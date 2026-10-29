// The Change answer dialog (Slice 1B-3): compact, with its ✕ top right; ✕ or Esc gives focus back to the
// button that opened it. It shows the current answer (rev n) with who, when and its follow-through state,
// the new answer in the same shape as the original (an escalation's options, reply text and Reply / Approve /
// Reject; a question's Answer / Accept proposal / Not relevant), the work that used rev n (recorded links
// and inferred ones, labelled; "No linked work found…" when none, never "no impact"), and Send change. The
// detail is fetched once when it opens (api.ts); a 409 says what changed and shows the new current answer.

import type { AnswerDetail, LinkedWork, QChangeKind } from '../../../shared/change-answer';
import { fullLabel } from '../../../shared/full-text';
import { LINK_WORDS, revDispatchWords, revOutcomeWords } from '../../../shared/change-answer';
import { NO_WORK_REQUIRED } from '../../../shared/task-links';
import { taskLinksList } from '../task-links/view';
import type { EscalationVerdict } from '../../../shared/roster/escalation';
import { h, openModal, timeAgo, toast } from '../dom';
import { freshDetail, loadDetail, sendChange } from './api';
import { historyList } from './history';
import './change-answer.css';

const VERDICT_LABEL: Record<EscalationVerdict, string> = { reply: 'Reply', approve: 'Approve', reject: 'Reject', dismiss: 'Noted' };
const Q_LABEL: Record<QChangeKind, string> = { answer: 'Answer', accept: 'Accept proposal', moot: 'Not relevant' };

function linkRow(l: LinkedWork): HTMLElement {
  return h('li.ca-link', { 'data-strength': l.strength }, h('span.ca-link-tag', { 'data-strength': l.strength }, LINK_WORDS[l.strength]), h('span.ca-link-l', {}, l.label), h('span.ca-link-src', {}, ` · ${l.source}`));
}

/** Radio-like buttons: the one chosen is pressed. */
function choices<T extends string>(label: string, items: readonly T[], words: Record<T, string>, start: T, on: (v: T) => void) {
  let v = start;
  const btns = items.map((x) => h('button.btn.small.ca-choice', { type: 'button', role: 'radio', 'data-v': x, onclick: () => ((v = x), paint(), on(x)) }, words[x]));
  const paint = () => btns.forEach((b) => (b.setAttribute('aria-checked', String(b.dataset.v === v)), b.classList.toggle('on', b.dataset.v === v)));
  paint();
  return { el: h('div.ca-choices', { role: 'radiogroup', 'aria-label': label }, ...btns), get: () => v };
}

