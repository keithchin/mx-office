// The Developer change lifecycle's seams to the real office (index.ts makes the service with them): stopping or
// isolating an active change's worker (held prompts for it taken back; its terminal stopped through the worker
// manager's sleep when it's mid-turn, as ⏸ Pause project does; told between turns otherwise), ending its task on
// the task record, flagging an open PR (a comment through gh: never closed, never deleted), the data-impact guard
// on its candidate (data-impact/seams.ts checkCandidate, env candidate:DC-n), merged-by-git (no PR), and the
// overlap reads (the explorer's unit diff, main's first-parent log). Git runs off the event loop; a commit's
// answers are kept (a commit never changes).

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { isAsleepStatus, isBusyStatus } from '../roster/bench.js';
import { gh } from '../github.js';
import { git } from '../asks/sources.js';
import { contains } from '../tasks/git.js';
import { modelOf } from '../model/index.js';
import { mprIn } from '../model/store.js';
import { explorerChanges } from '../app-explorer/index.js';
import { checkCandidate, heldIn } from '../data-impact/seams.js';
import { ownModelChange } from '../data-impact/stale.js';
import { dataImpactOf } from '../data-impact/index.js';
import { defaultBranch, floorRef } from '../liveapp/checkout.js';
import { ENV_LIVE } from '../../shared/data-impact.js';
import type { ChangeFacts, DevChange, HeldOn, StopResult } from '../../shared/dev-changes.js';
import type { RelatedDeps } from './related.js';

const carries = (id: string, text: string) => new RegExp(`change: ${id}(?!\\d)`).test(text);

/** Stops or isolates the worker an active change was handed to, before its slot is released. */
export async function stopWorker(ctx: Ctx, floor: Floor, c: DevChange, by: string): Promise<StopResult | string> {
  const wid = c.activated?.workerId;
  const w = wid ? floor.workers.get(wid) : undefined;
  if (!wid || !w) return { how: 'gone' };
  const roster = rosterOf(ctx);
  const tf = teamFloor(ctx, floor);
  // Its hand-over (or a note about it) still waiting for the turn to end: taken back, so it never goes in.
  const ids = roster.data(floor.id).held.filter((x) => x.workerId === wid && carries(c.id, x.text)).map((x) => x.id);
  for (const id of ids) roster.delivery.unhold(tf, id);
  const dropped = ids.length ? { dropped: ids.length } : {};
  if (isAsleepStatus(w.status)) return { how: 'asleep', worker: w.name, ...dropped };
  if (isBusyStatus(w.status)) {
    const err = floor.workers.sleep(wid);
    if (err) return `The office couldn’t stop ${w.name}: ${err}`;
    return { how: 'slept', worker: w.name, ...dropped };
  }
  // Between turns: nothing runs. Told, so its next turn doesn't pick the work up again.
  roster.delivery.send(tf, w, `${c.id} was cancelled by ${by} in the Developer view. Stop any work on it, don't push \`dev/${c.id}\` again, and leave its PR as it is: the office no longer counts anything for it.`, { origin: 'person', by, hold: true, between: true, resume: false });
  return { how: 'idle', worker: w.name, ...dropped };
}

/** Marks the change's task ended on the task record. */
export function endTask(ctx: Ctx, floorId: string, taskId: string, how: 'cancelled' | 'superseded', why: string) {
  rosterOf(ctx).tasks.ids.of(floorId).event(floorId, taskId, { type: how, at: Date.now(), why: why.slice(0, 120) });
}

/** Flags an open PR of a cancelled change with a comment (never closed or deleted). */
export async function flagPr(floor: Floor, pr: number, text: string): Promise<void> {
  await gh(['pr', 'comment', String(pr), '--body', text], floor.dir);
}

/** The revision the data-impact guard assesses for a change: its newest candidate (or its merge commit when there's none). */
const targetOf = (c: DevChange, merged?: string) => c.candidates.filter((x) => !x.late).at(-1)?.sha ?? merged;
const baseOf = (c: DevChange) => c.activated?.main ?? c.source.sha;

const mendixKept = new Map<string, Promise<boolean>>();

/** Whether the commit is a Mendix app (an .mpr at the top or one folder down): the guard is about its domain model only. */
function isMendix(dir: string, sha: string): Promise<boolean> {
  const key = `${dir}|${sha}`;
  let p = mendixKept.get(key);
  if (!p) {
    // ls-tree takes no globs: the top level, then (only when none there) each folder's own top level.
    const names = (out: string | undefined) => (out ?? '').split('\n').filter(Boolean);
    p = git(['ls-tree', '--name-only', sha], dir).then(async (out) => {
      if (mprIn(names(out))) return true;
      const dirs = names(await git(['ls-tree', '--name-only', '-d', sha], dir)).filter((d) => !d.startsWith('.')).slice(0, 50);
      const one = await git(['ls-tree', '--name-only', sha, '--', ...dirs.map((d) => `${d}/`)], dir);
      return !!mprIn(names(one));
    });
    mendixKept.set(key, p);
    if (mendixKept.size > 300) mendixKept.delete(mendixKept.keys().next().value!);
  }
  return p;
}

