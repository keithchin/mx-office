// What the Developer view's docked chat (./index.ts) decides, without the page, so the tests can check every
// case: which changes are this session's, the header's summary, each change's receipt in words (the four facts
// apart: execution, verification, preview availability, human review), when a change gets its "Please try this"
// card and when it sits in the conversation, the chip for what's selected, and the words a request carries. Only
// what the record backs: no timings, no guesses. Pure.

import { FACT_LABEL, type ChangeFour, type ChangeState, type DevChangesView, type DevChangeView } from '../../../../shared/dev-changes';
import type { ContextChip } from '../../lead-panel/dock';
import type { ElementContext } from '../explorer/element-ref';

/** A working session: changes asked in the last 12 hours, and every change still on its way, are "this session's". */
export const SESSION_MS = 12 * 3_600_000;

const OPEN = new Set<ChangeState>(['queued', 'clarify', 'working', 'candidate', 'attention']);

/** This session's changes, oldest first (linked records from other entry points' history aside). */
export function sessionChanges(list: readonly DevChangeView[], now: number): DevChangeView[] {
  return list.filter((c) => c.queue !== 'linked' || now - c.at <= SESSION_MS).filter((c) => now - c.at <= SESSION_MS || OPEN.has(c.state)).sort((a, b) => a.at - b.at || Number(a.id.slice(3)) - Number(b.id.slice(3)));
}

const EXEC_GROUP: Record<ChangeState, string> = { queued: 'queued', clarify: 'need a word', working: 'working', candidate: 'on a candidate', implemented: 'implemented', attention: 'need attention', abandoned: 'abandoned', 'not-found': 'not found', cancelled: 'cancelled', superseded: 'superseded' };
/** The execution fact in words, with the revision it names: "Working · candidate @c0ffee1", "Implemented @f00d123". */
export const executionWords = (c: DevChangeView) => c.facts.execution.words;

/** "3 changes this session" and "1 queued · 1 working · 2 implemented · 1 in the preview" (execution, then the preview apart). */
export function sessionSummary(list: readonly DevChangeView[]): { head: string; parts: string[] } {
  const n = list.length;
  const counts = new Map<string, number>();
  for (const c of list) {
    const g = EXEC_GROUP[c.state];
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const inPreview = list.filter((c) => c.facts.preview.status === 'in').length;
  const held = list.filter((c) => c.facts.preview.status === 'held').length;
  const parts = [...counts].map(([g, k]) => `${k} ${g}`);
  if (inPreview) parts.push(`${inPreview} in the preview`);
  if (held) parts.push(`${held} held`);
  return { head: n ? `${n} change${n === 1 ? '' : 's'} this session` : 'No changes this session', parts };
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const clock = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Who paused the project and when, in a line, and when queued changes start. */
export function pauseWords(p: NonNullable<DevChangesView['pause']>): string {
  const who = p.why === 'restart' ? 'for a safe restart' : p.why === 'budget' ? 'because its budget is reached' : `by ${p.by}`;
  return `Project paused ${who} (${clock(p.at)}). Queued changes start when someone resumes it in Project Management (▶ Resume).`;
}

/** One of a receipt's facts: which one, its label and what its source says. */
export interface ReceiptFact {
  key: keyof ChangeFour;
  label: string;
  text: string;
  status: string;
}

const FACT_KEYS: readonly (keyof ChangeFour)[] = ['execution', 'verification', 'preview', 'review'];

/**
 * A change's receipt: "→ DC-4 · Working · candidate @c0ffee1" (where the work is), its line, then the four facts
 * apart as their sources back them: the work, the checks at exactly the relevant revision (none or no CI:
 * incomplete), whether the live preview has it (or the guard holds it), and the person's review of a version.
 * Implemented is never "accepted" nor "ready to try": only a preview that contains it is, and only a review says
 * it looks right.
 */
export function receiptWords(c: DevChangeView, pause?: DevChangesView['pause']): { head: string; line: string; facts: ReceiptFact[] } {
  const head = `→ ${c.id} · ${executionWords(c)}`;
  const place = c.position && c.position > 1 ? `Number ${c.position} in the queue. ` : '';
  const line = c.state === 'queued' && pause ? `${place}${pauseWords(pause)}` : c.detail;
  const facts = FACT_KEYS.map((k) => ({ key: k, label: FACT_LABEL[k], text: c.facts[k].words, status: c.facts[k].status }));
  return { head, line, facts };
}

/** The dependency note: "Depends on DC-2 (not yet tried)". */
export const dependsWords = (c: Pick<DevChangeView, 'depends'>) => (c.depends?.length ? `Depends on ${c.depends.map((d) => d.id).join(', ')} (not yet tried): it overlaps ${[...new Set(c.depends.flatMap((d) => d.docs))].slice(0, 3).map((k) => k.split(':')[1]).join(', ')}` : '');

/** The words a person asked with, without the context line the office added ("About: …"). */
export function askedWords(text: string): string {
  return text.replace(/\n+About: [^\n]*$/, '').trim();
}

/** A change's "Please try this" card: once its merge is in the live preview. */
export const wantsTry = (c: DevChangeView) => c.facts.preview.status === 'in';

/** Where a card sits in the conversation: after the latest thing the record says happened to the change. */
export function tryAt(c: DevChangeView): number {
  return Math.max(c.at, c.settled?.at ?? 0, c.activated?.at ?? 0, ...c.candidates.map((x) => x.seenAt)) + 1;
}

/** The newest review of a change at exactly `revision` (the version on screen), if any. */
export function reviewAt(c: DevChangeView, revision: string | undefined) {
  if (!revision) return undefined;
  const r = revision.toLowerCase();
  return [...(c.reviews ?? [])].reverse().find((x) => x.revision.startsWith(r) || r.startsWith(x.revision));
}

/** What's selected in the explorer, as context for the composer and the request it makes. */
export interface DevContext {
  about: string;
  element?: ElementContext;
  rev?: string;
  page?: string;
}

/** The chip for a context: "My orders › Save button" for a widget, "My orders" for a page, "Logic: Save order" for an item. */
export function chipFor(c: DevContext): ContextChip {
  const e = c.element;
  const kind: ContextChip['kind'] = e?.ref.widgetName ? 'widget' : e ? 'page' : 'item';
  const label = e ? e.chip : c.about;
  const at = c.rev ? ` at @${short(c.rev)}` : '';
  return { key: `${kind}|${e ? `${e.ref.docQn}/${e.ref.widgetName ?? ''}` : c.about}|${c.rev ?? ''}`, label, title: `${e ? e.where : c.about}${at}`, kind };
}

/** What the lead is told a message with a chip is about. */
export function aboutLine(c: DevContext): string {
  const e = c.element;
  const at = c.rev ? ` at revision @${short(c.rev)}` : '';
  return e ? `About: ${e.chip} (${e.where})${at}${e.impact ? `. ${e.impact}` : ''}` : `About: ${c.about}${at}`;
}

/** The note the lead gets (after its turn) when a change waits in the queue: it knows, and doesn't start it early. */
export function queuedNote(c: Pick<DevChangeView, 'id' | 'by'>, text: string): string {
  return `For your information, from the Developer view: ${c.by} asked for a change, kept as ${c.id} and queued. It reaches you as its own task when it's next, on branch dev/${c.id}: nothing to do for it now.\n\nTheir words: ${askedWords(text)}`;
}
