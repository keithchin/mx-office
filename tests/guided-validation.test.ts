// C5 of the App Workspace proposal: guided validation and accept.
//   - a scenario's result is bound to the version shown: a result on another version is never this version's,
//     only a note ("passed on an earlier version"); an unknown tested revision counts for none
//   - the scenarios come from the journeys at that version, their steps in the journey's own words, Try it's start
//   - a mark (works / wrong) is recorded per project and version and audited; it's only for the version served now
//   - "Something's wrong" makes a correction through the change requests' path (a task id), linked to the
//     scenario and version; refused there, nothing is kept
//   - who may mark is who may ask for a change: signed in, from the office's own page
//   - an acceptance refusal (the existing path's words) said in business words, never engineering ones
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { checksAt, correctionText, plainCaption, resultsAt, scenarioSummary, scenarioView, startOf, stepWords, summaryLine, type FindingRecord } from '../src/shared/guided-validation.js';
import { scriptOf } from '../src/shared/walkthroughs/script.js';
import { requestTitle } from '../src/shared/change-requests.js';
import { ValidationBook, type ValidationDeps } from '../src/server/guided-validation/store.js';
import { guidedValidationRoutes } from '../src/server/http/routes/guided-validation.js';
import { requestHandler } from '../src/server/http/router.js';
import { plainRefusal } from '../src/shared/app-workspace/acceptance-words.js';
import { gateRefusal } from '../src/shared/security.js';
import { CYCLE_MOVED, NO_REVIEW, STALE_REVIEW } from '../src/server/acceptance/index.js';
import { AUDIT_GROUPS } from '../src/shared/audit.js';
import type { TestRunRecord } from '../src/shared/testing/record.js';
import type { AuditInput } from '../src/shared/audit.js';
import { removeDir } from './support/cleanup.js';

const A = '7d3f0b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // the version on screen
const OLD = '5e21c9daaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // an earlier one
const TASK = 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ0';

let n = 0;
function run(revision: string, results: { name: string; status: 'passed' | 'failed' | 'skipped' }[], suite = 'journeys', at = ++n): TestRunRecord {
  return {
    schemaVersion: 1,
    id: `tr_${at}`,
    source: 'report-file',
    sourceKey: `k${at}`,
    suite,
    testedRevision: revision,
    definitionRevision: revision,
    evidence: { kind: 'office', revision, locator: 'office:x' },
    results: results.map((r) => ({ ...r, links: [] })),
    links: [],
    actor: { kind: 'office', name: 'office' },
    importer: 'test',
    ingestedAt: at,
  };
}

// ---- Results bound to the version ------------------------------------------------------------------------

test('a scenario’s result is the one at exactly the version shown; an earlier version’s result is only a note', () => {
  const records = [
    run(OLD, [{ name: 'J-01', status: 'passed' }, { name: 'J-02', status: 'passed' }]),
    run(A, [{ name: 'J-02', status: 'failed' }]),
    run('unknown', [{ name: 'J-03', status: 'passed' }]),
    run(A.slice(0, 7), [{ name: 'J-04', status: 'passed' }]),
  ];
  const r = resultsAt(records, A, ['J-01', 'J-02', 'J-03', 'J-04']);
  const def = (id: string) => ({ id, title: id, steps: [] });
  const j1 = scenarioView(def('J-01'), r, []);
  assert.equal(j1.result, 'not-run', 'passed on the earlier version: not this one’s');
  assert.deepEqual(j1.earlier, { status: 'passed', revision: OLD }, 'told only as a note');
  const j2 = scenarioView(def('J-02'), r, []);
  assert.equal(j2.result, 'failed', 'this version’s own result wins over an earlier pass');
  assert.equal(j2.earlier, undefined, 'no note once it ran on this version');
  const j3 = scenarioView(def('J-03'), r, []);
  assert.equal(j3.result, 'not-run');
  assert.equal(j3.earlier, undefined, 'a run that didn’t say what it tested counts for no version');
  assert.equal(scenarioView(def('J-04'), r, []).result, 'passed', 'a short form of the same version is the same version');
  // The newest record of the version wins.
  const later = resultsAt([...records, run(A, [{ name: 'J-02', status: 'passed' }])], A, ['J-02']);
  assert.equal(later.at.get('J-02'), 'passed');
  // A suite named for one journey, with one result, names it.
  assert.equal(resultsAt([run(A, [{ name: 'main flow', status: 'passed' }], 'journey J-09')], A, ['J-09']).at.get('J-09'), 'passed');
});

