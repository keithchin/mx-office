// The Questions page's windows: Send to <analyst> (the message it will type, and, when they're working,
// the same "OK to interrupt?" choice as the console: after their current turn unless you pick now), the
// export for the client (CSV or a printable page, the questions marked Ask the client or every user-only
// one) and the import of the client's answers (the filled-in CSV, or pasted "OQ-05: answer" lines). Each
// has its ✕ (openModal), and ✕ or Esc gives focus back to the button that opened it.

import type { QuestionsView, Recipient } from '../../../shared/questions';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { setQuestionsView } from './feed';

const me = () => store.me.account?.name ?? store.profile.name;

async function post<T>(url: string, body: Record<string, unknown>): Promise<T & { error?: string }> {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, by: me() }) }).catch(() => undefined);
  const out = ((await res?.json().catch(() => ({}))) ?? {}) as T & { error?: string };
  if (!res?.ok) out.error ??= 'the office could not be reached';
  return out;
}

/** Send to <recipient>: the preview of the one message, the interrupt choice, Send. */
export function openSend(floor: string, r: Recipient, count: number) {
  const back = document.activeElement as HTMLElement | null;
  const status = h('p.qs-msg', { role: 'status', 'aria-live': 'polite' }, 'Building the message…');
  const preview = h('pre.qs-preview', { tabindex: 0, 'aria-label': 'The message' });
  let when: 'after' | 'now' = 'after';
  const choice = (v: 'after' | 'now', label: string) => h('button.btn.small.qs-when', { type: 'button', role: 'radio', 'data-v': v, onclick: () => ((when = v), paint()) }, label);
  const whens = [choice('after', 'After their current turn'), choice('now', 'Interrupt now')];
  const paint = () => whens.forEach((b) => (b.setAttribute('aria-checked', String(b.dataset.v === when)), b.classList.toggle('on', b.dataset.v === when)));
  paint();
  const sendBtn = h('button.btn.primary', { type: 'button', disabled: true, onclick: () => void send() }, `Send to ${r.name}`);
  const content = h(
    'div.modal.qs-modal',
    { role: 'dialog', 'aria-label': `Send ${count} answers to ${r.name}` },
    h('header', {}, h('h2', {}, `Send ${count} answer${count === 1 ? '' : 's'} to ${r.name}`)),
    h(
      'div.body',
      {},
      h('p', {}, `One message asks ${r.name} to record your answers in the BRDs with the toolkit's vocabulary and re-run bin/open-questions.sh. The office never edits the files itself; each shows as recorded once the toolkit reads it so.`),
      preview,
      r.working ? h('div.qs-interrupt', {}, h('p', {}, `${r.name} is working. OK to interrupt?`), h('div.qs-whens', { role: 'radiogroup', 'aria-label': `When ${r.name} gets it` }, ...whens)) : h('p', {}, `${r.name} is ready: the message goes now.`),
      status,
    ),
    h('footer', {}, sendBtn),
  );
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  void fetch(`/api/questions/draft?floor=${encodeURIComponent(floor)}&to=${encodeURIComponent(r.name)}&by=${encodeURIComponent(me())}`, { credentials: 'same-origin' })
    .then((res) => res.json() as Promise<{ text?: string; count?: number }>)
    .then((d) => {
      preview.textContent = d.text || 'Nothing is ready to send.';
      status.textContent = '';
      sendBtn.disabled = !d.text;
      sendBtn.focus();
    })
    .catch(() => (status.textContent = 'The office could not be reached.'));
  async function send() {
    sendBtn.disabled = true;
    status.textContent = 'Sending…';
    const out = await post<QuestionsView>('/api/questions/send', { floor, to: r.name, when: r.working ? when : 'now' });
    if (out.error || !out.floor) {
      sendBtn.disabled = false;
      status.textContent = `Not sent: ${out.error ?? 'no answer from the office'}`;
      return;
    }
    setQuestionsView(out);
    modal.close();
  }
}

