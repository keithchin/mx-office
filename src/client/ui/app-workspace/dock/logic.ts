// What the Developer view's docked chat (./index.ts) decides, without the page, so the tests can check every
// case: which changes are this session's, the header's summary, each change's receipt in words, when a change
// gets its "Please try this" card and when it sits in the conversation, the chip for what's selected, and the
// words a request carries. Only what the record backs: no timings, no guesses. Pure.

import { type DevChangesView, type DevChangeView } from '../../../../shared/dev-changes';
import type { ContextChip } from '../../lead-panel/dock';
import type { ElementContext } from '../explorer/element-ref';

/** A working session: changes asked in the last 12 hours, and every change still on its way, are "this session's". */
export const SESSION_MS = 12 * 3_600_000;

const OPEN = new Set(['queued', 'clarify', 'with-team', 'candidate']);

/** This session's changes, oldest first. */
export function sessionChanges(list: readonly DevChangeView[], now: number): DevChangeView[] {
  return list.filter((c) => now - c.at <= SESSION_MS || OPEN.has(c.state)).sort((a, b) => a.at - b.at || Number(a.id.slice(3)) - Number(b.id.slice(3)));
}

/** Where the work is, one fact (never the preview's or a review's): the record's execution state. */
export type Execution = 'queued' | 'clarify' | 'working' | 'candidate' | 'merged' | 'cancelled' | 'not-found';
const EXECUTION: Record<DevChangeView['state'], Execution> = {
  queued: 'queued',
  clarify: 'clarify',
  'with-team': 'working',
  candidate: 'candidate',
  merged: 'merged',
  'in-preview': 'merged',
  'preview-behind': 'merged',
  'preview-off': 'merged',
  cancelled: 'cancelled',
  'not-found': 'not-found',
};
const EXEC_WORD: Record<Execution, string> = { queued: 'Queued', clarify: 'Needs clarification', working: 'With the team', candidate: 'On candidate', merged: 'Merged', cancelled: 'Cancelled', 'not-found': 'Candidate not found' };
const EXEC_GROUP: Record<Execution, string> = { queued: 'queued', clarify: 'need a word', working: 'with the team', candidate: 'on a candidate', merged: 'merged', cancelled: 'cancelled', 'not-found': 'not found' };
export const executionOf = (c: DevChangeView): Execution => EXECUTION[c.state];
/** The execution fact in words, with the revision it names: "On candidate @c0ffee1", "Merged @f00d123". */
export function executionWords(c: DevChangeView): string {
  const e = executionOf(c);
  const rev = (e === 'candidate' || e === 'merged') && c.revision ? ` @${short(c.revision)}` : '';
  return `${EXEC_WORD[e]}${rev}`;
}

/** "3 changes this session" and "1 queued · 1 with the team · 2 merged · 1 in the preview" (execution, then the preview apart). */
export function sessionSummary(list: readonly DevChangeView[]): { head: string; parts: string[] } {
  const n = list.length;
  const counts = new Map<string, number>();
  for (const c of list) {
    const g = EXEC_GROUP[executionOf(c)];
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const inPreview = list.filter((c) => c.state === 'in-preview').length;
  const parts = [...counts].map(([g, k]) => `${k} ${g}`);
  if (inPreview) parts.push(`${inPreview} in the preview`);
  return { head: n ? `${n} change${n === 1 ? '' : 's'} this session` : 'No changes this session', parts };
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const clock = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Who paused the project and when, in a line, and when queued changes start. */
export function pauseWords(p: NonNullable<DevChangesView['pause']>): string {
  const who = p.why === 'restart' ? 'for a safe restart' : p.why === 'budget' ? 'because its budget is reached' : `by ${p.by}`;
  return `Project paused ${who} (${clock(p.at)}). Queued changes start when someone resumes it in Project Management (▶ Resume).`;
}

/** One of a receipt's facts: what it is about, and what the record says. */
export interface ReceiptFact {
  key: 'checks' | 'preview' | 'review';
  label: string;
  text: string;
}

/**
 * A change's receipt: "→ DC-4 · On candidate @c0ffee1" (where the work is), then each fact apart, as the record
 * backs it: the work (queued and why, the pause with who and when), the checks at exactly that revision, whether
 * the live preview has it, and the person's review of a version. Merged is never "accepted" nor "ready to try":
 * only a preview that contains it is, and only a review says it looks right.
 */
export function receiptWords(c: DevChangeView, pause?: DevChangesView['pause']): { head: string; line: string; facts: ReceiptFact[] } {
  const e = executionOf(c);
  const head = `→ ${c.id} · ${executionWords(c)}`;
  const place = c.position && c.position > 1 ? `Number ${c.position} in the queue. ` : '';
  const line = e === 'queued' && pause ? `${place}${pauseWords(pause)}` : e === 'merged' ? '' : c.detail;
  const facts: ReceiptFact[] = [];
  if (e === 'candidate' || e === 'merged') {
    facts.push({ key: 'checks', label: 'Checks', text: c.checks ? c.checks.line : e === 'merged' ? `None shown here for @${short(c.revision)}: see Testing in Project Management` : 'None reported yet' });
    const preview =
      c.state === 'in-preview' ? c.detail.replace(/: try it in the app\.$/, '.') : c.state === 'preview-behind' ? 'Not in the preview yet: it runs an older version.' : c.state === 'preview-off' ? 'The live preview isn’t running.' : e === 'merged' ? 'Whether the preview has it couldn’t be told.' : 'Not in the preview: it runs main, not this candidate.';
    facts.push({ key: 'preview', label: 'Preview', text: preview });
  }
  const r = c.reviews?.at(-1);
  if (r || e === 'merged') facts.push({ key: 'review', label: 'Your review', text: !r ? 'None yet' : r.verdict === 'works' ? `Looks right on @${short(r.revision)} (${r.by})` : `Something’s wrong on @${short(r.revision)} (${r.by})${r.correction ? `: ${r.correction}` : ''}` });
  return { head, line, facts };
}

/** The words a person asked with, without the context line the office added ("About: …"). */
export function askedWords(text: string): string {
  return text.replace(/\n+About: [^\n]*$/, '').trim();
}

/** A change's "Please try this" card: once its merge is in the live preview. */
export const wantsTry = (c: DevChangeView) => c.state === 'in-preview';

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
