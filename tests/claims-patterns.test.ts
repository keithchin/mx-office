// The claims check's patterns (shared/claims.ts): what counts as an explicit claim that an MDL script or
// batch was applied, or that tests passed, and what never does (plans, hedges, negations, docs-only
// work, a count with failures). Plus the result files' counts and the .gitignore matcher it uses
// (server/claims/results.ts), the card and the tell (server/claims/card.ts), and the build rows a
// mismatch takes off "on main". Neutral, synthetic examples only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allPassClaimed, appliedClaim, buildLogClaim, buildLogClaims, claimedRows, claimsIn, claimsTell, askedOf, keysOf, logTime, passClaim, plansOrNegates, scriptsIn, suitesIn, type ClaimMismatch } from '../src/shared/claims.js';
import { ignoreRules, isIgnored, resultCounts, resultName } from '../src/server/claims/results.js';
import { claimsItem, distinct, linksFrom } from '../src/server/claims/card.js';
import { buildMeasures, buildSummary, withClaimed } from '../src/shared/build-progress.js';
import { actMessage } from '../src/server/asks/detect.js';
import { askCandidates } from '../src/shared/decisions/candidates.js';

// ---- Applied claims -------------------------------------------------------------------------------------

test('explicit applied claims name an MDL script or batch: commit subjects, journal lines, the toolkit’s own commits', () => {
  const yes: [string, 'subject' | 'journal', string[]][] = [
    ['applied mdlsource/3-orders/06-orders-page.mdl', 'subject', ['06-orders-page']],
    ['applied 07c: invoice layout, totals row', 'subject', ['07c']],
    ['Apply 10f: drop the orphan flows, queue subtitle', 'subject', ['10f']],
    ['applied: ./bin/exec.sh --patch mdlsource/3-orders/07b-apply.sh', 'subject', ['07b-apply', '07b']],
    ['applied 01-frame (date pattern)', 'subject', ['01-frame']],
    ['Row 16: orders page applied (06-orders-page.mdl)', 'subject', ['06-orders-page']],
    ['Batch 10f applied and proven on the local app.', 'journal', ['10f']],
    ['✅ applied 02-domain.mdl, mxbuild clean', 'journal', ['02-domain']],
  ];
  for (const [s, src, keys] of yes) {
    const c = appliedClaim(s, src);
    assert.ok(c, `a claim: ${s}`);
    for (const k of keys) assert.ok(c!.keys.includes(k), `${s} → ${k} (got ${c!.keys})`);
  }
  assert.deepEqual(appliedClaim('Row 16: orders page applied (06-orders-page.mdl)', 'subject')!.rows, [16]);
});

test('plans, hedges, negations and drafts are never claims', () => {
  const no = [
    'Will apply 10f after the review',
    '10f is not applied yet',
    'Next: apply 07c-invoice.mdl',
    'Draft 07c-invoice.mdl (to be applied once the domain lands)',
    "07c hasn't been applied",
    '06-orders-page.mdl applied? pending the gate',
    'Could not apply 07c: CE0117, rolled back',
    'Applied should be 07c after the merge',
    '07c-invoice.mdl reverted, needs to be re-applied',
    'Journal: 07c applied on the branch',
  ];
  for (const s of no) assert.equal(appliedClaim(s, s.startsWith('Journal') ? 'subject' : 'journal'), undefined, s);
  assert.ok(plansOrNegates('Drafts 10e: queue layout'));
});

test('docs-only work and toolkit scripts are not model claims: no MDL script or batch named', () => {
  for (const s of ['BUILD-LOG pointer applied', 'review findings applied to the BRD', 'bin/check-design.sh applied by hand', 'theme fixes applied', 'Row 31: coherence pass applied to docs/evidence-summary.md', 'tests/orders.test.mdl applied']) assert.equal(appliedClaim(s, 'subject'), undefined, s);
  assert.deepEqual(scriptsIn('ran 12h ago'), { keys: [] }, 'an hour count is no batch');
  assert.deepEqual(keysOf('mdlsource/2-domain/02-domain.mdl'), ['02-domain']);
  assert.deepEqual(keysOf('patch: 10f-apply.sh'.replace(/^patch:\s*/, '')), ['10f-apply', '10f']);
});

test('a BUILD-LOG gated row is a claim only when its result says applied, with the run’s own time', () => {
  const ok = buildLogClaim('| 2026-10-16T15:45:28+0800 | `06-orders-page.mdl` | pass | ⚠️ applied, LINT ROSE | mxbuild clean · approval: auto |');
  assert.ok(ok);
  assert.equal(ok!.at, Date.parse('2026-10-16T07:45:28Z'));
  assert.equal(ok!.zoned, true);
  assert.deepEqual(ok!.keys, ['06-orders-page']);
  assert.ok(buildLogClaim('| 2026-10-18T09:55:07+0800 | `patch: 10f-apply.sh` | pass | ✅ applied | clean |')!.keys.includes('10f'));
  for (const l of ['| 2026-10-16T15:45:41+0800 | `06-orders-page.mdl` | not-run | 🚫 blocked | uncommitted model changes |', '| 2026-10-16T19:45:24+0800 | `06-orders-page.mdl` | fail | ❌ gate failed | 2 error(s) — script rolled back |', '2026-10-16T03:42:54Z  SOURCE-WAIVED legacy/a.txt reason: no requirement'])
    assert.equal(buildLogClaim(l), undefined, l);
  assert.equal(logTime('2026-10-16T15:45:28')!.zoned, false);
  assert.equal(logTime('2026-10-16 15:45:28+08:00')!.at, Date.parse('2026-10-16T07:45:28Z'));
  const notes = buildLogClaims(['### 2026-10-16 — Row 14 (seed proof), by OQL', 'order-submit: 12/12 passed on the local app']);
  assert.deepEqual(notes.map((c) => c.kind), ['pass'], 'a note’s PASS counts; a "### date — Row N" heading is no claim');
});

