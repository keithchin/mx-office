// The Project Manager's merge for a local-only project (server/local-merge/), under the "main is behind the
// work" banner on the Live app and Model tabs. Each team branch ahead of main shows what it is (its DC and the
// request's title, its owner, notes only or what it changes), its head and its review: [Approve at @abc1234]
// pins that commit, then [Merge @abc1234 into main] opens the confirm step (./confirm.ts) and merges exactly the
// reviewed commit, even if the branch moved on (newer commits stay for a later review). Notes-only branches
// (journal, docs) are hidden behind "Show notes branches", and merge as notes in one confirm. After Approve the
// row is redrawn from the server's answer at once. Admins see the buttons; everyone sees the state. Asked when
// the banner refreshes or a merge is done, never on a timer. Hidden for projects on GitHub.

import { dcWords, filesWords, mergeStateWords, type LocalMergeBranch, type LocalMergeView } from '../../../shared/local-merge';
import { store } from '../../state';
import { h, toast } from '../dom';
import { lmPost, openMergeConfirm } from './confirm';
import './panel.css';

export interface LocalMergePanel {
  readonly el: HTMLElement;
  refresh(): void;
}

const short = (sha: string) => sha.slice(0, 7);

export function localMergePanel(): LocalMergePanel {
  const el = h('section.lm', { 'aria-label': 'Merges into main (local only)', hidden: true });
  let view: LocalMergeView | null = null;
  let pending = 0;
  let showNotes = false;

  function draw() {
    const v = view;
    const show = !!v && v.floor === store.floor && v.localOnly && v.branches.length > 0;
    el.hidden = !show;
    if (!show || !v) return el.replaceChildren();
    const admin = store.me.admin;
    const notes = v.branches.filter((b) => b.kind === 'notes');
    const rows = v.branches.filter((b) => showNotes || b.kind !== 'notes');
    const toggle = notes.length
      ? h('label.lm-toggle', {}, h('input', { type: 'checkbox', 'data-act': 'show-notes', checked: showNotes, onchange: (e: Event) => ((showNotes = (e.target as HTMLInputElement).checked), draw()) }), ` Show notes branches (${notes.length}: journal or docs only)`)
      : '';
    el.replaceChildren(
      h('p.lm-head', {}, h('b', {}, 'You decide merges'), ` · ${v.levelName}${v.pmDecides ? '' : ' (the team may merge too)'} · local only: each merge takes exactly the commit you approved, into ${v.main}${v.mainSha ? ` (now @${short(v.mainSha)})` : ''}, no GitHub`),
      ...rows.map((b) => row(v, b, admin)),
      toggle,
    );
  }

  function row(v: LocalMergeView, b: LocalMergeBranch, admin: boolean): HTMLElement {
    const who = b.owner ? `${b.owner}'s branch` : b.branch;
    const dc = dcWords(b);
    const r = b.review;
    const approved = r?.verdict === 'approve';
    const state = h('span.lm-state', { 'data-state': r ? r.verdict : 'none' }, mergeStateWords(b));
    const btns: HTMLElement[] = [];
    if (admin) {
      const reviewedHead = approved && r!.sha === b.sha;
      if (b.kind === 'notes') {
        const notesBtn = h('button.btn', { type: 'button', 'data-act': 'merge-notes', title: `Approve and merge ${b.branch} at @${short(b.sha)} as notes (no model or code changes)` }, `Merge notes @${short(b.sha)}`) as HTMLButtonElement;
        notesBtn.addEventListener('click', () => void openMergeConfirm({ floor: v.floor, branch: b.branch, sha: approved ? r!.sha : b.sha, opener: notesBtn, reviewFirst: true, onReviewed: put, onDone: () => refresh() }));
        btns.push(notesBtn);
      } else {
        if (!reviewedHead) {
          const approve = h('button.btn', { type: 'button', 'data-act': 'approve', title: `Your review of exactly @${short(b.sha)}: Merge then takes that commit, never a newer one` }, `Approve at @${short(b.sha)}`) as HTMLButtonElement;
          approve.addEventListener('click', () => void review(approve, v, b, 'approve'));
          btns.push(approve);
        }
        if (!r) {
          const changes = h('button.btn', { type: 'button', 'data-act': 'changes' }, 'Ask for changes') as HTMLButtonElement;
          changes.addEventListener('click', () => void review(changes, v, b, 'changes'));
          btns.push(changes);
        }
        const at = approved ? r!.sha : b.sha;
        const merge = h('button.btn.primary', { type: 'button', 'data-act': 'merge', 'data-sha': at, disabled: !approved, title: approved ? `Merge exactly @${short(at)} into ${v.main}, after a confirm step` : 'Approve a commit first' }, `Merge @${short(at)} into ${v.main}`) as HTMLButtonElement;
        merge.addEventListener('click', () => void openMergeConfirm({ floor: v.floor, branch: b.branch, sha: at, opener: merge, onDone: () => refresh() }));
        btns.push(merge);
      }
    }
    const kind = b.kind === 'notes' ? h('span.lm-kind', { 'data-kind': 'notes' }, 'notes only') : h('span.lm-kind', { 'data-kind': 'change' }, filesWords(b.files, b.kind));
    return h(
      'div.lm-row',
      { 'data-branch': b.branch, 'data-kind': b.kind, 'data-dc': (b.dcs ?? []).map((d) => d.id).join(' ') },
      h('div.lm-what', {}, dc ? h('b.lm-dc', {}, dc) : h('b', {}, who), h('small', {}, ` ${dc ? `${who} · ` : ''}${b.branch}${b.task ? ` · task ${b.task}` : ''}`)),
      h('small.lm-meta', {}, `${b.ahead} ahead · head @${short(b.sha)} · ${b.subject} · `, kind),
      state,
      h('span.lm-btns', {}, ...btns),
    );
  }

  /** Puts a row the server answered with into the view and redraws it at once (a look in flight is dropped). */
  function put(row: LocalMergeBranch | undefined) {
    if (!row || !view) return;
    pending++;
    view = { ...view, branches: view.branches.map((x) => (x.branch === row.branch ? row : x)) };
    draw();
  }

  async function review(btn: HTMLButtonElement, v: LocalMergeView, b: LocalMergeBranch, verdict: 'approve' | 'changes') {
    btn.disabled = true;
    try {
      const r = await lmPost<{ branch?: LocalMergeBranch }>('/api/local-merge/review', { floor: v.floor, branch: b.branch, sha: b.sha, verdict });
      toast(verdict === 'approve' ? `Approved ${b.branch} at @${short(b.sha)}: Merge takes exactly that commit` : `Asked for changes on ${b.branch} at @${short(b.sha)}`);
      if (r.branch) return put(r.branch);
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

  // A merge made elsewhere (a Developer change receipt) moves main: look again.
  window.addEventListener('mx:local-merged', () => refresh());
  return { el, refresh };
}
