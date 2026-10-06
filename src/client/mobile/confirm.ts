// Risky actions on the phone (shared/mobile.ts isRisky: merge, hire, raise the cap, approve a merge-order
// escalation): a sheet that says exactly what will happen, a second tap to do it, and the password typed
// again unless you signed in or typed it within the last 10 minutes. The office checks the same on its
// side (server/mobile/actions.ts), so the sheet is the way through, never the only guard. ✕ or Esc cancels.

import type { MobileAction } from '../../shared/mobile';
import { h, openModal, toast } from '../ui/dom';
import { ApiError, mobileApi } from './api';

/** Until when the office lets risky actions through without the password (from /api/m/me and each re-auth). */
let freshUntil = 0;
export const setFreshUntil = (t: number) => void (freshUntil = t);
const fresh = () => freshUntil > Date.now() + 5_000;

export interface Confirm {
  title: string;
  /** What will happen, in a sentence or two. */
  detail: string;
  /** The button's words ("Merge PR #12", "Hire the Lead Tester"). */
  label: string;
  /** Ask for the password even if the last sign-in is recent (the office refused it). */
  forcePassword?: boolean;
}

/** The sheet: resolves true once confirmed (and the password, when asked, accepted). */
export function confirmRisky(c: Confirm): Promise<boolean> {
  return new Promise((resolve) => {
    const ask = c.forcePassword || !fresh();
    const pw = ask ? (h('input.m-pw', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' }) as HTMLInputElement) : undefined;
    const err = h('p.m-err', { role: 'alert' });
    const go = h('button.btn.primary.m-danger', { type: 'submit' }, ask ? `🔒 ${c.label}` : c.label);
    const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      modal.close();
      resolve(v);
    };
    const form = h(
      'form.modal.m-sheet.m-confirm',
      { role: 'dialog', 'aria-label': c.title },
      h('header', {}, h('h2', {}, `⚠️ ${c.title}`), close),
      h(
        'div.body',
        {},
        h('p', {}, c.detail),
        pw ? h('label.m-pw-row', {}, h('span', {}, 'Type your password again: risky actions from the phone need a sign-in from the last 10 minutes.'), pw) : h('p.m-dim', {}, 'Tap again to do it.'),
        err,
      ),
      h('footer', {}, h('button.btn', { type: 'button', onclick: () => finish(false) }, 'Cancel'), go),
    );
    const modal = openModal(form, { onClose: () => !done && ((done = true), resolve(false)), doing: '📱 confirming' });
    close.addEventListener('click', () => finish(false));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pw) return finish(true);
      if (!pw.value) return pw.focus();
      go.disabled = true;
      try {
        const r = await mobileApi.reauth(pw.value);
        freshUntil = r.reauthUntil;
        finish(true);
      } catch (x) {
        err.textContent = (x as Error).message;
        pw.select();
      } finally {
        go.disabled = false;
      }
    });
    setTimeout(() => (pw ?? go).focus(), 30);
  });
}

/**
 * Does `a` (after the sheet, when `risky` says what it is), and tells you how it went. When the office
 * says the sign-in is too old after all, it asks once more with the password.
 */
export async function act(a: MobileAction, risky?: Confirm): Promise<{ summary: string; url?: string } | undefined> {
  if (risky && !(await confirmRisky(risky))) return undefined;
  try {
    const r = await mobileApi.act(a);
    toast(`✅ ${r.summary}`);
    return r;
  } catch (x) {
    if (x instanceof ApiError && x.reauth) {
      freshUntil = 0;
      if (!(await confirmRisky({ ...(risky ?? { title: 'Confirm', detail: 'The office wants your password again for this.', label: 'Confirm' }), forcePassword: true }))) return undefined;
      return act(a);
    }
    toast(`Couldn't do it: ${(x as Error).message}`, 'warn');
    return undefined;
  }
}
