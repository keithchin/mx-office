// The Testing tab's parts (App Insights › Testing), drawn from GET /api/testing: the header (main's
// commit, the Stage 6 gate, checks on main, and coverage, results and freshness counted apart), the test
// plan panel (its markdown asked for only when opened), the functional domains (a row per BRD use case,
// grouped by feature, each opening onto its criteria, linked tests and runs with all three revisions)
// and the test runs, newest first. Read-only: nothing here changes anything.

import type { AcView, RunSummary, TestingView, TestRef, UcRow } from '../../../shared/testing/view';
import type { Link } from '../../../shared/testing/record';
import { h } from '../dom';
import { COVERAGE, countLine, countsOf, FRESHNESS, linkWord, RESULT, rev, SOURCE_WORD, UC_COVERAGE, when, type Tone } from './words';

const pill = (word: string, tone: Tone, title?: string) => h('span.tst-pill', { 'data-tone': tone, ...(title ? { title } : {}) }, word);

/** The header: main, the gate, checks on main, the three counts, stale. */
export function header(v: TestingView): HTMLElement {
  const main = v.main
    ? h('p.tst-main', {}, h('span.tst-k', {}, `${v.main.branch} at `), h('code.tst-sha', { title: v.main.sha }, rev(v.main.sha)), v.stale ? pill('Stale', 'warn', `No run has tested ${rev(v.main.sha)} yet; the newest known run tested ${rev(v.stale.lastTested)}`) : null)
    : h('p.tst-main', {}, 'No main commit yet');
  const gate = h('p.tst-gate', {}, h('span.tst-k', {}, 'Stage 6 gate: '), v.gate6 ? pill(v.gate6.status, v.gate6.status === 'PASS' ? 'good' : v.gate6.status === 'FAIL' ? 'bad' : 'muted') : pill('not known', 'muted'), v.gate6 ? h('small.tst-from', {}, ` ${v.gate6.from}${v.gate6.detail ? `: ${v.gate6.detail}` : ''}`) : null);
  const checks = v.checksOnMain.length
    ? h('p.tst-gate', {}, h('span.tst-k', {}, 'Runs on main: '), ...v.checksOnMain.map((c) => h('span.tst-check', {}, `${c.suite} `, pill(RESULT[c.result].word, RESULT[c.result].tone))))
    : h('p.tst-gate', {}, h('span.tst-k', {}, 'Runs on main: '), h('span.tst-muted', {}, v.main ? `no run has tested ${rev(v.main.sha)}` : 'none'));
  const group = (title: string, sub: string, items: { key: string; n: number; word: string }[], tones: Record<string, { tone: Tone }>) =>
    h('div.tst-count', { role: 'group', 'aria-label': title }, h('span.tst-count-h', {}, title, h('small', {}, ` ${sub}`)), h('div.tst-count-row', {}, ...items.map((i) => h('span.tst-count-i', { 'data-tone': i.n ? tones[i.key].tone : 'muted' }, h('strong', {}, String(i.n)), ` ${i.word}`))));
  return h(
    'section.tst-head',
    {},
    main,
    gate,
    checks,
    h(
      'div.tst-counts',
      {},
      group('Coverage', 'acceptance criteria', countsOf(v.counts.coverage, COVERAGE), COVERAGE),
      group('Results', 'use cases, latest run', countsOf(v.counts.result, RESULT), RESULT),
      group('Freshness', 'use cases, against main', countsOf(v.counts.freshness, FRESHNESS), FRESHNESS),
    ),
    v.notes.length ? h('ul.tst-notes', {}, ...v.notes.map((n) => h('li', {}, n))) : null,
  );
}

/** The test plan panel: its path and status at once, its text only when opened. */
export function planPanel(v: TestingView, load: () => Promise<{ markdown: string } | undefined>, md: (src: string) => HTMLElement): HTMLElement {
  if (!v.plan)
    return h('section.tst-card', {}, h('h3.tst-h', {}, 'Test plan'), h('p.tst-empty', {}, 'No test plan yet. The Tester writes it at tests/test-plan.md in Stage 4 (the toolkit’s plan); it will show here once it is on main.'));
  const p = v.plan;
  const body = h('div.tst-plan-body', {}, h('p.tst-muted', {}, 'Loading…'));
  let loaded = false;
  const box = h(
    'details.tst-plan',
    {
      ontoggle: () => {
        if (!box.open || loaded) return;
        loaded = true;
        void load().then(
          (r) => body.replaceChildren(r ? md(r.markdown) : h('p.tst-muted', {}, 'The plan could not be read.')),
          () => body.replaceChildren(h('p.tst-muted', {}, 'The plan could not be read.')),
        );
      },
    },
    h('summary', {}, h('code', {}, p.path), ' ', pill(p.status ? `Status: ${p.status}` : 'No status line', p.status ? 'info' : 'muted'), p.changedIn ? h('small.tst-from', {}, ` last changed in ${rev(p.changedIn)}${p.changedAt ? `, ${when(p.changedAt)}` : ''}`) : null),
    body,
  );
  return h('section.tst-card', {}, h('h3.tst-h', {}, 'Test plan'), box);
}

