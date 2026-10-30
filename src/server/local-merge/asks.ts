// Agents' merge asks (shared/merge-target.ts mergeAskOf): an escalation that asks the Project Manager to merge a
// named commit ("approve merge of 3e9a360 (office/carl-1)"). Read for the receipt's merge targets (./targets.ts)
// and the panel's rows (./index.ts: which commit an agent asked for, and the change it names). Once that commit
// is on main (merged here or otherwise), the ask is closed by the office with that reason recorded (card-sweep/
// autoResolve; release 82: marking it gone still left the count stuck at 5 to 11 for merges long done): the first
// rebuild run left 37 such asks for merges done a day before in Needs you, burying the new ones. Looked at after
// each merge, and at most once a minute from the panel; the card sweep looks at every project's too.

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { mergeAskOf, type MergeAsk } from '../../shared/merge-target.js';
import type { Git } from '../gitgraph/index.js';

const DAY = 86_400_000;

type EscLike = { id: string; by: string; at: number; title: string; details?: string; options?: string[]; recommendation?: string; status: string; resolution?: { at: number }; sourceGone?: unknown };

function escalationsOf(ctx: Ctx, floorId: string): EscLike[] {
  try {
    if (!ctx.floors?.has(floorId)) return [];
    return rosterOf(ctx).data(floorId).escalations as EscLike[];
  } catch {
    return [];
  }
}

/** The team's merge asks (open escalations, and ones answered in the last three days), newest first. */
export function mergeAsks(ctx: Ctx, floorId: string, now = Date.now()): MergeAsk[] {
  return escalationsOf(ctx, floorId)
    .filter((e) => e.status === 'open' || (e.resolution && now - e.resolution.at < 3 * DAY))
    .map((e) => mergeAskOf(e))
    .filter((a): a is MergeAsk => !!a)
    .sort((a, b) => b.at - a.at);
}

/** The merge asks whose every named commit (that exists) is on `target` now: what to mark gone, with the words. */
export async function settledAsks(asks: readonly MergeAsk[], git: Git, dir: string, target: string, main: string): Promise<{ id: string; what: string }[]> {
  const out: { id: string; what: string }[] = [];
  for (const a of asks) {
    const known: string[] = [];
    let all = true;
    for (const s of a.shas) {
      const full = (await git(['rev-parse', '--verify', '--quiet', `${s}^{commit}`], dir).catch(() => '')).trim();
      if (!full) continue;
      known.push(full);
      const on = await git(['merge-base', '--is-ancestor', full, target], dir).then(
        () => true,
        () => false,
      );
      if (!on) all = false;
    }
    if (known.length && all) out.push({ id: a.id, what: `The commit it asks to merge (${known.map((s) => `@${s.slice(0, 7)}`).join(', ')}) is on ${main} now` });
  }
  return out;
}

const looked = new Map<string, number>();

/** Closes open merge asks whose commits are on main, the reason recorded (card-sweep/). Never throws. */
export async function settleMergeAsks(ctx: Ctx, floor: Floor, git: Git, target: string, main: string, opts: { force?: boolean; now?: number } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  if (!opts.force && now - (looked.get(floor.id) ?? 0) < 60_000) return 0;
  looked.set(floor.id, now);
  try {
    const open = escalationsOf(ctx, floor.id).filter((e) => e.status === 'open');
    const asks = open.map((e) => mergeAskOf(e)).filter((a): a is MergeAsk => !!a);
    if (!asks.length) return 0;
    const done = await settledAsks(asks, git, floor.dir, target, main);
    const tf = teamFloor(ctx, floor);
    let n = 0;
    const { autoResolve } = await import('../card-sweep/index.js');
    for (const d of done) if (autoResolve(rosterOf(ctx), tf, { id: d.id, kind: 'commit-on-main', reason: d.what })) n++;
    if (n) rosterOf(ctx).touch(tf);
    return n;
  } catch {
    return 0;
  }
}

/** Tests: forget when each project was looked at. */
export const forgetAskLooks = () => looked.clear();