test('the other automatic checks are counted at that version only, scenarios left out', () => {
  const records = [run(A, [{ name: 'unit a', status: 'passed' }, { name: 'unit b', status: 'failed' }, { name: 'J-01', status: 'passed' }, { name: 'unit c', status: 'skipped' }], 'mxcli test'), run(OLD, [{ name: 'unit d', status: 'passed' }], 'mxcli test')];
  assert.deepEqual(checksAt(records, A, ['J-01']), { passed: 1, failed: 1, skipped: 1 });
});

test('a mark at this version shows on its scenario; one at another version doesn’t', () => {
  const mark = (o: Partial<FindingRecord>): FindingRecord => ({ id: 'GV-1', revision: A, scenario: 'J-01', title: 'Sign in', verdict: 'works', by: 'Alex', at: 1, ...o });
  const r = resultsAt([], A, ['J-01']);
  const v = scenarioView({ id: 'J-01', title: 'Sign in', steps: [] }, r, [mark({}), mark({ id: 'GV-2', verdict: 'wrong', at: 2 }), mark({ id: 'GV-3', scenario: 'J-02', at: 3 })]);
  assert.equal(v.finding?.id, 'GV-2', 'the newest mark of this scenario');
  assert.equal(v.marks, 2);
  const s = scenarioSummary([v, scenarioView({ id: 'J-02', title: 'x', steps: [] }, resultsAt([run(A, [{ name: 'J-02', status: 'passed' }])], A, ['J-02']), [])]);
  assert.deepEqual(s, { total: 2, passed: 1, failed: 0, notRun: 1, works: 0, wrong: 1, unmarked: 1 });
  assert.equal(summaryLine(s), '1 of 2 passed, 1 not run on this version; 1 with something wrong');
  assert.equal(summaryLine(scenarioSummary([])), 'No guided checks are written for this version yet');
});

test('steps in the journey’s own words, and where Try it opens', () => {
  const journey = JSON.stringify({ id: 'J-01', title: 'Reception signs a visitor in', steps: [{ name: 'Open the visitor list', goto: '/p/Visitors' }, { actions: [{ do: 'click', widget: 'btnSignInVisitor' }] }, { name: 'The visitor shows as waiting', expectText: 'Waiting' }] });
  const s = scriptOf('tests/e2e/sign-in.journey.json', journey);
  assert.ok(typeof s !== 'string');
  assert.deepEqual(stepWords(s.steps), ['Open the visitor list', 'Click Sign in visitor', 'The visitor shows as waiting']);
  assert.deepEqual(startOf(s.steps), { path: '/p/Visitors' });
  const nav = scriptOf('j.journey.json', JSON.stringify({ id: 'J-2', steps: [{ actions: [{ do: 'nav', group: 'Visitors', item: 'Today' }] }] }));
  assert.ok(typeof nav !== 'string');
  assert.deepEqual(startOf(nav.steps), { words: 'Open Visitors › Today' });
  assert.equal(plainCaption('Type “Sam” into txtVisitorName'), 'Type “Sam” into Visitor name');
  assert.equal(startOf(scriptOf('k.journey.json', JSON.stringify({ id: 'k', steps: [{ goto: '//evil.test/x' }] })) as never), undefined, 'never another site');
});

// ---- Marks: recorded, audited, only for the version served now ---------------------------------------------

