// The claims check against real git (server/claims/): synthetic projects in temp folders, an "origin" the
// agents push to and the office's clone that fetches it, as the office reads a project. A BUILD-LOG row
// saying applied with no model commit behind it is flagged; a model change only on an unmerged branch is
// flagged with the commit that holds it, and clears once merged (or once a merged PR brought it); a PASS
// claim against a committed failing result is flagged, as is evidence only in a git-ignored folder; a
// claim the commits back, and plans or negations, flag nothing. The tasks closed on a flagged claim stay
// claimed (unverified). Local temp repos only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GhPull } from '../src/shared/protocol.js';
import { readSnapshot } from '../src/server/claims/repo.js';
import { checkSnapshot, claimsCheck } from '../src/server/claims/check.js';
import { markClaimTasks } from '../src/server/claims/index.js';
import { taskStateOf, countsAsDelivered } from '../src/server/roster/task-verify.js';
import type { Assignment } from '../src/server/roster/resume.js';

const NOW = Date.now();
const H = 3_600_000;
const T0 = NOW - 48 * H;

const run = (dir: string, args: string[], env: Record<string, string> = {}) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env } }).trim();
const who = (name: string, at: number) => {
  const date = `@${Math.floor(at / 1000)} +0000`;
  return { GIT_AUTHOR_NAME: `${name} (Mx Office Lead Developer)`, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@agents.mx-office.local`, GIT_COMMITTER_NAME: 'Mx Office', GIT_COMMITTER_EMAIL: 'office@example.test', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
};
const iso = (at: number) => new Date(at).toISOString().replace(/\.\d+Z$/, '+0000');
const row = (at: number, script: string, result = '✅ applied') => `| ${iso(at)} | \`${script}\` | pass | ${result} | mxbuild clean · approval: auto |\n`;

interface Project {
  origin: string;
  work: string;
  floor: string;
}

function project(t: { after(fn: () => void): void }): Project {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claims-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const floor = path.join(root, 'floor');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  run(work, ['remote', 'add', 'origin', origin]);
  write(work, '.gitignore', 'tests/e2e/artifacts/\n/deployment/\n');
  write(work, 'docs/BUILD-LOG.md', '# Build log\n\n| when | script | gate | result | detail |\n|---|---|---|---|---|\n');
  write(work, 'App.mpr', 'model v0');
  write(work, 'mprcontents/aa/unit.mxunit', 'unit v0');
  commitAll(work, 'Start the app', who('Ada', T0 - 20 * H));
  run(work, ['push', '-q', 'origin', 'main']);
  execFileSync('git', ['clone', '-q', origin, floor]);
  return { origin, work, floor };
}

function write(dir: string, file: string, text: string) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
}
function append(dir: string, file: string, text: string) {
  appendFileSync(path.join(dir, file), text);
}
function commitAll(dir: string, msg: string, env: Record<string, string>): string {
  run(dir, ['add', '-A'], env);
  run(dir, ['commit', '-qm', msg], env);
  return run(dir, ['rev-parse', 'HEAD']);
}

/** Pushes `branches` from the agents' clone and fetches them into the office's, then checks. */
async function check(p: Project, branches: string[] = ['main'], pulls: GhPull[] = []) {
  for (const b of branches) run(p.work, ['push', '-q', '-f', 'origin', b]);
  run(p.floor, ['fetch', '-q', '--prune', 'origin']);
  const sha = run(p.floor, ['rev-parse', 'origin/main']);
  const s = await readSnapshot(p.floor, { branch: 'main', sha }, NOW);
  assert.ok(s, 'the snapshot reads');
  return checkSnapshot(s!, pulls, NOW);
}

test('a BUILD-LOG row says applied, but no commit with model files backs it anywhere: claimed applied, no model change', async (t) => {
  const p = project(t);
  append(p.work, 'docs/BUILD-LOG.md', row(T0, '07c-invoice.mdl'));
  write(p.work, 'mdlsource/3-invoice/07c-invoice.mdl', 'create page ...');
  const c = commitAll(p.work, 'Row 12: invoice page applied', who('Ada', T0 + H));
  const ms = await check(p);
  assert.equal(ms.length, 1, JSON.stringify(ms.map((m) => [m.verdict, m.claim.text])));
  assert.equal(ms[0].verdict, 'no-model');
  assert.equal(ms[0].commit, c);
  assert.equal(ms[0].who, 'Ada');
  assert.equal(ms[0].onMain, true);
  assert.deepEqual(ms[0].claim.rows, [12], 'the subject’s row goes with the gated row about the same script');
});

test('the model change is only on an unmerged branch: flagged with the commit that holds it; merged later, it clears', async (t) => {
  const p = project(t);
  // The agent applied 07c on its branch and committed the model there; its journal with the BUILD-LOG row reached main on its own.
  run(p.work, ['checkout', '-q', '-b', 'office/ada-1234']);
  write(p.work, 'App.mpr', 'model v1 (07c)');
  write(p.work, 'mprcontents/aa/unit.mxunit', 'unit v1');
  const model = commitAll(p.work, 'Model after batch 07c (invoice page)', who('Ada', T0 + 2 * H));
  run(p.work, ['checkout', '-q', 'main']);
  append(p.work, 'docs/BUILD-LOG.md', row(T0, 'patch: 07c-apply.sh', '⚠️ applied, LINT ROSE'));
  write(p.work, 'mdlsource/3-invoice/07c-apply.sh', '#!/bin/sh');
  const claim = commitAll(p.work, 'Apply 07c: invoice page, totals row', who('Ada', T0 + 3 * H));
  let ms = await check(p, ['main', 'office/ada-1234']);
  assert.equal(ms.length, 1, JSON.stringify(ms.map((m) => [m.verdict, m.claim.text])));
  assert.equal(ms[0].verdict, 'branch-only');
  assert.equal(ms[0].commit, claim);
  assert.deepEqual(ms[0].holder, { branch: 'office/ada-1234', commit: model, subject: 'Model after batch 07c (invoice page)' });
  // Through the cached entry point too, and then merged: the card clears.
  const sha = run(p.floor, ['rev-parse', 'origin/main']);
  assert.equal((await claimsCheck(p.floor, { branch: 'main', sha }, [], NOW))!.length, 1);
  run(p.work, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #5 from example/office/ada-1234', 'office/ada-1234'], who('Ada', T0 + 4 * H));
  ms = await check(p, ['main', 'office/ada-1234']);
  assert.deepEqual(ms, []);
  const after = run(p.floor, ['rev-parse', 'origin/main']);
  assert.deepEqual(await claimsCheck(p.floor, { branch: 'main', sha: after }, [], NOW), []);
});

test('a merged PR from the holding branch (a squash) counts as arrived: nothing flagged', async (t) => {
  const p = project(t);
  run(p.work, ['checkout', '-q', '-b', 'office/ada-77']);
  write(p.work, 'App.mpr', 'model v1');
  commitAll(p.work, 'applied mdlsource/3-invoice/07d-totals.mdl', who('Ada', T0 + H));
  run(p.work, ['checkout', '-q', 'main']);
  append(p.work, 'docs/BUILD-LOG.md', row(T0, '07d-totals.mdl'));
  commitAll(p.work, 'Journal: totals', who('Ada', T0 + 2 * H));
  const pull = { number: 7, title: 'Totals', state: 'MERGED', headRefName: 'office/ada-77', mergedAt: new Date(T0 + 5 * H).toISOString(), createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0 + 5 * H).toISOString(), body: '', url: 'https://github.com/example-org/orders-app/pull/7' } as GhPull;
  assert.equal((await check(p, ['main', 'office/ada-77'])).length, 1, 'without the PR list: flagged');
  assert.deepEqual(await check(p, ['main', 'office/ada-77'], [pull]), []);
});

test('a PASS claim against a committed result that shows failures is flagged; committing a passing result clears it', async (t) => {
  const p = project(t);
  const results = (pass: number, fail: number) => JSON.stringify({ capturedAt: iso(T0), results: [...Array(pass)].map((_, i) => ({ name: `ok ${i}`, verdict: 'PASS' })).concat([...Array(fail)].map((_, i) => ({ name: `bad ${i}`, verdict: 'FAIL' }))) });
  write(p.work, 'docs/verification/regression/order-submit.json', results(21, 14));
  const res = commitAll(p.work, 'Regression run results', who('Ben', T0 + H));
  write(p.work, 'tests/evidence-summary.md', '# Evidence\n\n| Check | Result |\n|---|---|\n| order-submit, order-refused | PASS 35/0/0 and 13/13 |\n');
  const claim = commitAll(p.work, 'Evidence summary updated', who('Ben', T0 + 2 * H));
  let ms = await check(p);
  assert.equal(ms.length, 1, JSON.stringify(ms.map((m) => [m.verdict, m.claim.text])));
  assert.equal(ms[0].verdict, 'failing');
  assert.equal(ms[0].commit, claim);
  assert.equal(ms[0].who, 'Ben');
  assert.deepEqual(ms[0].result, { file: 'docs/verification/regression/order-submit.json', commit: res, failed: 14, passed: 21 });
  write(p.work, 'docs/verification/regression/order-submit.json', results(35, 0));
  commitAll(p.work, 'Regression re-run on main: passing', who('Ben', T0 + 3 * H));
  ms = await check(p);
  assert.deepEqual(ms, []);
});

test('evidence only in a git-ignored folder: evidence not committed', async (t) => {
  const p = project(t);
  write(p.work, 'docs/team/testing.md', '# Testing journal\n\n## 2026-10-16\norder-refused 9/9 passed (tests/e2e/artifacts/run-3/order-refused.json).\n');
  commitAll(p.work, 'Journal: order-refused run', who('Cleo', T0 + H));
  const ms = await check(p);
  assert.equal(ms.length, 1, JSON.stringify(ms.map((m) => [m.verdict, m.claim.text])));
  assert.equal(ms[0].verdict, 'not-committed');
  assert.equal(ms[0].ignored, 'tests/e2e/artifacts/run-3/order-refused.json');
  assert.equal(ms[0].claim.source, 'journal');
});

test('a claim the commits back flags nothing: the toolkit’s model commit, then the journal with its BUILD-LOG row', async (t) => {
  const p = project(t);
  write(p.work, 'App.mpr', 'model v1');
  write(p.work, 'mprcontents/bb/unit.mxunit', 'unit v1');
  commitAll(p.work, 'applied mdlsource/2-domain/02-domain.mdl', who('Ada', T0 + 10 * 60_000));
  append(p.work, 'docs/BUILD-LOG.md', row(T0, '02-domain.mdl'));
  write(p.work, 'docs/team/development.md', '# Development journal\n\n02-domain.mdl applied, mxbuild clean.\n');
  commitAll(p.work, 'Row 7: domain applied; journal', who('Ada', T0 + H));
  // A merged PR whose own commits hold the model backs its title's claim too.
  run(p.work, ['checkout', '-q', '-b', 'office/ada-9']);
  write(p.work, 'App.mpr', 'model v2');
  commitAll(p.work, 'invoice page model', who('Ada', T0 + 2 * H));
  run(p.work, ['checkout', '-q', 'main']);
  run(p.work, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #9 from example/office/ada-9', 'office/ada-9'], who('Ada', T0 + 3 * H));
  const merge = run(p.work, ['rev-parse', 'HEAD']);
  const pull = { number: 9, title: 'Row 12: 07c-invoice.mdl applied', state: 'MERGED', headRefName: 'office/ada-9', mergeCommit: merge, mergedAt: new Date(T0 + 3 * H).toISOString(), createdAt: new Date(T0 + H).toISOString(), updatedAt: new Date(T0 + 3 * H).toISOString(), body: 'Opened by Ada (Lead Developer) via Mx Office', url: 'https://github.com/example-org/orders-app/pull/9' } as GhPull;
  assert.deepEqual(await check(p, ['main'], [pull]), []);
});

test('plans, negations and docs-only work flag nothing', async (t) => {
  const p = project(t);
  write(p.work, 'docs/team/development.md', ['# Development journal', '', 'Will apply 08a-reports.mdl next, after the review.', '08b-export.mdl is not applied yet: the gate failed.', 'Draft 08c-charts.mdl ready to be applied once 08b lands.', 'Review findings applied to the BRD.', 'order-submit will PASS 12/12 once 08b lands.', ''].join('\n'));
  commitAll(p.work, 'Journal: reports plan', who('Ada', T0 + H));
  write(p.work, 'mdlsource/4-reports/08d-filters.mdl', 'create ...');
  commitAll(p.work, 'Drafts 08d: report filters (to be applied)', who('Ada', T0 + 2 * H));
  append(p.work, 'docs/BUILD-LOG.md', row(T0 + 3 * H, '08b-export.mdl', '❌ gate failed').replace('| pass |', '| fail |'));
  commitAll(p.work, 'Journal: 08b gate failed', who('Ada', T0 + 4 * H));
  assert.deepEqual(await check(p), []);
});

test('a task closed on a flagged claim stays claimed (unverified), never delivered; once backed, the mark goes', () => {
  const task = (over: Partial<Assignment>): Assignment => ({ text: 'Build the invoice page', at: T0, doneAt: T0 + H, outcome: 'delivered', doneWhy: 'issue closed', ...over }) as Assignment;
  const a = task({ pr: 4 });
  const b = task({ taskId: 'tsk_01ABC', outcome: 'integrated', pr: 8 });
  const c = task({ pr: 99 });
  const m = { id: 'x', verdict: 'branch-only' as const, claim: { kind: 'applied' as const, source: 'build-log' as const, text: '07c ✅ applied', keys: ['07c'], rows: [] }, commit: 'a'.repeat(40), subject: 's', who: 'Ada', place: 'main', onMain: true, pr: 4, holder: { branch: 'office/ada-1', commit: 'b'.repeat(40), subject: 'Model' }, at: T0 };
  assert.equal(markClaimTasks([a, b, c], [m, { ...m, id: 'y', pr: undefined, tasks: ['tsk_01ABC'] }], NOW), true);
  assert.equal(taskStateOf(a), 'claim-unverified');
  assert.equal(countsAsDelivered(a), false);
  assert.equal(taskStateOf(b), 'claim-unverified');
  assert.equal(taskStateOf(c), 'delivered');
  assert.match(a.doneWhy!, /\(claimed, unverified\)$/);
  assert.equal(markClaimTasks([a, b, c], [m, { ...m, id: 'y', pr: undefined, tasks: ['tsk_01ABC'] }], NOW), false, 'marked once');
  assert.equal(markClaimTasks([a, b, c], [], NOW), true);
  assert.equal(taskStateOf(a), 'delivered');
  assert.equal(a.doneWhy, 'issue closed');
});
