// The "Needs you" strip at the top of the 1D view's 🎛️ Command Center: whatever is blocked on you right
// now (ui/needsyou/logic.ts), most urgent first, each with one button straight to the fix, and a count
// on the Command Center's tab button whichever tab is showing. One calm line when nothing is. It
// fetches the floor's team itself, again when the office says it changed. No three.js here.

import type { FirmFloorStatus } from '../../../shared/firm/engagement';
import type { LiveAppState, ServerMsg } from '../../../shared/protocol';
import type { RosterView } from '../../../shared/roster/types';
import type { StudioState } from '../../../shared/studio';
import type { SetupView } from '../../../shared/wizard';
import { store } from '../../state';
import { h, timeAgo } from '../dom';
import { fetchRoster } from '../roster/api';
import { collectNeeds, hereCount, type BudgetNeed, type NeedItem, type NeedTarget } from './logic';
import '../pm/jeff-rank.css';
import './needsyou.css';

/** Rows shown before "Show N more". */
const FOLD_AFTER = 5;

export interface NeedsYouDeps {
  /** Takes you to an item's fix. */
  go(target: NeedTarget): void;
  /** The setup panel's view of this floor, when it has one. */
  setup(): SetupView | undefined;
  live(): LiveAppState | null;
  /** The Firm's audit of this floor (ui/firm/banner.ts fetches it). */
  firm?(): FirmFloorStatus | undefined;
  /** Studio mode on this floor (ui/studio/). */
  studio?(): StudioState | undefined;
  /** The project's budget alerts and pause (ui/budget/). */
  budget?(): BudgetNeed | undefined;
}

export interface NeedsYou {
  /** Draws again from what the page knows now. */
  refresh(): void;
  /** Every server message: refetches the team on 'roster.changed' for this floor. */
  onMessage(msg: ServerMsg): void;
}

/** `root` is the strip, `badge` the count on the Command Center's tab button. */
export function needsYouStrip(root: HTMLElement, badge: HTMLElement, deps: NeedsYouDeps): NeedsYou {
  let floor: string | undefined;
  let roster: RosterView | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Every item, not just the first few. */
  let all = false;

  const load = () => {
    const f = floor;
    if (!f) return;
    fetchRoster(f).then(
      (r) => {
        if (f !== floor) return;
        roster = r;
        draw();
      },
      () => {
        // No team on this floor, or the office is unreachable: the rest still shows.
        if (f === floor) roster = undefined;
      },
    );
  };

  const row = (n: NeedItem) =>
    h(
      'li.ny-item',
      { class: `ny-${n.level} ny-${n.kind}` },
      h('span.ny-ico', { 'aria-hidden': 'true' }, n.icon),
      h('span.ny-text', {}, n.rank ? h('span.jrank-chip', { class: `jrank-${n.rank.n}`, title: n.rank.tip, 'aria-label': n.rank.tip }, n.rank.chip) : null, n.tag ? h('span.ny-tag', {}, n.tag) : null, n.text, n.since ? h('small.ny-since', {}, ` · ${timeAgo(n.since)}`) : null),
      h('button.btn.small.ny-go', { type: 'button', onclick: () => deps.go(n.target), 'aria-label': `${n.action}: ${n.text}` }, n.action, h('span', { 'aria-hidden': 'true' }, ' →')),
      n.alt ? h('button.btn.small.ny-go', { type: 'button', onclick: () => deps.go(n.alt!.target), 'aria-label': `${n.alt.action}: ${n.text}` }, n.alt.action) : null,
    );

  function draw() {
    const items = collectNeeds({ floor, workers: store.workers.values(), roster, pulls: store.pulls.items, floors: store.floors, setup: deps.setup(), live: deps.live(), firm: deps.firm?.(), studio: deps.studio?.(), budget: deps.budget?.() });
    const n = hereCount(items);
    badge.textContent = n ? String(n) : '';
    badge.title = n ? `${n} thing${n === 1 ? '' : 's'} on this floor need${n === 1 ? 's' : ''} you` : '';
    root.classList.toggle('ny-calm', !items.length);
    if (!items.length) return void root.replaceChildren(h('p.ny-empty', { role: 'status' }, '✅ Nothing needs you right now.'));
    // A long list folds after the first few, so the Command Center isn't pushed off the screen.
    const shown = all || items.length <= FOLD_AFTER + 1 ? items : items.slice(0, FOLD_AFTER);
    const more = items.length - shown.length;
    const fold = all && items.length > FOLD_AFTER + 1;
    root.replaceChildren(
      h(
        'section.ny',
        { 'aria-label': 'Needs you' },
        h('header.ny-h', {}, h('b', {}, '🚨 Needs you')),
        h('ul.ny-list', {}, ...shown.map(row)),
        more || fold ? h('button.ny-more', { type: 'button', onclick: () => ((all = !all), draw()) }, more ? `Show ${more} more ▾` : 'Show fewer ▴') : null,
      ),
    );
  }

  function refresh() {
    const f = store.floor ?? undefined;
    if (f !== floor) {
      floor = f;
      roster = undefined;
      load();
    }
    draw();
  }

  for (const k of ['workers', 'pulls', 'floors', 'floor', 'studio'] as const) store.on(k, refresh);
  // "3m ago" moves on by itself.
  setInterval(draw, 30_000);

  return {
    refresh,
    onMessage(msg) {
      if (msg.t !== 'roster.changed' || msg.floor !== floor) return;
      // A burst of changes (a standup asking four Leads) fetches once.
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    },
  };
}
