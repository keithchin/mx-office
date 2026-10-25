// The Project Manager's merge for a local-only project (server/local-merge/), under the "main is behind the
// work" banner on the Live app and Model tabs: each team branch ahead of main with its head, its review at that
// head, and [Approve at @abc1234] [Ask for changes] then [Merge into main]. Merge is offered only once the head
// has an approving review (the server checks again, and refuses a head that moved). Admins see the buttons;
// everyone sees the state. Asked when the banner refreshes, never on a timer. Hidden for projects on GitHub.

import { mergeStateWords, type LocalMergeBranch, type LocalMergeView } from '../../../shared/local-merge';
import { store } from '../../state';
import { h, toast } from '../dom';
import './panel.css';

export interface LocalMergePanel {
  readonly el: HTMLElement;
  refresh(): void;
}

async function post(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === 'string' ? out.error : `${res.status}`);
  return out;
}

export function localMergePanel(): LocalMergePanel {
  const el = h('section.lm', { 'aria-label': 'Merges into main (local only)', hidden: true });
  let view: LocalMergeView | null = null;
  let pending = 0;

  function draw() {
    const v = view;
    const show = !!v && v.floor === store.floor && v.localOnly && v.branches.length > 0;
    el.hidden = !show;
    if (!show || !v) return el.replaceChildren();
    const admin = store.me.admin;
    el.replaceChildren(
      h('p.lm-head', {}, h('b', {}, 'You decide merges'), ` · ${v.levelName}${v.pmDecides ? '' : ' (the team may merge too)'} · local only: reviewed here, merged into ${v.main} with a merge commit, no GitHub`),
      ...v.branches.map((b) => row(v, b, admin)),
    );
  }

  function row(v: LocalMergeView, b: LocalMergeBranch, admin: boolean): HTMLElement {
    const who = b.owner ? `${b.owner}'s branch` : b.branch;
    const state = h('span.lm-state', { 'data-state': b.review ? b.review.verdict : 'none' }, mergeStateWords(b));
    const btns: HTMLElement[] = [];
    if (admin) {
      const approve = h('button.btn', { type: 'button', 'data-act': 'approve', title: `Your review of ${b.branch} exactly at ${b.sha.slice(0, 7)}: a newer commit needs a new review` }, `Approve at @${b.sha.slice(0, 7)}`) as HTMLButtonElement;
      const changes = h('button.btn', { type: 'button', 'data-act': 'changes' }, 'Ask for changes') as HTMLButtonElement;
      const ready = b.review?.verdict === 'approve';
      const merge = h('button.btn.primary', { type: 'button', 'data-act': 'merge', disabled: !ready, title: ready ? `Merge ${b.branch} into ${v.main} with a merge commit (--no-ff), as the office, and record it` : 'Approve its head first' }, `Merge into ${v.main}`) as HTMLButtonElement;
      approve.addEventListener('click', () => void act(approve, '/api/local-merge/review', { floor: v.floor, branch: b.branch, sha: b.sha, verdict: 'approve' }, `Approved ${b.branch} at ${b.sha.slice(0, 7)}`));
      changes.addEventListener('click', () => void act(changes, '/api/local-merge/review', { floor: v.floor, branch: b.branch, sha: b.sha, verdict: 'changes' }, `Asked for changes on ${b.branch}`));
      merge.addEventListener('click', () => void act(merge, '/api/local-merge/merge', { floor: v.floor, branch: b.branch, sha: b.sha }, `Merged ${b.branch} into ${v.main}`));
      if (!b.review || b.review.verdict !== 'approve') btns.push(approve);
      if (!b.review) btns.push(changes);
      btns.push(merge);
    }
    return h('div.lm-row', { 'data-branch': b.branch }, h('b', {}, who), h('small', {}, ` ${b.ahead} ahead · @${b.sha.slice(0, 7)} · ${b.subject}`), state, h('span.lm-btns', {}, ...btns));
  }

  async function act(btn: HTMLButtonElement, url: string, body: Record<string, unknown>, done: string) {
    btn.disabled = true;
    try {
      await post(url, body);
      toast(done);
    } catch (err) {
      toast((err as Error).message, 'warn');
    }
    refresh();
  }

  function refresh() {
    const floor = store.floor;
    if (!floor) return;
    const mine = ++pending;
    fetch(`/api/local-merge?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<LocalMergeView>) : null))
      .then((v) => {
        if (mine !== pending) return;
        view = v;
        draw();
      })
      .catch(() => undefined);
  }

  return { el, refresh };
}