function harness(o: { served?: string; refuse?: string } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-gv-'));
  const audits: AuditInput[] = [];
  const asked: Parameters<ValidationDeps['correct']>[1][] = [];
  const deps: ValidationDeps = {
    dataDir,
    now: () => Date.UTC(2026, 9, 23, 10),
    served: () => ('served' in o ? o.served : A),
    scenarios: async (_f, rev) => (rev === A ? [{ id: 'J-01', title: 'Reception signs a visitor in' }] : []),
    async correct(_f, ask) {
      asked.push(ask);
      return o.refuse ?? { id: 'CR-7', taskId: TASK };
    },
    record: (e) => audits.push(e),
  };
  return { book: new ValidationBook(deps), deps, audits, asked, dataDir, done: () => removeDir(dataDir) };
}

test('“Works as expected” is kept with its project and version, audited, and read back after a restart', async () => {
  const x = harness();
  try {
    const r = await x.book.mark('shop', { revision: A, scenario: 'J-01', verdict: 'works', note: 'Fine', page: '/p/Visitors', by: 'Alex Lee', owner: 'acc_1' });
    assert.ok(r.ok);
    assert.equal(r.finding.id, 'GV-1');
    assert.equal(r.finding.revision, A);
    assert.equal(r.finding.page, '/p/Visitors');
    assert.equal(r.finding.correction, undefined, 'a working mark makes no correction');
    assert.equal(x.asked.length, 0);
    assert.equal(x.audits.length, 1);
    const e = x.audits[0];
    assert.equal(e.action, 'validation.mark');
    assert.equal(e.floor, 'shop');
    assert.deepEqual(e.actor, { kind: 'human', name: 'Alex Lee', id: 'acc_1' });
    assert.equal((e.details as { verdict: string }).verdict, 'works');
    assert.ok(AUDIT_GROUPS.delivery.prefixes.some((p) => e.action.startsWith(p)), 'filed with acceptance in the audit log');
    const file = JSON.parse(readFileSync(path.join(x.dataDir, 'guided-validation', 'shop.json'), 'utf8'));
    assert.equal(file.items.length, 1);
    const again = new ValidationBook(x.deps);
    assert.equal(again.at('shop', A).length, 1, 'kept on disk');
    assert.equal(again.at('shop', OLD).length, 0, 'per version');
  } finally {
    x.done();
  }
});

test('“Something’s wrong” becomes a correction through the change requests’ path: a task id, linked to the scenario and version', async () => {
  const x = harness();
  try {
    const r = await x.book.mark('shop', { revision: A, scenario: 'J-01', verdict: 'wrong', note: 'The host’s name is missing on the badge', page: '/p/Badge', pageMoved: true, by: 'Alex Lee' });
    assert.ok(r.ok);
    assert.deepEqual(r.finding.correction, { id: 'CR-7', taskId: TASK });
    assert.equal(x.asked.length, 1);
    assert.equal(x.asked[0].revision, A, 'the request carries the version');
    assert.equal(x.asked[0].page, '/p/Badge');
    assert.equal(x.asked[0].pageMoved, true);
    assert.equal(x.asked[0].text, correctionText('Reception signs a visitor in', 'J-01', A, 'The host’s name is missing on the badge'));
    assert.match(x.asked[0].text, /"Reception signs a visitor in" \(J-01\) on version 7d3f0b1: The host’s name is missing/);
    assert.equal(requestTitle(x.asked[0].text), 'The host’s name is missing on the badge', 'the request is titled by the person’s note, not a generic “Something’s wrong…”');
    assert.equal(requestTitle(correctionText('T', 'J-02', A, 'Badge prints blank\nOnly on the second printer')), 'Badge prints blank', 'its first line');
    assert.equal(x.audits[0].ids?.taskId, TASK, 'audited with the task id');
    assert.deepEqual(x.book.corrections('shop').map((c) => c.correction?.id), ['CR-7']);
  } finally {
    x.done();
  }
});

