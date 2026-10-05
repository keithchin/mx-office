// The Analysis tab on the 2D view: which model does well on which kind of task. A leaderboard per
// model, a model × task-type matrix, the latest runs with the analyzer's note on each, and how the
// score is worked out (from the weights the server ranked with, so the page can't disagree with it).
// It asks GET /api/analysis for this project or the whole building. No three.js here: the 2D view imports it.

import type { AnalysisReport, GroupBy, LeaderRow, RunRecord, TaskType } from '../../shared/analysis';
import { TASK_TYPE_LABEL } from '../../shared/analysis';
import type { Grade } from '../../shared/ranking/model';
import type { RankingReport } from '../../shared/ranking/report';
import { h, timeAgo, toast } from './dom';
import { jeffSection } from './jeff';
import './analysis.css';

type Scope = 'floor' | 'global';

const SCOPE_KEY = 'agent-office.analysis-scope';
const BY_KEY = 'agent-office.analysis-by';
/** How many of the latest runs the list shows. */
const RUNS_SHOWN = 25;

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // just for this visit, then
  }
};
const recall = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const usd = (n: number) => `$${n.toFixed(2)}`;
const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 90 * 60_000 ? `${(ms / 60_000).toFixed(ms < 600_000 ? 1 : 0)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const pct = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v * 100)}`);
const tone = (score: number) => (score >= 75 ? 'good' : score >= 50 ? 'mid' : 'low');

/**
 * Draws the tab into `root` for the floor you're on (`floor`), or the whole building when you pick
 * "All projects" (remembered between visits). Call it again to refresh; it never throws.
 */
