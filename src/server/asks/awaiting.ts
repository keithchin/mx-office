// AWAITING-PM lines in Needs you, per item (surface asks, S4). A handoff ends `AWAITING-PM: <what>`, but
// only the bench path ever escalated it: one line, and not at all if the role had any open escalation, and
// never for a pause handoff. Now the newest AWAITING-PM entry of every team journal is read wherever it is
// (the floor's folder, each agent's worktree, the branch heads: sources.ts), on bench, on pause and every
// few minutes; each item in it (split.ts) becomes an escalation of its own, filed once per entry. An item
// the role reworded in a newer entry continues the escalation it already has (same role, same AWAITING-PM
// source, the same item by shared/decisions/same-item.ts): updated in place, never a second one. One whose
// line is gone is marked so for the person, never settled by itself (decision cards, D02). Pure.

import type { Escalation } from '../../shared/roster/escalation.js';
import { parseJournal, type JournalEntry } from '../../shared/roster/journal.js';
import { journalPath, ROLE_BY_ID, ROLES, type RoleId, type TeamId } from '../../shared/roster/roles.js';
import { isHandsOn } from '../../shared/roster/hands-on.js';
import { sameItem } from '../../shared/decisions/same-item.js';
import { sameAsk } from '../roster/jeff-ask.js';
import { anyFailed, type Read } from './sources.js';
import { awaitingItemsOf } from './split.js';

/** The items an entry's AWAITING-PM lines name (./split.ts): clear list separators only; none for "none". */
export const awaitingItems = (body: string): string[] => awaitingItemsOf(body);

/** The entry a team's waits are read from: the newest that is a handoff or says AWAITING-PM (later notes don't clear it). */
export function waitingEntry(entries: readonly JournalEntry[]): JournalEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (/handoff/i.test(e.heading) || /AWAITING[- ]PM/i.test(e.body)) return e;
  }
  return undefined;
}

/** When an entry was written, from its heading ("2026-10-12 22:52 — Handoff"; the date alone at midnight UTC). */
export function entryTime(e: JournalEntry): number {
  const m = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(e.heading);
  return m ? Date.parse(`${m[1]}T${m[2] ?? '00'}:${m[3] ?? '00'}:00Z`) || 0 : 0;
}

/** One team's waits as the newest copy says, and whose copy that was. */
export interface Waits {
  team: TeamId;
  entry: JournalEntry;
  at: number;
  items: string[];
  where: string;
}

/** Each team's newest waiting entry over every copy of its journal (the one written last wins). */
export function newestWaits(reads: readonly Read[]): Waits[] {
  const out: Waits[] = [];
  for (const team of new Set(ROLES.map((r) => r.team))) {
    const file = journalPath(team);
    let best: Waits | undefined;
    for (const r of reads) {
      const text = r.files.get(file);
      if (!text) continue;
      const entry = waitingEntry(parseJournal(text));
      if (!entry) continue;
      const at = entryTime(entry);
      if (!best || at > best.at || (at === best.at && entry.body.length > best.entry.body.length)) best = { team, entry, at, items: awaitingItems(entry.body), where: r.place.kind === 'checkout' ? 'the project folder' : r.place.kind === 'worktree' ? `${r.place.who}'s worktree` : `branch ${r.place.branch}` };
    }
    if (best) out.push(best);
  }
  return out;
}

/** The key an item's escalation carries: its role and its words, lower case. */
export const awaitingKey = (role: string, item: string) => `${role}:${item.toLowerCase().replace(/\s+/g, ' ').trim()}`.slice(0, 300);

/** Whether the person separated two escalations' cards (decision cards' Separate): continuity never joins them. */
export type Apart = (a: string, b: string) => boolean;

export interface AwaitingPlan {
  /** Items to file: role, the item, the waits it came from. */
  raise: { role: RoleId; item: string; waits: Waits }[];
  /**
   * Items the role reworded: the open escalation already filed for it (gone or not) continues with the new
   * words (title, details, key), its line back, its id kept: no second escalation.
   */
  update: { escalation: Escalation; role: RoleId; item: string; waits: Waits }[];
  /**
   * Open escalations the office filed from a line that is gone now: marked "line gone" for the person to
   * say (Resolved, or Still needed), never settled. Not when a read of that team's journal failed.
   */
  gone: Escalation[];
  /** Ones marked gone whose line is back: an ask like before. */
  back: Escalation[];
}

