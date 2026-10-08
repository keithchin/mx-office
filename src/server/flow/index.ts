// The office's workflow engine (engine.ts): one per office, made on first use, with its runs kept in
// <office data>/flows/. Every run's start, finish, failure, pause and cancel goes in the audit log as
// the office's doing. A feature registers its workflow on it and starts runs; GET /api/flows lists them.

import path from 'node:path';
import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { FlowEngine } from './engine.js';
import { FileStore } from './store.js';
import type { RunRecord } from './types.js';

export { FlowEngine, DEFAULT_MAX_STEPS, type EngineOptions, type ListFilter } from './engine.js';
export { FileStore, writeJsonAtomic, type CheckpointStore } from './store.js';
export { backoffMs, transientError } from './retry.js';
export * from './types.js';

const ACTOR = { kind: 'office' as const, name: 'Workflows' };

const target = (run: RunRecord) => ({ kind: 'workflow', id: run.runId, label: `${run.workflow} ${run.runId}`.slice(0, 120) });

/** Writes a run's lifecycle into the audit log. Steps themselves aren't logged: the run's history has them. */
export function auditFlows(engine: FlowEngine) {
  engine.on('run-started', ({ run, resumed }) =>
    audit.record({ floor: run.floor, actor: ACTOR, action: 'flow.start', target: target(run), summary: `${resumed ? 'Resumed' : 'Started'} the ${run.workflow} workflow at ${run.step}`, details: { by: run.by, step: run.step, resumed } }),
  );
  engine.on('run-paused', ({ run, reason }) =>
    audit.record({ floor: run.floor, actor: ACTOR, action: reason.kind === 'interrupt' ? 'flow.wait' : 'flow.pause', target: target(run), summary: `The ${run.workflow} workflow stopped: ${reason.message}`, details: { step: run.step, reason: reason.kind, edge: reason.edge }, severity: reason.kind === 'manual' ? 'info' : 'notice' }),
  );
  engine.on('run-finished', ({ run, status }) =>
    audit.record({
      floor: run.floor,
      actor: ACTOR,
      action: status === 'done' ? 'flow.finish' : status === 'failed' ? 'flow.fail' : 'flow.cancel',
      target: target(run),
      summary: status === 'done' ? `The ${run.workflow} workflow finished` : status === 'failed' ? `The ${run.workflow} workflow failed at ${run.step}: ${run.error ?? 'no reason given'}` : `The ${run.workflow} workflow was cancelled`,
      details: { step: run.step, error: run.error, usage: run.usage },
      severity: status === 'failed' ? 'warning' : 'info',
    }),
  );
}

const offices = new WeakMap<object, FlowEngine>();

/** The office's engine: made on first use (loading every saved run), then the same one each time. */
export function flowsOf(ctx: Pick<Ctx, 'cfg'>): FlowEngine {
  let e = offices.get(ctx.cfg);
  if (!e) {
    // Checkpoints written in the background (flow/store.ts).
    e = new FlowEngine({ store: new FileStore(path.join(ctx.cfg.dataDir, 'flows'), { background: true }) });
    auditFlows(e);
    offices.set(ctx.cfg, e);
  }
  return e;
}