export async function renderAnalysis(root: HTMLElement, floor: string | undefined): Promise<void> {
  root.classList.add('an');
  const scope: Scope = floor && recall(SCOPE_KEY) !== 'global' ? 'floor' : 'global';
  const by: GroupBy = recall(BY_KEY) === 'effort' ? 'effort' : 'model';
  if (!root.firstChild) root.append(h('p.an-loading', {}, 'Loading the analysis…'));
  const q = new URLSearchParams(scope === 'floor' && floor ? { floor } : { scope: 'global' });
  if (by === 'effort') q.set('by', 'effort');
  let report: AnalysisReport;
  // Each worker's grade, from the Workers tab's ranking (built on these run scores), for the runs list.
  const grades = workerGrades();
  try {
    const res = await fetch(`/api/analysis?${q}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
    report = (await res.json()) as AnalysisReport;
  } catch (err) {
    root.replaceChildren(h('p.an-error', {}, `Couldn't load the analysis: ${(err as Error).message}`));
    return;
  }
  const again = () => void renderAnalysis(root, floor);
  root.replaceChildren(
    toolbar(report, scope, by, floor, again),
    // Jeff, the Router: his judgements next to the office's rules, for this project (ui/jeff.ts).
    jeffSection(floor),
    leaderboard(report),
    matrixView(report) ?? '',
    runsView(report, await grades),
    howScored(report),
  );
}

function toolbar(r: AnalysisReport, scope: Scope, by: GroupBy, floor: string | undefined, again: () => void): HTMLElement {
  const seg = <T extends string>(label: string, current: T, options: [T, string][], pick: (v: T) => void) =>
    h('div.an-seg', { role: 'group', 'aria-label': label }, ...options.map(([v, text]) => h(`button.btn${v === current ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(v === current), onclick: () => pick(v) }, text)));
  const floorName = r.floors.find((f) => f.id === floor)?.name ?? floor ?? '';
  const ranked = r.runs.filter((x) => x.score !== undefined).length;
  return h(
    'div.an-bar',
    {},
    h('div.an-title', {}, h('h2', {}, '📊 Model performance'), h('p.an-sub', {}, `${scope === 'floor' ? floorName : 'All projects'} · ${ranked} ranked run${ranked === 1 ? '' : 's'} of ${r.runs.length}${r.busy ? ' · analysing…' : ''}`)),
    h(
      'div.an-controls',
      {},
      floor
        ? seg('Scope', scope, [['floor', 'This project'], ['global', 'All projects']], (v) => {
            remember(SCOPE_KEY, v);
            again();
          })
        : null,
      seg('Group by', by, [['model', 'Model'], ['effort', 'Model + effort']], (v) => {
        remember(BY_KEY, v);
        again();
      }),
      h('button.btn', { type: 'button', title: 'Record every worker again and re-classify new runs (admins only)', onclick: () => void backfill(again) }, '↻ Re-analyse'),
    ),
  );
}

async function backfill(again: () => void) {
  try {
    const res = await fetch('/api/analysis/backfill', { method: 'POST', credentials: 'same-origin' });
    const body = await res.json().catch(() => null);
    if (!res.ok) return void toast(body?.error ?? `Re-analysis failed (HTTP ${res.status})`, 'warn');
    toast(body?.started ? '📊 Re-analysing every worker: refresh in a minute' : '📊 Already analysing');
    setTimeout(again, 4000);
  } catch {
    toast('Re-analysis failed: the office is unreachable', 'warn');
  }
}

function section(title: string, hint: string, ...body: (Node | null)[]): HTMLElement {
  return h('section.an-card', {}, h('header.an-h', {}, h('h3', {}, title), h('span.an-hint', {}, hint)), ...body);
}

function scoreCell(score: number, low: boolean, n: number): HTMLElement {
  return h(
    'div.an-score',
    {},
    h('span.an-num', {}, score.toFixed(0)),
    h('span.an-meter', { 'aria-hidden': 'true' }, h(`span.an-fill.${tone(score)}`, { style: `width:${Math.max(2, Math.min(100, score))}%` })),
    low ? h('span.an-low', { title: `Only ${n} run${n === 1 ? '' : 's'}: fewer than 3 is not enough to rank on` }, 'low n') : null,
  );
}

function leaderboard(r: AnalysisReport): HTMLElement {
  if (!r.leaderboard.length) return section('🏆 Leaderboard', 'No finished runs to rank yet', h('p.an-empty', {}, 'Runs appear here once a worker finishes a task. Runs still going, and false starts (no PR, under 10 API calls), are not ranked.'));
  const head = ['#', r.by === 'effort' ? 'Model · effort' : 'Model', 'Score', 'n', 'PRs merged', 'Quality', 'mx check clean', 'Avg cost', 'Avg working time', 'Avg wall time', 'Human nudges'];
  const row = (x: LeaderRow, i: number) =>
    h(
      'tr',
      {},
      h('td.an-rank', {}, String(i + 1)),
      h('th.an-model', { scope: 'row' }, x.label),
      h('td', {}, scoreCell(x.score, x.lowConfidence, x.n)),
      h('td.num', {}, String(x.n)),
      h('td.num', {}, `${x.merged}/${x.n}`),
      h('td.num', { title: `${x.qualityN} of ${x.n} runs had a best-practices score` }, x.avgQuality === undefined ? '–' : `${x.avgQuality.toFixed(0)}/100`),
      h('td.num', {}, x.mxN ? `${x.mxClean}/${x.mxN}` : '–'),
      h('td.num', {}, usd(x.avgCost)),
      h('td.num', {}, mins(x.avgActiveMs)),
      h('td.num', {}, mins(x.avgDurationMs)),
      h('td.num', {}, x.avgInterventions.toFixed(1)),
    );
  const sub = (x: LeaderRow) => h('tr.an-parts', {}, h('td', {}), h('td', { colspan: String(head.length - 1) }, partsLine(x.parts)));
  return section(
    '🏆 Leaderboard',
    r.scope === 'floor' ? 'This project only' : 'Across every project',
    h(
      'p.an-towork',
      {},
      'Models, by their tasks’ scores. Each worker’s A–F grade, built on these scores, is on ',
      h('button.btn', { type: 'button', onclick: () => document.getElementById('tab-workers')?.click() }, '👷 Workers'),
    ),
    h('div.an-scroll', {}, h('table.an-table', {}, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, ...r.leaderboard.flatMap((x, i) => [row(x, i), sub(x)])))),
  );
}

function partsLine(parts: LeaderRow['parts']): HTMLElement {
  const names: [keyof LeaderRow['parts'], string][] = [['quality', 'Quality'], ['success', 'Success'], ['efficiency', 'Efficiency'], ['autonomy', 'Autonomy']];
  return h('span.an-partline', {}, ...names.map(([k, label]) => h('span.an-part', { title: `${label}, 0–100 before weighting` }, `${label} `, h('b', {}, pct(parts[k])))));
}

function matrixView(r: AnalysisReport): HTMLElement | null {
  const { rows, types } = r.matrix;
  if (!rows.length) return null;
  const cell = (c: { score: number; n: number } | undefined) =>
    c
      ? h(`td.an-cell.${tone(c.score)}`, { title: `${c.n} run${c.n === 1 ? '' : 's'}${c.n < r.minConfidentRuns ? ' (low confidence)' : ''}` }, h('b', {}, c.score.toFixed(0)), h('small', {}, ` n=${c.n}`), c.n < r.minConfidentRuns ? h('span.an-dot', { 'aria-label': 'low confidence' }, '•') : null)
      : h('td.an-cell.none', {}, '–');
  return section(
    '🧩 Model × task type',
    'Score per kind of task (a task of several kinds counts toward each)',
    h(
      'div.an-scroll',
      {},
      h(
        'table.an-table.an-matrix',
        {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, r.by === 'effort' ? 'Model · effort' : 'Model'), ...types.map((t) => h('th', { scope: 'col' }, TASK_TYPE_LABEL[t])))),
        h('tbody', {}, ...rows.map((row) => h('tr', {}, h('th.an-model', { scope: 'row' }, row.label), ...types.map((t) => cell(row.cells[t]))))),
      ),
    ),
  );
}

const OUTCOME: Record<RunRecord['outcome'], [string, string]> = {
  merged: ['merged', '✅ Merged'],
  open: ['open', '🔀 PR open'],
  closed: ['closed', '✖ Closed'],
  'no-pr': ['nopr', '— No PR'],
  running: ['running', '⏳ Running'],
};

/** `<floor>:<worker id>` → its grade, from GET /api/ranking; empty when that's unavailable. */
async function workerGrades(): Promise<Map<string, Grade>> {
  const out = new Map<string, Grade>();
  try {
    const res = await fetch('/api/ranking?floor=all', { credentials: 'same-origin' });
    if (!res.ok) return out;
    for (const w of ((await res.json()) as RankingReport).workers) if (w.grade) for (const id of w.workerIds) out.set(`${w.floor}:${id}`, w.grade);
  } catch {
    // the runs list just goes without grades
  }
  return out;
}

function runsView(r: AnalysisReport, grades: Map<string, Grade>): HTMLElement {
  const runs = r.runs.slice(0, RUNS_SHOWN);
  const floorName = (id: string) => r.floors.find((f) => f.id === id)?.name ?? id;
  const item = (x: RunRecord & { score?: number }) => {
    const [cls, label] = OUTCOME[x.outcome];
    const sc = x.scorecard;
    const quality = sc?.score !== undefined ? `${sc.score}/100${sc.source === 'self-reported' ? '*' : ''}` : '–';
    const outcome = x.pr?.url ? h('a', { href: x.pr.url, target: '_blank', rel: 'noopener' }, `${label} #${x.pr.number}`) : label;
    return h(
      `li.an-run${x.excluded ? '.excluded' : ''}`,
      {},
      h(
        'div.an-run-top',
        {},
        h('span.an-run-model', {}, x.modelLabel, x.effort ? h('small', {}, ` · ${x.effort}`) : null),
        h('span.an-run-title', {}, x.issue ? `#${x.issue} ` : '', x.title),
        x.score !== undefined ? h(`span.an-badge.${tone(x.score)}`, { title: 'Run score' }, x.score.toFixed(0)) : h('span.an-badge.none', { title: x.excluded ?? '' }, 'not ranked'),
      ),
      h(
        'div.an-run-facts',
        {},
        h(`span.an-outcome.${cls}`, {}, outcome),
        h('span', {}, `👷 ${x.worker}`, grades.has(x.id) ? h(`b.an-grade.g-${grades.get(x.id)}`, { title: 'The worker’s grade on the 👷 Workers tab' }, grades.get(x.id)!) : null),
        r.scope === 'global' ? h('span', {}, `🏢 ${floorName(x.floor)}`) : null,
        h('span', { title: 'Wall clock / time actually working' }, `⏱ ${mins(x.durationMs)} (${mins(x.activeMs)} working)`),
        h('span', {}, `💰 ${usd(x.cost)}`),
        h('span', { title: 'API calls / tool calls' }, `🔁 ${x.apiCalls} / 🔧 ${x.toolCalls}`),
        h('span', { title: sc ? `${sc.source === 'ci' ? 'CI scorecard' : 'Self-reported in the PR description'}${sc.mxErrors !== undefined ? ` · mx check errors ${sc.mxErrors}` : ''}${sc.lintWarnings !== undefined ? ` · lint ${sc.lintErrors ?? 0}E/${sc.lintWarnings}W` : ''}` : 'No scorecard' }, `🧪 ${quality}`),
        x.humanPrompts + x.needsInput ? h('span.an-nudge', {}, `🙋 ${x.humanPrompts + x.needsInput}`) : null,
        h('span.an-when', {}, timeAgo(x.startedAt)),
      ),
      h('div.an-types', {}, ...x.types.map((t: TaskType) => h('span.an-chip', {}, TASK_TYPE_LABEL[t])), h('span.an-by', { title: x.typesBy === 'llm' ? 'Classified by the analyzer agent (Claude Haiku)' : 'Classified by keyword rules' }, x.typesBy === 'llm' ? 'AI' : 'rules')),
      x.note ? h('p.an-note', {}, x.note) : null,
    );
  };
  // The runs that count first; the ones still going and the false starts tucked away below, so they don't crowd them out.
  const ranked = runs.filter((x) => !x.excluded);
  const unranked = runs.filter((x) => x.excluded);
  return section(
    '🕑 Recent runs',
    `Latest ${runs.length}${r.runs.length > runs.length ? ` of ${r.runs.length}` : ''} · * quality the agent reported itself`,
    ranked.length ? h('ol.an-runs', {}, ...ranked.map(item)) : h('p.an-empty', {}, 'No ranked runs yet.'),
    unranked.length ? h('details.an-unranked', {}, h('summary', {}, `${unranked.length} not ranked (still running, or no PR and under 10 API calls)`), h('ol.an-runs', {}, ...unranked.map(item))) : null,
  );
}

function howScored(r: AnalysisReport): HTMLElement {
  const w = r.weights;
  const p = (n: number) => `${Math.round(n * 100)}%`;
  return h(
    'details.an-card.an-how',
    {},
    h('summary', {}, 'ℹ️ How scores are computed'),
    h(
      'ul',
      {},
      h('li', {}, h('b', {}, `Quality ${p(w.quality)}`), ` — best-practices score out of 100 (${p(r.qualityWeights.score)}), Studio Pro's mx check clean (${p(r.qualityWeights.mxClean)}), and the share of tests passed when tests ran (${p(r.qualityWeights.tests)}). From the CI scorecard comment when there is one, else what the agent wrote in its PR (marked *).`),
      h('li', {}, h('b', {}, `Success ${p(w.success)}`), ` — PR merged ${pct(r.successValue.merged)}, open ${pct(r.successValue.open)}, closed unmerged ${pct(r.successValue.closed)}, no PR ${pct(r.successValue['no-pr'])}.`),
      h('li', {}, h('b', {}, `Efficiency ${p(w.efficiency)}`), ` — half cost, half working time: $${r.refCostUsd.toFixed(2)} or ${r.refActiveMin} min each scores 50, half that scores 67, double scores 33.`),
      h('li', {}, h('b', {}, `Autonomy ${p(w.autonomy)}`), ' — 100 with no human help, 50 after one nudge, 33 after two (prompts typed before the PR was opened, and permission or question stops).'),
      h('li', {}, `A part with no data (no scorecard yet) is left out and the others scaled up. A model's score is the mean of its runs' scores. Fewer than ${r.minConfidentRuns} runs is marked low n: treat it as an anecdote. Runs still going and false starts (no PR and under 10 API calls) are listed but not ranked.`),
    ),
  );
}
