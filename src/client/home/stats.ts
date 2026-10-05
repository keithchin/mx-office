/**
 * The home page's 📊 Statistics tab: the whole office in a row of numbers (spend, who's working,
 * waiting or asleep, what's open on GitHub), every project side by side in a table you sort by any
 * column, and which models do best across every project. The numbers come from GET /api/home/stats
 * (server/home-stats.ts, built from what the office already keeps) and the ranking from the
 * Analysis tab's own GET /api/analysis?scope=global: nothing here asks a model anything. No three.js.
 */
import type { HomeFloorStats, HomeStats } from '../../shared/home';
import type { AnalysisReport, LeaderRow } from '../../shared/analysis';
import { h, timeAgo } from '../ui/dom';
import { floorUrl, openFloor } from './projects';
import './stats.css';

/** How long a fetched answer is reused (the server keeps its own for a few seconds too). */
const FRESH_MS = 10_000;
const SORT_KEY = 'agent-office.home-sort';
/** How many models the ranking shows: the floors' 📊 Analysis tab has the rest. */
const RANKED = 8;

function cached<T>(url: string): () => Promise<T> {
  let hit: { at: number; p: Promise<T> } | undefined;
  return () => {
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.p;
    const p = fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      return (await res.json()) as T;
    });
    hit = { at: Date.now(), p };
    p.catch(() => (hit = undefined));
    return p;
  };
}
const fetchStats = cached<HomeStats>('/api/home/stats');
const fetchRanking = cached<AnalysisReport>('/api/analysis?scope=global');

const usd = (n: number) => `$${n.toFixed(2)}`;
const plus = (n: number, capped: boolean) => `${n}${capped ? '+' : ''}`;

interface Column {
  key: string;
  label: string;
  title: string;
  /** What it sorts by: numbers sort biggest first, words A to Z. */
  sort(f: HomeFloorStats): number | string;
  cell(f: HomeFloorStats, leaving: () => void): Node | string;
}

const COLUMNS: Column[] = [
  {
    key: 'name',
    label: 'Project',
    title: 'The project (its floor): open its board',
    sort: (f) => f.name.toLowerCase(),
    cell: (f, leaving) => h('a.hs-name', { href: floorUrl(f.id, '1d'), onclick: (e: Event) => (e.preventDefault(), openFloor(f.id, '1d', leaving)) }, f.name),
  },
  { key: 'repo', label: 'Repo', title: 'Its repository on GitHub', sort: (f) => (f.repo ?? '').toLowerCase(), cell: (f) => f.repo ?? '—' },
  { key: 'stage', label: 'Stage', title: "A toolkit project's current stage", sort: (f) => (f.stage ?? '').toLowerCase(), cell: (f) => f.stage ?? '—' },
  { key: 'issuesOpen', label: 'Issues open', title: 'Open issues', sort: (f) => f.issuesOpen, cell: (f) => String(f.issuesOpen) },
  { key: 'issuesClosed', label: 'Closed', title: 'Closed issues (the board keeps the latest 40)', sort: (f) => f.issuesClosed, cell: (f) => plus(f.issuesClosed, f.issuesClosedCapped) },
  { key: 'prsOpen', label: 'PRs open', title: 'Open pull requests', sort: (f) => f.prsOpen, cell: (f) => String(f.prsOpen) },
  {
    key: 'prsMerged',
    label: 'Merged',
    title: 'Merged pull requests (the board keeps the latest 30), and how many in the last 7 days',
    sort: (f) => f.prsMerged,
    cell: (f) => h('span', {}, plus(f.prsMerged, f.prsMergedCapped), f.mergedWeek ? h('small', {}, ` · ${f.mergedWeek} this week`) : null),
  },
  { key: 'queued', label: 'Queue', title: 'Tasks queued (and running) for the next free agent', sort: (f) => f.queued + f.running, cell: (f) => (f.running ? `${f.queued} + ${f.running} running` : String(f.queued)) },
  {
    key: 'agents',
    label: 'Agents',
    title: 'Its agents: working, waiting on a human, asleep',
    sort: (f) => f.working * 1000 + f.waiting * 100 + f.agents,
    cell: (f) =>
      f.agents
        ? h('span.hs-agents', {}, f.working ? h('span', { title: 'working' }, `👷 ${f.working}`) : null, f.waiting ? h('span.bad', { title: 'waiting on a human' }, `🙋 ${f.waiting}`) : null, f.asleep ? h('span', { title: 'asleep' }, `💤 ${f.asleep}`) : null, h('small', {}, `of ${f.agents}`))
        : '—',
  },
  {
    key: 'leads',
    label: 'Team',
    title: "The project team's Leads: hired (on the job) and benched",
    sort: (f) => (f.leads ? f.leads.hired * 100 + f.leads.benched : -1),
    cell: (f) => (f.leads ? h('span', {}, `${f.leads.hired} of ${f.leads.total} hired`, f.leads.benched ? h('small', {}, ` · ${f.leads.benched} benched`) : null) : '—'),
  },
  { key: 'spend', label: 'Spend', title: 'What its workers spent all told, and today', sort: (f) => f.spend.total, cell: (f) => h('span', {}, usd(f.spend.total), f.spend.today ? h('small', {}, ` ${usd(f.spend.today)} today`) : null) },
  { key: 'last', label: 'Last activity', title: 'When anything last happened there', sort: (f) => f.lastActivity ?? 0, cell: (f) => (f.lastActivity ? timeAgo(f.lastActivity) : '—') },
];