/** Export for the client: which questions, then the CSV or the printable page. */
export function openExport(floor: string, asked: number, userOnly: number) {
  const back = document.activeElement as HTMLElement | null;
  let which: 'asked' | 'user-only' = asked ? 'asked' : 'user-only';
  const radio = (v: typeof which, label: string, n: number) =>
    h('label.qs-radio', {}, h('input', { type: 'radio', name: 'qs-which', value: v, checked: v === which, onchange: () => (which = v) }), ` ${label} (${n})`);
  const href = (format: 'csv' | 'html') => `/api/questions/export?floor=${encodeURIComponent(floor)}&format=${format}&which=${which}`;
  const content = h(
    'div.modal.qs-modal',
    { role: 'dialog', 'aria-label': 'Export for the client' },
    h('header', {}, h('h2', {}, 'Export for the client')),
    h(
      'div.body',
      {},
      h('p', {}, 'A file with the questions for the client: the id, the BRD, the question, its context in plain words, what it blocks, and an empty Answer column. Fill in the CSV (Excel opens it) and import it back here.'),
      h('fieldset.qs-which', {}, h('legend', {}, 'Which questions'), radio('asked', 'Marked Ask the client', asked), radio('user-only', 'Those, and every open question only the client can answer', asked + userOnly)),
    ),
    h('footer', {}, h('button.btn.primary', { type: 'button', onclick: () => location.assign(href('csv')) }, 'Download CSV'), h('button.btn', { type: 'button', onclick: () => window.open(href('html'), '_blank', 'noopener') }, 'Printable page')),
  );
  openModal(content, { onClose: () => back?.focus?.() });
  setTimeout(() => content.querySelector<HTMLInputElement>('input:checked')?.focus(), 0);
}

/** Import the client's answers: the filled-in CSV, or "ID: answer" lines. */
export function openImport(floor: string) {
  const back = document.activeElement as HTMLElement | null;
  const status = h('p.qs-msg', { role: 'status', 'aria-live': 'polite' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'The filled-in CSV' }) as HTMLInputElement;
  const ta = h('textarea.qs-text', { rows: 6, 'aria-label': 'Answers, one per line', placeholder: 'OQ-05: Yes, all ten draft decisions are confirmed.\nG3B: Until the end of the visit window.' }) as HTMLTextAreaElement;
  const go = h('button.btn.primary', { type: 'button', onclick: () => void run() }, 'Import');
  const content = h(
    'div.modal.qs-modal',
    { role: 'dialog', 'aria-label': "Import the client's answers" },
    h('header', {}, h('h2', {}, "Import the client's answers")),
    h('div.body', {}, h('p', {}, "Each answer goes on the question with the same id, marked as the client's and imported by you, ready to send to the analyst."), h('label.qs-field', {}, 'The filled-in CSV', file), h('label.qs-field', {}, 'Or paste lines like "OQ-05: answer"', ta), status),
    h('footer', {}, go),
  );
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  setTimeout(() => file.focus(), 0);
  async function run() {
    const f = file.files?.[0];
    const text = f ? await f.text() : ta.value;
    if (!text.trim()) return void (status.textContent = 'Pick the file or paste the answers first.');
    go.disabled = true;
    status.textContent = 'Importing…';
    const out = await post<{ matched: string[]; unknown: string[]; skipped: string[]; view: QuestionsView }>('/api/questions/import', { floor, format: f ? 'csv' : 'text', text });
    go.disabled = false;
    if (out.error) return void (status.textContent = `Not imported: ${out.error}`);
    setQuestionsView(out.view);
    const said = [`${out.matched.length} answer${out.matched.length === 1 ? '' : 's'} attached`, out.unknown.length ? `no question with id ${out.unknown.join(', ')}` : '', out.skipped.length ? `skipped (already settled or sent): ${out.skipped.join(', ')}` : ''].filter(Boolean).join('; ');
    if (!out.unknown.length && !out.skipped.length) return void modal.close();
    status.textContent = `${said}.`;
  }
}
