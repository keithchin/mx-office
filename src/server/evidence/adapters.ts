// Read-only adapters (gap map 4.2): each maps one kind of existing record to trace events, with an
// EvidenceRef back to it. The records are never changed. An id a record didn't carry is worked out from
// the ids it did (marked `inferred`) or listed as a gap with the reason, and a cost the office couldn't
// measure is `unknown`, never 0.

import type { RunRecord } from '../../shared/analysis.js';
import type { AuditEvent } from '../../shared/audit.js';
import type { SpendRow } from '../../shared/budget/types.js';
import type { ChatterMessage } from '../../shared/chatter.js';
import { issueTaskId, isRoleId, legacyQueueTaskId, workerInstanceId, type IdField } from '../../shared/evidence/ids.js';
import type { Measured, TraceEvent, TraceEventType } from '../../shared/evidence/types.js';
import type { Incident } from '../../shared/incidents.js';
import { envelope, evidenceRef, firstFound, inferred, recorded, sha256, wasRedacted, type Found } from './refs.js';

/** What every adapter is told about the floor it reads for. */
export interface AdapterCtx {
  floorId: string;
  /** The floor's repository (owner/name), for issue task ids. */
  repo?: string;
  /** The project the floor is now; old records don't carry it, so it's always inferred from the floor id. */
  projectId?: string;
  now: number;
}

const NO_EXECUTION = 'no execution id is recorded before delivery attempts exist (gap map F2)';
const NO_SESSION = 'this source does not record the provider session';

const projectOf = (c: AdapterCtx, recordedId?: string): Found => firstFound(recorded(recordedId, ''), inferred(c.projectId, 'the floor has no project id yet'));

// ---- Audit ---------------------------------------------------------------------------------------

/** Audit actions as spec events; everything else is `other`, with its action kept. */
export function auditEventType(e: Pick<AuditEvent, 'action' | 'actor'>): TraceEventType {
  const a = e.action;
  if (a === 'queue.start' || a === 'worker.hire') return 'task.assigned';
  if (a === 'escalation.raise') return 'escalation.raised';
  if (a === 'escalation.answer') return 'escalation.resolved';
  if (a === 'pr.open') return 'artifact.submitted';
  if (a === 'firm.delivered') return 'review.completed';
  if (a === 'flow.start') return 'execution.started';
  if (a === 'flow.finish') return 'execution.completed';
  if (a === 'flow.fail' || a === 'flow.cancel') return 'execution.aborted';
  if (a === 'incident.created') return 'incident.recorded';
  if (e.actor.kind === 'human' && (a === 'worker.prompt' || a === 'proposal.decide' || a === 'pr.merge' || a === 'budget.resume' || a.startsWith('phone.'))) return 'human.intervention';
  if (a.startsWith('budget.')) return 'budget.updated';
  return 'other';
}