/**
 * What to do with the waits: an item already open under its key (or escalated by the role itself in the
 * same words), or filed before from this entry, is left alone; an item the role reworded continues the open
 * escalation it matches (same role, from an AWAITING-PM line, not live under its own key, one item per
 * escalation, never one the person separated from another the item also matches); the rest are raised. An
 * open one filed from a line no newest entry lists any more is marked gone. Other open escalations hold
 * nothing back.
 */
export function planAwaiting(waits: readonly Waits[], roleOf: (team: TeamId) => RoleId | undefined, escalations: readonly Escalation[], reads: readonly Read[] = [], apart: Apart = () => false): AwaitingPlan {
  const raise: AwaitingPlan['raise'] = [];
  const update: AwaitingPlan['update'] = [];
  const live = new Set<string>();
  const fresh: { role: RoleId; item: string; waits: Waits }[] = [];
  for (const w of waits) {
    const role = roleOf(w.team);
    if (!role) continue;
    for (const item of w.items) {
      const key = awaitingKey(role, item);
      live.add(key);
      const mine = escalations.filter((e) => e.from?.kind === 'awaiting' && e.from.key === key);
      if (mine.some((e) => e.status === 'open' || e.at >= w.at)) continue;
      if (escalations.some((e) => e.status === 'open' && e.role === role && e.from?.kind !== 'awaiting' && sameAsk(e.title, item))) continue;
      fresh.push({ role, item, waits: w });
    }
  }
  // Continuity: the same role's open AWAITING-PM escalations no item names by its key any more.
  const claimed = new Set<string>();
  for (const f of fresh) {
    const pool = escalations.filter((e) => e.status === 'open' && e.from?.kind === 'awaiting' && e.role === f.role && !live.has(e.from.key) && !claimed.has(e.id) && sameItem(f.item, e.title));
    // Newest first, one whose line is still there before one marked gone.
    const best = [...pool].sort((a, b) => Number(!!a.sourceGone) - Number(!!b.sourceGone) || b.at - a.at)[0];
    if (best && !pool.some((o) => o !== best && apart(best.id, o.id))) {
      claimed.add(best.id);
      update.push({ escalation: best, ...f });
    } else raise.push(f);
  }
  // A journal that couldn't be read somewhere can't say a line is gone (decision cards, D02).
  const unread = (e: Escalation) => {
    const team = e.role ? ROLE_BY_ID.get(e.role)?.team : undefined;
    return team ? anyFailed(reads, [journalPath(team)]) : anyFailed(reads);
  };
  const filed = escalations.filter((e) => e.status === 'open' && e.from?.kind === 'awaiting' && !!e.from.key && !claimed.has(e.id));
  const gone = filed.filter((e) => !live.has(e.from!.key) && !e.sourceGone && !unread(e));
  const back = filed.filter((e) => live.has(e.from!.key) && !!e.sourceGone);
  return { raise, update, gone, back };
}

/** The escalation for one item: titled with it, hands-on ones as needs-human, the entry as its details. */
export function awaitingAsk(name: string, item: string, w: Waits, why: string): { urgency: 'important'; trigger: 'needs-human' | 'blocked'; title: string; details: string; options: string[] } {
  const body = w.entry.body.length > 3000 ? `${w.entry.body.slice(0, 3000)}\n…(the rest is in the journal)` : w.entry.body;
  return {
    urgency: 'important',
    trigger: isHandsOn(item) ? 'needs-human' : 'blocked',
    title: item.slice(0, 160),
    details: [`${name}'s newest entry in \`${journalPath(w.team)}\` (${w.where}, “${w.entry.heading}”) says it is waiting on you, and it wasn't escalated. The office raised it on its behalf ${why}.`, '', `Waiting on: ${item}`, '', `Answer here and the answer goes to ${name}. If the line goes from ${name}'s newest entry, the card asks you whether it's resolved. The entry:`, '', body].join('\n'),
    options: [],
  };
}