// ---- PASS claims ----------------------------------------------------------------------------------------

test('all-pass claims: counts with no failures, "all … pass", a named suite’s PASS', () => {
  for (const s of ['| order-submit, order-refused | PASS 35/0/0 and 13/13 |', 'journeys 7/7', 'order-submit 12/12 passed', '35 passed, 0 failed', 'All journeys pass on main', 'all 12 tests passed', 'T-ORDER PASS', 'order-submit: PASS']) assert.ok(allPassClaimed(s), s);
  for (const s of ['PASS 21/14', '6/8 passed', 'journeys 5/7', 'coherence pass (24/27 coherent)', 'Stage 3-4 gates pass', 'the walk passed by the queue', '21 passed, 14 failed']) assert.equal(allPassClaimed(s), false, s);
  assert.equal(passClaim('order-submit will PASS once 07c lands', 'journal'), undefined, 'a plan');
  assert.equal(passClaim('order-submit did not PASS 12/12', 'journal'), undefined, 'a negation');
  const c = passClaim('| order-submit, order-refused | PASS 35/0/0 (run in tests/e2e/artifacts/run-3/) |', 'evidence')!;
  assert.ok(c.suites!.includes('order-submit') && c.suites!.includes('order-refused'));
  assert.deepEqual(c.paths, ['tests/e2e/artifacts/run-3/']);
  assert.deepEqual(suitesIn('J-01..J-03 walked: J-01 PASS').suites.includes('J-01'), true);
});

test('claimsIn reads each sentence: an applied claim and a PASS claim in one text, nothing from a copied gated row', () => {
  const cs = claimsIn('Applied 07c-invoice.mdl on the local app. order-submit 12/12 passed.\n| 2026-10-16T15:45:28+0800 | `07c-invoice.mdl` | pass | ✅ applied | x |', 'journal');
  assert.deepEqual(cs.map((c) => c.kind), ['applied', 'pass']);
});

// ---- Result files and .gitignore ------------------------------------------------------------------------

test('result files: the journey runner’s and checks scripts’ JSON, JUnit XML, a report page, runners’ summaries', () => {
  const journey = JSON.stringify({ capturedAt: '2026-10-18T01:24:10Z', results: [...Array(21)].map((_, i) => ({ name: `step ${i}`, verdict: 'PASS' })).concat([...Array(14)].map((_, i) => ({ name: `bad ${i}`, verdict: 'FAIL' }))) });
  assert.deepEqual(resultCounts('docs/verification/order-submit.json', journey), { passed: 21, failed: 14 });
  assert.deepEqual(resultCounts('reports/testing/a.xml', '<testsuite name="s"><testcase name="a"/><testcase name="b"><failure message="x"/></testcase></testsuite>'), { passed: 1, failed: 1 });
  assert.deepEqual(resultCounts('docs/verification/report.html', '<p><b>69 passed</b> · 6 failed · 24 did not run</p>'), { passed: 69, failed: 6 });
  assert.deepEqual(resultCounts('out/jest.json', JSON.stringify({ numPassedTests: 5, numFailedTests: 0 })), { passed: 5, failed: 0 });
  assert.equal(resultCounts('tests/e2e/order-submit.journey.json', JSON.stringify({ steps: [{ go: '/' }] })), undefined);
  assert.equal(resultName('reports/testing/order-submit-findings.json'), 'order-submit');
  assert.equal(resultName('TEST-order-submit.xml'), 'order-submit');
});

test('.gitignore: anchored and unanchored rules, folders, globs, negation', () => {
  const rules = ignoreRules('# build\n/deployment/\ntests/e2e/artifacts/\n*.mpr.bak\nlogs/\n!logs/keep.txt\n/**/node_modules/\n');
  assert.ok(isIgnored(rules, 'tests/e2e/artifacts/run-3/order-submit.json'));
  assert.ok(isIgnored(rules, 'tests/e2e/artifacts/'));
  assert.ok(isIgnored(rules, 'deployment/web/x.css'));
  assert.ok(!isIgnored(rules, 'src/deployment/x'), 'an anchored rule is the root’s');
  assert.ok(isIgnored(rules, 'a/b/App.mpr.bak'));
  assert.ok(isIgnored(rules, 'pkg/node_modules/x.js'));
  assert.ok(isIgnored(rules, 'logs/keep.txt'), 'a file under an ignored folder can’t be re-included');
  assert.ok(!isIgnored(rules, 'reports/testing/order-submit.json'));
});

