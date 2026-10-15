// Likely duplicates in Needs you (docs/site/using-the-office/needs-you.md): asks the office filed more than
// once before continuity (server/asks/awaiting.ts) kept one escalation per reworded AWAITING-PM item, and
// the same proposal harvested twice. Grouped only where the office is sure enough to offer a one-click
// clean-up, and closed only when the person confirms (server/decisions/duplicates.ts):
//   - escalations: open ones filed from an AWAITING-PM line, the same role, the same item by the continuity
//     rule (./same-item.ts). The newest whose line is still there is kept (else the newest); only ones
//     whose line is gone are offered for closing, each as superseded by the one kept.
//   - proposals: pending ones from the same role, of the same kind, with the same words (lower case,
//     punctuation aside); the newest is kept.
// Never across roles or sources, and never two the person separated (decision cards' Separate). Pure: the
// page builds the card from what it already has, the server checks the same groups before closing.

import type { Escalation } from '../roster/escalation.js';
import type { Proposal } from '../roster/types.js';
import type { DecisionSplit } from './types.js';
import { sameItem } from './same-item.js';

/** Whether the person separated two sources (namespaced ids: esc:<id>, appr:p-<id>). */
export type Apart = (a: string, b: string) => boolean;

/** The splits as a check on two source ids, either way round. */
export function apartOf(splits: readonly DecisionSplit[]): Apart {
  const pairs = new Set(splits.flatMap((s) => [`${s.cardId}\0${s.sourceId}`, `${s.sourceId}\0${s.cardId}`]));
  return (a, b) => pairs.has(`${a}\0${b}`);
}

/** The same on escalation ids (continuity in server/asks/). */
export const escalationsApart = (splits: readonly DecisionSplit[]) => {
  const ap = apartOf(splits);
  return (a: string, b: string) => ap(`esc:${a}`, `esc:${b}`);
};

export interface DuplicateItem {
  id: string;
  title: string;
  at?: number;
  gone?: boolean;
}

export interface DuplicateGroup {
  kind: 'escalation' | 'proposal';
  /** Who it's from (the role's member, or the proposer). */
  by: string;
  keep: DuplicateItem;
  close: DuplicateItem[];
}

const item = (e: Pick<Escalation, 'id' | 'title' | 'at' | 'sourceGone'>): DuplicateItem => ({ id: e.id, title: e.title, at: e.at, ...(e.sourceGone ? { gone: true } : {}) });

/** Open AWAITING-PM escalations that repeat another of the same role's. */
export function escalationDuplicates(escalations: readonly Escalation[], apart: Apart = () => false): DuplicateGroup[] {
  const open = escalations.filter((e) => e.status === 'open' && e.from?.kind === 'awaiting' && !!e.role);
  const out: DuplicateGroup[] = [];
  for (const role of new Set(open.map((e) => e.role!))) {
    const mine = open.filter((e) => e.role === role).sort((a, b) => Number(!!a.sourceGone) - Number(!!b.sourceGone) || b.at - a.at);
    const used = new Set<string>();
    for (const keep of mine) {
      if (used.has(keep.id)) continue;
      const close = mine.filter((o) => o !== keep && !used.has(o.id) && !!o.sourceGone && sameItem(keep.title, o.title) && !apart(`esc:${keep.id}`, `esc:${o.id}`));
      if (!close.length) continue;
      used.add(keep.id);
      close.forEach((o) => used.add(o.id));
      out.push({ kind: 'escalation', by: keep.by, keep: item(keep), close: close.map(item) });
    }
  }
  return out;
}

/** A proposal's words as compared: lower case, punctuation and spacing aside. */
export const proposalWords = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}#]+/gu, ' ').trim();

/** The key two pending proposals are the same on: the same role's, of the same kind, in the same words. */
export const proposalKey = (p: Pick<Proposal, 'role' | 'kind' | 'title'>) => `${p.role}:${p.kind}:${proposalWords(p.title)}`;

/** Pending proposals that repeat another one (the newest is kept; later in the list is newer when `at` is missing). */
export function proposalDuplicates(proposals: readonly Proposal[], apart: Apart = () => false): DuplicateGroup[] {
  const pending = proposals.map((p, i) => ({ p, i })).filter((x) => x.p.status === 'pending');
  const by = new Map<string, typeof pending>();
  for (const x of pending) by.set(proposalKey(x.p), [...(by.get(proposalKey(x.p)) ?? []), x]);
  const out: DuplicateGroup[] = [];
  for (const list of by.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (b.p.at ?? 0) - (a.p.at ?? 0) || b.i - a.i);
    const keep = sorted[0].p;
    const close = sorted.slice(1).map((x) => x.p).filter((o) => !apart(`appr:p-${keep.id}`, `appr:p-${o.id}`));
    if (close.length) out.push({ kind: 'proposal', by: keep.by, keep: { id: keep.id, title: keep.title, ...(keep.at ? { at: keep.at } : {}) }, close: close.map((o) => ({ id: o.id, title: o.title, ...(o.at ? { at: o.at } : {}) })) });
  }
  return out;
}

/** Every group the clean-up card offers. */
export function duplicateGroups(escalations: readonly Escalation[], proposals: readonly Proposal[], splits: readonly DecisionSplit[] = []): DuplicateGroup[] {
  const apart = apartOf(splits);
  return [...escalationDuplicates(escalations, apart), ...proposalDuplicates(proposals, apart)];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The card's words: "Likely duplicates: 9 asks repeat 5 others", and a line per group. */
export function duplicatesWords(groups: readonly DuplicateGroup[]): { title: string; lines: string[] } {
  const n = groups.reduce((x, g) => x + g.close.length, 0);
  const title = `Likely duplicates: ${n} ${n === 1 ? 'ask repeats' : 'asks repeat'} ${groups.length} ${groups.length === 1 ? 'other' : 'others'}`;
  const lines = groups.map((g) => `${clip(g.keep.title, 70)} ×${g.close.length + 1} → keep the newest${g.kind === 'proposal' ? ' (proposals)' : ''} (${g.by})`);
  return { title, lines };
}
