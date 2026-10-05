// The panels a team's page has for its own lane (ui/teams/page.ts), each made of data the office already
// has: Testing sees the open PRs' CI scorecards and what's failing (ui/prchecks.ts), Development its
// own open PRs (the Development team's, by the same rule as the board's tags) with their checks and the
// live app, Analysis its memos and the analyzer's ranking for the
// floor (GET /api/analysis), Design its artifacts and the design approvals, Management the newest
// standup and the approvals queue (the roster). Nothing here polls or asks a model.

import type { AnalysisReport } from '../../../shared/analysis';
import type { GhPull } from '../../../shared/protocol';
import { pullTeam } from '../../../shared/roster/card-team';
import type { TeamId } from '../../../shared/roster/roles';
import type { TeamPageData } from '../../../shared/roster/team-page';
import type { RosterView } from '../../../shared/roster/types';
import { store } from '../../state';
import { h, openModal, timeAgo } from '../dom';
import { markdownFile } from '../markdown';
import { prChecksPanel } from '../prchecks';
import { openStandupWindow } from '../roster';
import { subagentList } from '../roster/subagents';
import { LEADS } from '../../../shared/roster/roles';
import { teamWorld } from './world';

export interface PanelDeps {
  openPull(p: GhPull): void;
  /** Puts the 🌐 Live app chip into `el` (the 1D view's, ui/liveapp.ts). */
  liveChip(el: HTMLElement): void;
  /** The 👥 Team tab, on its approvals. */
  openApprovals(): void;
}

/** How many open PRs a panel shows (each scorecard is one GET, cached a minute). */
const PRS_SHOWN = 6;
const CHECK_TEXT: Record<GhPull['checks'], string> = { pass: '✅ checks pass', fail: '❌ checks fail', pending: '⏳ checks running', none: '· no checks' };

const panel = (title: string, ...body: (HTMLElement | string | null)[]) => h('section.tm-panel', {}, h('h3.tm-panel-h', {}, title), ...body);
const empty = (text: string) => h('p.tm-dim', {}, text);

function prRow(p: GhPull, deps: PanelDeps, scorecard: boolean): HTMLElement {
  return h(
    'li.tm-pr',
    {},
    h(
      'button.tm-link',
      { type: 'button', onclick: () => deps.openPull(p), title: `${p.headRefName} → ${p.baseRefName}` },
      h('b', {}, `#${p.number}`),
      ' ',
      p.title,
    ),
    h('span.tm-pr-meta', { class: `tm-checks-${p.checks}` }, [CHECK_TEXT[p.checks], p.isDraft ? 'draft' : '', p.reviewDecision ? p.reviewDecision.toLowerCase().replace(/_/g, ' ') : '', timeAgo(p.updatedAt)].filter(Boolean).join(' · ')),
    scorecard ? prChecksPanel(p.number) : null,
  );
}

const openPulls = () => store.pulls.items.filter((p) => p.state === 'OPEN');

