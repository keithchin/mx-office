// The "Needs you" strip at the top of the 1D view's 🎛️ Command Center: whatever is blocked on you right
// now (ui/needsyou/logic.ts), most urgent first, each with one button straight to the fix, and a count
// on the Command Center's tab button whichever tab is showing. One calm line when nothing is. It
// fetches the floor's team itself, again when the office says it changed.

import type { FirmFloorStatus } from '../../../shared/firm/engagement';
import type { LiveAppState, ServerMsg } from '../../../shared/protocol';
import type { RosterView } from '../../../shared/roster/types';
import type { StudioState } from '../../../shared/studio';
import type { SetupView } from '../../../shared/wizard';
import { store } from '../../state';
import { h, timeAgo } from '../dom';
import { fetchRoster } from '../roster/api';
import { collectNeeds, hereCount, type BudgetNeed, type NeedItem, type NeedKind, type NeedTarget } from './logic';
import { incidentBriefs, incidentFeedMessage, onIncidentsChanged } from '../incidents/feed';
import { hasPhone, openPhone } from '../phone/api';
import { batched } from '../batch';
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
/** Each kind's words in the Needs-you row, for one and for several. */
const KIND_WORDS: Record<NeedKind, [string, string]> = {
  asking: ['asking', 'asking'],
  finished: ['finished, unseen', 'finished, unseen'],
  lost: ['worktree lost', 'worktrees lost'],
  escalation: ['escalation', 'escalations'],
  approval: ['to approve', 'to approve'],
  idle: ['idle with a task', 'idle with a task'],
  paused: ['spend cap', 'spend cap'],
  pr: ['failing PR', 'failing PRs'],
  setup: ['setup', 'setup'],
  live: ['live app', 'live app'],
  floor: ['floor waiting', 'floors waiting'],
  audit: ['audit', 'audit'],
  studio: ['Studio Pro', 'Studio Pro'],
  incident: ['incident', 'incidents'],
  budget: ['budget', 'budget'],
};

/** The compact row: a count per kind, most urgent kind first, and the button to the phone's Needs you. */
export function countsRow(items: readonly NeedItem[]): HTMLElement {
  const kinds = new Map<NeedKind, { n: number; icon: string; block: boolean }>();
  for (const n of items) {
    const k = kinds.get(n.kind) ?? { n: 0, icon: n.icon, block: false };
    k.n++;
    k.block ||= n.level === 'block';
    kinds.set(n.kind, k);
  }
  const open = () => openPhone({ needs: true });
  return h(
    'section.ny.ny-row',
    { 'aria-label': 'Needs you' },
    h('b.ny-row-h', {}, '🚨 Needs you'),
    h(
      'span.ny-counts',
      {},
      ...[...kinds].map(([kind, k]) => h('button.ny-count', { type: 'button', class: k.block ? 'ny-block' : 'ny-warn', onclick: open, title: items.filter((n) => n.kind === kind).map((n) => n.text).join('\n') }, h('span', { 'aria-hidden': 'true' }, k.icon), ` ${k.n} ${KIND_WORDS[kind][k.n === 1 ? 0 : 1]}`)),
    ),
    h('button.btn.small.ny-open', { type: 'button', onclick: open }, 'Open in the team phone', h('span', { 'aria-hidden': 'true' }, ' →')),
  );
}

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

  /** What the strip last drew from, so a worker update that changes nothing it shows draws nothing. */
  let drawnKey = '';
  function draw() {
    const items = collectNeeds({ floor, workers: store.workers.values(), roster, pulls: store.pulls.items, floors: store.floors, setup: deps.setup(), live: deps.live(), firm: deps.firm?.(), studio: deps.studio?.(), incidents: incidentBriefs(), budget: deps.budget?.() });
    const n = hereCount(items);
    // The time ago on each item is part of what it shows: the half-minute timer moves it on.
    const key = JSON.stringify([all, hasPhone(), items.map((i) => [i.key, i.text, i.level, i.action, i.tag ?? '', i.rank?.chip ?? '', i.since ? timeAgo(i.since) : '', i.alt?.action ?? ''])]);
    if (key === drawnKey) return;
    drawnKey = key;
    badge.textContent = n ? String(n) : '';
    badge.title = n ? `${n} thing${n === 1 ? '' : 's'} on this floor need${n === 1 ? 's' : ''} you` : '';
    root.classList.toggle('ny-calm', !items.length);
    if (!items.length) return void root.replaceChildren(h('p.ny-empty', { role: 'status' }, '✅ Nothing needs you right now.'));
    // With the team phone on the page, one row of counts that opens its Needs you section (the full list is there).
    if (hasPhone()) return void root.replaceChildren(countsRow(items));
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

  // Every worker update of every live worker: worked out at most four times a second (ui/batch.ts).
  const refreshSoon = batched(refresh);
  for (const k of ['workers', 'pulls', 'floors', 'floor', 'studio'] as const) store.on(k, refreshSoon);
  onIncidentsChanged(draw);
  // "3m ago" moves on by itself.
  setInterval(draw, 30_000);

  return {
    refresh,
    onMessage(msg) {
      incidentFeedMessage(msg);
      if (msg.t !== 'roster.changed' || msg.floor !== floor) return;
      // A burst of changes (a standup asking four Leads) fetches once.
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    },
  };
}
