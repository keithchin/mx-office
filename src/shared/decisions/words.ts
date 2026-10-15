// What a decision card says and which buttons it has, by its kind (./types.ts): a decision has its
// options, Reply in my words and Ask <lead>; a hands-on action has I've done it, Can't now and Ask; an FYI
// has Noted, which approves nothing. And the header's counts. Pure.

import type { Escalation } from '../roster/escalation.js';
import type { DecisionCard, DecisionKind } from './types.js';

/** "Decision", "Action for you", "FYI", "Status": the card's tag. */
export const KIND_TAG: Record<DecisionKind, string> = { decision: 'Decision', 'hands-on': 'Action for you', fyi: 'FYI', status: 'Status' };

/** The first paragraph of a text with its links taken out. */
const firstPara = (s: string) => (s.replace(/\r\n?/g, '\n').split(/\n\s*\n/).find((p) => p.trim()) ?? '').replace(/https?:\/\/\S+/g, ' ');

/** Whether an escalation asks something: it has options, or its title or first paragraph is a question. */
export const asksSomething = (e: Pick<Escalation, 'options' | 'title' | 'details'>) => e.options.length > 0 || /\?/.test(e.title.replace(/https?:\/\/\S+/g, ' ')) || /\?/.test(firstPara(e.details));

/**
 * An escalation's kind: hands-on when it's a needs-human one (or an approved human-action proposal's
 * card); an FYI that asks something is a decision, and says it was filed as FYI; else FYI or decision.
 */
export function escalationKind(e: Pick<Escalation, 'trigger' | 'fyi' | 'options' | 'title' | 'details' | 'from'>): { kind: DecisionKind; filedAsFyi: boolean } {
  if (e.trigger === 'needs-human' || e.from?.kind === 'proposal') return { kind: 'hands-on', filedAsFyi: false };
  if (e.fyi) return asksSomething(e) ? { kind: 'decision', filedAsFyi: true } : { kind: 'fyi', filedAsFyi: false };
  return { kind: 'decision', filedAsFyi: false };
}

/** The line "After you answer: …" for a card (plan §1.1's wording). */
export function afterWords(kind: DecisionKind, o: { owner: string; question?: boolean; analyst?: string }): string {
  if (o.question) return `After you answer: send it from the Questions page and ${o.analyst ?? 'the analyst'} records it in the BRD. This card shows Sent until the toolkit reads it recorded.`;
  switch (kind) {
    case 'decision':
      return `After you answer: ${o.owner} gets it after their current turn and records it. This card shows Sent until then.`;
    case 'hands-on':
      return `After you do it: press I've done it. ${o.owner} is told and re-checks. Pressing it doesn't prove it worked.`;
    case 'fyi':
      return "Noting doesn't approve anything.";
    case 'status':
      return 'Nothing is sent until you press its button.';
  }
}

/** What "I've done it" types to the agent: never "APPROVED". */
export const doneMessage = (person: string) => `${person} says it's done: please re-check`;

/** A card's main buttons, by kind: what the page draws and the server accepts. */
export type CardAct = 'option' | 'reply' | 'ask' | 'done' | 'cant-now' | 'noted' | 'resolved' | 'still-needed' | 'go' | 'separate';

export function cardActs(c: Pick<DecisionCard, 'kind' | 'escalation' | 'gone' | 'options' | 'sources'>): CardAct[] {
  const sep: CardAct[] = c.sources.length > 1 ? ['separate'] : [];
  if (!c.escalation) return ['go', ...sep];
  if (c.gone) return ['resolved', 'still-needed', ...sep];
  switch (c.kind) {
    case 'hands-on':
      return ['done', 'cant-now', 'ask', ...sep];
    case 'fyi':
      return ['noted', ...sep];
    default:
      return [...(c.options?.length ? (['option'] as CardAct[]) : []), 'reply', 'ask', ...sep];
  }
}

/** Whether a card counts as waiting on you (decisions and actions do; FYIs and info don't). */
export const waitsOnYou = (c: Pick<DecisionCard, 'level' | 'need'>) => c.level !== 'info' && c.need.kind !== 'floor';

export interface CardCounts {
  decisions: number;
  actions: number;
  fyis: number;
}

/** The header's numbers: decisions and actions wait on you; FYIs (and everything info) don't. */
export function cardCounts(cards: readonly Pick<DecisionCard, 'kind' | 'level' | 'need'>[]): CardCounts {
  const out = { decisions: 0, actions: 0, fyis: 0 };
  for (const c of cards) {
    if (c.need.kind === 'floor') continue;
    if (!waitsOnYou(c)) out.fyis++;
    else if (c.kind === 'decision') out.decisions++;
    else out.actions++;
  }
  return out;
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** "3 decisions · 2 actions for you · 4 FYIs" (the parts that aren't 0). */
export function countsWords(c: CardCounts): string {
  const parts = [c.decisions ? n(c.decisions, 'decision', 'decisions') : '', c.actions ? n(c.actions, 'action for you', 'actions for you') : '', c.fyis ? n(c.fyis, 'FYI', 'FYIs') : ''].filter(Boolean);
  return parts.join(' · ') || 'Nothing needs you';
}