const testRow = (t: TestRef) => h('li', {}, h('span.tst-test', {}, t.name), ' ', pill(t.basis === 'recorded' ? 'recorded' : 'inferred', t.basis === 'recorded' ? 'good' : 'info', t.rule ? `Rule: ${t.rule}` : t.via), h('small.tst-from', {}, ` ${t.rule ? `rule: ${t.rule}; ` : ''}${t.via}`));

function acItem(a: AcView): HTMLElement {
  return h(
    'li.tst-ac',
    {},
    h('div.tst-ac-top', {}, h('strong', {}, a.id), ' ', h('span', {}, a.text), a.journeys.length ? h('small.tst-from', {}, ` proof: ${a.journeys.join(', ')}`) : null),
    h('div.tst-states', {}, cell('Coverage', COVERAGE[a.coverage]), cell('Latest result', RESULT[a.result]), cell('Freshness', FRESHNESS[a.freshness], a.tested ? `tested ${rev(a.tested)}` : undefined)),
    a.tests.length ? h('ul.tst-tests', {}, ...a.tests.slice(0, 12).map(testRow)) : h('p.tst-muted', {}, 'No test is linked to this criterion.'),
  );
}

const cell = (label: string, s: { word: string; tone: Tone }, sub?: string) => h('span.tst-state', {}, h('span.tst-state-l', {}, label), pill(s.word, s.tone), sub ? h('small.tst-from', {}, ` ${sub}`) : null);

/** A run's three revisions, each with its name. */
export function revisions(r: Pick<RunSummary, 'tested' | 'definition' | 'evidence'>): HTMLElement {
  return h(
    'span.tst-revs',
    {},
    h('span', {}, h('span.tst-rev-l', {}, 'Tested app '), h('code', { title: r.tested }, rev(r.tested))),
    h('span', {}, h('span.tst-rev-l', {}, 'Tests from '), h('code', { title: r.definition }, rev(r.definition))),
    h('span', {}, h('span.tst-rev-l', {}, 'Evidence '), h('code', { title: r.evidence.locator }, r.evidence.kind === 'repo-commit' ? rev(r.evidence.revision) : r.evidence.revision)),
  );
}

function ucRow(r: UcRow, runs: Map<string, RunSummary>): HTMLElement {
  const top = h(
    'summary.tst-row',
    {},
    h('span.tst-c-uc', { 'data-label': 'Use case' }, h('strong', {}, r.id), ' ', r.title, r.flaky ? pill('Flaky', 'warn', 'A linked test passed and failed on the same tested revision') : null),
    h('span.tst-c-br', { 'data-label': 'Business rules' }, r.rules.length ? r.rules.join(', ') : '–'),
    h('span.tst-c-ac', { 'data-label': 'Acceptance criteria' }, r.acs.length ? r.acs.map((a) => a.id).join(', ') : '–'),
    h('span.tst-c-n', { 'data-label': 'Linked tests' }, String(r.tests.length)),
    h('span.tst-c-s', { 'data-label': 'Coverage' }, pill(UC_COVERAGE[r.coverage].word, UC_COVERAGE[r.coverage].tone, r.coverageNote)),
    h('span.tst-c-s', { 'data-label': 'Latest result' }, pill(RESULT[r.result].word, RESULT[r.result].tone)),
    h('span.tst-c-s', { 'data-label': 'Freshness' }, pill(FRESHNESS[r.freshness].word, FRESHNESS[r.freshness].tone, r.tested ? `Tested ${rev(r.tested)}` : undefined)),
  );
  const box = h('details.tst-uc', {}, top);
  let drawn = false;
  box.addEventListener('toggle', () => {
    if (!box.open || drawn) return;
    drawn = true;
    const rr = r.runIds.map((id) => runs.get(id)).filter((x): x is RunSummary => !!x);
    box.append(
      h(
        'div.tst-drill',
        {},
        h('p.tst-muted', {}, r.coverageNote),
        h('h4', {}, 'Acceptance criteria'),
        r.acs.length ? h('ul.tst-acs', {}, ...r.acs.map(acItem)) : h('p.tst-muted', {}, 'No acceptance criterion is tied to this use case.'),
        h('h4', {}, 'Linked tests'),
        r.tests.length ? h('ul.tst-tests', {}, ...r.tests.slice(0, 20).map(testRow)) : h('p.tst-muted', {}, 'No test names this use case, its rules or its criteria.'),
        h('h4', {}, 'Runs'),
        rr.length ? h('ul.tst-runs-mini', {}, ...rr.map((x) => h('li', {}, h('span', {}, `${when(x.at)} ${x.suite} `), pill(countLine(x.counts), x.counts.failed ? 'bad' : x.counts.passed ? 'good' : 'muted'), ' ', pill(FRESHNESS[x.freshness].word, FRESHNESS[x.freshness].tone), ' ', revisions(x)))) : h('p.tst-muted', {}, 'No run has a result linked here.'),
      ),
    );
  });
  return box;
}

