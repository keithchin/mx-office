// After a local merge (./merge.ts), the team hears where main is now: "main is now @M (merged DC-n)", with the
// reviewed commit, what stayed out, and to fetch before asking for another merge. In the rebuild test a lead asked
// for a merge two hours after it was done: its worktree compared with a local `main` that only moved when the
// project folder happened to be on main and clean, and nothing told it. Now the merge also moves the local main
// (fast-forward only, ./merge.ts) and this note goes to the branch's own worker and the team lead, through the
// roster's delivery as the office's own words: held for the end of a turn under way, never into a dialog, not past
// the spend cap or a project pause, and an asleep agent isn't woken for it (the next hand-over carries main).

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { managerRole } from '../roster/coverage.js';
import { mainNowWords, type LocalMergeDc } from '../../shared/local-merge.js';
import type { LocalMergeDeps } from './index.js';

/** The branch's worker (an agent) and whoever covers Management, once each. */
function recipientsOf(ctx: Ctx, floor: Floor, ownerId: string | undefined): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const add = (id: string | undefined) => {
    if (!id || out.some((x) => x.id === id)) return;
    const w = floor.workers?.get?.(id);
    if (w && w.kind === 'agent') out.push({ id, name: w.name });
  };
  add(ownerId);
  try {
    if (ctx.floors?.has(floor.id)) {
      const d = rosterOf(ctx).data(floor.id);
      const m = d.members[managerRole(d)];
      if (m?.phase === 'active') add(m.workerId);
    }
  } catch {
    /* no team: only the branch's own worker */
  }
  return out;
}

function deliverOf(ctx: Ctx, floor: Floor) {
  return (workerId: string, text: string, id: string): string | undefined => {
    const w = floor.workers.get(workerId);
    if (!w) return 'gone';
    const r = rosterOf(ctx).delivery.send(teamFloor(ctx, floor), w, text, { origin: 'office', id, resume: false });
    return r.status === 'refused' ? r.why : undefined;
  };
}

/** Tells the team main moved: the names it went to (or was held for). */
export function tellMainNow(ctx: Ctx, floor: Floor, m: { main: string; merge: string; branch: string; sha: string; dcs: LocalMergeDc[]; newer: number; reviewedBy: string }, ownerId: string | undefined, deps: Partial<LocalMergeDeps> = {}): string[] {
  const text = mainNowWords(m);
  const who = deps.recipients ? deps.recipients(ownerId) : recipientsOf(ctx, floor, ownerId);
  const deliver = deps.deliver ?? deliverOf(ctx, floor);
  const told: string[] = [];
  for (const w of who) {
    try {
      if (!deliver(w.id, text, `local-merge-main-${m.merge.slice(0, 12)}-${w.id}`)) told.push(w.name);
    } catch {
      /* one worker's delivery never fails the merge */
    }
  }
  return told;
}