test('a mark is refused, with nothing kept or audited: another version on screen, no app, no note, unknown check, or the correction refused', async () => {
  const cases: [ReturnType<typeof harness>, Parameters<ValidationBook['mark']>[1], number, RegExp][] = [
    [harness({ served: OLD }), { revision: A, scenario: 'J-01', verdict: 'works', by: 'A' }, 409, /moved on to another version/],
    [harness({ served: undefined }), { revision: A, scenario: 'J-01', verdict: 'works', by: 'A' }, 409, /isn’t running/],
    [harness(), { revision: A, scenario: 'J-01', verdict: 'wrong', note: '', by: 'A' }, 400, /Say what went wrong/],
    [harness(), { revision: A, scenario: 'J-99', verdict: 'works', by: 'A' }, 400, /isn’t part of this version/],
    [harness(), { revision: 'main', scenario: 'J-01', verdict: 'works', by: 'A' }, 400, /which version/],
    [harness(), { revision: A, scenario: 'J-01', verdict: 'maybe', by: 'A' }, 400, /works as expected/],
    [harness({ refuse: 'No team lead is at work on this project yet' }), { revision: A, scenario: 'J-01', verdict: 'wrong', note: 'Broken badge', by: 'A' }, 400, /No team lead/],
  ];
  for (const [x, ask, status, why] of cases) {
    try {
      const r = await x.book.mark('shop', ask);
      assert.ok(!r.ok);
      assert.equal(r.status, status, String(why));
      assert.match(r.error, why);
      assert.equal(x.book.at('shop', A).length, 0, 'nothing kept');
      assert.equal(x.audits.length, 0, 'nothing audited');
    } finally {
      x.done();
    }
  }
});

// ---- Who may mark ------------------------------------------------------------------------------------------

function call(route: { handle: unknown; path: string }, o: { origin?: string; body: unknown }): Promise<number> {
  const headers: Record<string, string> = { host: 'office.test', 'content-type': 'application/json', ...(o.origin ? { origin: o.origin } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(o.body))]), { method: 'POST', headers });
  let status = 0;
  const res = { writeHead: (s: number) => ((status = s), res), end: () => undefined, headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: false }), floors: new Map() };
  return Promise.resolve((route.handle as (c: unknown, r: unknown) => unknown)(ctx, { req, res, url: new URL(`http://office.test${route.path}`), path: route.path, session: {} })).then(() => status);
}

test('who may mark is who may ask for a change: signed in, from the office’s own page', async () => {
  assert.equal(guidedValidationRoutes.mark.auth, 'session');
  assert.equal(guidedValidationRoutes.view.auth, 'session');
  assert.equal(await call(guidedValidationRoutes.mark, { origin: 'https://evil.test', body: { floor: 'shop' } }), 403);
  assert.equal(await call(guidedValidationRoutes.mark, { body: { floor: 'shop' } }), 403, 'a script with no Origin');
  assert.equal(await call(guidedValidationRoutes.mark, { origin: 'http://office.test', body: { floor: 'shop' } }), 404, 'a member from the office’s page gets past the check');
  const handler = requestHandler({ cfg: { port: 4999 }, auth: { fromAnyCookie: () => false, fromRequest: () => undefined }, services: { lookup: () => undefined } } as never, [guidedValidationRoutes.view, guidedValidationRoutes.mark]);
  for (const [method, url] of [['GET', `/api/guided-validation?floor=shop&revision=${A}`], ['POST', '/api/guided-validation/mark']]) {
    let status = 0;
    const res = { writeHead: (s: number) => ((status = s), res), end: () => undefined, headersSent: false, setHeader: () => undefined };
    await handler({ method, url, headers: { host: 'office.test' } } as never, res as never);
    assert.equal(status, 401, method);
  }
});

// ---- Acceptance refusals, said plainly ----------------------------------------------------------------------

