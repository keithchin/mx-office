// The floor sync in the office: each floor's own checkout kept up to date with GitHub by safe
// fast-forwards (./sync.ts says when it's safe), so the folder Studio Pro opens has what main has.
// It looks when the office starts (once per floor, one at a time, a little after the floors open), when
// something in the office fetched a floor's origin or saw main move (./bus.ts), when someone walks onto
// a floor, and on demand before "Edit in Studio Pro" (http/routes/studio.ts). No polling of its own.
//
// A move goes in the audit log (floor.sync, from → to). A refusal goes there once per reason (and branch)
// until the folder is current again, never on every look; the last look is kept for the floor page, which
// shows it on the Studio Pro button and in what the button says when it can't open.

import { access } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { audit } from '../audit/index.js';
import { dropKeys, onForgetFloor } from '../office/forget.js';
import { execFileOff } from '../offloop/exec.js';
import { ensureLongPaths } from '../longpaths.js';
import { isBusy } from '../../shared/status.js';
import type { FloorSyncState } from '../../shared/studio.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { findMpr } from '../liveapp/checkout.js';
import { refindMpr, studioStateOf } from '../studio/index.js';
import { lockOf, machineDetect, sightFloor, studioProcesses } from '../studio/detect.js';
import { defaultBranch, fetchDefault } from '../wizard/gate-source.js';
import { onOriginNews, type OriginNews } from './bus.js';
import { refusalKey, syncFloor, type GitAnswer, type SyncDeps } from './sync.js';

/** The floor as the sync needs it. */
export type SyncFloor = Pick<Floor, 'id' | 'dir' | 'def' | 'workers'>;

/** After the office starts, the first look waits this long (the floors' own start-up comes first). */
const START_DELAY_MS = 20_000;
/** A fetch before a look waits at most this long; after that the look goes on with what's there. */
const FETCH_WAIT_MS = 20_000;
/** News about a floor that's current is looked at again at most this often. */
const NEWS_EVERY_MS = 15_000;
/** A floor the office refused to move is looked at again on news at most this often (asked, always). */
const REFUSED_EVERY_MS = 5 * 60_000;
/** Someone walking onto the floor fetches first, at most this often. */
const ARRIVED_EVERY_MS = 2 * 60_000;

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

/** git off the event loop; a failure's first `fatal:`/`error:` line (else its message) as the error. */
export function gitOff(args: string[], cwd: string, timeout = 20_000): Promise<GitAnswer> {
  return new Promise((resolve) =>
    execFileOff('git', args, { cwd, env: ENV, timeout, maxBuffer: 8 << 20, windowsHide: true }, (err, out, stderr) => {
      if (!err) return resolve({ ok: true, out });
      const why = String(stderr || err.stderr || '').split(/\r?\n/).find((l) => /^(fatal|error):/.test(l.trim())) ?? err.message.split(/\r?\n/)[0];
      resolve({ ok: false, err: why.trim() });
    }),
  );
}

/** Whether Studio Pro has the floor's project open: Studio mode's last look, else a look now (the lock and the studiopro.exe processes). */
export async function studioHolds(floor: Pick<Floor, 'id' | 'dir'>): Promise<boolean> {
  if (studioStateOf(floor.id)?.open) return true;
  let mpr: string | undefined;
  try {
    mpr = findMpr(floor.dir);
  } catch {
    mpr = undefined;
  }
  if (!mpr) return false;
  const lockFile = lockOf(mpr);
  let lock: string | undefined;
  try {
    lock = existsSync(lockFile) ? readFileSync(lockFile, 'utf8').slice(0, 4096) : undefined;
  } catch {
    lock = existsSync(lockFile) ? '' : undefined;
  }
  const procs = await studioProcesses(machineDetect(), new Map());
  return sightFloor(mpr, lock, procs).open;
}

/** The agents mid-turn in the floor's folder itself: no worktree of their own. */
export const busyInFolder = (floor: Pick<Floor, 'workers'>): string[] =>
  floor.workers
    .list()
    .filter((w) => w.kind === 'agent' && isBusy(w.status) && !w.worktree && !w.repos?.length)
    .map((w) => w.name);

/** This machine's deps for one floor. */
export function machineSyncDeps(floor: SyncFloor): SyncDeps {
  return {
    git: gitOff,
    exists: (p) => access(p).then(
      () => true,
      () => false,
    ),
    studioOpen: () => studioHolds(floor).catch(() => true),
    busyHere: () => busyInFolder(floor),
    now: Date.now,
  };
}

// ---- What the office remembers -----------------------------------------------------------------

const last = new Map<string, FloorSyncState>();
/** The refusal last written in the audit log, per floor, until the folder is current again. */
const logged = new Map<string, string>();
const running = new Map<string, Promise<FloorSyncState>>();
const arrivedAt = new Map<string, number>();
onForgetFloor((f) => {
  dropKeys(last, f);
  dropKeys(logged, f);
  dropKeys(running, f);
  dropKeys(arrivedAt, f);
});

/** Floor `id`'s folder against GitHub, from the office's last look. */
export const floorSyncOf = (id: string): FloorSyncState | undefined => last.get(id);

