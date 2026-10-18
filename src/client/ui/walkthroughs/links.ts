// The Live app tab's way to walkthroughs: a small "🎬 Walkthroughs →" link (with how many videos there are)
// that opens the 🎬 Walkthroughs page, and the readiness card's "▶ Walkthrough" beside a ready milestone
// that has a passing video of the running build, which opens that video on the Walkthroughs page. It asks
// the office only when the Live app tab is drawn: when the app's commit changed, else at most once a minute.

import type { WalkView } from '../../../shared/walkthroughs/types';
import { h } from '../dom';
import { loadView, openWalkthroughs } from './api';
import './links.css';

export interface WalkLinks {
  el: HTMLElement;
  /** The Live app tab was drawn for `floor` running `sha` (or another floor). */
  update(floor: string, sha: string | undefined, shown: boolean): void;
  /** "▶ Walkthrough" for a ready milestone, when a passing recording of it (or of one of its journeys) at `commit` exists. */
  linkFor(milestone: string, commit: string | undefined, journeys?: readonly string[]): HTMLElement | null;
  /** The list changed (the readiness card's links follow). */
  onChange?: () => void;
}

export function walkLinks(): WalkLinks {
  const count = h('small.wt-count', {});
  const el = h('p.wt-golink', {}, h('button.wt-link', { type: 'button', title: 'Videos of the app’s workflows, recorded by the office at each passing build', onclick: () => openWalkthroughs() }, '🎬 Walkthroughs →'), ' ', count);
  let view: WalkView | null = null;
  let key = '';
  let at = 0;
  let asking = false;
  async function load(floor: string) {
    if (asking) return;
    asking = true;
    try {
      const v = await loadView(floor);
      if (!v) return;
      const before = JSON.stringify(view?.recordings.map((r) => [r.id, r.status]));
      view = v;
      const n = v.recordings.filter((r) => r.status === 'passed').length;
      count.textContent = v.batches.length ? '(recording now)' : n ? `(${n} passing video${n === 1 ? '' : 's'})` : '';
      if (JSON.stringify(v.recordings.map((r) => [r.id, r.status])) !== before) links.onChange?.();
    } finally {
      asking = false;
    }
  }
  const links: WalkLinks = {
    el,
    update(floor, sha, shown) {
      if (!shown || !floor) return;
      const k = `${floor}|${sha ?? ''}`;
      if (view && view.floor !== floor) {
        view = null;
        count.textContent = '';
      }
      // Again when the commit moved, and at most once a minute otherwise (a batch may have finished).
      if (k === key && Date.now() - at < 60_000) return;
      key = k;
      at = Date.now();
      void load(floor);
    },
    linkFor(milestone, commit, journeys) {
      const r = view?.recordings.find((x) => x.kind === 'workflow' && x.status === 'passed' && x.app.commit === commit && (x.milestone?.id === milestone || !!journeys?.includes(x.journey.id)));
      if (!r) return null;
      return h('button.wt-link', { type: 'button', title: `Watch the walkthrough recorded @${r.app.commit.slice(0, 7)} on the Walkthroughs page`, onclick: () => openWalkthroughs(r.id) }, '▶ Walkthrough');
    },
  };
  return links;
}