/** The guard on a change's candidate: true while it's held (a Mendix model it can't read holds as unknown; a project with no .mpr has no domain model to guard). */
export async function candidateHeld(ctx: Ctx, floor: Floor, c: DevChange, f?: Pick<ChangeFacts, 'merged'>): Promise<boolean> {
  const base = baseOf(c);
  const target = targetOf(c, f?.merged?.sha);
  if (!base || !target || base === target) return false;
  if (!(await isMendix(floor.dir, target))) return false;
  // A candidate that changes no model of its own (a notes branch that merged main in) guards nothing: what the diff
  // finds came in from main, which the live preview's own guard holds. No hold, and an old one for it is let go.
  const main = await defaultBranch(floor.dir).then((b) => floorRef(floor.dir, b)).catch(() => undefined);
  if (main?.sha && (await ownModelChange(floor.dir, target, main.sha.trim()).catch(() => undefined)) === false) {
    dataImpactOf(ctx).guard.clear(floor.id, `candidate:${c.id}`, `${target.slice(0, 7)} changes no model of its own (its model difference came in from main)`);
    return false;
  }
  const units = modelOf(ctx).units;
  const v = await checkCandidate(ctx, c.id, { floorId: floor.id, dir: floor.dir, base, target, units }).finally(() => units.blobs(floor.dir).close());
  return v.hold;
}

/** The hold that keeps a change from running, if any: its own (env candidate:DC-n), or the live preview's on exactly its revision. */
export function heldOn(ctx: Ctx, floorId: string, c: DevChange, merged?: string): HeldOn | undefined {
  const own = heldIn(ctx, floorId, `candidate:${c.id}`);
  const target = targetOf(c, merged);
  const live = heldIn(ctx, floorId, ENV_LIVE);
  const h = own && own.target === target ? own : live && (live.target === merged || live.target === target) ? live : undefined;
  return h ? { env: h.env, reason: h.reason, findings: h.assessment?.findings.length ?? 0 } : undefined;
}

const mergedKept = new Map<string, Promise<string | undefined>>();

/** The first-parent commit on `main` that brought `sha` in (itself when it is on that line); undefined when main hasn't it. */
export function mergedAt(dir: string, sha: string, main: string | undefined): Promise<string | undefined> {
  if (!main) return Promise.resolve(undefined);
  const key = `${dir}|${sha}|${main}`;
  let p = mergedKept.get(key);
  if (!p) {
    p = (async () => {
      if (sha === main) return sha;
      if (!(await contains(dir, sha, main).catch(() => false))) return undefined;
      const line = await git(['rev-list', '--first-parent', '--ancestry-path', '--reverse', `${sha}..${main}`], dir);
      const first = line?.split('\n').find((l) => /^[0-9a-f]{40}$/.test(l.trim()))?.trim();
      const onLine = await git(['rev-list', '--first-parent', '-n', '500', main], dir);
      return onLine?.split('\n').some((l) => l.trim() === sha) ? sha : first;
    })();
    mergedKept.set(key, p);
    if (mergedKept.size > 300) mergedKept.delete(mergedKept.keys().next().value!);
  }
  return p;
}

const docsKept = new Map<string, Promise<string[] | undefined>>();

/** The overlap reads for one project. */
export function relatedDeps(ctx: Ctx, floor: Floor, main: () => Promise<string | undefined>, triedOk: (id: string) => boolean): RelatedDeps {
  return {
    docs(from, to) {
      const key = `${floor.dir}|${from}|${to}`;
      let p = docsKept.get(key);
      if (!p) {
        p = explorerChanges(ctx, floor, from, to).then((r) => r.docs, () => undefined);
        docsKept.set(key, p);
        if (docsKept.size > 500) docsKept.delete(docsKept.keys().next().value!);
      }
      return p;
    },
    async commits(from, max) {
      const m = await main();
      if (!m || m === from) return [];
      const out = await git(['log', '--first-parent', `-n${max}`, '--format=%H%x00%P%x00%s%x00%b%x1e', `${from}..${m}`], floor.dir);
      if (out === undefined) return undefined;
      return out
        .split('\x1e')
        .map((r) => r.replace(/^\s+/, ''))
        .filter((r) => r.includes('\0'))
        .map((r) => {
          const [sha, parents, subject, body] = r.split('\0');
          return { sha, parent: parents.split(' ')[0], subject, body: body ?? '' };
        })
        .reverse();
    },
    triedOk,
  };
}
