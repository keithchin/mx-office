// The "main is behind the work" banner (shared/branch-ahead.ts, server/branch-ahead/) on the Model tab and
// the Live app tab: "main is 75 commits behind Sophie's branch, which has model changes (PR #6, open, not
// reviewed) — [View it] [Ask Katherine to review]". On the Model tab, View it switches the tab to that
// branch; on the Live app tab it says the live app runs main and offers the Model tab instead (there is
// no branch live app). Ask … to review tells the lead through the team's durable tell (admins only).
// Asked when the tab shows or main moves, never on a timer; hidden when nothing relevant is ahead.

import type { AheadBranch, AheadView } from '../../../shared/branch-ahead';
import { aheadLine, reviewWords } from '../../../shared/branch-ahead';
import { store } from '../../state';
import { h, toast } from '../dom';
import './banner.css';
import { localMergePanel } from '../local-merge/panel';

export interface AheadBanner {
  readonly el: HTMLElement;
  /** Asks the office again (the tab showed, another project, main moved). */
  refresh(): void;
}

export interface AheadOptions {
  /** Model tab: show this branch. */
  view?(branch: string): void;
  /** Live app tab: open the Model tab (which can show the branch). */
  openModel?(): void;
  /** Whether the banner may show now (the Model tab hides it while a branch is on show). */
  shown?(): boolean;
}

export function aheadBanner(where: 'model' | 'live', o: AheadOptions): AheadBanner {
  const el = h('div.ba', { role: 'status', hidden: true });
  // A local-only project's merges, decided by the PM (ui/local-merge/): beside the banner, shown on its own.
  const merges = localMergePanel();
  const wrap = h('div.ba-wrap', {}, el, merges.el);
  let view: AheadView | null = null;
  let asking: AbortController | null = null;
  let pending = 0;

  function draw() {
    const v = view;
    const show = !!v && v.floor === store.floor && v.branches.length > 0 && (o.shown?.() ?? true);
    el.hidden = !show;
    if (!show || !v) return el.replaceChildren();
    const admin = store.me.admin;
    const rows = v.branches.map((b) => row(v, b, admin));
    const note = where === 'live' ? h('p.ba-note', {}, `The live app runs ${v.main}, so it shows none of this until it merges.`) : null;
    el.replaceChildren(...([h('p.ba-line', {}, h('span.ba-icon', { 'aria-hidden': 'true' }, '⚠️'), aheadLine(v)), note, h('div.ba-rows', {}, ...rows)] as (HTMLElement | null)[]).filter((x): x is HTMLElement => !!x));
  }

  function row(v: AheadView, b: AheadBranch, admin: boolean): HTMLElement {
    const label = b.owner ? `${b.owner}'s branch` : b.branch;
    const viewBtn =
      where === 'model'
        ? h('button.btn', { type: 'button', title: `Show ${b.branch} in the Model tab`, onclick: () => o.view?.(b.branch) }, b.branch.length > 28 ? 'View it' : `View ${label}`)
        : h('button.btn', { type: 'button', title: `The live app runs ${v.main}; the Model tab can show ${b.branch}`, onclick: () => o.openModel?.() }, 'View it in the Model tab');
    const askBtn =
      admin && b.review.state !== 'reviewed' && v.lead
        ? (h('button.btn', { type: 'button', title: `Tell ${v.lead}, after their turn, to have ${b.pr ? `PR #${b.pr.number}` : b.branch} reviewed per the review gate (a Review: comment with checks and files)` }, `Ask ${v.lead} to review`) as HTMLButtonElement)
        : null;
    askBtn?.addEventListener('click', () => void ask(b, askBtn));
    const pr = b.pr?.url ? h('a.ba-pr', { href: b.pr.url, target: '_blank', rel: 'noopener noreferrer' }, `PR #${b.pr.number} ↗`) : null;
    const review = h('span', { class: `ba-review ${b.review.state}`, title: b.review.state === 'unknown' ? 'The office reads review comments on merged PRs only, so it can’t say yet whether this open PR has a Review: comment' : '' }, reviewWords(b.review));
    return h('div.ba-row', {}, h('b', {}, label), h('small', {}, ` ${b.ahead} ahead · ${b.modelFiles} model file${b.modelFiles === 1 ? '' : 's'}`), pr, review, viewBtn, askBtn);
  }

  async function ask(b: AheadBranch, btn: HTMLButtonElement) {
    btn.disabled = true;
    try {
      const res = await fetch('/api/branch-ahead/review', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor: store.floor, branch: b.branch }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; lead?: string };
      if (!res.ok) throw new Error(body.error || `${res.status}`);
      toast(`Asked ${body.lead} to have ${b.pr ? `PR #${b.pr.number}` : b.branch} reviewed (after their turn)`);
      btn.textContent = `Asked ${body.lead}`;
    } catch (err) {
      btn.disabled = false;
      toast(`Couldn't ask for the review: ${(err as Error).message}`, 'warn');
    }
  }

  return {
    el: wrap,
    refresh() {
      const floor = store.floor;
      if (!floor) return;
      merges.refresh();
      asking?.abort();
      const mine = ++pending;
      const ctl = (asking = new AbortController());
      fetch(`/api/branch-ahead?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin', signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<AheadView>) : null))
        .then((v) => {
          if (mine !== pending) return;
          view = v;
          draw();
        })
        .catch(() => undefined);
      draw();
    },
  };
}