test('a refusal from the existing acceptance path is said plainly', () => {
  const sec = gateRefusal({ commit: A, missing: ['No mx check at 7d3f0b1', 'Anonymous users are on'], meets: false, enforced: true } as never, 'Accepting this delivery') + ' The office has started an mx check at 7d3f0b1 (it takes a few minutes): try again when it has finished.';
  const p = plainRefusal(409, sec);
  assert.match(p.lead, /security checks haven’t passed/);
  assert.deepEqual(p.reasons, ['No mx check at 7d3f0b1', 'Anonymous users are on', 'The office has started the security check. It takes a few minutes: try again when it has finished.']);
  assert.equal(p.again, true);
  assert.match(plainRefusal(409, STALE_REVIEW).lead, /Something changed while you were looking/);
  assert.match(plainRefusal(409, NO_REVIEW).lead, /Something changed/);
  assert.match(plainRefusal(409, CYCLE_MOVED).lead, /accepted or reopened this meanwhile/);
  assert.match(plainRefusal(403, 'Only the Project Manager (an admin) can accept or reopen a delivery').lead, /Only the Project Manager/);
  assert.match(plainRefusal(409, 'v1 is already accepted: reopen it to start the next version').lead, /already accepted/);
  assert.match(plainRefusal(409, 'The delivery commit could not be read. Commit the delivery and reopen the acceptance dialog').lead, /couldn’t read the version/);
  assert.equal(plainRefusal(409, 'Something about a merge on the branch').lead, 'Something about a merge on the branch.', 'the server’s own words, as they are');
  assert.match(plainRefusal(409, '').lead, /Project Management’s acceptance record says why/);
});

// ---- The scenarios of one version, read from the project's folder ---------------------------------------------

test('the scenarios are the journeys as they are at the version shown, with results of exactly that version', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { validationAt } = await import('../src/server/guided-validation/scenarios.js');
  const { testingStore } = await import('../src/server/testing/index.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-gv-repo-'));
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-gv-data-'));
  try {
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    g('init', '-q');
    mkdirSync(path.join(dir, 'tests', 'e2e'), { recursive: true });
    const j = (id: string, title: string) => JSON.stringify({ id, title, steps: [{ name: 'Open the list', goto: '/p/List' }] });
    writeFileSync(path.join(dir, 'tests', 'e2e', 'a.journey.json'), j('J-01', 'Sign a visitor in'));
    writeFileSync(path.join(dir, 'tests', 'e2e', 'broken.journey.json'), j('skeleton-broken', 'x'));
    g('add', '.');
    g('commit', '-qm', 'first');
    const first = g('rev-parse', 'HEAD');
    writeFileSync(path.join(dir, 'tests', 'e2e', 'b.journey.json'), j('J-02', 'Print a badge'));
    g('add', '.');
    g('commit', '-qm', 'second');
    const second = g('rev-parse', 'HEAD');
    await testingStore(dataDir, 'shop').ingest([
      { ...run(first, [{ name: 'J-01', status: 'passed' }]), sourceKey: 's1' },
      { ...run(second, [{ name: 'J-02', status: 'failed' }]), sourceKey: 's2' },
    ].map(({ id: _i, ingestedAt: _a, schemaVersion: _s, ...d }) => d));
    const v1 = await validationAt({ dataDir, floorId: 'shop', dir, revision: first, marks: [], corrections: [] });
    assert.deepEqual(v1.scenarios.map((s) => [s.id, s.result]), [['J-01', 'passed']], 'only the journeys of that version; the broken control left out');
    assert.deepEqual(v1.scenarios[0].steps, ['Open the list']);
    assert.deepEqual(v1.scenarios[0].start, { path: '/p/List' });
    const v2 = await validationAt({ dataDir, floorId: 'shop', dir, revision: second, marks: [], corrections: [] });
    assert.deepEqual(v2.scenarios.map((s) => [s.id, s.result, s.earlier?.status]), [['J-01', 'not-run', 'passed'], ['J-02', 'failed', undefined]], 'J-01 passed on the first version only: a note here, never this version’s pass');
    const none = await validationAt({ dataDir, floorId: 'shop', dir, revision: 'abcdef1234567', marks: [], corrections: [] });
    assert.equal(none.scenarios.length, 0);
    assert.match(none.note ?? '', /can’t read this version/);
  } finally {
    removeDir(dir);
    removeDir(dataDir);
  }
});
