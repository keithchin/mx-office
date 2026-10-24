// The push watch: direct and force pushes to a project's default branch seen without waiting for something
// else to fetch (review-gate/pushes.ts finds them; it only reads the local copy of origin). Nothing in the
// office fetches main on a clock of its own (the PR list polls GitHub, but a push without a pull request
// doesn't show there), so a push could sit unseen for minutes. This looks a little after the office
// starts (after the folder sync's first fetch), so a commit made while the office was down is compared with
// the baseline on disk at once, and then now and then: every 2 minutes for a project whose GitHub polling
// isn't working (no PR list, or the last one failed), every 10 minutes otherwise.
//
// Cheap and bounded: a tick a minute, at most MAX_PER_TICK projects per tick, one at a time, never two ticks
// at once; per project one `git ls-remote` of the default branch (a few hundred bytes), a fetch only when
// GitHub's head differs from the local copy (through wizard/gate-source.ts fetchDefault, which tells the
// folder sync), and the local push check. A project something else fetched lately is skipped. Local-only
// projects and folders without an origin are never asked. New events make Needs you look soon.

import { gitOff } from '../floor-sync/index.js';
import { onOriginNews } from '../floor-sync/bus.js';
import { localOnlyAt } from '../local-only.js';
import { defaultBranch, fetchDefault } from '../wizard/gate-source.js';
import { checkPushes, type PushLook } from '../review-gate/pushes.js';
import { externalCheck } from '../data-impact/external.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';

/** The first look waits this long after the start (the folder sync's first fetch is at 20 s). */
export const START_MS = 60_000;
export const TICK_MS = 60_000;
/** How often a project is looked at when its GitHub polling isn't working, and when it is. */
export const NO_POLL_EVERY_MS = 2 * 60_000;
export const POLL_EVERY_MS = 10 * 60_000;
/** The PR list counts as working when it came back without an error within this long. */
const POLL_FRESH_MS = 5 * 60_000;
export const MAX_PER_TICK = 2;
const LS_REMOTE_MS = 15_000;

/** A project as the watch sees it. */
export interface WatchFloor {
  id: string;
  dir: string;
  /** Its PR list is coming back from GitHub. */
  polling(now: number): boolean;
  /** The PR merge commits it knows. */
  merges(): ReadonlySet<string>;
}

export interface WatchDeps {
  floors(): WatchFloor[];
  /** origin's default branch name, and its head on GitHub (undefined: couldn't ask). */
  defaultBranch(dir: string): Promise<string | undefined>;
  remoteHead(dir: string, branch: string): Promise<string | undefined>;
  /** The local copy of origin/<branch>. */
  localHead(dir: string, branch: string): Promise<string | undefined>;
  fetch(dir: string, branch: string): Promise<void>;
  check(floorId: string, dir: string, main: { branch: string; sha: string }, merges: ReadonlySet<string>): Promise<PushLook>;
  /** New events: Needs you looks again soon. */
  found(floorId: string, look: PushLook): void;
  localOnly(dir: string): boolean;
  now(): number;
}

export class PushWatch {
  private lookedAt = new Map<string, number>();
  private fetchedAt = new Map<string, number>();
  private busy = false;
  /** Looks done (the tests' and the perf check's count). */
  looks = 0;

  constructor(private readonly deps: WatchDeps) {}

  /** Something else fetched the folder at `dir` just now: it needn't be fetched again for a while. */
  heardFetch(dir: string) {
    this.fetchedAt.set(dir, this.deps.now());
  }

  /** The projects due now, the longest unlooked first, at most MAX_PER_TICK. */
  due(): WatchFloor[] {
    const now = this.deps.now();
    return this.deps
      .floors()
      .filter((f) => !this.deps.localOnly(f.dir))
      .filter((f) => {
        const every = f.polling(now) ? POLL_EVERY_MS : NO_POLL_EVERY_MS;
        return now - (this.lookedAt.get(f.id) ?? -Infinity) >= every;
      })
      .sort((a, b) => (this.lookedAt.get(a.id) ?? 0) - (this.lookedAt.get(b.id) ?? 0))
      .slice(0, MAX_PER_TICK);
  }

