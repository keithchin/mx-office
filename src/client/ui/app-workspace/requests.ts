// The Developer view's Request a change (C4, shared/change-requests.ts, server/change-requests/): the POST every
// entry point uses (the docked chat, ./dock/; this dialog), and the dialog itself, kept as the fallback where
// there's no chat on the page (the docked composer is the way in otherwise):
//
//   dialog   Request a change: the person's words, and what it's about, captured for them: the project, the page
//            of the app the canvas shows and the running version. It becomes a Developer change (DC-n,
//            ui/dev-changes/): queued, and handed to the team's lead as a task when it's its turn. One key per
//            dialog, so sending again after a failure never makes a second change.
//
// What the person wrote is shown as written.

import { h, openModal } from '../dom';
import { REQUEST_MAX } from '../../../shared/change-requests';
import type { DevChange, ElementRef } from '../../../shared/dev-changes';
import { draftKey } from '../dev-changes/feed';
import type { ElementContext } from './explorer/element-ref';

export interface RequestAsk {
  text: string;
  page?: string;
  pageMoved?: boolean;
  revision?: string;
  /** What it points at in the model: the page, or the widget picked on its Model preview. */
  ref?: ElementRef;
  /** The revision viewed when it was asked (the explorer's: main's newest unless another was picked). */
  source?: string;
  /** The dialog's (or the docked composer's) idempotency key. */
  key?: string;
  /** Which entry point asked: the docked chat, or this dialog (its fallback). */
  via?: 'chat' | 'dialog';
}

export type RequestSent = { ok: true; change: DevChange; again: boolean } | { ok: false; error: string };

/** POST /api/change-requests: the change as kept (queued, or handed to the lead), or why not. A dropped connection is tried once more with the same key. */
export async function postRequest(floor: string, ask: RequestAsk, by?: string): Promise<RequestSent> {
  const body = JSON.stringify({ floor, ...ask, ...(by ? { by } : {}) });
  for (let i = 0; ; i++) {
    try {
      const res = await fetch('/api/change-requests', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body });
      const out = (await res.json().catch(() => ({}))) as { error?: string; change?: DevChange; again?: boolean };
      return res.ok && out.change ? { ok: true, change: out.change, again: !!out.again } : { ok: false, error: out.error ?? 'The office couldn’t take the request just now. Try again.' };
    } catch {
      if (i || !ask.key) return { ok: false, error: 'The office couldn’t be reached. Try again: it won’t be asked twice.' };
    }
  }
}

/** The toast after a request: handed to the lead, or queued. */
export const sentWords = (c: DevChange | undefined) => (!c ? 'Request sent: its state shows in the coordinator chat and on Approvals' : c.queue === 'active' ? `Request ${c.id} handed to ${c.activated?.member ?? 'the team lead'} on branch dev/${c.id}: its state shows in the coordinator chat` : c.queue === 'clarify' ? `Request ${c.id} needs clarification: see the coordinator chat` : `Request ${c.id} is queued: the coordinator chat says what it waits for`);

const short = (sha?: string) => (sha ?? '').slice(0, 7);

export interface RequestContext {
  project?: string;
  /** What it's about when picked in the explorer ("Page: Visitor list"): shown, and added to the words sent. */
  about?: string;
  page?: string;
  pageMoved?: boolean;
  revision?: string;
  /** From the Developer view's explorer: the page or widget it points at in the model, with its chip. */
  element?: ElementContext;
  /** The revision viewed (a full commit id), and how to say it ("main @abc1234"). */
  source?: string;
  sourceWords?: string;
}

/**
 * Request a change: the words, with the project, page and version captured and shown (not editable: they're
 * what was on screen). ✕ and Esc close it and give the focus back to the button that opened it.
 */
export function openRequestDialog(c: RequestContext, send: (ask: RequestAsk) => Promise<RequestSent>, done: (r: DevChange) => void): void {
  const key = draftKey();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const box = h('textarea.aw-reqtext', { rows: 5, maxlength: String(REQUEST_MAX), placeholder: 'For example: let reception see who signed a visitor in, next to the arrival time.', 'aria-label': 'What should change' }) as HTMLTextAreaElement;
  const err = h('p.aw-warn', { role: 'alert', hidden: true });
  const submit = h('button.btn.primary.aw-reqsend', { type: 'submit' }, 'Send request') as HTMLButtonElement;
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const el = c.element;
  type Row = [string, string | HTMLElement];
  const about: Row[] = [
    ['Project', c.project ?? 'This project'],
    ...(el ? ([['About', h('span.aw-chip', {}, el.chip)], ['In the model', el.where]] as Row[]) : c.about ? ([['About', c.about]] as Row[]) : []),
    ...(el?.gone ? ([['Note', 'The widget you picked isn’t on this page at this revision, so this asks about the page.']] as Row[]) : []),
    ...(el?.impact ? ([['Shared', el.impact]] as Row[]) : []),
    ...(c.source ? ([['Viewing', c.sourceWords ?? `revision ${short(c.source)}`]] as Row[]) : []),
    ...(el && !c.page ? [] : ([['Page', c.page ? `${c.page}${c.pageMoved ? ' (the app moved on from there by itself; this is where it was last opened)' : ''}` : 'No page: the app isn’t showing here']] as Row[])),
    ['Version', c.revision ? `running ${short(c.revision)}` : el ? 'Not running: not needed, the request points at the model' : 'No version running'],
  ];
  const form = h(
    'form.modal.aw-reqdlg',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Request a change' },
    h('header', {}, h('h2', {}, 'Request a change')),
    h(
      'div.body',
      {},
      h('p', {}, 'Describe what should behave differently, in your own words. It becomes a request the team lead works on; you’ll see its state in the chat.'),
      box,
      h('dl.aw-about', {}, ...about.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('p.aw-small', {}, el ? 'The page, the widget and the revision are taken from what’s on screen, so the team sees what you saw; the widget is checked again by name when the change starts. It doesn’t need the app running. One change is worked on at a time: if the team is busy, paused or asleep, it waits in the queue and says why.' : 'The page and version are taken from what’s on screen, so the team sees what you saw. One change is worked on at a time: if the team is busy, paused or asleep, it waits in the queue and says why.'),
      err,
    ),
    h('footer', {}, h('span.grow'), cancel, submit),
  ) as HTMLFormElement;
  form.noValidate = true;
  const modal = openModal(form, { onClose: () => opener?.focus() });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text) {
      err.hidden = false;
      err.textContent = 'Say what should change first.';
      box.focus();
      return;
    }
    submit.disabled = true;
    const aboutWords = el ? `${el.chip} (${el.where})` : c.about;
    void send({ text: aboutWords ? `${text}\n\nAbout: ${aboutWords}` : text, ...(c.page ? { page: c.page } : {}), ...(c.pageMoved ? { pageMoved: true } : {}), ...(c.revision ? { revision: c.revision } : {}), ...(el ? { ref: el.ref } : {}), ...(c.source ? { source: c.source } : {}), key, via: 'dialog' }).then((r) => {
      submit.disabled = false;
      if (!r.ok) {
        err.hidden = false;
        err.textContent = r.error;
        return;
      }
      modal.close();
      done(r.change);
    });
  });
  box.focus();
}
