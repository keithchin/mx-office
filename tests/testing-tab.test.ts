// App Insights › Testing, the page side: registered through the Portal tab registry under App Insights
// (not hand-wired into lite.ts), every state a word (colour only repeats it), "unknown" shown plainly,
// coverage, result and freshness in their own columns, and the empty state when a project has nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { installFakeDom } from './support/fakedom.js';
import { registeredTab } from '../src/client/tabs/registry.js';
import '../src/client/tabs/index.js';
import { navGroups } from '../src/client/ui/portal/nav-logic.js';
import { COVERAGE, countLine, FRESHNESS, rev, RESULT, UC_COVERAGE, linkWord } from '../src/client/ui/testing/words.js';
import { buildTestingView } from '../src/shared/testing/view.js';
import { parseAcTable, parseBrd } from '../src/shared/testing/links.js';
import { IMPORTER_VERSION, UNKNOWN } from '../src/shared/testing/record.js';

installFakeDom();
const { header, domainsPanel, planPanel, runsPanel } = await import('../src/client/ui/testing/render.js');

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

test('the Testing tab is registered under App Insights through the tab registry, not in lite.ts', () => {
  const t = registeredTab('testing')!;
  assert.equal(t.group, 'insights');
  assert.equal(t.label, 'Testing');
  assert.ok(!t.admin);
  const insights = navGroups().find((g) => g.id === 'insights')!;
  assert.deepEqual(
    insights.items.map((i) => i.id),
    ['analysis', 'budget', 'audit', 'testing', 'security'],
  );
  assert.doesNotMatch(read('src/client/lite.ts'), /testing/i);
  assert.doesNotMatch(read('src/client/lite.html'), /testing-view|tab-testing/);
  // The page's own code comes in with the first show.
  assert.match(read('src/client/ui/testing/tab.ts'), /import\('\.\/page'\)/);
});

test('every state has its own word; unknown is spelled out', () => {
  for (const words of [COVERAGE, UC_COVERAGE, RESULT, FRESHNESS]) for (const v of Object.values(words)) assert.ok(v.word.length > 2);
  assert.equal(RESULT.none.word, 'No result');
  assert.equal(COVERAGE.none.word, 'No linked test');
  assert.equal(FRESHNESS.unknown.word, 'Revision unknown');
  assert.equal(rev(UNKNOWN), 'unknown');
  assert.equal(rev('0123456789abcdef0123456789abcdef01234567'), '0123456');
  assert.equal(countLine({ passed: 2, failed: 0, skipped: 1 }), '2 passed · 1 skipped');
  assert.equal(linkWord({ basis: 'inferred', rule: 'business rule id in the PR title' }), 'inferred (business rule id in the PR title)');
});

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function view() {
  const brd = parseBrd(JSON.stringify({ id: 'F001', title: 'Travel', useCases: [{ id: 'UC001', title: 'Submit' }, { id: 'UC002', title: 'Export' }] }), 'F001.brd.json')!;
  const acs = parseAcTable('| AC-01 | Submit (UC001) | J-01 |\n| AC-02 | Export (UC002) | later |\n');
  const tests = [{ path: 'tests/e2e/J-01.journey.json', journey: 'J-01', kind: 'journey' as const, links: [] }];
  const runs = [
    { schemaVersion: 1 as const, id: 'tr_1', source: 'report-file' as const, sourceKey: 'k1', suite: 'final-checks', testedRevision: UNKNOWN, definitionRevision: UNKNOWN, evidence: { kind: 'repo-commit' as const, revision: B, locator: `git:${B}:reports/testing/final-checks.json` }, results: [{ name: 'J-01 submit', status: 'passed' as const, links: [{ target: 'J-01', basis: 'inferred' as const, via: 'x', rule: 'journey id in the test name' }] }], links: [], actor: { kind: 'repo' as const, name: 'x' }, importer: IMPORTER_VERSION, ingestedAt: 1 },
  ];
  return buildTestingView('shop', { main: { branch: 'main', sha: A }, brds: [brd], acs, tests, notes: [] }, runs);
}

test('the panels: header counts apart, a criterion with no test shows "No linked test" and "No result", unknown revisions plainly', () => {
  const v = view();
  const head = header(v).textContent;
  assert.match(head, /main at aaaaaaa/);
  assert.match(head, /Stage 6 gate: not known/);
  assert.match(head, /Coverage acceptance criteria1 Linked0 Inferred only1 No linked test/);
  assert.match(head, /Results/);
  assert.match(head, /Freshness/);
  assert.match(head, /Stale/, 'no run has tested main');
  const domains = domainsPanel(v).textContent;
  assert.match(domains, /UC002 Export/);
  assert.match(domains, /Revision unknown/);
  // The second row: coverage none, no result, no run.
  const uc2 = v.features[0].rows[1];
  assert.deepEqual([uc2.coverage, uc2.result, uc2.freshness], ['none', 'none', 'none']);
  const runs = runsPanel(v).textContent;
  assert.match(runs, /Tested app unknown/);
  assert.match(runs, /Tests from unknown/);
  assert.match(runs, /Evidence bbbbbbb/);
});

test('T1: with no plan, BRD or runs each panel says so calmly', () => {
  const empty = buildTestingView('shop', { brds: [], acs: [], tests: [], notes: ['No BRD at analysis/knowledge-base/brd/*.brd.json yet'] }, []);
  assert.match(planPanel(empty, async () => undefined, () => document.createElement('div')).textContent, /No test plan yet/);
  assert.match(domainsPanel(empty).textContent, /No BRD use cases on main yet/);
  assert.match(runsPanel(empty).textContent, /No test runs recorded yet/);
  assert.match(header(empty).textContent, /No main commit yet/);
});
