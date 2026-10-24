// The one Needs-you count: what every surface on a project's page says waits on you (the top bar's bell and the
// team phone's badge, the navigation's Overview badge, the Overview's Needs you card, the lead panel's banner in
// Project Management and docked in the Developer view, the Approvals page, the phone version /m). Worked out
// once per moment by the Needs-you strip (client/ui/needsyou/) and handed to the others with its snapshot, so
// they agree at the same moment; the phone version, which has no strip, works it out with this same function.
//
// What counts, for this viewer:
//   - for you: a decision or an action on this project (not an FYI or info row, not another project's row) that
//     you can act on. An admin (the Project Manager) can act on every one; a member only on an agent asking,
//     an agent's finished turn and a lost worktree (the rest are the Project Manager's on the server: answering
//     escalations, approvals, budget, settings, sign-offs…);
//   - waiting on the Project Manager: for a member, the decisions and actions they can't act on. Never counted
//     as theirs, said apart;
//   - in other projects: agents asking or finished elsewhere (what the office tells every page about other
//     projects), said apart and never added to this project's number.
// The notification channels (the desktop tray, Home's urgent list, Teams posts, phone pushes) post a subset
// (shared/needs-actionable.ts: what's urgent enough to buzz); they say what they post, not this count. Pure.

import type { NeedItem, NeedKind } from './needsyou.js';

/** What a member can act on themselves (the rest needs an admin on the server). */
export const MEMBER_ACTS: ReadonlySet<NeedKind> = new Set<NeedKind>(['asking', 'finished', 'lost']);

/** Whether an item is a decision or an action on this project (FYIs, info rows and other projects' rows aren't). */
export const waitsHere = (n: Pick<NeedItem, 'kind' | 'level'>): boolean => n.kind !== 'floor' && n.level !== 'info';

/** Whether this viewer can act on it. */
export const canAct = (n: Pick<NeedItem, 'kind'>, admin: boolean): boolean => admin || MEMBER_ACTS.has(n.kind);

export interface NeedsCount {
  /** The number every badge shows: decisions and actions on this project you can act on. */
  forYou: number;
  /** A member's decisions and actions only the Project Manager can act on (0 for an admin). */
  forPm: number;
  /** Agents asking or finished in other projects, and in how many projects. */
  elsewhere: number;
  elsewhereProjects: number;
  admin: boolean;
}

export interface CountInput {
  admin: boolean;
  /** This project. */
  floor?: string;
  /** Every project as the office says it ({t:'floors'}): `waiting` is its agents asking or finished. */
  floors?: readonly { id: string; waiting: number; cloning?: boolean }[];
}

/** The count, from the items Needs you works out (collectNeeds) and the projects list. */
export function needsCount(items: readonly Pick<NeedItem, 'kind' | 'level'>[], i: CountInput): NeedsCount {
  let forYou = 0;
  let forPm = 0;
  for (const n of items) {
    if (!waitsHere(n)) continue;
    if (canAct(n, i.admin)) forYou++;
    else forPm++;
  }
  const others = (i.floors ?? []).filter((f) => f.id !== i.floor && !f.cloning && f.waiting > 0);
  return { forYou, forPm, elsewhere: others.reduce((s, f) => s + f.waiting, 0), elsewhereProjects: others.length, admin: i.admin };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 for you in this project · 2 waiting on the Project Manager · 4 agents waiting in 2 other projects" (the parts that aren't 0). */
export function countWords(c: NeedsCount): string {
  const parts = [
    c.forYou || !c.forPm ? `${c.forYou} for you in this project` : '',
    c.forPm ? `${c.forPm} waiting on the Project Manager` : '',
    c.elsewhere ? `${plural(c.elsewhere, 'agent', 'agents')} waiting in ${c.elsewhereProjects === 1 ? 'another project' : `${c.elsewhereProjects} other projects`}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/** The banner's words: "3 waiting on you" for what's yours; a member with nothing of their own sees what waits on the Project Manager. */
export function bannerWords(c: NeedsCount): string {
  if (c.forYou) return `${c.forYou} waiting on you`;
  if (c.forPm) return `${c.forPm} waiting on the Project Manager`;
  return '';
}
