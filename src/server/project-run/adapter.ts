// ▶ Resume / ⏸ Pause project's seam (types.ts) made from the real office: a floor's worker manager,
// GitHub lists, Studio mode and chatter, git for the safety checks, the office's roster and workflow
// engine. One service per office, made on first use; startProjectRuns (office/timers.ts) makes it as
// the office starts, so a run a restart cut off carries on.

import type { WorkerInfo } from '../../shared/protocol.js';
import { findTranscript } from '../analysis/transcript.js';
import { noteChatter, OFFICE } from '../chatter/bus.js';
import { chatterOf } from '../chatter/office.js';
import type { Floor } from '../floor.js';
import { flowsOf } from '../flow/index.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { studioStateOf } from '../studio/index.js';
import { ProjectRuns } from './index.js';
import { mergesSince, probeAgent } from './safety.js';
import { useProjectRunFile } from './store.js';
import type { RunFloor } from './types.js';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('cancelled'));
    const t = setTimeout(() => (signal.removeEventListener('abort', stop), resolve()), ms);
    const stop = () => (clearTimeout(t), reject(new Error('cancelled')));
    signal.addEventListener('abort', stop, { once: true });
  });

function runFloor(ctx: Ctx, floor: Floor): RunFloor {
  const team = teamFloor(ctx, floor);
  const base = (w: WorkerInfo) => w.worktree?.from ?? floor.project.branch ?? undefined;
  return {
    team,
    base: floor.project.branch ?? undefined,
    pulls: () => floor.github.pulls.items,
    issues: () => floor.github.issues.items,
    cutOff: (id) => floor.workers.cutOff(id),
    sleep: (id) => floor.workers.sleep(id),
    studioOpen: () => !!studioStateOf(floor.id)?.open,
    chatter: (name, since) =>
      chatterOf(ctx)
        .page(floor.id, { since, limit: 20, filter: { with: 'person', name } })
        .messages.reverse()
        .map((m) => `${m.from.name} → ${'group' in m.to ? m.to.group : m.to.name}: ${m.text}`),
    probe: (w, mergedPr) => {
      const cwd = team.cwdOf(w);
      const resumable = !!w.sessionId && (w.provider !== 'claude' || !!findTranscript(w.sessionId, cwd));
      return probeAgent(cwd, { base: base(w), worktree: !!w.worktree, mergedPr, resumable: !w.lost && resumable });
    },
    merges: (w, since) => mergesSince(team.cwdOf(w), base(w), since),
  };
}

const offices = new WeakMap<object, ProjectRuns>();

/** The office's Resume / Pause project service: made on first use. */
export function projectRunsOf(ctx: Ctx): ProjectRuns {
  let r = offices.get(ctx.cfg);
  if (!r) {
    useProjectRunFile(ctx.cfg.dataDir);
    r = new ProjectRuns({
      roster: rosterOf(ctx),
      engine: flowsOf(ctx),
      floor: (id) => {
        const f = ctx.floors.get(id);
        return f && runFloor(ctx, f);
      },
      now: () => Date.now(),
      sleep,
      chatter: (floorId, text) => noteChatter(floorId, { kind: 'relay', from: OFFICE, to: { group: 'team' }, text }),
    });
    offices.set(ctx.cfg, r);
  }
  return r;
}

/** Makes the service as the office starts (its pauses loaded before any prompt goes out) and carries on cut-off runs. */
export function startProjectRuns(ctx: Ctx): () => void {
  const runs = projectRunsOf(ctx);
  // The floors open first: a run is only carried on for a floor that's there.
  const t = setTimeout(() => runs.carryOn(), 5_000);
  t.unref?.();
  return () => clearTimeout(t);
}