export function fromAudit(e: AuditEvent, c: AdapterCtx, sequence?: number): TraceEvent {
  const ids = e.ids ?? {};
  const workerish = e.actor.kind === 'agent' ? e.actor.id : e.target?.kind === 'worker' ? e.target.id : undefined;
  const details = e.details ?? {};
  const issue = e.target?.kind === 'issue' ? Number(String(e.target.id ?? '').replace(/^#/, '')) : typeof details.issue === 'number' ? details.issue : undefined;
  const queued = typeof details.task === 'string' ? legacyQueueTaskId(c.floorId, details.task) : undefined;
  const found: Record<IdField, Found> = {
    projectId: projectOf(c, ids.projectId),
    executionId: recorded(ids.executionId, NO_EXECUTION),
    taskId: firstFound(recorded(ids.taskId, ''), inferred(queued, ''), inferred(issueTaskId(c.repo, issue), 'the event names no queue task or issue')),
    agentInstanceId: firstFound(recorded(ids.agentInstanceId, ''), inferred(workerInstanceId(workerish), 'no worker acted or was acted on')),
    roleId: recorded(ids.roleId, 'audit events do not record the role covered'),
    sessionId: recorded(ids.sessionId, NO_SESSION),
  };
  const floorKey = e.floor || '_office';
  return envelope({
    eventId: `audit:${e.id}`,
    occurredAt: e.at,
    ingestedAt: c.now,
    floorId: e.floor,
    ids: found,
    spanId: ids.spanId,
    parentSpanId: ids.parentSpanId,
    sequence,
    eventType: auditEventType(e),
    action: e.action,
    summary: e.summary,
    payload: { actor: e.actor, ...(e.target ? { target: e.target } : {}), ...(e.details ? { details: e.details } : {}), severity: e.severity },
    source: evidenceRef({ kind: 'trace_event', sourceSystem: 'audit', sourceId: e.id, sourceVersion: e.hash, contentHash: e.hash, locator: `audit:${floorKey}:${e.id}`, retentionClass: 'audit-90d', projectId: ids.projectId ?? c.projectId, capturedAt: c.now }),
    redacted: wasRedacted([e.summary, e.target, e.details]),
  });
}

// ---- Chatter -------------------------------------------------------------------------------------

const CHATTER_TYPES: Partial<Record<ChatterMessage['kind'], TraceEventType>> = {
  escalation: 'escalation.raised',
  answer: 'escalation.resolved',
  handoff: 'handoff.completed',
  dispatch: 'task.assigned',
  review: 'review.completed',
};

export function chatterEventType(m: Pick<ChatterMessage, 'kind' | 'from'>): TraceEventType {
  return CHATTER_TYPES[m.kind] ?? (m.from.kind === 'human' ? 'human.intervention' : 'other');
}

export function fromChatter(m: ChatterMessage, c: AdapterCtx): TraceEvent {
  const found: Record<IdField, Found> = {
    projectId: projectOf(c),
    executionId: { reason: NO_EXECUTION },
    taskId: { reason: 'chatter names no task' },
    agentInstanceId: firstFound(recorded(workerInstanceId(m.from.workerId), ''), recorded(workerInstanceId(m.ref?.worker), m.from.kind === 'agent' ? 'the speaker is not a worker at a desk (a subagent or the office)' : `the speaker is a ${m.from.kind}, not an agent`)),
    roleId: recorded(isRoleId(m.from.roleId) ? m.from.roleId : undefined, 'the speaker has no roster role'),
    sessionId: { reason: NO_SESSION },
  };
  return envelope({
    eventId: `chatter:${m.floor}:${m.id}`,
    occurredAt: m.at,
    ingestedAt: c.now,
    floorId: m.floor,
    ids: found,
    eventType: chatterEventType(m),
    action: `chatter.${m.kind}`,
    summary: m.text,
    payload: { from: m.from, to: m.to, ...(m.ref ? { ref: m.ref } : {}), derived: true },
    source: evidenceRef({ kind: 'trace_event', sourceSystem: 'chatter', sourceId: m.id, record: m, locator: `chatter:${m.floor}:${m.id}`, retentionClass: 'chatter-capped', projectId: c.projectId, capturedAt: c.now }),
    redacted: wasRedacted(m.text),
  });
}

// ---- Analysis runs -------------------------------------------------------------------------------

/** A run's cost and tokens as the office knows them: priced from its own table for Claude, unknown for providers it can't meter. */
export function runMeasures(r: RunRecord): { cost: Measured; tokens: Measured; toolCalls: Measured } {
  const metered = r.provider === 'claude';
  const why = `the office does not meter ${r.provider || 'this provider'}`;
  const tokens = r.tokens.input + r.tokens.output + r.tokens.cacheWrite + r.tokens.cacheRead;
  return {
    cost: metered ? { status: 'estimated', value: r.cost } : { status: 'unknown', reason: why },
    tokens: metered ? { status: 'observed', value: tokens } : { status: 'unknown', reason: why },
    toolCalls: metered ? { status: 'observed', value: r.toolCalls } : { status: 'unknown', reason: 'only Claude transcripts are read for tool calls' },
  };
}

/** A run as two events: it started, and (unless it's still running) it ended. */
export function fromRun(r: RunRecord, c: AdapterCtx): TraceEvent[] {
  const found: Record<IdField, Found> = {
    projectId: projectOf(c),
    executionId: { reason: `${NO_EXECUTION}; a run record spans a worker's whole task` },
    taskId: inferred(issueTaskId(r.repo ?? c.repo, r.issue), 'the run names no issue'),
    agentInstanceId: recorded(workerInstanceId(r.workerId), 'the run names no worker'),
    roleId: { reason: 'run records do not store the role' },
    sessionId: { reason: NO_SESSION },
  };
  const source = evidenceRef({ kind: 'trace_event', sourceSystem: 'analysis', sourceId: r.id, sourceVersion: String(r.updatedAt), record: r, locator: `analysis:${r.id}`, retentionClass: 'permanent', projectId: c.projectId, capturedAt: c.now });
  const base = { ingestedAt: c.now, floorId: r.floor, ids: found, source, redacted: wasRedacted(r.prompt) };
  const started = envelope({ ...base, eventId: `analysis:${r.id}:started`, occurredAt: r.startedAt, eventType: 'execution.started', action: 'run.started', summary: `${r.worker} started “${r.title}” on ${r.modelLabel}`, payload: { provider: r.provider, model: r.model, effort: r.effort, issue: r.issue } });
  if (r.outcome === 'running') return [started];
  const m = runMeasures(r);
  const payload = {
    outcome: r.outcome,
    outcomeMeans: 'pull request state, not acceptance',
    durationMs: r.durationMs,
    activeMs: r.activeMs,
    cost: m.cost,
    tokens: m.tokens,
    toolCalls: m.toolCalls,
    humanPrompts: r.humanPrompts,
    needsInput: { status: 'observed-live-only', count: r.needsInput, ms: r.needsInputMs },
    ...(r.pr ? { pr: { number: r.pr.number, state: r.pr.state, checks: r.pr.checks } } : {}),
    ...(r.scorecard ? { scorecard: r.scorecard } : {}),
  };
  return [started, envelope({ ...base, eventId: `analysis:${r.id}:ended`, occurredAt: r.endedAt, eventType: 'execution.completed', action: `run.${r.outcome}`, summary: `${r.worker} finished “${r.title}”: ${r.outcome}`, payload })];
}

// ---- Budget ledger rows --------------------------------------------------------------------------

/** A ledger row's identity (day × agent × model × stage × work × kind), as a short stable key. */
export const spendRowKey = (r: SpendRow) => `${r.day}.${sha256(JSON.stringify([r.day, r.agent, r.model, r.stage, r.issue ?? null, r.pr ?? null, !!r.est, !!r.unmetered])).slice(0, 12)}`;

export function spendCost(r: SpendRow): Measured {
  if (r.unmetered) return { status: 'unknown', reason: 'a provider the office cannot price: calls are counted, cost is not' };
  return { status: 'estimated', value: r.cost };
}

function spendAgent(agent: string): Found {
  if (agent.startsWith('bg:')) return { reason: `a background call (${agent.slice(3)}), not an agent instance` };
  const [lead, sub] = agent.split('/');
  if (sub) return { reason: 'subagent spend is kept by subagent type under its Lead, not by agent_id' };
  return recorded(workerInstanceId(lead), 'the row names no worker');
}

export function fromSpendRow(r: SpendRow, c: AdapterCtx): TraceEvent {
  const key = spendRowKey(r);
  const found: Record<IdField, Found> = {
    projectId: projectOf(c),
    executionId: { reason: NO_EXECUTION },
    taskId: inferred(issueTaskId(c.repo, r.issue), r.pr !== undefined ? 'the row names a pull request, not a task' : 'the row names no issue'),
    agentInstanceId: spendAgent(r.agent),
    roleId: { reason: 'ledger rows keep a role title, not a roster role id' },
    sessionId: { reason: NO_SESSION },
  };
  const day = Date.parse(`${r.day}T00:00:00Z`);
  return envelope({
    eventId: `budget:${c.floorId}:${key}`,
    occurredAt: Number.isFinite(day) ? day : 0,
    ingestedAt: c.now,
    floorId: c.floorId,
    ids: found,
    eventType: 'budget.updated',
    action: 'budget.spend',
    summary: `${r.calls} call${r.calls === 1 ? '' : 's'} on ${r.model} by ${r.agent} (${r.day})`,
    payload: { day: r.day, timePrecision: 'day', agent: r.agent, model: r.model, stage: r.stage, issue: r.issue, pr: r.pr, calls: r.calls, cost: spendCost(r), ...(r.est ? { backfilled: true } : {}) },
    source: evidenceRef({ kind: 'trace_event', sourceSystem: 'budget', sourceId: key, sourceVersion: r.day, record: r, locator: `budget:${c.floorId}:${key}`, retentionClass: 'ledger-30d', projectId: c.projectId, capturedAt: c.now }),
    redacted: false,
  });
}

// ---- Incidents -----------------------------------------------------------------------------------

export function fromIncident(i: Incident, c: AdapterCtx): TraceEvent {
  const workers = i.workers.filter((w) => !w.floor || w.floor === c.floorId);
  const only = workers.length === 1 ? workerInstanceId(workers[0].id) : undefined;
  const found: Record<IdField, Found> = {
    projectId: projectOf(c),
    executionId: { reason: NO_EXECUTION },
    taskId: { reason: 'incidents link audit events and workers, not tasks' },
    agentInstanceId: recorded(only, workers.length > 1 ? 'the incident involves several workers (see payload)' : 'the incident names no worker'),
    roleId: { reason: 'incidents do not record roles' },
    sessionId: { reason: NO_SESSION },
  };
  const ref = `INC-${i.number}`;
  return envelope({
    eventId: `incidents:${i.id}`,
    occurredAt: i.detectedAt,
    ingestedAt: c.now,
    floorId: c.floorId,
    ids: found,
    eventType: 'incident.recorded',
    action: `incident.${i.status}`,
    summary: `${ref} ${i.title}`,
    payload: { number: i.number, severity: i.severity, status: i.status, detectedBy: i.detectedBy, workers, auditIds: i.auditIds, occurrences: i.occurrences, ...(i.resolvedAt ? { resolvedAt: i.resolvedAt } : {}), actions: i.actions.map((a) => ({ status: a.status, ...(a.link ? { link: a.link } : {}) })) },
    source: evidenceRef({ kind: 'incident', sourceSystem: 'incidents', sourceId: ref, sourceVersion: String(i.updatedAt), record: i, locator: `incidents:${i.id}`, retentionClass: 'permanent', projectId: c.projectId, capturedAt: c.now }),
    redacted: wasRedacted([i.summary, i.timeline]),
  });
}
