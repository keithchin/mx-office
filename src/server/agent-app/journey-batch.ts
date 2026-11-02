// Several journeys on an agent's app instance in one go, in the background (release 83, a real build): agents ran
// their regression and sequence runs straight with node (`node tests/e2e/J-01.journey.js`), outside the office, so
// the merge gate saw only their own summary check. Why they went round `office-app journey`:
//   * it took one journey per call, so a regression run of twelve was twelve calls;
//   * each call held its HTTP answer until the journey ended, and a cold .journey.js run takes minutes: past the
//     agent's own command time limit (Claude Code's Bash tool stops a command after 2 min by default), so the
//     command was killed and the agent ran the script itself.
// Now `office-app journey --all` / `--ids J-01,J-02` (and one id) starts a batch here and answers at once; the batch
// plays each journey in turn through ./journey.ts runJourney (each recorded on its own at the instance's commit, by
// its id: the Testing page, the change's Checks and the merge gate read them per journey) and `office-app journey`
// polls GET /office/app/journeys, printing each result as it lands (`--no-wait` to look later). One batch per agent;
// the instance's idle clock is touched before each journey, and a stopped instance ends the batch.

import { outcomeWords, SEED_JOURNEY, type RunOutcome } from '../../shared/agent-app.js';
import { scriptOf } from '../../shared/walkthroughs/script.js';
import { listFiles, readFiles } from '../testing/repo.js';
import { JOURNEY_FILE } from './identity.js';
import { jsJourneyId } from './journey-js.js';
import { runJourney, type JourneyDeps } from './journey.js';
import type { AgentApp } from './service.js';

/** At most this many journeys in one batch. */
export const BATCH_MAX = 60;

export interface BatchResult {
  id: string;
  status: RunOutcome['status'];
  record?: string;
  words: string;
}

export interface JourneyBatch {
  floorId: string;
  workerId: string;
  commit: string;
  ids: string[];
  results: BatchResult[];
  running: boolean;
  current?: string;
  startedAt: number;
  endedAt?: number;
  /** Why it stopped early (the instance stopped). */
  stopped?: string;
}

/** The journeys at the instance's commit: id → path (toolkit .journey.json and the project's .journey.js), without the seed journey. */
export async function journeysAt(floorDir: string, commit: string): Promise<Map<string, string>> {
  const files = (await listFiles(floorDir, commit, ['tests']).catch(() => [] as string[])).filter((f) => JOURNEY_FILE.test(f) && f !== SEED_JOURNEY).slice(0, 300);
  const texts = await readFiles(floorDir, commit, files, 512 * 1024);
  const out = new Map<string, string>();
  for (const f of files) {
    const text = texts.get(f) ?? '';
    if (/\.json$/i.test(f)) {
      const sc = scriptOf(f, text);
      if (typeof sc !== 'string' && !out.has(sc.journey)) out.set(sc.journey, f);
    } else {
      const id = jsJourneyId(f, text);
      if (!out.has(id)) out.set(id, f);
    }
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
}

const batches = new Map<string, JourneyBatch>();
const keyOf = (floorId: string, workerId: string) => `${floorId}\u0000${workerId}`;

/** The agent's batch now (running, or its last one). */
export const batchOf = (floorId: string, workerId: string): JourneyBatch | undefined => batches.get(keyOf(floorId, workerId));

/** A batch's state in lines: what passed, failed or didn't run, and what is left. */
export function batchWords(b: JourneyBatch): string {
  const n = (s: RunOutcome['status']) => b.results.filter((r) => r.status === s).length;
  const left = b.ids.length - b.results.length;
  const head = `Journeys @${b.commit.slice(0, 7)}: ${b.results.length} of ${b.ids.length} run (${n('passed')} passed, ${n('failed')} failed, ${n('error')} did not run)${b.running ? `; now ${b.current ?? 'starting'}, ${left} left` : left ? `; ${left} not run${b.stopped ? ` (${b.stopped})` : ''}` : ''}`;
  const lines = [head, ...b.results.map((r) => `  ${r.id}: ${r.status.toUpperCase()}${r.record ? ` (record ${r.record})` : ''}`)];
  if (!b.running) lines.push(`  Each is recorded on its own at ${b.commit.slice(0, 7)} by its journey id: the change's Checks and the merge gate read them.`);
  return lines.join('\n');
}

export interface BatchAsk {
  /** Every journey at the commit. */
  all?: boolean;
  /** These journey ids (or paths). */
  ids?: string[];
}

/**
 * Starts a batch on the agent's ready instance: the journeys asked for, in turn, each recorded at its commit.
 * The batch, or why not (none asked, none there, one already running).
 */
export async function startBatch(e: AgentApp, ask: BatchAsk, d: JourneyDeps, hooks: { touch?: () => void; onEnd?: (b: JourneyBatch) => void; run?: typeof runJourney; now?: () => number } = {}): Promise<JourneyBatch | string> {
  const key = keyOf(e.floorId, e.workerId);
  if (batches.get(key)?.running) return 'A batch of journeys is already running on your instance: office-app journey --status says how far it is';
  let ids: string[];
  if (ask.all) {
    ids = [...(await journeysAt(d.floorDir, e.commit)).keys()];
    if (!ids.length) return `No journeys at ${e.commit.slice(0, 7)} (tests/**/*.journey.json or *.journey.js): commit them first`;
  } else ids = [...new Set((ask.ids ?? []).map((x) => x.trim()).filter(Boolean))];
  if (!ids.length) return 'Say which journeys: --ids J-01,J-02, or --all';
  if (ids.length > BATCH_MAX) return `At most ${BATCH_MAX} journeys in one batch (asked ${ids.length}): split it with --ids`;
  const now = hooks.now ?? Date.now;
  const b: JourneyBatch = { floorId: e.floorId, workerId: e.workerId, commit: e.commit, ids, results: [], running: true, startedAt: now() };
  batches.set(key, b);
  void (async () => {
    try {
      for (const id of ids) {
        if (e.abort.signal.aborted || !e.instance) {
          b.stopped = 'the instance stopped';
          break;
        }
        b.current = id;
        hooks.touch?.();
        const o = await (hooks.run ?? runJourney)(e, { journey: id }, d).catch((err: Error): RunOutcome => ({ suite: `journey ${id}`, commit: e.commit, status: 'error', failure: err.message }));
        hooks.touch?.();
        b.results.push({ id, status: o.status, ...(o.record ? { record: o.record } : {}), words: outcomeWords(o) });
      }
    } finally {
      b.running = false;
      b.current = undefined;
      b.endedAt = now();
      try {
        hooks.onEnd?.(b);
      } catch {
        // A listener's trouble isn't the batch's.
      }
    }
  })();
  return b;
}

/** Tests: forget every batch. */
export const forgetBatches = () => batches.clear();
