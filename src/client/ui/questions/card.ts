// One question's card on the Questions page: its id and question, the evidence (folded), what it blocks,
// who can answer, the analyst's proposed position, where it was read (whose working copy, committed or
// not), its status, and the four ways to answer it. Answer and Not relevant open a small form in the card;
// Accept proposal and Ask the client are one click. Nothing is sent from here: answers wait in the sticky
// bar for Send.

import { ANSWER_LABEL, cardStatus, sourceWords, blocksWork, type AnswerKind, type PmAnswer, type Question } from '../../../shared/questions';
import { h } from '../dom';
import type { FollowItem } from '../../../shared/followthrough';
import { followLevel, followLine } from '../../../shared/followthrough';
import { bothTexts, followActs } from '../followthrough/card';

export interface CardDeps {
  admin: boolean;
  /** Who it goes to, for the status line. */
  to?: string;
  /** Saves (or with 'clear' takes back) the person's answer; resolves to the error, if any. */
  answer(q: Question, kind: AnswerKind | 'clear', text?: string, option?: string): Promise<string | undefined>;
  /** Its follow-through (Recorded as given), when it's being followed: the line, both texts and the buttons. */
  follow?: FollowItem;
  floor?: string;
}

const KIND_WORDS: Record<string, string> = { 'user-only': 'Needs the client', choice: 'You can decide', gap: 'Gap', conflict: 'Conflict' };

export function questionCard(q: Question, a: PmAnswer | undefined, deps: CardDeps): HTMLElement {
  const st = cardStatus(q, a);
  const status = h('p.qs-msg', { role: 'status', 'aria-live': 'polite' });
  const form = h('div.qs-form');
  const busy = (on: boolean) => card.querySelectorAll<HTMLButtonElement>('.qs-acts button, .qs-form button').forEach((b) => (b.disabled = on));
  const go = async (kind: AnswerKind | 'clear', text?: string, option?: string) => {
    busy(true);
    status.textContent = '';
    const err = await deps.answer(q, kind, text, option);
    busy(false);
    if (err) status.textContent = `Not saved: ${err}`;
  };

  /** The small form for Answer (text, and a choice's options) and Not relevant (the reason). */
  const open = (kind: 'answer' | 'moot') => {
    const ta = h('textarea.qs-text', { rows: 3, 'aria-label': kind === 'moot' ? `Why ${q.id} is not relevant` : `Your answer to ${q.id}`, placeholder: kind === 'moot' ? 'Why it no longer matters (required: the toolkit records MOOT with its reason)' : 'Your answer' }) as HTMLTextAreaElement;
    const opts = kind === 'answer' && q.options?.length ? (h('select.qs-opt', { 'aria-label': 'Pick an option' }, h('option', { value: '' }, 'Pick an option…'), ...q.options.map((o) => h('option', { value: o }, o))) as HTMLSelectElement) : undefined;
    const save = h('button.btn.small.primary', { type: 'button', onclick: () => void go(kind, ta.value, opts?.value || undefined).then(() => !status.textContent && form.replaceChildren()) }, kind === 'moot' ? 'Mark not relevant' : 'Save answer');
    const cancel = h('button.btn.small', { type: 'button', onclick: () => (form.replaceChildren(), trigger?.focus()) }, 'Cancel');
    const trigger = card.querySelector<HTMLButtonElement>(`button[data-kind="${kind}"]`);
    form.replaceChildren(h('div.qs-form-in', {}, opts ?? null, ta, h('div.qs-form-acts', {}, save, cancel)));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel.click();
      }
    });
    setTimeout(() => (opts ?? ta).focus(), 0);
  };

  const settled = st.tone === 'done' || a?.status === 'sent' || a?.status === 'recorded';
  const act = (kind: AnswerKind, extra: Record<string, string> = {}) =>
    h('button.btn.small', { type: 'button', 'data-kind': kind, disabled: !deps.admin, ...extra, onclick: () => (kind === 'answer' || kind === 'moot' ? open(kind) : void go(kind)) }, ANSWER_LABEL[kind]);
  const actions = settled
    ? null
    : a
      ? h('div.qs-acts', {}, h('button.btn.small', { type: 'button', disabled: !deps.admin, onclick: () => void go('clear') }, 'Take back'), a.kind !== 'ask-client' ? null : act('answer'))
      : h('div.qs-acts', {}, q.proposedPosition ? act('accept', { class: 'primary', title: 'Record it as ASSUMED with your consent (your name and the time)' }) : null, act('answer'), act('ask-client', { title: 'Put it in the export for the client' }), act('moot'));

  const yours = a && a.kind !== 'ask-client' ? h('p.qs-yours', {}, h('b', {}, a.kind === 'accept' ? 'You accepted the proposal' : a.kind === 'moot' ? 'Not relevant: ' : a.fromClient ? 'The client answered: ' : 'Your answer: '), a.kind === 'accept' ? '' : [a.option, a.text].filter(Boolean).join(': ')) : null;
  const card = h(
    'article.qs-card',
    { 'data-key': q.key, 'data-tone': st.tone, 'aria-label': `${q.id}: ${q.question}` },
    h(
      'header.qs-card-h',
      {},
      h('code.qs-id', {}, q.id),
      q.kind ? h('span.qs-kind', { 'data-kind': q.kind }, KIND_WORDS[q.kind] ?? q.kind) : null,
      blocksWork(q) ? h('span.qs-blocks-tag', {}, 'Blocks work') : null,
      h('span.qs-status', { 'data-tone': st.tone }, st.tone === 'warn' ? '⚠ ' : '', st.text),
    ),
    h('p.qs-q', {}, q.question),
    q.blocks ? h('p.qs-line', {}, h('b', {}, 'Blocks: '), q.blocks) : null,
    q.owner ? h('p.qs-line', {}, h('b', {}, 'Who can answer: '), q.owner) : null,
    q.proposedPosition ? h('p.qs-line.qs-prop', {}, h('b', {}, 'Proposed position: '), q.proposedPosition) : null,
    q.evidence ? h('details.qs-ev', {}, h('summary', {}, 'Evidence'), h('p', {}, q.evidence), q.sourceRef ? h('p.qs-ref', {}, h('code', {}, q.sourceRef)) : null) : null,
    q.assumedNoConsent ? h('p.qs-warn', { role: 'note' }, `The analyst wrote ASSUMED without your consent${q.assumption ? `: ${q.assumption}` : ''}. The toolkit counts it as never raised (UNRAISED). Accept it or answer it.`) : null,
    yours,
    deps.follow && deps.floor ? h('div.qs-follow.pt-ft', { 'data-level': followLevel(deps.follow.recording) }, h('p.pt-ft-line', {}, followLine(deps.follow)), bothTexts(deps.follow), followActs(deps.floor, deps.follow, deps.admin)) : null,
    h('p.qs-src', {}, `From ${sourceWords(q.source)} · ${q.file}${q.state !== 'RAISED' ? ` · ${q.state}` : ''}`),
    actions,
    form,
    status,
  );
  return card;
}
