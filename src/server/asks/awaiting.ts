// AWAITING-PM lines in Needs you, per item (surface asks, S4). A handoff ends `AWAITING-PM: <what>`, but
// only the bench path ever escalated it: one line, and not at all if the role had any open escalation, and
// never for a pause handoff. Now the newest AWAITING-PM entry of every team journal is read wherever it is
// (the floor's folder, each agent's worktree, the branch heads: sources.ts), on bench, on pause and every
// few minutes; each item in it becomes an escalation of its own (deduped by role and text, filed once per
// entry), and it's resolved by itself once the newest entry no longer lists it. Pure but for the roster.

import type { Escalation } from '../../shared/roster/escalation.js';
import { parseJournal, type JournalEntry } from '../../shared/roster/journal.js';
import { journalPath, ROLES, type RoleId, type TeamId } from '../../shared/roster/roles.js';
import { isHandsOn } from '../../shared/roster/hands-on.js';
import { sameAsk } from '../roster/jeff-ask.js';
import type { Read } from './sources.js';

/** `AWAITING-PM: <what>` lines, as bench.ts reads them. */
const LINE = /^[\s>*_-]*AWAITING[- ]PM[*_]*\s*:[*_]*\s*(.*)$/gim;

/** The items an entry's AWAITING-PM lines name: each line, split on "; " and numbered "(1) … (2) …" parts; none for "none". */
export function awaitingItems(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(LINE)) {
    const line = m[1].replace(/[*_`]/g, '').trim();
    if (!line || /^(?:none|n\/?a)\b/i.test(line)) continue;
    const parts = line.split(/;\s+|\s+\(\d+\)\s+|^\(\d+\)\s+/).map((p) => p.replace(/^(?:and|also)\s+/i, '').replace(/[.;,\s]+$/, '').trim()).filter((p) => p.length > 2);
    for (const p of parts) if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out;
}

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

export interface AwaitingPlan {
  /** Items to file: role, the item, the waits it came from. */
  raise: { role: RoleId; item: string; waits: Waits }[];
  /** Open escalations the office filed from a line that is gone now: resolve them. */
  settle: Escalation[];
}

/**
 * What to do with the waits: each item not already open (as one the office filed from a line, or one the
 * role escalated itself with the same words) and not filed before from this entry is raised; an open one
 * filed from a line no newest entry lists any more is settled. Other open escalations hold nothing back.
 */
export function planAwaiting(waits: readonly Waits[], roleOf: (team: TeamId) => RoleId | undefined, escalations: readonly Escalation[]): AwaitingPlan {
  const raise: AwaitingPlan['raise'] = [];
  const live = new Set<string>();
  for (const w of waits) {
    const role = roleOf(w.team);
    if (!role) continue;
    for (const item of w.items) {
      const key = awaitingKey(role, item);
      live.add(key);
      const mine = escalations.filter((e) => e.from?.kind === 'awaiting' && e.from.key === key);
      if (mine.some((e) => e.status === 'open' || e.at >= w.at)) continue;
      if (escalations.some((e) => e.status === 'open' && e.role === role && e.from?.kind !== 'awaiting' && sameAsk(e.title, item))) continue;
      raise.push({ role, item, waits: w });
    }
  }
  const settle = escalations.filter((e) => e.status === 'open' && e.from?.kind === 'awaiting' && !!e.from.key && !live.has(e.from.key));
  return { raise, settle };
}

/** The escalation for one item: titled with it, hands-on ones as needs-human, the entry as its details. */
export function awaitingAsk(name: string, item: string, w: Waits, why: string): { urgency: 'important'; trigger: 'needs-human' | 'blocked'; title: string; details: string; options: string[] } {
  const body = w.entry.body.length > 3000 ? `${w.entry.body.slice(0, 3000)}\n…(the rest is in the journal)` : w.entry.body;
  return {
    urgency: 'important',
    trigger: isHandsOn(item) ? 'needs-human' : 'blocked',
    title: item.slice(0, 160),
    details: [`${name}'s newest entry in \`${journalPath(w.team)}\` (${w.where}, “${w.entry.heading}”) says it is waiting on you, and it wasn't escalated. The office raised it on its behalf ${why}.`, '', `Waiting on: ${item}`, '', `Answer here and the answer goes to ${name}. It closes by itself once the line is gone from ${name}'s newest entry. The entry:`, '', body].join('\n'),
    options: [],
  };
}