/** Opens the dialog for `decision`, as its card saw it at revision `rev`; `done` after a change went. */
export function openChangeAnswer(floor: string, decision: string, rev: number, done?: () => void) {
  const back = document.activeElement as HTMLElement | null;
  const body = h('div.body.ca-body', {}, h('p.ca-rev-meta', {}, 'Loading…'));
  const status = h('p.ca-msg', { role: 'status', 'aria-live': 'polite' });
  const sendBtn = h('button.btn.primary', { type: 'button', disabled: true }, 'Send change') as HTMLButtonElement;
  const title = h('h2', {}, 'Change answer');
  const content = h('div.modal.ca-modal', { role: 'dialog', 'aria-label': 'Change answer' }, h('header', {}, title), body, h('footer', {}, status, sendBtn));
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  let send: () => Promise<void> = async () => {};
  sendBtn.onclick = () => void send();

  const draw = (d: AnswerDetail) => {
    title.textContent = `Change answer · ${d.label}`;
    const cur = d.revs.find((r) => r.rev === d.rev);
    const current = h(
      'section.ca-sec',
      { 'aria-label': `Current answer (rev ${d.rev})` },
      h('h3', {}, `Current answer (rev ${d.rev})`),
      h('p.ca-title', {}, d.title),
      d.details ? h('details.ca-full', {}, h('summary', {}, fullLabel(d.details)), h('div.ca-full-text', {}, d.details)) : null,
      cur ? h('p.ca-rev-text', {}, [cur.option && !cur.text.includes(cur.option) ? cur.option : '', cur.text].filter(Boolean).join(': ') || '(no text)') : h('p.ca-rev-meta', {}, 'Not in the answer store'),
      cur ? h('p.ca-rev-meta', {}, `${cur.by} · ${timeAgo(cur.at)} · Sent: ${revDispatchWords(cur)} · Follow-through: ${revOutcomeWords(cur)}`) : null,
      d.revs.length > 1 ? h('details.ca-hist', {}, h('summary', {}, `History (${d.revs.length} revisions)`), historyList(d)) : null,
    );
    // The explicit links (1B-3) and the task links with their strength and evidence (1B-4); when there are none,
    // "No links found" or the person's stated "No implementation work required", never one for the other.
    const links = h('section.ca-sec', { 'aria-label': `Work that used rev ${d.rev}` }, h('h3', {}, `Work that used rev ${d.rev}`), d.links.length ? h('ul.ca-links', {}, ...d.links.map(linkRow)) : null, taskLinksList(d.taskLinks, { others: d.links.length }));
    if (d.blocked) {
      body.replaceChildren(current, h('p.ca-blocked', { role: 'note' }, d.blocked), links);
      sendBtn.disabled = true;
      return;
    }
    const ta = h('textarea.ca-text', { rows: 3, maxlength: 4000, 'aria-label': 'Your new answer' }) as HTMLTextAreaElement;
    // Slice 1B-4: "No implementation work required": the answer stands as it is, restated as a new revision of that kind with your reason.
    const noWorkBox = h('input', { type: 'checkbox', class: 'ca-nowork-box' }) as HTMLInputElement;
    const noWork = h('label.ca-nowork', { title: 'The answer stands as it is; this records your choice that no implementation work is needed for it (a new revision). The text above is your reason.' }, noWorkBox, ` ${NO_WORK_REQUIRED}`);
    let fresh: HTMLElement;
    let read: () => { verdict?: EscalationVerdict; kind?: QChangeKind; text: string; option?: string; noWork?: boolean } | string;
    if (d.input.kind === 'esc') {
      const inp = d.input;
      ta.placeholder = inp.options.length ? 'Your new answer (or pick an option)…' : 'Your new answer…';
      const opts = inp.options.length ? h('div.ca-opts', { role: 'group', 'aria-label': 'Options' }, ...inp.options.map((o) => h('button.btn.small.ca-opt', { type: 'button', class: o === inp.recommendation ? 'rec' : '', title: 'Use this option as your answer', onclick: () => ((ta.value = `Go with: ${o}`), ta.focus()) }, o === inp.recommendation ? `⭐ ${o}` : o))) : null;
      const verdicts: EscalationVerdict[] = inp.fyi ? ['reply', 'approve', 'reject', 'dismiss'] : ['reply', 'approve', 'reject'];
      const v = choices('Your answer is', verdicts, VERDICT_LABEL, 'reply', () => {});
      fresh = h('section.ca-sec', { 'aria-label': 'New answer' }, h('h3', {}, 'New answer'), opts, ta, v.el, inp.fyi ? null : noWork);
      read = () => {
        const text = ta.value.trim();
        if (noWorkBox.checked) return { noWork: true, text };
        if (v.get() === 'reply' && !text) return 'Write your new answer';
        if (v.get() === 'reject' && !text) return 'Say why it is rejected';
        return { verdict: v.get(), text };
      };
    } else {
      const inp = d.input;
      const kinds: QChangeKind[] = inp.proposedPosition ? ['answer', 'accept', 'moot'] : ['answer', 'moot'];
      const sel = inp.options.length ? (h('select.ca-sel', { 'aria-label': 'Pick an option' }, h('option', { value: '' }, 'Pick an option…'), ...inp.options.map((o) => h('option', { value: o }, o))) as HTMLSelectElement) : undefined;
      const prop = inp.proposedPosition ? h('p.ca-rev-meta', {}, h('b', {}, 'Proposed position: '), inp.proposedPosition) : null;
      const paint = (k: QChangeKind) => {
        ta.hidden = k === 'accept';
        if (sel) sel.hidden = k !== 'answer';
        ta.placeholder = k === 'moot' ? 'Why it no longer matters (required)' : 'Your new answer';
      };
      const k = choices('Your answer is', kinds, Q_LABEL, 'answer', paint);
      paint('answer');
      fresh = h('section.ca-sec', { 'aria-label': 'New answer' }, h('h3', {}, 'New answer'), k.el, prop, sel ?? null, ta, noWork);
      read = () => {
        const text = ta.value.trim();
        if (noWorkBox.checked) return { noWork: true, text };
        const kind = k.get();
        if (kind === 'moot' && !text) return 'Say why it is not relevant';
        if (kind === 'answer' && !text && !sel?.value) return 'Write the answer first';
        return { kind, text: kind === 'accept' ? '' : text, ...(kind === 'answer' && sel?.value ? { option: sel.value } : {}) };
      };
    }
    body.replaceChildren(current, fresh, links);
    sendBtn.disabled = false;
    setTimeout(() => ta.focus(), 0);
    send = async () => {
      const x = read();
      if (typeof x === 'string') {
        status.textContent = x;
        return void ta.focus();
      }
      sendBtn.disabled = true;
      status.textContent = 'Sending…';
      const out = await sendChange({ floor, decision, expectedRev: d.rev, ...x });
      if (!out.ok) {
        status.textContent = out.error;
        if (out.status === 409) {
          // It moved on meanwhile: show the answer as it is now, nothing was written.
          const now = await freshDetail(floor, decision);
          if (typeof now !== 'string') draw(now);
          status.textContent = `${out.error}. This is the answer now; change it again if you still want to.`;
        } else sendBtn.disabled = false;
        return;
      }
      toast(out.note ?? `Changed: ${d.label} rev ${out.rev} replaces rev ${d.rev}`, out.note ? 'warn' : 'info');
      modal.close();
      done?.();
    };
  };

  void loadDetail(floor, decision, rev).then((d) => {
    if (typeof d === 'string') return void body.replaceChildren(h('p.ca-blocked', {}, d));
    draw(d);
  });
}
