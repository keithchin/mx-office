// A team's own page on the 1D view (🧩 Team boards, `?tab=teams&team=testing`): a switcher of the five teams,
// then the team's header (its mission, its Lead's card from the org chart with hire and wake for the
// Project Manager, its subagents), the team's own board (the board's kanban with only its cards), its own panels
// (ui/teams/panels.ts) and its journal feed (GET /api/teams/page, from the floor's main checkout).

import { TEAM_IDS, TEAM_META, leadOf, type CardTeam } from '../../../shared/roster/card-team';
import type { RoleId, SubagentDef, TeamId } from '../../../shared/roster/roles';
import type { TeamPageData } from '../../../shared/roster/team-page';
import { countTeams } from '../../../shared/roster/team-filter';
import { askedTeam, setAddress } from '../../shared/address';
import { store } from '../../state';
import { h } from '../dom';
import { cards, renderBoard, type KanbanActions } from '../kanban';
import { markdownFile } from '../markdown';
import { memberCard } from '../roster/org';
import { teamCounts, teamsOf } from './filter';
import { teamPanels, type PanelDeps } from './panels';
import { retagControl } from './retag';
import { currentRoster, setRoster } from './world';
import { covererIn, coverNote } from '../roster/coverage';
import type { RosterView } from '../../../shared/roster/types';

/** A team's subagent in its header: "Nia (Tester)" once its member's subagent has a name, else "Testers". */
function subTitle(v: RosterView | undefined, role: RoleId | undefined, s: SubagentDef): string {
  const first = role && v?.subagentNames?.[`${role}/${s.id}`];
  return first ? `${first} (${s.title})` : `${s.title}s`;
}

const TEAM_KEY = 'agent-office.team-page';
const isTeam = (v: unknown): v is TeamId => typeof v === 'string' && (TEAM_IDS as readonly string[]).includes(v);

function rememberedTeam(): TeamId {
  if (isTeam(askedTeam)) return askedTeam;
  try {
    const t = localStorage.getItem(TEAM_KEY);
    if (isTeam(t)) return t;
  } catch {
    // the first team, then
  }
  return 'development';
}

let team: TeamId = rememberedTeam();
export const pageTeam = () => team;

/** The page's project data per floor and team, fetched when the page is drawn and kept for a redraw. */
const data = new Map<string, TeamPageData>();
const fetchedAt = new Map<string, number>();
/** Read again after this long (ms): a Lead may have pushed a journal entry since. */
const DATA_FRESH_MS = 60_000;
const asking = new Set<string>();

export interface PageDeps extends PanelDeps {
  kanban: KanbanActions;
  openWorker(id: string): void;
}

/** Draws the page for the team picked into `root`. Cheap enough to call on every change of the floor. */
export function renderTeamPage(root: HTMLElement, deps: PageDeps) {
  const floor = store.floor;
  const key = `${floor}\0${team}`;
  if (floor && Date.now() - (fetchedAt.get(key) ?? 0) > DATA_FRESH_MS && !asking.has(key)) {
    asking.add(key);
    fetchedAt.set(key, Date.now());
    void fetch(`/api/teams/page?${new URLSearchParams({ floor, team })}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<TeamPageData>) : undefined))
      .then((d) => {
        if (d) data.set(key, d);
        if (floor === store.floor && root.isConnected) renderTeamPage(root, deps);
      })
      .catch(() => undefined)
      .finally(() => asking.delete(key));
  }
  const v = currentRoster();
  const pageData = data.get(key);
  const every = cards(deps.kanban);
  const teams = teamsOf(every);
  const n = countTeams(every.map((c) => teams.get(c.key) ?? 'unassigned'));

  const pick = (t: TeamId) => {
    team = t;
    try {
      localStorage.setItem(TEAM_KEY, t);
    } catch {
      // just for this visit
    }
    setAddress({ team: t });
    renderTeamPage(root, deps);
  };
  const switcher = h(
    'nav.tm-switch',
    { role: 'tablist', 'aria-label': 'Teams' },
    ...TEAM_IDS.map((t) =>
      h(
        'button.btn.tm-switch-b',
        { type: 'button', role: 'tab', class: `tm-${t}${t === team ? ' on' : ''}`, 'aria-selected': String(t === team), 'data-team': t, onclick: () => pick(t) },
        h('span.tm-ico', { 'aria-hidden': 'true' }, TEAM_META[t].icon),
        TEAM_META[t].name,
        h('span.tm-chip-n', {}, String(n[t])),
      ),
    ),
  );

  const lead = leadOf(team);
  // Whoever covers the team: its own Lead, or another member on a Solo or Startup team.
  const member = covererIn(v, team) ?? v?.members.find((m) => m.role === lead.id);
  const covered = coverNote(v, team);
  const head = h(
    'header.tm-head',
    { class: `tm-${team}` },
    h(
      'div.tm-head-text',
      {},
      h('h2.tm-title', {}, h('span.tm-title-ico', { 'aria-hidden': 'true' }, TEAM_META[team].icon), `${TEAM_META[team].name} team`, covered ? h('small.tm-covered', {}, ` · ${covered}`) : null),
      h('p.tm-mission', {}, lead.mission),
      h('p.tm-subs', {}, '👥 ', lead.subagents.length ? lead.subagents.map((s) => subTitle(v, member?.role, s)).join(', ') : 'Coordinates the Leads', ` · 📓 ${pageData?.journalPath ?? `docs/team/${team}.md`}`),
    ),
    v && member ? h('div.tm-lead', {}, memberCard(v, member, { openWorker: deps.openWorker, redraw: setRoster })) : h('p.tm-dim', {}, 'Loading the team…'),
  );

  const board = h('div.kb.tm-board');
  const mine = (t: CardTeam) => t === team;
  renderBoard(board, deps.kanban, {
    keep: (c) => mine(teams.get(c.key) ?? 'unassigned'),
    note: (list) => teamCounts(list.filter((c) => mine(teams.get(c.key) ?? 'unassigned')), teams),
    previewTop: (c) => retagControl(c, teams.get(c.key) ?? 'unassigned'),
  });

  const journal = h(
    'section.tm-panel.tm-journal',
    {},
    h('h3.tm-panel-h', {}, '📓 Journal'),
    !pageData
      ? h('p.tm-dim', {}, 'Reading the journal…')
      : pageData.journal.length
        ? h('ol.tm-entries', {}, ...pageData.journal.map((e) => h('li.tm-entry', {}, h('div.tm-entry-h', {}, e.heading), markdownFile(e.body))))
        : h('p.tm-dim', {}, `No entries in ${pageData.journalPath} on main yet.`),
  );

  root.replaceChildren(
    h(
      'div.tm-page',
      { class: `tm-${team}`, 'data-team': team },
      switcher,
      head,
      h('h3.tm-sec', {}, `🗂 ${TEAM_META[team].name}'s board`),
      board,
      h('div.tm-grid', {}, h('div.tm-col', {}, ...teamPanels(team, v, pageData, deps)), h('div.tm-col', {}, journal)),
    ),
  );
}

/** Forget the project data, so the next drawing reads it again (the floor changed, or a while passed). */
export function forgetTeamData() {
  data.clear();
  fetchedAt.clear();
}
