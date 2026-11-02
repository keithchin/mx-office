// What an agent has running in the office's background (release 83, a real build: the automatic back-to-work
// nudge re-pasted a Lead's original task about ten times while its test chain ran, each costing a turn). The
// roster asks this before nudging (RosterDeps.background): a Lead waiting on its microflow tests, its journeys or
// its app instance starting isn't stopped with its task open, it is waiting for the office. In memory only.
//   * its microflow test run (testing/mxcli-office.ts testRunOf: the project's run, started by it);
//   * its batch of journeys (./journey-batch.ts), or a single journey or smoke run under way (noteRun, ./hook.ts);
//   * its app instance starting (./service.ts).

import type { Ctx } from '../office/context.js';
import { testRunOf } from '../testing/mxcli-office.js';
import { batchOf } from './journey-batch.js';
import { agentAppsOf } from './office.js';

const runs = new Map<string, number>();
const keyOf = (floorId: string, workerId: string) => `${floorId}\u0000${workerId}`;

/** A single journey or smoke run for the agent began (true) or ended (false). */
export function noteRun(floorId: string, workerId: string, on: boolean) {
  const k = keyOf(floorId, workerId);
  const n = (runs.get(k) ?? 0) + (on ? 1 : -1);
  if (n > 0) runs.set(k, n);
  else runs.delete(k);
}

export interface BackgroundLook {
  /** The project's microflow test run: running, and who started it. */
  tests?: { running: boolean; by?: string; commit?: string };
  journeys?: boolean;
  single?: boolean;
  instance?: string;
}

/** The words for what the agent waits on, or undefined when nothing of its runs in the background. Pure. */
export function backgroundWords(name: string, l: BackgroundLook): string | undefined {
  if (l.tests?.running && l.tests.by === name) return `its microflow tests${l.tests.commit ? ` at @${l.tests.commit.slice(0, 7)}` : ''} are running`;
  if (l.journeys) return 'its journeys are running';
  if (l.single) return 'a journey or smoke run of its is under way';
  if (l.instance === 'starting') return 'its app instance is starting';
  return undefined;
}

/** What the worker has running in the office's background now, in words, or undefined. */
export function backgroundWorkOf(ctx: Pick<Ctx, 'cfg' | 'floors'>, floorId: string, workerId: string, name: string): string | undefined {
  try {
    const t = testRunOf(floorId);
    return backgroundWords(name, {
      tests: { running: t.running, ...(t.by ? { by: t.by } : {}), ...(t.commit ? { commit: t.commit } : {}) },
      journeys: !!batchOf(floorId, workerId)?.running,
      single: runs.has(keyOf(floorId, workerId)),
      instance: agentAppsOf(ctx).view(floorId, workerId, false)?.state,
    });
  } catch {
    return undefined;
  }
}
