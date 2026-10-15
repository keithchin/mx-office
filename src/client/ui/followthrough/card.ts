// Answered decisions still being followed through, on the Overview's Needs you card (server/followthrough/):
// each answered escalation or question until its record is as given and merged into main, or you dismiss
// it. Status-level, never counted in "waiting on you"; a record that differs, or cites an older revision,
// is a warning with both texts (You decided · Recorded, and where) and Accept as recorded / Send correction.
// Nothing here blocks other work. Only an admin can act (the server checks too). No modal.

import type { FollowAction, FollowItem } from '../../../shared/followthrough';
import { followLevel, followLine, locationWords, whereWords } from '../../../shared/followthrough';
import type { NeedTarget } from '../../../shared/needsyou';
import { store } from '../../state';
import { h } from '../dom';
import { followAct, followView, onFollowChanged } from './feed';
import './follow.css';

/** The buttons of an item that differs (and Dismiss for any), shared with the Questions page. */
export function followActs(floor: string, it: FollowItem, admin: boolean): HTMLElement {
  if (!admin) return h('p.pt-esc-meta', {}, 'Only the Project Manager (an admin) can accept or correct it.');
  const warn = followLevel(it.recording) === 'warn';
  const btn = (text: string, action: FollowAction, cls: string, title: string) =>
    h(`button.btn.small${cls}`, {
      type: 'button',
      title,
      onclick: (ev: Event) => {
        const b = ev.currentTarget as HTMLButtonElement;
        const all = [...(b.parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        all.forEach((x) => (x.disabled = true));
        void followAct(floor, it.decision, action, it.rev).finally(() => all.forEach((x) => (x.disabled = false)));
      },
    }, text);
  return h(
    'div.pt-esc-acts.pt-ft-acts',
    {},
    warn ? btn('Accept as recorded', 'accept-as-recorded', '.primary', 'Makes the recorded words your decision (a new revision); nothing is sent') : null,
    warn ? btn('Send correction', 'send-correction', '', 'Tells the agent what you decided and the citation to use now (a new revision, sent)') : null,
    h('span.pt-grow'),
    h('button.pt-link.pt-ft-dismiss', { type: 'button', title: 'Stops following this revision through (it is not marked recorded)', onclick: (ev: Event) => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      void followAct(floor, it.decision, 'dismiss', it.rev).finally(() => (b.disabled = false));
    } }, 'Dismiss'),
  );
}

/** "You decided: … · Recorded: …", and where. */
export function bothTexts(it: FollowItem): HTMLElement | null {
  const r = it.recording;
  if (r.outcome !== 'recorded-differently' && r.outcome !== 'recorded-older-rev') return null;
  const where = [whereWords(r.location), locationWords(r.location)].filter(Boolean).join(' · ');
  return h('div.pt-ft-both', {}, h('p', {}, h('b', {}, 'You decided: '), it.decided), h('p', {}, h('b', {}, r.outcome === 'recorded-older-rev' ? `Recorded (for rev ${r.rev}): ` : 'Recorded: '), r.text ?? '—'), where ? h('p.pt-ft-where', {}, where) : null);
}

function item(floor: string, it: FollowItem, admin: boolean, go: (t: NeedTarget) => void): HTMLElement {
  const warn = followLevel(it.recording) === 'warn';
  const open = () => go(it.kind === 'esc' ? { to: 'escalation', id: it.ref } : { to: 'questions', key: it.ref });
  return h(
    'article.pt-nitem.pt-esc.pt-ft',
    { 'data-decision': it.decision, 'data-level': warn ? 'warn' : 'status', 'aria-label': `${it.label}: ${followLine(it)}` },
    h('div.pt-esc-h', {}, h('span.pt-tag', { class: warn ? 't-verify' : 't-later' }, h('span.pt-tag-i', { 'aria-hidden': 'true' }, warn ? '⚠' : '↻'), warn ? 'Recorded differently' : 'Following through'), h('b.pt-esc-t', {}, h('button.pt-link', { type: 'button', onclick: open }, it.label), ` ${it.title}`)),
    h('p.pt-ft-line', {}, followLine(it)),
    bothTexts(it),
    followActs(floor, it, admin),
  );
}

/** The section for the Needs you card; `update` redraws it for the floor shown, only when what it shows changed. */
export function followNotices(): { el: HTMLElement; update(floor: string | undefined, admin: boolean, go: (t: NeedTarget) => void): void } {
  const list = h('div.pt-ft-items');
  const el = h('div.pt-ft-list', { role: 'region', 'aria-label': 'Answered decisions being followed through' }, h('h3.pt-ft-h', {}, 'Following through'), list);
  let last: { floor?: string; admin: boolean; go: (t: NeedTarget) => void } = { admin: false, go: () => {} };
  let sig = '';
  const draw = () => {
    const v = followView(last.floor);
    const items = v?.items ?? [];
    const admin = last.admin || !!v?.admin;
    const next = JSON.stringify([last.floor, admin, items]);
    if (next === sig) return;
    sig = next;
    list.replaceChildren(...items.map((it) => item(last.floor!, it, admin, last.go)));
    el.hidden = !items.length;
  };
  onFollowChanged(draw);
  el.hidden = true;
  return {
    el,
    update(floor, admin, go) {
      last = { floor, admin: admin || store.me.admin, go };
      draw();
    },
  };
}
