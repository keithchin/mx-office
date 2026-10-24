// The App Workspace's decision cards (C4, proposal section 5.1): the business owner's decisions only
// (shared/app-workspace/business-decisions.ts), each with its related artifact beside it when the decision names
// one explicitly (shared/decisions/artifact.ts; never guessed from its words), and answered here through the
// office's own answer path for decision cards (POST /api/decisions/action, Project Manager only, the server
// checks) with the revision the card was opened at: a stale answer is the office's 409, nothing is sent, and the
// card says so plainly and shows the decision as it is now. A decision that isn't an escalation (a client
// question, a stage's sign-off, a design system) is answered where it's answered today, with that page's checks.

import { h, timeAgo } from '../dom';
import { ARTIFACT_WORDS, type DecisionArtifact } from '../../../shared/decisions/artifact';
import type { WorkspaceDecision } from './data';

export type AnswerResult = { ok: true } | { ok: false; status: number; error: string; current?: { state?: string; open?: string; rev?: number } };

export const STALE = 'This question changed since you opened it. Here’s the new version.';

export interface CardsCtx {
  floor: string | null;
  admin: boolean;
  open(tab: string): void;
  answer(x: WorkspaceDecision, a: { verdict: 'reply'; text: string }): Promise<AnswerResult>;
  /** Draw again (after an answer or a refusal). */
  redraw(): void;
}

/** What each card last said after a send: sent, or the 409's new version. Kept per card id across redraws. */
const notes = new Map<string, { kind: 'sent' | 'stale' | 'error'; text: string; question: string }>();

/** The related artifact: only from an explicit id. */
export function artifactSlot(a: DecisionArtifact, floor: string | null, open: (tab: string) => void): HTMLElement {
  const file = floor ? `/api/deliverables/file?floor=${encodeURIComponent(floor)}&path=${encodeURIComponent(a.ref)}` : '';
  const head = h('div.aw-k', {}, ARTIFACT_WORDS[a.kind]);
  const body: (Node | string)[] = [];
  if (a.kind === 'screenshot' && file) {
    const img = h('img.aw-shot', { src: file, alt: `${ARTIFACT_WORDS[a.kind]}: ${a.ref}`, loading: 'lazy' }) as HTMLImageElement;
    img.addEventListener('error', () => img.replaceWith(h('p.aw-none', {}, 'The office couldn’t open this picture here. It may not be a file the office lists under Documents.')));
    body.push(h('a.aw-shotlink', { href: file, target: '_blank', rel: 'noopener' }, img));
  }
  if (a.kind === 'walkthrough' || a.kind === 'journey') {
    body.push(h('p', {}, a.kind === 'walkthrough' ? `Walkthrough ${a.ref}` : `Guided check ${a.ref}`));
    body.push(h('button.aw-link', { type: 'button', onclick: () => open(a.kind === 'walkthrough' ? 'walkthroughs' : 'testing') }, a.kind === 'walkthrough' ? 'Watch it in Project Management' : 'See its results in Project Management'));
  } else {
    body.push(h('p.aw-small', {}, a.ref));
    if (file) body.push(h('a.aw-link', { href: file, target: '_blank', rel: 'noopener' }, 'Open it in a new tab ↗'));
  }
  return h('aside.aw-artifact', { 'data-artifact': a.kind, 'aria-label': `Related: ${ARTIFACT_WORDS[a.kind]}` }, head, ...body);
}

