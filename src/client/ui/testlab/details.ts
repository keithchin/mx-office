// One test run on the Test Mode page (ui/testlab/): its headline, then for a pages run the two charts and
// the per-view table (time to usable, longest task, heap growth), for a journey its steps, for the unit
// tests and the Command Center check their counts; and every failure with what's known of it (the view,
// its long tasks' top frames, the page's errors, a screenshot to open full size) and an Open incident.

import { PERF_BUDGETS, SUITE_LABEL, type RunResult, type RunSummary, type StepResult, type ViewResult } from '../../../shared/testlab';
import { h, openModal, toast } from '../dom';
import { barChart } from './charts';
import { barsOf, duration, heapWord, MAX_ROWS, mb, ms, STATUS_WORD } from './logic';

export interface DetailDeps {
  /** Opens an incident from a failure (a view's or step's id, or the whole run): its number, or undefined. */
  incident(run: RunSummary, what: { view?: string; step?: string }): Promise<number | undefined>;
}

const fileUrl = (run: string, name: string) => `/api/testlab/runs/${encodeURIComponent(run)}/file/${encodeURIComponent(name)}`;

function shot(run: string, name: string, label: string): HTMLElement {
  const img = h('img.tl-thumb', { src: fileUrl(run, name), alt: `Screenshot: ${label}`, loading: 'lazy' });
  const open = () => openModal(h('div.modal.tl-shot-modal', {}, h('header', {}, h('h2', {}, `Screenshot: ${label}`)), h('div.body', {}, h('img.tl-shot', { src: fileUrl(run, name), alt: `Screenshot: ${label}` }))));
  return h('button.tl-thumb-btn', { type: 'button', title: 'Open the screenshot full size', onclick: open }, img);
}

const badge = (ok: boolean) => h('span.tl-ok', { class: ok ? 'pass' : 'fail' }, ok ? '✓ ok' : '✕ over');

function incidentButton(run: RunSummary, key: string, what: { view?: string; step?: string }, d: DetailDeps): HTMLElement {
  const had = run.incidents?.[key];
  const b = h('button.btn.small', { type: 'button', disabled: !!had }, had ? `Incident INC-${had} opened` : '🚨 Open incident') as HTMLButtonElement;
  b.addEventListener('click', async () => {
    b.disabled = true;
    const n = await d.incident(run, what);
    if (n) {
      b.textContent = `Incident INC-${n} opened`;
      (run.incidents ??= {})[key] = n;
      toast(`Opened INC-${n}: it's on the 🧾 Audit log's Incidents tab`);
    } else b.disabled = false;
  });
  return b;
}

function viewFailure(run: RunSummary, v: ViewResult, d: DetailDeps): HTMLElement {
  const tasks = [...v.longTasks].sort((a, b) => b.ms - a.ms).slice(0, 5);
  return h(
    'div.tl-fail',
    { id: `tl-view-${v.id}` },
    h('div.tl-fail-head', {}, h('b', {}, v.name), h('code', {}, v.path), incidentButton(run, v.id, { view: v.id }, d)),
    h('ul', {}, ...v.failures.slice(0, 10).map((f) => h('li', {}, f))),
    ...tasks.map((t) => h('details.tl-task', {}, h('summary', {}, `Long task ${ms(t.ms)}, ${ms(t.at)} after opening`), t.stack?.length ? h('pre.tl-stack', {}, t.stack.slice(0, 12).join('\n')) : h('p.tl-note', {}, 'The profiler caught no frames in it.'))),
    v.pageErrors?.length ? h('details.tl-task', {}, h('summary', {}, `Page errors (${v.pageErrors.length})`), h('pre.tl-stack', {}, v.pageErrors.slice(0, 10).join('\n'))) : null,
    v.screenshot ? shot(run.id, v.screenshot, v.name) : null,
  );
}

