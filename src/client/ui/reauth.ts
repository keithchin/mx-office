// Risky actions on a desktop page opened through 📱 Phone access's tunnel need the password typed again
// within the last 10 minutes (server/phone-access/reauth.ts). The office refuses them with 401
// { reauth: true } (or a 'reauth' message over the socket); this asks for the password in a window of
// its own (✕ and Esc cancel), confirms it (POST /api/m/reauth) and sends the request again. Every
// fetch on the page goes through it, so each window's own calls need nothing of their own. Pages on the
// office's own address are never asked.

import './reauth.css';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { h, openModal } from './dom';
import { mergeWaiters } from './github/api';

let plainFetch: typeof fetch = (...a) => fetch(...a);
let asking: Promise<boolean> | undefined;

/** Whether a 401 answer says the password is needed again. */
export async function wantsReauth(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = (await res.clone().json().catch(() => null)) as { reauth?: unknown } | null;
  return body?.reauth === true;
}

/** Asks for the password (one window at a time): true once the office accepted it. */
export function askPassword(): Promise<boolean> {
  return (asking ??= passwordWindow().finally(() => (asking = undefined)));
}

function passwordWindow(): Promise<boolean> {
  return new Promise((resolve) => {
    const pw = h('input.reauth-pw', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' }) as HTMLInputElement;
    const err = h('p.reauth-err', { role: 'alert' });
    const go = h('button.btn.primary', { type: 'submit' }, '🔒 Confirm');
    let ok = false;
    const form = h(
      'form.modal.reauth-modal',
      { role: 'dialog', 'aria-label': 'Type your password again' },
      h('header', {}, h('h2', {}, '🔒 Type your password again')),
      h('div.body', {}, h('p', {}, 'You came in through Phone access. Risky actions from here (merging, hiring, raising caps and budgets, pausing and resuming, Connections) need your password from the last 10 minutes.'), pw, err),
      h('footer', {}, h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), go),
    );
    const modal = openModal(form, { doing: '🔒 confirming', onClose: () => resolve(ok) });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pw.value) return pw.focus();
      go.disabled = true;
      try {
        const r = await plainFetch('/api/m/reauth', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
        if (r.ok) {
          ok = true;
          return modal.close();
        }
        err.textContent = ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `The office said ${r.status}`;
        pw.select();
      } catch (x) {
        err.textContent = (x as Error).message;
      } finally {
        go.disabled = false;
      }
    });
    setTimeout(() => pw.focus(), 30);
  });
}

/** A request on this office (not elsewhere): only those are sent again. */
const ours = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : String(input), location.href).origin === location.origin;

/** Every fetch on the page: a refusal that wants the password asks for it, then sends the request once more. */
function installFetch() {
  if ((window.fetch as { reauth?: true }).reauth) return;
  const plain = window.fetch.bind(window);
  plainFetch = plain;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const again = input instanceof Request ? input.clone() : input;
    const res = await plain(input, init);
    if (!ours(input) || !(await wantsReauth(res))) return res;
    return (await askPassword()) ? plain(again, init) : res;
  };
  window.fetch = Object.assign(wrapped, { reauth: true as const });
}

/** What a socket that sends and hears messages needs. */
export interface ReauthNet {
  onMessage(fn: (msg: ServerMsg) => void): void;
  send(msg: ClientMsg): void;
}

/** A refused socket message: the password, then the same message again; cancelled, whoever waits on it hears so. */
export async function onReauthMsg(net: Pick<ReauthNet, 'send'>, retry: ClientMsg, ask: () => Promise<boolean> = askPassword) {
  if (await ask()) return net.send(retry);
  if (retry.t === 'gh.merge') mergeWaiters.get(retry.number)?.({ t: 'gh.merged', number: retry.number, error: 'Not merged: the password wasn’t typed again' });
}

/** Installs both on a desktop page: its fetches, and its socket when it has one. */
export function installReauth(net?: ReauthNet) {
  installFetch();
  net?.onMessage((msg) => {
    if (msg.t === 'reauth') void onReauthMsg(net, msg.retry);
  });
}