function answerForm(x: WorkspaceDecision, c: CardsCtx): HTMLElement {
  let pick: string | undefined = x.options?.length ? (x.recommendation && x.options.find((o) => x.recommendation!.includes(o))) || undefined : undefined;
  const opts = (x.options ?? []).map((o) => {
    const b = h('button.aw-opt', { type: 'button', 'aria-pressed': String(pick === o) }, h('b', {}, o), x.recommendation && x.recommendation.includes(o) ? h('span.aw-rec', {}, 'Team recommends') : '') as HTMLButtonElement;
    b.addEventListener('click', () => {
      pick = o;
      for (const y of opts) y.setAttribute('aria-pressed', String(y === b));
    });
    return b;
  });
  const note = h('textarea.aw-note', { rows: 2, placeholder: x.options?.length ? 'Add a note (optional)' : 'Your answer, in your own words', 'aria-label': `Your answer to: ${x.question}` }) as HTMLTextAreaElement;
  const err = h('p.aw-warn', { role: 'alert', hidden: true });
  const send = h('button.aw-btn.aw-primary.aw-send', { type: 'button' }, 'Send decision') as HTMLButtonElement;
  send.addEventListener('click', () => {
    const own = note.value.trim();
    if (!pick && !own) {
      err.hidden = false;
      err.textContent = x.options?.length ? 'Pick an option, or write your answer.' : 'Write your answer first.';
      return note.focus();
    }
    send.disabled = true;
    const text = pick ? `Go with: ${pick}${own ? `\n\n${own}` : ''}` : own;
    void c.answer(x, { verdict: 'reply', text }).then((r) => {
      send.disabled = false;
      if (r.ok) notes.set(x.id, { kind: 'sent', question: x.question, text: `Sent to ${x.owner ?? 'the team'}. They record it, and the decision leaves this list.` });
      else if (r.status === 409) notes.set(x.id, { kind: 'stale', question: x.question, text: r.current?.open ?? (r.current?.state ? `Now: ${r.current.state}.` : 'Its new state is shown below.') });
      else notes.set(x.id, { kind: 'error', question: x.question, text: r.error });
      c.redraw();
    });
  });
  return h('div.aw-answer', {}, ...(opts.length ? [h('div.aw-opts', { role: 'group', 'aria-label': 'Options' }, ...opts)] : []), note, err, h('div.aw-row', {}, h('span.aw-grow'), send), h('p.aw-small', {}, 'Your answer is kept with the revision of the question you saw; if it changed meanwhile, nothing is sent and you’re shown the new version.'));
}

function noteEl(id: string, c: CardsCtx): HTMLElement | '' {
  const n = notes.get(id);
  if (!n) return '';
  return h('div.aw-note-msg', { class: n.kind, role: 'status', 'data-note': n.kind }, n.kind === 'stale' ? h('p', {}, h('b', {}, STALE)) : '', h('p', {}, n.text), h('button.aw-link', { type: 'button', onclick: () => (notes.delete(id), c.redraw()) }, 'OK'));
}

/** One decision's card (the docked chat draws each one inline, in the conversation). */
export function decisionCard(x: WorkspaceDecision, c: CardsCtx): HTMLElement {
  const here = !!x.escalation && c.admin;
  const actions = here
    ? answerForm(x, c)
    : h('div.aw-row', {}, h('span.aw-small', {}, x.escalation && !c.admin ? 'Only the Project Manager (an admin) can answer this.' : 'Answered on its own page, with its own checks.'), h('span.aw-grow'), h('button.aw-btn', { type: 'button', onclick: () => x.answer() }, x.escalation && !c.admin ? 'View' : 'Answer'));
  const main = h(
    'div.aw-dcard',
    {},
    h('div.aw-row', {}, h('p.aw-q', {}, x.question), h('span.aw-grow'), h('span.aw-pill', { class: x.level === 'block' ? 'bad' : 'warn' }, 'Needs you')),
    x.detail ? h('p.aw-small', {}, x.detail.length > 320 ? `${x.detail.slice(0, 319)}…` : x.detail) : '',
    h('p.aw-small', {}, [x.owner ? `Asked by ${x.owner}` : '', x.since ? `waiting since ${timeAgo(x.since)}` : ''].filter(Boolean).join(' · ')),
    noteEl(x.id, c),
    actions,
  );
  return h('li.aw-decision', { 'data-level': x.level, 'data-id': x.id, class: x.artifact ? 'with-artifact' : '' }, ...(x.artifact ? [artifactSlot(x.artifact, c.floor, c.open)] : []), main);
}

/** The decision cards, most blocking first; the notes of cards that left the list (answered, or answered elsewhere) above them. */
export function decisionCards(list: readonly WorkspaceDecision[], c: CardsCtx): HTMLElement {
  return h('div', {}, ...leftNotes(list, c), list.length ? h('ul.aw-decisions', {}, ...list.map((x) => decisionCard(x, c))) : h('p.aw-none', {}, 'Nothing waits on you. When the team needs a decision from you, it shows here, most blocking first.'));
}

/** What the cards said after a send, for decisions that left the list (answered, here or elsewhere). */
export function leftNotes(list: readonly WorkspaceDecision[], c: CardsCtx): HTMLElement[] {
  const gone = [...notes].filter(([id]) => !list.some((x) => x.id === id));
  return gone.map(([id, n]) => h('div.aw-note-msg', { class: n.kind, role: 'status', 'data-note': n.kind, 'data-id': id }, n.kind === 'stale' ? h('p', {}, h('b', {}, STALE)) : '', h('p', {}, h('i', {}, n.question)), h('p', {}, n.text), h('button.aw-link', { type: 'button', onclick: () => (notes.delete(id), c.redraw()) }, 'OK')));
}

/** For tests: forget the notes. */
export const forgetNotes = () => notes.clear();
