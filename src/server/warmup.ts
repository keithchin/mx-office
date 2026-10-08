// Warming the caches the first looks at a floor would otherwise wait on. Right after the office starts
// (and after a floor is added), the first Budget look built the whole worker ranking and the setup
// panel's first look ran git four to six times: 1.5 to 3.5 s before an answer on a big project (the
// performance guard, 2026-10-07). So once the office is up, and whenever a new floor opens, the
// ranking and each floor's setup view are worked out in the background, one floor at a time with a
// gap between, so other work goes first. Their caches answer stale-while-revalidate from then on
// (ranking/index.ts, wizard/index.ts), so no look waits on them again.

import type { Ctx } from './office/context.js';
import type { Floor } from './floor.js';
import { primeRanking } from './ranking/index.js';
import { wizardOf } from './wizard/index.js';
import { dayIn, DEFAULT_SCHEDULE } from '../shared/roster/schedule.js';
import { resolveCommandSoon } from './workers/process.js';

/** The programs the office looks for as its parts start (resolveCommand): looked up off the event loop first. */
const COMMANDS = ['claude', 'gh', 'git', 'mxcli', 'psql'];

export interface WarmupOptions {
  /** How long after the office starts before warming begins. */
  delayMs?: number;
  /** The pause between one warm-up step and the next. */
  gapMs?: number;
  /** How often to look for floors added since. */
  pollMs?: number;
  /** What warms a floor (tests); the ranking and the setup view by default. */
  warm?: (floor: Floor | undefined) => Promise<void> | void;
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

/** The default warm-up for one floor (or, with none, the building's ranking). Never throws. */
async function warmFloor(ctx: Ctx, floor: Floor | undefined): Promise<void> {
  // The standup clock's time zone, loaded now rather than at the first worker update (50–100 ms on a loaded machine).
  if (!floor) {
    dayIn(Date.now(), DEFAULT_SCHEDULE.timeZone);
    await Promise.all(COMMANDS.map((c) => resolveCommandSoon(c).catch(() => undefined)));
  }
  try {
    await primeRanking(ctx, floor?.id);
  } catch {
    // no ranking yet: the first look works it out
  }
  if (!floor) return;
  try {
    await wizardOf(ctx).setup(floor);
  } catch {
    // the panel's own look says what's wrong
  }
}

/** Starts warming (see above). Returns what stops it. */
export function startWarmup(ctx: Pick<Ctx, 'floors'> & Partial<Ctx>, opts: WarmupOptions = {}): () => void {
  const gap = opts.gapMs ?? 300;
  const warm = opts.warm ?? ((f: Floor | undefined) => warmFloor(ctx as Ctx, f));
  const seen = new Set<string>();
  let stopped = false;
  let running = false;

  const pass = async (first: boolean) => {
    if (running || stopped) return;
    const fresh = [...ctx.floors.values()].filter((f) => !seen.has(f.id));
    if (!fresh.length && !first) return;
    running = true;
    try {
      for (const f of fresh) seen.add(f.id);
      if (first) {
        await warm(undefined);
        await pause(gap);
      }
      for (const f of fresh) {
        if (stopped) return;
        await warm(f);
        await pause(gap);
      }
    } finally {
      running = false;
    }
  };

  const start = setTimeout(() => void pass(true), opts.delayMs ?? 3000);
  start.unref();
  const poll = setInterval(() => void pass(false), opts.pollMs ?? 5000);
  poll.unref();
  return () => {
    stopped = true;
    clearTimeout(start);
    clearInterval(poll);
  };
}
