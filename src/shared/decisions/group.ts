// Folding Needs-you sources into decision cards: candidates (./candidates.ts) that share an explicit id
// (a BRD question key, a register id, a PR number, a stage id, a stuck item) become one card listing every
// source, led by the source whose answer path is the right one (a question's is the Questions page). A
// "Separate" the person chose (DecisionSplit) takes a source out of that card again. Every other Needs-you
// item is a card of its own. The cards come back in the order the items came in, each where its first
// source was, with the compact rows (NeedItem) the other surfaces show. Pure.

import type { NeedItem } from '../needsyou.js';
import type { Candidate } from './candidates.js';
import type { DecisionCard, DecisionKind, DecisionSplit } from './types.js';
import { afterWords } from './words.js';

export type Entry = { need: NeedItem; cand?: Candidate };

const KIND_RANK: Record<DecisionKind, number> = { decision: 0, 'hands-on': 1, status: 2, fyi: 3 };
const LEVEL_RANK = { block: 0, warn: 1, info: 2 } as const;

/** Groups of entry indexes (each a list in entry order) joined on shared keys, without the keys of `drop`'s sources. */
function groupsOf(entries: readonly Entry[], drop: ReadonlySet<string>): number[][] {
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byKey = new Map<string, number>();
  entries.forEach((e, i) => {
    if (!e.cand || drop.has(e.cand.source.id)) return;
    for (const k of e.cand.keys) {
      const j = byKey.get(k);
      if (j === undefined) byKey.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const out = new Map<number, number[]>();
  entries.forEach((_, i) => {
    const r = find(i);
    const g = out.get(r) ?? [];
    g.push(i);
    out.set(r, g);
  });
  return [...out.values()];
}

/** The group's lead: a question (its one answer path is the Questions page), else its strongest kind, then the source whose answer path wins, then the first. */
function primaryOf(entries: readonly Entry[], g: readonly number[]): number {
  return [...g].sort((a, b) => {
    const ca = entries[a].cand;
    const cb = entries[b].cand;
    return Number(ca?.prio !== 0) - Number(cb?.prio !== 0) || KIND_RANK[ca?.kind ?? 'status'] - KIND_RANK[cb?.kind ?? 'status'] || (ca?.prio ?? 9) - (cb?.prio ?? 9) || a - b;
  })[0];
}

const idOf = (e: Entry) => e.cand?.source.id ?? e.need.key;

/** An item that isn't a decision source, as a card of its own: an agent asking you is a decision, the rest status. */
function plainCard(n: NeedItem): DecisionCard {
  const kind: DecisionKind = n.kind === 'asking' ? 'decision' : n.level === 'info' ? 'fyi' : 'status';
  return {
    id: n.key,
    kind,
    question: n.text,
    evidence: [],
    blocks: [],
    owner: 'the office',
    sources: [{ id: n.key, type: 'other', label: 'Needs you', target: n.target }],
    after: kind === 'decision' ? 'After you answer: the agent carries on with it.' : afterWords(kind, { owner: 'the office' }),
    ...(n.since !== undefined ? { since: n.since } : {}),
    level: n.level,
    notes: [],
    related: [],
    need: { ...n, card: n.key },
  };
}

/** The cards and their compact rows, in the entries' order, with the splits applied. */
export function foldCards(entries: readonly Entry[], splits: readonly DecisionSplit[] = []): { cards: DecisionCard[]; needs: NeedItem[] } {
  let groups = groupsOf(entries, new Set());
  if (splits.length) {
    const drop = new Set<string>();
    for (const g of groups) {
      if (g.length < 2) continue;
      const card = idOf(entries[primaryOf(entries, g)]);
      for (const s of splits) if (s.cardId === card && g.some((i) => idOf(entries[i]) === s.sourceId)) drop.add(s.sourceId);
    }
    if (drop.size) groups = groupsOf(entries, drop);
  }
  const groupOf = new Map<number, number[]>();
  for (const g of groups) for (const i of g) groupOf.set(i, g);
  const cards: DecisionCard[] = [];
  const done = new Set<number[]>();
  entries.forEach((e, i) => {
    const g = groupOf.get(i)!;
    if (done.has(g)) return;
    done.add(g);
    if (g.length === 1 && !e.cand) return void cards.push(plainCard(e.need));
    const p = entries[primaryOf(entries, g)];
    const c = p.cand!;
    const members = g.map((j) => entries[j]);
    const level = members.map((m) => m.need.level).sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b])[0];
    // A decision is never shown as info: an FYI folded into one counts with it.
    // A question you answered isn't waiting on you, whatever still lists it.
    const lvl = c.body.answered ? 'info' : c.kind !== 'fyi' && level === 'info' ? 'warn' : level;
    const sinces = members.map((m) => m.need.since).filter((x): x is number => x !== undefined);
    const since = sinces.length ? Math.min(...sinces) : undefined;
    const sources = [c.source, ...members.filter((m) => m !== p).map((m) => m.cand?.source ?? { id: m.need.key, type: 'other' as const, label: 'Needs you', target: m.need.target })];
    const id = c.source.id;
    const card: DecisionCard = {
      id,
      kind: c.kind,
      ...c.body,
      sources,
      after: c.body.after ?? afterWords(c.kind, { owner: c.body.owner, question: !!c.body.questionKey && c.kind === 'decision', ...(c.body.analyst ? { analyst: c.body.analyst } : {}) }),
      ...(since !== undefined ? { since } : {}),
      level: lvl,
      notes: [
        ...c.body.notes,
        ...(c.body.answered ? members.filter((m) => m !== p && m.cand?.source.type === 'stuck').map((m) => `${m.cand!.source.label} still lists it as open: it closes once the register is updated (the answer you send asks the analyst to update PROJECT.md too).`) : []),
        ...members.filter((m) => m !== p).flatMap((m) => (m.cand?.source.note && /re-read/.test(m.cand.source.note) ? [`${m.cand.source.label}: ${m.cand.source.note}`] : []))],
      related: [],
      need: { ...c.need, level: lvl, ...(since !== undefined ? { since } : {}), card: id, ...(sources.length > 1 ? { sources: sources.length } : {}) },
    };
    cards.push(card);
  });
  // Possibly related, never merged: a free-text test name another card's words mention.
  for (const c of cards) {
    const m = entries.find((e) => e.cand?.source.id === c.id)?.cand?.mentions;
    if (!m) continue;
    for (const o of cards) if (o !== c && o.question.includes(m)) c.related.push({ label: o.question, card: o.id });
  }
  return { cards, needs: cards.map((c) => c.need) };
}