const HEADS = ['Use case', 'Business rules', 'Acceptance criteria', 'Linked tests', 'Coverage', 'Latest result', 'Freshness'];

/** The functional domains: a row per BRD use case, grouped by feature; the criteria tied to none after. */
export function domainsPanel(v: TestingView): HTMLElement {
  const runs = new Map(v.runs.map((r) => [r.id, r]));
  const head = () => h('div.tst-row.tst-row-h', { 'aria-hidden': 'true' }, ...HEADS.map((t) => h('span', {}, t)));
  const parts: HTMLElement[] = [];
  for (const g of v.features) parts.push(h('div.tst-feature', {}, h('h4.tst-feature-h', {}, `${g.id} · ${g.title}`, h('small.tst-from', {}, ` ${g.file}`)), head(), ...g.rows.map((r) => ucRow(r, runs))));
  if (v.unassigned.length) parts.push(h('div.tst-feature', {}, h('h4.tst-feature-h', {}, 'Acceptance criteria tied to no use case'), h('ul.tst-acs', {}, ...v.unassigned.map(acItem))));
  return h('section.tst-card', {}, h('h3.tst-h', {}, 'Functional domains', h('small.tst-hsub', {}, 'declared coverage: a linked passing test does not prove every path ran')), parts.length ? h('div.tst-domains', {}, ...parts) : h('p.tst-empty', {}, 'No BRD use cases on main yet (analysis/knowledge-base/brd/*.brd.json). They show here, grouped by feature, once the analysis stage writes them.'));
}

const linkChip = (l: Link) => h('span.tst-link', { title: l.via }, `${l.target} `, h('small', {}, linkWord(l)));

/** The test runs, newest first: the first ones at once, the rest on asking. */
export function runsPanel(v: TestingView): HTMLElement {
  const FIRST = 15;
  const row = (r: RunSummary) =>
    h(
      'li.tst-run',
      {},
      h('div.tst-run-top', {}, h('strong', {}, r.suite), h('small.tst-from', {}, ` ${SOURCE_WORD[r.source] ?? r.source}${r.branch ? ` · ${r.branch}` : ''}${r.pr ? ` · PR #${r.pr}` : ''}${r.at ? ` · ${when(r.at)}` : ''}`)),
      h('div.tst-run-mid', {}, pill(countLine(r.counts), r.counts.failed ? 'bad' : r.counts.passed ? 'good' : 'muted'), ' ', pill(FRESHNESS[r.freshness].word, FRESHNESS[r.freshness].tone), r.flaky.length ? pill(`Flaky: ${r.flaky.length}`, 'warn', r.flaky.join('\n')) : null),
      revisions(r),
      r.links.length ? h('div.tst-run-links', {}, ...r.links.slice(0, 8).map(linkChip)) : null,
    );
  const list = h('ul.tst-runlist', {}, ...v.runs.slice(0, FIRST).map(row));
  const more =
    v.runs.length > FIRST
      ? h(
          'button.btn.tst-more',
          {
            type: 'button',
            onclick: (e: Event) => {
              list.append(...v.runs.slice(FIRST).map(row));
              (e.currentTarget as HTMLElement).remove();
            },
          },
          `Show ${v.runs.length - FIRST} more`,
        )
      : null;
  return h(
    'section.tst-card',
    {},
    h('h3.tst-h', {}, 'Test runs', h('small.tst-hsub', {}, `${v.totalRuns} recorded${v.totalRuns > v.runs.length ? `, newest ${v.runs.length} shown` : ''}`)),
    v.runs.length ? h('div', {}, list, more) : h('p.tst-empty', {}, 'No test runs recorded yet. They come from pr-checks runs on pull requests, report files under reports/testing/ and docs/report.json, and the office’s own gate-check of main.'),
  );
}