/** The table's order, as this browser left it. */
function savedSort(): { key: string; asc: boolean } {
  try {
    const s = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null') as { key?: unknown; asc?: unknown } | null;
    if (s && COLUMNS.some((c) => c.key === s.key)) return { key: s.key as string, asc: s.asc === true };
  } catch {
    // Nothing kept: by name.
  }
  return { key: 'name', asc: true };
}

export interface StatsView {
  render(): Promise<void>;
}

/** Draws the tab into `root`; render() again refreshes it. `leaving` hears the page head off to a floor. */
export function statsView(root: HTMLElement, leaving: () => void): StatsView {
  let sort = savedSort();
  let stats: HomeStats | undefined;
  let ranking: AnalysisReport | null | undefined;

  const tiles = (s: HomeStats) => {
    const t = s.totals;
    const tile = (label: string, value: string, sub?: string, cls = '') => h('li.hs-tile', { class: cls }, h('span.hs-value', {}, value), h('span.hs-label', {}, label), sub ? h('span.hs-sub', {}, sub) : null);
    return h(
      'ul.hs-tiles',
      { 'aria-label': 'The office in numbers' },
      tile('Spent today', usd(s.spend.today), s.spend.budget ? `of ${usd(s.spend.budget)} budget` : undefined),
      tile('Spent all-time', usd(s.spend.total)),
      tile('Agents working', String(t.working), `of ${t.agents}`),
      tile('Waiting on a human', String(t.waiting), undefined, t.waiting ? 'bad' : ''),
      tile('Asleep', String(t.asleep)),
      tile('Open issues', String(t.issuesOpen)),
      tile('Open PRs', String(t.prsOpen)),
      tile('PRs merged, 7 days', String(t.mergedWeek)),
      tile('Queued tasks', String(t.queued)),
    );
  };

  const table = (s: HomeStats) => {
    const col = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0];
    const rows = [...s.floors].sort((a, b) => {
      const x = col.sort(a);
      const y = col.sort(b);
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.asc ? d : -d;
    });
    const head = COLUMNS.map((c) => {
      const on = c.key === sort.key;
      return h(
        'th',
        { scope: 'col', 'aria-sort': on ? (sort.asc ? 'ascending' : 'descending') : undefined, class: on ? 'on' : '' },
        h('button.hs-sort', { type: 'button', title: `${c.title}. Sort by it`, 'data-key': c.key, onclick: () => resort(c.key) }, c.label, h('span.hs-arrow', { 'aria-hidden': 'true' }, on ? (sort.asc ? '▲' : '▼') : '')),
      );
    });
    return h(
      'div.hs-scroll',
      {},
      h(
        'table.hs-table',
        {},
        h('thead', {}, h('tr', {}, ...head)),
        h('tbody', {}, ...rows.map((f) => h('tr', { class: f.waiting ? 'waiting' : '' }, ...COLUMNS.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : {}, c.cell(f, leaving)))))),
      ),
    );
  };

  /** Click a column: by it, or the other way round if it already is. Numbers start biggest first. */
  const resort = (key: string) => {
    sort = sort.key === key ? { key, asc: !sort.asc } : { key, asc: key === 'name' || key === 'repo' || key === 'stage' };
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    } catch {
      // Just for this visit, then.
    }
    draw();
  };

  const rankingTable = (r: AnalysisReport | null | undefined) => {
    if (r === undefined) return h('p.hs-note', {}, 'Loading the ranking…');
    const rows = r?.leaderboard.slice(0, RANKED) ?? [];
    if (!rows.length) return h('p.hs-note', {}, 'No finished runs to rank yet: models are ranked once workers finish tasks.');
    const row = (x: LeaderRow, i: number) =>
      h(
        'tr',
        {},
        h('td.hs-rank', {}, String(i + 1)),
        h('th', { scope: 'row' }, x.label, x.lowConfidence ? h('small', { title: `Fewer than ${r!.minConfidentRuns} ranked runs: a rough guide` }, ' (few runs)') : null),
        h('td', {}, h('span.hs-score', { style: `--score:${Math.round(x.score)}%` }, String(Math.round(x.score)))),
        h('td', {}, String(x.n)),
        h('td', {}, usd(x.avgCost)),
        h('td', {}, `${x.merged} / ${x.prs}`),
      );
    return h(
      'div.hs-scroll',
      {},
      h(
        'table.hs-table.hs-ranking',
        {},
        h('thead', {}, h('tr', {}, ...['#', 'Model', 'Score', 'Runs', 'Avg cost', 'PRs merged / opened'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, ...rows.map(row)),
      ),
    );
  };

  const draw = () => {
    if (!stats) return;
    root.replaceChildren(
      tiles(stats),
      h('div.hs-head', {}, h('h2', {}, 'Projects side by side'), h('span.hs-note', {}, `Updated ${timeAgo(stats.generatedAt)} · click a column to sort`)),
      stats.floors.length ? table(stats) : h('p.hs-note', {}, 'No projects yet: ➕ Add project on the Projects tab.'),
      h('div.hs-head', {}, h('h2', {}, '🏆 Model ranking'), h('span.hs-note', {}, ranking ? `All projects · ${ranking.leaderboard.reduce((n, x) => n + x.n, 0)} ranked runs · a floor's 📊 Analysis tab has the details` : '')),
      rankingTable(ranking),
    );
  };

  return {
    async render() {
      if (!stats) root.replaceChildren(h('p.hs-note', {}, 'Counting…'));
      void fetchRanking()
        .then((r) => (ranking = r))
        .catch(() => (ranking = null))
        .then(draw);
      try {
        stats = await fetchStats();
      } catch (err) {
        if (!stats) root.replaceChildren(h('p.hs-note.bad', {}, `Couldn't load the statistics: ${(err as Error).message}`));
        return;
      }
      draw();
    },
  };
}