function viewsPart(run: RunSummary, r: RunResult, d: DetailDeps): Node[] {
  const views = (r.views ?? []).slice(0, MAX_ROWS);
  const limit = r.budgets?.heapGrowthPct ?? PERF_BUDGETS.heapGrowthPct;
  const longB = r.budgets?.longTaskMs ?? PERF_BUDGETS.longTaskMs;
  const ttuB = r.budgets?.timeToUsableMs ?? PERF_BUDGETS.timeToUsableMs;
  const jump = (id: string) => document.getElementById(`tl-view-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const table = h(
    'table.tl-table',
    {},
    h('thead', {}, h('tr', {}, ...['View', 'Time to usable', 'Longest task', 'Long tasks', 'Heap', 'Heap growth', 'Result'].map((t) => h('th', { scope: 'col' }, t)))),
    h(
      'tbody',
      {},
      ...views.map((v) =>
        h(
          'tr',
          { class: v.ok ? '' : 'bad' },
          h('th', { scope: 'row' }, v.ok ? v.name : h('a', { href: `#tl-view-${v.id}`, onclick: (e: Event) => (e.preventDefault(), jump(v.id)) }, v.name)),
          h('td', {}, ms(v.ttuMs)),
          h('td', {}, ms(v.longestTaskMs)),
          h('td', {}, String(v.longTasks.length)),
          h('td', {}, `${mb(v.heapStartMB)} → ${mb(v.heapEndMB)}`),
          h('td', {}, heapWord(v, limit)),
          h('td', {}, badge(v.ok)),
        ),
      ),
    ),
  );
  const failing = views.filter((v) => !v.ok);
  return [
    h('div.tl-charts', {}, barChart(`Longest task per view (budget ${ms(longB)})`, barsOf(r, 'longest', longB), longB, jump), barChart(`Time to usable per view (budget ${ms(ttuB)})`, barsOf(r, 'ttu', ttuB), ttuB, jump)),
    h('div.tl-scroll', {}, table),
    ...(failing.length ? [h('h4', {}, `What failed (${failing.length})`), ...failing.map((v) => viewFailure(run, v, d))] : []),
  ];
}

function stepsPart(run: RunSummary, steps: StepResult[], d: DetailDeps): Node[] {
  return [
    h(
      'ol.tl-steps',
      {},
      ...steps.slice(0, MAX_ROWS).map((s) =>
        h(
          'li',
          { class: s.ok ? 'pass' : 'fail', id: `tl-step-${s.id}` },
          h('span.tl-ok', { class: s.ok ? 'pass' : 'fail' }, s.ok ? '✓' : '✕'),
          h('b', {}, s.name),
          h('span.tl-note', {}, ms(s.ms)),
          s.detail ? h('div.tl-note', {}, s.detail) : null,
          !s.ok ? incidentButton(run, s.id, { step: s.id }, d) : null,
          s.screenshot ? shot(run.id, s.screenshot, s.name) : null,
        ),
      ),
    ),
  ];
}

/** A run's details, from GET /api/testlab/runs/<id>. */
export function runDetails(run: RunSummary, r: RunResult | undefined, d: DetailDeps): HTMLElement {
  const head = h(
    'div.tl-run-head',
    {},
    h('span.tl-status', { class: run.status }, STATUS_WORD[run.status]),
    h('b', {}, SUITE_LABEL[run.suite]),
    h('span.tl-note', {}, `${new Date(run.startedAt).toLocaleString()} · ${duration(run.durationMs)}${run.by ? ` · by ${run.by}` : ''}`),
    run.headline ? h('span', {}, run.headline) : null,
  );
  const body: Node[] = [];
  if (!r) body.push(h('p.tl-note', {}, run.status === 'running' ? 'Running: the results show here when it ends.' : 'This run left no results.'));
  else {
    if (r.error) body.push(h('p.tl-error', {}, r.error));
    if (r.views?.length) body.push(...viewsPart(run, r, d));
    if (r.steps?.length) body.push(...stepsPart(run, r.steps, d));
    if (r.counts) body.push(h('p', {}, `${r.counts.pass} passed, ${r.counts.fail} failed${r.counts.skip ? `, ${r.counts.skip} skipped` : ''}.`));
    if (r.failures?.length) body.push(h('h4', {}, 'Failures'), h('ul.tl-fails', {}, ...r.failures.slice(0, MAX_ROWS).map((f) => h('li', {}, f))));
    if (!r.ok && !r.views?.some((v) => !v.ok) && !r.steps?.some((s) => !s.ok)) body.push(h('div.seg', {}, incidentButton(run, 'run', {}, d)));
    if (r.officeDir) body.push(h('p.tl-note', {}, `Test office: ${r.officeDir}`));
  }
  return h('section.tl-run', { 'data-run': run.id }, head, ...body);
}