/** A Markdown file of the project in a window (the bookshelf's reading, without the shelf). */
async function openDoc(path: string) {
  const body = h('div.body.tm-doc', {}, h('p.tm-dim', {}, 'Loading…'));
  openModal(h('div.modal.tm-doc-win', { role: 'dialog', 'aria-label': path }, h('header', {}, h('h2', {}, path)), body));
  try {
    const r = await fetch(`/api/docs/file?${new URLSearchParams({ floor: store.floor ?? '', path })}`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
    body.replaceChildren(markdownFile(((await r.json()) as { text: string }).text));
  } catch (err) {
    body.replaceChildren(empty(`Couldn't read it: ${(err as Error).message}`));
  }
}

/** A list of project files: Markdown opens in a window, anything else is just named. */
function fileList(paths: string[], none: string): HTMLElement {
  if (!paths.length) return empty(none);
  return h(
    'ul.tm-files',
    {},
    ...paths.slice(0, 12).map((p) => h('li', {}, /\.(md|markdown)$/i.test(p) ? h('button.tm-link', { type: 'button', onclick: () => void openDoc(p) }, `📄 ${p}`) : h('span', {}, `🖼️ ${p}`))),
  );
}

/** The analyzer's report per floor, kept a minute: the page is drawn again on every change of the board. */
const reports = new Map<string, { at: number; p: Promise<AnalysisReport> }>();

function report(floor: string): Promise<AnalysisReport> {
  const hit = reports.get(floor);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = fetch(`/api/analysis?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<AnalysisReport>;
  });
  reports.set(floor, { at: Date.now(), p });
  p.catch(() => reports.get(floor)?.p === p && reports.delete(floor));
  return p;
}

async function ranking(root: HTMLElement) {
  const floor = store.floor;
  if (!floor) return;
  try {
    const rep = await report(floor);
    const rows = rep.leaderboard.slice(0, 5);
    root.replaceChildren(
      rows.length
        ? h(
            'ol.tm-rank',
            {},
            ...rows.map((l) => h('li', {}, h('b', {}, l.label), ` · score ${Math.round(l.score)} · ${l.n} run${l.n === 1 ? '' : 's'} · $${l.avgCost.toFixed(2)}/run${l.lowConfidence ? ' · few runs' : ''}`)),
          )
        : empty('No ranked runs on this floor yet: the 📊 Analysis tab fills in as agents finish work.'),
    );
  } catch (err) {
    root.replaceChildren(empty(`Couldn't load the analysis: ${(err as Error).message}`));
  }
}

/** The team's subagents with their track record, compact (the org chart has the buttons). */
function subagentsPanel(team: TeamId, v: RosterView | undefined): HTMLElement | null {
  const lead = LEADS.find((r) => r.team === team);
  if (!lead || !v) return null;
  return panel('👥 Subagents', subagentList(v, lead.id, () => undefined, true) ?? empty('No subagent runs yet.'));
}

/** The team's own panels, under its header. */
export function teamPanels(team: TeamId, v: RosterView | undefined, data: TeamPageData | undefined, deps: PanelDeps): HTMLElement[] {
  const subs = subagentsPanel(team, v);
  return subs ? [...lanePanels(team, v, data, deps), subs] : lanePanels(team, v, data, deps);
}

function lanePanels(team: TeamId, v: RosterView | undefined, data: TeamPageData | undefined, deps: PanelDeps): HTMLElement[] {
  const prs = openPulls();
  if (team === 'testing') {
    const failing = prs.filter((p) => p.checks === 'fail');
    return [
      panel('❌ Failing', failing.length ? h('ul.tm-prs', {}, ...failing.map((p) => prRow(p, deps, false))) : empty('Nothing failing on the open PRs.')),
      panel('🧪 CI scorecards', prs.length ? h('ul.tm-prs', {}, ...prs.slice(0, PRS_SHOWN).map((p) => prRow(p, deps, true))) : empty('No open pull requests.')),
    ];
  }
  if (team === 'development') {
    // The chip goes into an .sm-name, where it sits in the project summary too.
    const chip = h('div.tm-live', {}, h('span.sm-name.tm-live-at'));
    deps.liveChip(chip);
    // Only Development's: a `team:development` label, else a Lead Developer author, else the issue it closes.
    const world = teamWorld();
    const dev = prs.filter((p) => pullTeam(p, world) === 'development');
    return [panel('🌐 Live app', chip), panel('🔀 Development PRs', dev.length ? h('ul.tm-prs', {}, ...dev.slice(0, PRS_SHOWN * 2).map((p) => prRow(p, deps, false))) : empty(prs.length ? `No open Development pull requests (${prs.length} open in other teams' lanes).` : 'No open pull requests.'))];
  }
  if (team === 'analysis') {
    const rank = h('div', {}, empty('Loading the ranking…'));
    void ranking(rank);
    return [panel('📑 BRD & insight memos', data ? fileList(data.insights, 'No memos yet: the Chief Analyst writes docs/insights/YYYY-Www.md after a standup.') : empty('Loading…')), panel('📊 Model ranking on this floor', rank)];
  }
  if (team === 'design') {
    const approvals = (v?.approvals ?? []).filter((a) => a.team === 'design');
    return [
      panel('✅ Design approvals', approvals.length ? h('ul.tm-files', {}, ...approvals.map((a) => h('li', {}, h('b', {}, a.title), a.detail ? ` — ${a.detail}` : ''))) : empty('Nothing of Design waiting on the Project Manager.')),
      panel('🖼️ Design artifacts', data ? fileList(data.design, 'No design/ folder in the project yet.') : empty('Loading…')),
    ];
  }
  // Management: the standup and what waits on the Project Manager.
  const last = v?.standups[0];
  return [
    panel(
      '📋 Latest standup',
      last
        ? h('p', {}, h('button.tm-link', { type: 'button', onclick: () => store.floor && void openStandupWindow(store.floor) }, `📋 ${last.date}`), ` · ${last.status === 'compiled' ? 'compiled' : 'collecting answers'} · by ${last.by}`)
        : empty('No standup yet: ▶️ Run standup on the 👥 Team tab.'),
      data?.standup ? h('p.tm-dim', {}, 'In the repo: ', h('button.tm-link', { type: 'button', onclick: () => void openDoc(data.standup!) }, data.standup)) : null,
    ),
    panel('✅ Approvals', h('p', {}, h('b.tm-big', {}, String(v?.approvals.length ?? 0)), ' waiting on the Project Manager '), h('button.btn.small', { type: 'button', onclick: deps.openApprovals }, 'Open the approvals →')),
  ];
}
