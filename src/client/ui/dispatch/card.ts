// The Needs you card's notices for answers whose outcome the office couldn't establish (server/dispatch/):
// "Couldn't confirm your answer was typed to <agent>" with Open <agent>'s terminal / Send again / It went
// through / Abandon, and for a proposal's issue "The issue may or may not have been created" with Check
// GitHub / Create it / It exists: link #…. Send again is a new attempt; It went through is recorded as your
// confirmation, never as the office's. Only an admin can act (the server checks too). No modal: the issue
// number is typed in place.

import type { DispatchPersonAction, DispatchRecord } from '../../../shared/dispatch';
import { decisionLabel, unknownLine } from '../../../shared/dispatch';
import type { NeedTarget } from '../../../shared/needsyou';
import { store } from '../../state';
import { h, timeAgo, toast } from '../dom';
import { dispatchUnknown, onDispatchChanged, setDispatchView } from './feed';
import './dispatch.css';

async function act(floor: string, id: string, action: DispatchPersonAction, issue?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/dispatch/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, id, action, ...(issue ? { issue } : {}) }) });
    const out = (await res.json().catch(() => ({}))) as { error?: string; note?: string; floor?: string };
    if (!res.ok) {
      toast(out.error ?? 'The office could not do that just now', 'warn');
      return false;
    }
    if (out.note) toast(out.note);
    if (out.floor) setDispatchView(out as never);
    return true;
  } catch {
    toast('The office could not be reached', 'warn');
    return false;
  }
}

function notice(floor: string, r: DispatchRecord, admin: boolean, go: (t: NeedTarget) => void): HTMLElement {
  const who = r.workerName ?? 'the agent';
  const issue = r.channel === 'github-issue';
  const why = r.history[r.history.length - 1]?.note;
  const btn = (text: string, action: DispatchPersonAction, cls = '', title?: string, value?: () => string | undefined) =>
    h(`button.btn.small${cls}`, {
      type: 'button',
      ...(title ? { title } : {}),
      onclick: (ev: Event) => {
        const b = ev.currentTarget as HTMLButtonElement;
        const all = [...(b.parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        all.forEach((x) => (x.disabled = true));
        void act(floor, r.id, action, value?.()).finally(() => all.forEach((x) => (x.disabled = false)));
      },
    }, text);
  const num = h('input.pt-dsp-num', { type: 'text', inputmode: 'numeric', placeholder: '#123', 'aria-label': 'The issue number' }) as HTMLInputElement;
  const acts = !admin
    ? h('p.pt-esc-meta', {}, 'Only the Project Manager (an admin) can settle it.')
    : issue
      ? h('div.pt-esc-acts', {}, btn('Check GitHub', 'check', '.primary', 'Searches the issues once for its marker: only a match settles it'), btn('Create it', 'create-issue', '', 'Makes the issue now, as a new attempt'), h('span.pt-dsp-link', {}, num, btn('It exists: link', 'link-issue', '', 'Records the issue you found (your word, not the office’s)', () => num.value.trim() || undefined)))
      : h(
          'div.pt-esc-acts',
          {},
          r.workerId ? h('button.btn.small', { type: 'button', onclick: () => go({ to: 'worker', id: r.workerId! }) }, `Open ${who}'s terminal`) : null,
          btn('Send again', 'send-again', '.primary', 'Types it again as a new attempt (with a new marker)'),
          btn('It went through', 'went-through', '', 'Records your confirmation that it was typed (shown as yours, not the office’s)'),
          btn('Abandon', 'abandon', '', 'Stops tracking this attempt; the decision stays as it was'),
        );
  return h(
    'article.pt-nitem.pt-esc.pt-dsp',
    { 'data-dispatch': r.id, 'aria-label': unknownLine(r) },
    h('div.pt-esc-h', {}, h('span.pt-tag.t-block', {}, h('span.pt-tag-i', { 'aria-hidden': 'true' }, '⚠'), 'Unconfirmed'), h('b.pt-esc-t', {}, issue || r.typedAt !== undefined ? unknownLine(r) : `Couldn't confirm your answer was typed to ${who}`)),
    h('p.pt-esc-meta', {}, [`${decisionLabel(r.decision)} rev ${r.answerRev}`, timeAgo(r.updatedAt), why].filter(Boolean).join(' · ')),
    admin && r.payload ? h('details.pt-dsp-text', {}, h('summary', {}, issue ? 'What was asked' : 'What was sent'), h('pre', {}, r.payload.slice(0, 2000))) : null,
    h('p.pt-dc-small', {}, issue ? "The office never makes it again by itself: GitHub's search can lag, so an empty search proves nothing." : r.typedAt !== undefined ? `It was typed into ${who}'s terminal, but ${who}'s session never showed it arrive: it may still be sitting in the input box. The office never sends an answer again by itself.` : 'The office restarted while sending. It never sends an answer again by itself.'),
    acts,
  );
}

/** The notices' element for the Needs you card; `update` redraws it for the floor shown. */
export function dispatchNotices(): { el: HTMLElement; update(floor: string | undefined, admin: boolean, go: (t: NeedTarget) => void): void } {
  const el = h('div.pt-dsp-list', { role: 'region', 'aria-label': 'Answers to settle' });
  let last: { floor?: string; admin: boolean; go: (t: NeedTarget) => void } = { admin: false, go: () => {} };
  let sig = '';
  const draw = () => {
    const v = dispatchUnknown(last.floor);
    const list = v?.unsettled ?? [];
    const next = JSON.stringify([last.floor, last.admin, list.map((r) => [r.id, r.state, r.updatedAt])]);
    if (next === sig) return;
    sig = next;
    el.replaceChildren(...list.map((r) => notice(last.floor!, r, last.admin || !!v?.admin, last.go)));
    el.hidden = !list.length;
  };
  onDispatchChanged(draw);
  el.hidden = true;
  return {
    el,
    update(floor, admin, go) {
      last = { floor, admin: admin || store.me.admin, go };
      draw();
    },
  };
}
