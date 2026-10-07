// The Team tab on the 1D view: the floor's project team (docs/teams.md) as an org chart, the
// standup, the approvals queue (with a count badge on the tab) and the team settings. It fetches
// GET /api/roster and draws again when the office says the team changed ('roster.changed'). No
// three.js here: the flat views import it.

import type { ServerMsg } from '../../../shared/protocol';
import type { RosterView } from '../../../shared/roster/types';
import { AUTONOMY } from '../../../shared/roster/autonomy';
import { h } from '../dom';
import { fetchRoster } from './api';
import { approvalsView } from './approvals';
import { orgChart } from './org';
import { settingsView } from './settings';
import { standupView } from './standup';
import { shapeChip } from './coverage';
import './roster.css';

export { openStandupWindow } from './standup';

export type Pane = 'org' | 'standup' | 'approvals' | 'settings';
const PANE_KEY = 'agent-office.team-pane';

let pane: Pane = 'org';
try {
  const saved = localStorage.getItem(PANE_KEY);
  if (saved === 'standup' || saved === 'approvals' || saved === 'settings') pane = saved;
} catch {
  // the org chart, then
}

export interface TeamTab {
  /** Draws the tab for `floor` into its root (fetching the team), when it's showing. */
  render(floor: string | undefined): void;
  /** Hands it every server message: it redraws on 'roster.changed' for its floor. */
  onMessage(msg: ServerMsg): void;
  /** Opens on `p` from now on (a team page's "Open the approvals"). */
  showPane(p: Pane): void;
}

export interface TeamTabOptions {
  /** Flat: the page's own tabs pick the pane, so the tab draws no sub-tabs of its own, and this switches the page to `p`. */
  select?: (p: Pane) => void;
}

/**
 * The tab. `root` is where it draws, `badge` the count on its tab button, `shown` whether the tab is
 * the one showing (the badge stays up to date either way), `openWorker` a worker's terminal.
 */
export function teamTab(root: HTMLElement, badge: HTMLElement, shown: () => boolean, openWorker: (id: string) => void, opts: TeamTabOptions = {}): TeamTab {
  let floor: string | undefined;
  let last: RosterView | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const draw = (v: RosterView) => {
    last = v;
    badge.textContent = v.approvals.length ? String(v.approvals.length) : '';
    if (!shown()) return;
    const a = AUTONOMY[v.settings.autonomy];
    const tab = (p: Pane, label: string, n?: number) =>
      h(`button.btn${pane === p ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(pane === p), 'data-pane': p, onclick: () => pick(p) }, label, n ? h('span.ro-badge', {}, String(n)) : null);
    const body = pane === 'standup' ? standupView(v, draw) : pane === 'approvals' ? approvalsView(v, draw) : pane === 'settings' ? settingsView(v, draw) : orgChart(v, { openWorker, redraw: draw });
    root.replaceChildren(
      h(
        'div.ro-head',
        {},
        // Flat, the page's own tabs pick the pane (the 1D view has Org chart, Standup, Approvals and Settings with its other tabs).
        opts.select ? null : h('div.ro-panes', { role: 'tablist', 'aria-label': 'Team' }, tab('org', '🏢 Org chart'), tab('standup', '📋 Standup'), tab('approvals', '✅ Approvals', v.approvals.length), tab('settings', '⚙️ Settings')),
        shapeChip(v),
        h('button.btn.small.ro-level-chip', { type: 'button', title: a.summary, onclick: () => (opts.select ? opts.select('settings') : pick('settings')) }, `Autonomy ${a.level} · ${v.byStage ? 'by stage' : a.name}`),
      ),
      v.paused ? h('p.ro-paused', {}, `💸 ${v.paused}`) : '',
      body,
    );
  };
  const pick = (p: Pane) => {
    pane = p;
    try {
      localStorage.setItem(PANE_KEY, p);
    } catch {
      // just for this visit
    }
    if (last) draw(last);
  };
  const load = () => {
    if (!floor) return;
    const f = floor;
    if (!root.firstChild && shown()) root.append(h('p.ro-dim', {}, 'Loading the team…'));
    fetchRoster(f).then(
      (v) => f === floor && draw(v),
      (err) => shown() && root.replaceChildren(h('p.ro-dim', {}, `Couldn't load the team: ${(err as Error).message}`)),
    );
  };
  return {
    showPane: (p) => pick(p),
    render(f) {
      if (f !== floor) last = undefined;
      floor = f;
      load();
    },
    onMessage(msg) {
      if (msg.t !== 'roster.changed' || msg.floor !== floor) return;
      // Not while the Project Manager is typing in the settings, or an answer to an escalation in the
      // approvals: a redraw would throw the edit away. The next change after that fetches it.
      const typing = root.contains(document.activeElement) && (pane === 'settings' || document.activeElement?.matches('textarea, input'));
      if (shown() && typing) return;
      // A burst of changes (a standup asking four Leads) fetches once.
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    },
  };
}