// ---- The card, the tell, the build rows -----------------------------------------------------------------

const mismatch = (over: Partial<ClaimMismatch> = {}): ClaimMismatch => ({
  id: 'm1',
  verdict: 'branch-only',
  claim: { kind: 'applied', source: 'build-log', text: '07c-invoice.mdl ✅ applied', keys: ['07c-invoice', '07c'], rows: [12] },
  commit: 'a'.repeat(40),
  subject: 'Journal: invoice batch',
  who: 'Ada',
  place: 'main',
  onMain: true,
  pr: 4,
  holder: { branch: 'office/ada-1234', commit: 'b'.repeat(40), subject: 'Model after batch 07c' },
  at: Date.parse('2026-10-16T08:00:00Z'),
  ...over,
});

test('one card per project: each mismatch with its links, who made it, Ask <agent> to fix and Hide', () => {
  const links = linksFrom('https://github.com/example-org/orders-app/pull/4');
  const item = claimsItem([mismatch(), mismatch({ id: 'm2', verdict: 'failing', holder: undefined, claim: { kind: 'pass', source: 'evidence', text: 'order-submit PASS 35/0/0', keys: [], rows: [], suites: ['order-submit'] }, result: { file: 'docs/verification/order-submit.json', commit: 'c'.repeat(40), failed: 14, passed: 21 }, who: 'Ben' })], links)!;
  assert.equal(item.kind, 'claims');
  assert.equal(item.level, 'warn');
  assert.match(item.text, /^2 claims git doesn’t back: Ada, applied on office\/ada-1234, not on main \(and 1 more\)$/);
  assert.deepEqual(item.acts, [{ act: 'ask-lead', label: 'Ask Ada and Ben to fix' }, { act: 'seen', label: 'Hide' }]);
  assert.match(item.lines![0], /Ada: “07c-invoice\.mdl ✅ applied” \(commit aaaaaaa \(https:\/\/github\.com\/example-org\/orders-app\/commit\/a{40}\), PR #4 .* applied on office\/ada-1234 .* not on main; the model change is commit bbbbbbb/);
  assert.match(item.lines![0], /Fix: merge the commit holding the model \(bbbbbbb on office\/ada-1234\) into main .* re-run the journeys/);
  assert.match(item.lines![1], /claim says PASS; committed result shows 14 failed \(docs\/verification\/order-submit\.json at ccccccc: 21 passed, 14 failed\)/);
  assert.ok(item.evidence!.some((e) => e.where === 'https://github.com/example-org/orders-app/blob/' + 'c'.repeat(40) + '/docs/verification/order-submit.json'));
  const tell = actMessage('ask-lead', item, 'Pat')!;
  assert.match(tell, /^The Project Manager asks Ada and Ben to fix claims that git doesn't back/);
  assert.match(tell, /1\. Ada: .*Fix: merge the commit holding the model/);
  assert.match(tell, /claimed \(unverified\)/);
  assert.equal(askedOf('Ask Ada to fix'), 'Ada');
  assert.match(claimsTell('Ada', ['x']), /1\. x/);
  // Its decision card carries the links as evidence.
  const cand = askCandidates({ floor: 'f1', items: [item] }, 'f1')[0];
  assert.ok(cand.body.evidence.length >= 4);
  // The same id while the set is the same; a new mismatch is a new card (Hide doesn't hide it).
  assert.equal(claimsItem([mismatch()])!.id, claimsItem([mismatch()])!.id);
  assert.notEqual(claimsItem([mismatch()])!.id, claimsItem([mismatch(), mismatch({ id: 'm3', commit: 'd'.repeat(40) })])!.id);
  assert.equal(claimsItem([]), undefined);
  assert.equal(distinct([mismatch(), mismatch({ id: 'dup', claim: { ...mismatch().claim, text: 'Apply 07c' } })]).length, 1, 'the same gap said twice in one commit is one line');
  assert.equal(claimsItem([mismatch({ onMain: false, place: 'office/ada-1234' })])!.level, 'info');
});

test('a mismatch’s rows read "claimed, not evidenced", never built on main', () => {
  assert.deepEqual(claimedRows([mismatch(), mismatch({ onMain: false, claim: { ...mismatch().claim, rows: [13] } })]), [12]);
  const rows = withClaimed({ main: [10, 11, 12], branch: [], mentioned: [] }, [12]);
  assert.deepEqual(rows, { main: [10, 11], branch: [], mentioned: [], claimed: [12] });
  const e = { branch: 'main', merged: [], open: [], plan: { total: 20, built: 0, partial: 0, blocked: 0 }, rows };
  assert.match(buildSummary(e), /2 of 20 build-plan rows with build evidence on main \(rows 10–11\), 1 claimed, not evidenced \(row 12\)/);
  assert.ok(buildMeasures(e).includes('Rows claimed, not evidenced on main (the claims check): 12'));
  assert.deepEqual(withClaimed({ main: [1], branch: [], mentioned: [] }, []), { main: [1], branch: [], mentioned: [] });
});