/** What a look means for the audit log: a move always, a refusal once per reason until it's current again. */
export function noteSync(floor: Pick<Floor, 'id' | 'def'>, s: FloorSyncState, record: (e: Parameters<typeof audit.record>[0]) => void = (e) => audit.record(e)) {
  last.set(floor.id, s);
  const target = { kind: 'project', id: floor.id, label: floor.def.name };
  const actor = { kind: 'office' as const, name: 'The office' };
  if (s.state === 'moved') {
    logged.delete(floor.id);
    // The .mpr may be new, or moved: Studio mode looks for it again at once, so an open is seen (and the agents' mxcli writes paused) from the start.
    refindMpr(floor.id);
    record({ floor: floor.id, actor, action: 'floor.sync', target, summary: `Brought the project folder up to date with GitHub: ${s.branch} ${s.from?.slice(0, 7)} → ${s.to?.slice(0, 7)} (${s.commits} commit${s.commits === 1 ? '' : 's'})`, details: { branch: s.branch, from: s.from, to: s.to, commits: s.commits }, severity: 'info' });
  } else if (s.state === 'current' || s.state === 'no-remote') {
    logged.delete(floor.id);
  } else {
    const key = refusalKey(s)!;
    if (logged.get(floor.id) === key) return;
    logged.set(floor.id, key);
    record({ floor: floor.id, actor, action: 'floor.sync-refused', target, summary: `Didn't bring the project folder up to date with GitHub: ${s.message}`, details: { reason: s.reason, branch: s.branch, behind: s.behind, ...(s.on ? { on: s.on } : {}), ...(s.files ? { files: s.files } : {}) }, severity: 'warning' });
  }
}

export interface SyncAsk {
  /** Fetch origin/<default> first (waited for FETCH_WAIT_MS at most). */
  fetch?: boolean;
  /** Stand-ins for the machine (the tests'). */
  deps?: SyncDeps;
}

/** One look at the floor's folder (joining one already going), a fast-forward when it's safe, and what came of it. Never throws. */
export function syncFloorNow(floor: SyncFloor, ask: SyncAsk = {}): Promise<FloorSyncState> {
  const going = running.get(floor.id);
  if (going) return going;
  const p = (async () => {
    // Every floor's repository gets core.longpaths in its own config on its first look (once per run,
    // a file read after that): people's git in the folder needs it too, and a floor cloned before
    // release 21 never got it (the office's own git has it from the environment, gitenv.ts).
    await ensureLongPaths(floor.dir);
    if (ask.fetch) {
      const def = await defaultBranch(floor.dir);
      if (def) {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([fetchDefault(floor.dir, def, 10_000), new Promise((r) => (timer = setTimeout(r, FETCH_WAIT_MS)))]);
        clearTimeout(timer);
      }
    }
    const s = await syncFloor(floor.id, floor.dir, ask.deps ?? machineSyncDeps(floor));
    noteSync(floor, s);
    if (s.state === 'moved') console.log(`  ${floor.def.name}: the project folder caught up with origin/${s.branch} (${s.commits} commit${s.commits === 1 ? '' : 's'})`);
    return s;
  })()
    .catch((err): FloorSyncState => ({ floor: floor.id, state: 'refused', reason: 'failed', message: `Couldn't bring the project folder up to date: ${(err as Error).message}`, behind: 0, at: Date.now() }))
    .finally(() => running.delete(floor.id));
  running.set(floor.id, p);
  return p;
}

const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/** Whether news about a floor is worth a look now. */
export function worthALook(s: FloorSyncState | undefined, now: number): boolean {
  if (!s) return true;
  return now - s.at >= (s.state === 'refused' ? REFUSED_EVERY_MS : NEWS_EVERY_MS);
}

/** Starts the floor sync: a look at every floor soon after the office starts, then on news. Returns what stops it. */
export function startFloorSync(ctx: Pick<Ctx, 'floors'>): () => void {
  const floorAt = (dir: string): Floor | undefined => {
    const d = norm(dir);
    for (const f of ctx.floors.values()) if (norm(f.dir) === d) return f;
    return undefined;
  };
  const off = onOriginNews((dir: string, news: OriginNews) => {
    const floor = floorAt(dir);
    if (!floor) return;
    const now = Date.now();
    if (news === 'stale') {
      // Someone walked in, or the Live app saw main move on GitHub: fetch, then look.
      if (now - (arrivedAt.get(floor.id) ?? 0) < ARRIVED_EVERY_MS) return;
      arrivedAt.set(floor.id, now);
      return void syncFloorNow(floor, { fetch: true });
    }
    if (worthALook(last.get(floor.id), now)) void syncFloorNow(floor);
  });
  let stopped = false;
  const first = setTimeout(async () => {
    for (const floor of [...ctx.floors.values()]) {
      if (stopped) return;
      arrivedAt.set(floor.id, Date.now());
      await syncFloorNow(floor, { fetch: true });
    }
  }, START_DELAY_MS);
  first.unref?.();
  return () => {
    stopped = true;
    clearTimeout(first);
    off();
  };
}