  /** One project: ask GitHub's head, fetch when it moved, then the push check. Never throws. */
  async lookAt(f: WatchFloor): Promise<PushLook | undefined> {
    const now = this.deps.now();
    this.lookedAt.set(f.id, now);
    this.looks++;
    try {
      const branch = await this.deps.defaultBranch(f.dir);
      if (!branch) return undefined;
      const every = f.polling(now) ? POLL_EVERY_MS : NO_POLL_EVERY_MS;
      if (now - (this.fetchedAt.get(f.dir) ?? -Infinity) >= every) {
        const [remote, local] = await Promise.all([this.deps.remoteHead(f.dir, branch), this.deps.localHead(f.dir, branch)]);
        if (remote && remote !== local) await this.deps.fetch(f.dir, branch);
      }
      const sha = await this.deps.localHead(f.dir, branch);
      if (!sha) return undefined;
      const look = await this.deps.check(f.id, f.dir, { branch, sha }, f.merges());
      if (look.fresh.length) this.deps.found(f.id, look);
      return look;
    } catch {
      return undefined;
    }
  }

  /** One tick: the due projects, one at a time; skipped while the last tick is still going. */
  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const list = this.due();
      for (const f of list) await this.lookAt(f);
      return list.length;
    } finally {
      this.busy = false;
    }
  }
}

const pollingOf = (floor: Floor) => (now: number) => {
  const p = floor.github?.pulls;
  return !!p && !p.error && p.fetchedAt > 0 && now - p.fetchedAt < POLL_FRESH_MS;
};

/** This machine's deps for the office's projects. */
export function machineWatchDeps(ctx: Pick<Ctx, 'floors' | 'cfg'>, found: WatchDeps['found']): WatchDeps {
  return {
    floors: () =>
      [...ctx.floors.values()].map((floor) => ({
        id: floor.id,
        dir: floor.dir,
        polling: pollingOf(floor),
        merges: () => new Set((floor.github?.pulls.items ?? []).flatMap((p) => (p.state === 'MERGED' && p.mergeCommit ? [p.mergeCommit] : []))),
      })),
    defaultBranch: (dir) => defaultBranch(dir),
    remoteHead: async (dir, branch) => {
      const r = await gitOff(['ls-remote', '--quiet', 'origin', `refs/heads/${branch}`], dir, LS_REMOTE_MS);
      return r.ok ? /^([0-9a-f]{40})\s/.exec(r.out)?.[1] : undefined;
    },
    localHead: async (dir, branch) => {
      const r = await gitOff(['rev-parse', '-q', '--verify', `refs/remotes/origin/${branch}^{commit}`], dir);
      return r.ok ? r.out.trim() || undefined : undefined;
    },
    fetch: (dir, branch) => fetchDefault(dir, branch, 0),
    check: (floorId, dir, main, merges) => {
      const floor = ctx.floors.get(floorId);
      return checkPushes(ctx.cfg.dataDir, floorId, dir, main, merges, Date.now(), floor && 'accounts' in ctx ? externalCheck(ctx as Ctx, floor) : undefined);
    },
    found,
    localOnly: (dir) => localOnlyAt(dir),
    now: Date.now,
  };
}

/** Starts the push watch (office/timers.ts). Returns what stops it. */
export function startPushWatch(ctx: Ctx): () => void {
  const watch = new PushWatch(
    machineWatchDeps(ctx, (floorId) => {
      // Loaded when needed: Needs you's look imports the review gate, which reads the pushes this found.
      void import('../asks/index.js').then((m) => m.asksOf(ctx).soon(floorId, 'the push check')).catch(() => undefined);
    }),
  );
  const off = onOriginNews((dir, news) => {
    if (news === 'fetched') watch.heardFetch(dir);
  });
  let timer: NodeJS.Timeout | undefined;
  const first = setTimeout(() => {
    void watch.tick();
    timer = setInterval(() => void watch.tick(), TICK_MS);
    timer.unref?.();
  }, START_MS);
  first.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    off();
  };
}
