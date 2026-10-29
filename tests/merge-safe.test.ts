// Merge-safe (server/local-merge/, the rebuild test's merge panel findings): the PM's local merge takes exactly the
// reviewed commit even while the branch moves on, refuses a commit that's gone, rewritten, on main or conflicting,
// shows what a branch is (its DC and the request's title; notes only), gives the confirm step's facts, answers an
// Approve with the row as it is now, tells the team "main is now @M", carries main in a Developer change's
// hand-over, and stays admin-only and audited. Real git with a local bare origin, fake agents, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bookOf, confirmLocal, forgetLocalMerges, localMergeView, mergeLocal, reviewLocal } from '../src/server/local-merge/index.js';
import { forgetLocalOnly } from '../src/server/local-only.js';
import { devChangesOf } from '../src/server/dev-changes/index.js';
import { testingStore } from '../src/server/testing/index.js';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { localMergeRoutes } from '../src/server/http/routes/local-merge.js';
import { classify, mainNowWords, mergeStateWords, mergingWords } from '../src/shared/local-merge.js';
import { requestTaskText } from '../src/shared/change-requests.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
const as = (name: string) => ['-c', `user.name=${name}`, '-c', 'user.email=a@agents.mx-office.local'];

function commit(dir: string, who: string, file: string, text: string, msg: string): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '.');
  git(dir, ...as(who), 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

test('merge-safe: the reviewed commit while the head moves, refusals, DC labels, notes, confirm facts, Approve row, main-is-now, audit', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-safe-'));
  const data = path.join(dir, 'data');
  useAudit(new AuditLog(path.join(data, 'audit')));
  try {
    const bare = path.join(dir, '.local-git', 'o', 'app.git');
    mkdirSync(path.dirname(bare), { recursive: true });
    git(dir, 'init', '-q', '--bare', '-b', 'main', bare);
    const floorDir = path.join(dir, 'o', 'app');
    git(dir, 'clone', '-q', bare, floorDir);
    git(floorDir, 'checkout', '-q', '-b', 'main');
    writeFileSync(path.join(floorDir, 'agent-office.project.json'), JSON.stringify({ localOnly: true }));
    commit(floorDir, 'Mx Office', 'README.md', 'app\n', 'setup');
    git(floorDir, 'push', '-q', '-u', 'origin', 'main');
    const wt = (name: string, branch: string) => {
      const p = path.join(dir, name);
      git(floorDir, 'worktree', 'add', '-q', '-b', branch, p, 'main');
      return p;
    };
    // dev/DC-3 (Rhea's worktree): the change; Carl's office branch carries DC-4 by its hand-over; Barbara's is journal only.
    const wDc3 = wt('wt-dc3', 'dev/DC-3');
    const a1 = commit(wDc3, 'Rhea (Mx Office Developer)', 'src/page.js', 'caption = "+ New claim"\n', 'DC-3: rename the button');
    const wCarl = wt('wt-carl', 'office/carl-1');
    commit(wCarl, 'Carl (Mx Office Lead Developer)', 'mdlsource/pages.mdl', 'page P1\n', 'Phase 2 pages');
    const wNotes = wt('wt-barbara', 'office/barbara-2');
    const n1 = commit(wNotes, 'Barbara (Mx Office Chief Analyst)', 'journal/2026-10-26.md', '# Journal\nrelay of DC-3 merge escalation\n', 'Journal: relay of DC-3 merge escalation');
    commit(wNotes, 'Barbara (Mx Office Chief Analyst)', 'docs/notes.md', '# Notes\n', 'Notes');
    const wConf = wt('wt-conf', 'office/conf-1');
    const c1 = commit(wConf, 'Carl (Mx Office Lead Developer)', 'README.md', 'app, the branch way\n', 'Reword the readme');
    const wRw = wt('wt-rw', 'office/rw-1');
    const r1 = commit(wRw, 'Carl (Mx Office Lead Developer)', 'src/a.js', 'a\n', 'R1');

    forgetLocalOnly();
    forgetLocalMerges();
    const ctx = { cfg: { dataDir: data } } as never;
    const workers = [
      { id: 'w-rhea', name: 'Rhea', kind: 'agent', status: 'working', color: '#888', worktree: { branch: 'dev/DC-3', path: wDc3 } },
      { id: 'w-carl', name: 'Carl', kind: 'agent', status: 'working', color: '#888', worktree: { branch: 'office/carl-1', path: wCarl } },
    ];
    const floor = { id: 'app', dir: floorDir, workers: { list: () => workers, get: (id: string) => workers.find((w) => w.id === id) }, github: { pulls: { items: [] } }, def: { repo: 'o/app' } } as never;
    // The DC records: DC-3 by its branch, DC-4 handed to Carl's worker.
    const { store } = devChangesOf(ctx);
    await store.create('app', { id: 'DC-3', text: 'Rename the button to + New claim\nAbout: My claims', by: 'Pat Morgan', at: 1, source: { kind: 'unknown' } });
    await store.create('app', { id: 'DC-4', text: 'Show the claim total in the list', by: 'Pat Morgan', at: 2, source: { kind: 'unknown' } });
    await store.event('app', 'DC-4', { type: 'activated', at: 3, requestId: 'CR-4', taskId: 'tk-4', member: 'Carl', role: 'lead-dev', workerId: 'w-carl', delivery: 'sent' });
    // A check and a journey recorded at exactly a1.
    const run = (suite: string, results: { name: string; status: 'passed' | 'failed' }[], key: string) => ({ source: 'report-file', sourceKey: key, suite, testedRevision: a1, definitionRevision: a1, evidence: { kind: 'office', revision: a1, locator: 'office:x' }, results: results.map((r) => ({ ...r, links: [] })), links: [], actor: { kind: 'office', name: 'office' }, importer: 'test' });
    await testingStore(data, 'app').ingest([run('unit tests', [{ name: 'caption', status: 'passed' }], 'k1'), run('journeys', [{ name: 'J-01 Create a claim', status: 'passed' }], 'k2')] as never);

    // ---- What a branch is: DC labels and notes only ----
    let v = await localMergeView(ctx, floor);
    const row = (b: string) => v.branches.find((x) => x.branch === b)!;
    assert.deepEqual(row('dev/DC-3').dcs, [{ id: 'DC-3', title: 'Rename the button to + New claim' }], 'dev/DC-n with the request’s title (the About line left out)');
    assert.equal(row('dev/DC-3').owner, 'Rhea');
    assert.deepEqual(row('office/carl-1').dcs, [{ id: 'DC-4', title: 'Show the claim total in the list' }], 'the change handed to its worker');
    assert.equal(row('office/carl-1').files.model, 1);
    assert.equal(row('office/barbara-2').kind, 'notes');
    assert.equal(row('office/barbara-2').dcs, undefined, 'a subject that mentions DC-3 is not DC-3');
    assert.equal(row('dev/DC-3').kind, 'change');
    assert.ok(v.mainSha && v.mainSha.length === 40);

    // ---- Approve answers with the row as it is now (no second look) ----
    const pat = { name: 'Pat Morgan', id: 'u1' };
    const ap = await reviewLocal(ctx, floor, { branch: 'dev/DC-3', sha: a1, verdict: 'approve' }, pat);
    assert.ok(ap.ok && ap.branch, JSON.stringify(ap));
    assert.equal(ap.branch!.review?.sha, a1);
    assert.match(mergeStateWords(ap.branch!), /^approved @[0-9a-f]{7} by Pat Morgan: ready to merge @/);

    // ---- The head moves on after the review: Merge still takes exactly a1 ----
    const a2 = commit(wDc3, 'Rhea (Mx Office Developer)', 'src/page.js', 'caption = "+ New claim (WIP)"\n', 'DC-3: WIP not reviewed');
    v = await localMergeView(ctx, floor);
    assert.equal(row('dev/DC-3').sha, a2);
    assert.equal(row('dev/DC-3').review?.sha, a1, 'the review of an older commit still on the branch stands');
    assert.equal(row('dev/DC-3').newer, 1);
    assert.match(mergeStateWords(row('dev/DC-3')), /ready to merge @[0-9a-f]{7} · 1 newer commit not reviewed/);

    // ---- The confirm step's facts ----
    const cf = await confirmLocal(ctx, floor, 'dev/DC-3', a1.slice(0, 7));
    assert.ok(cf.ok, JSON.stringify(cf));
    const c = (cf as { confirm: import('../src/shared/local-merge.js').LocalMergeConfirm }).confirm;
    assert.equal(c.sha, a1);
    assert.equal(c.subject, 'DC-3: rename the button');
    assert.equal(c.newer, 1);
    assert.equal(c.head, a2);
    assert.deepEqual(c.dcs.map((d) => d.id), ['DC-3']);
    assert.deepEqual(c.files, { model: 0, code: 1, notes: 0 });
    assert.deepEqual(c.paths, ['src/page.js']);
    assert.deepEqual(c.checks, [{ name: 'unit tests', verdict: 'passed' }]);
    assert.deepEqual(c.journeys, [{ name: 'J-01', verdict: 'passed' }]);
    assert.equal(c.dataImpact.status, 'none', 'no model change: no data impact');
    assert.equal(c.review?.verdict, 'approve');

    // ---- Refusals: unreviewed, missing, rewritten, conflicting ----
    const pull = (x: unknown) => (x as { error: string }).error;
    assert.match(pull(await mergeLocal(ctx, floor, { branch: 'dev/DC-3', sha: a2 }, pat)), /has no review/, 'the newer commit has no review');
    assert.match(pull(await mergeLocal(ctx, floor, { branch: 'dev/DC-3', sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, pat)), /doesn't exist in the project/);
    assert.equal((await reviewLocal(ctx, floor, { branch: 'office/rw-1', sha: r1, verdict: 'approve' }, pat)).ok, true);
    git(wRw, 'reset', '-q', '--hard', 'main');
    commit(wRw, 'Carl (Mx Office Lead Developer)', 'src/b.js', 'b\n', 'R2 (rewritten)');
    assert.match(pull(await mergeLocal(ctx, floor, { branch: 'office/rw-1', sha: r1 }, pat)), /no longer on office\/rw-1/);
    assert.equal((await reviewLocal(ctx, floor, { branch: 'office/conf-1', sha: c1, verdict: 'approve' }, pat)).ok, true);
    commit(floorDir, 'Mx Office', 'README.md', 'app, the main way\n', 'main moves');
    git(floorDir, 'push', '-q', 'origin', 'main');
    git(floorDir, 'fetch', '-q', 'origin');
    const conflict = pull(await mergeLocal(ctx, floor, { branch: 'office/conf-1', sha: c1 }, pat));
    assert.match(conflict, /conflicts with main in 1 file \(README\.md\)/, 'which files conflict, in words');
    assert.doesNotMatch(conflict, /Mx-Office-Local-Merge|Command failed|Reviewed at/, 'never git’s command line or the merge trailer');
    assert.equal(git(bare, 'log', '-1', '--format=%s', 'main'), 'main moves', 'a refusal changes nothing');

    // ---- The merge: exactly a1, --no-ff, as the office; a2 stays on the branch; the team is told ----
    git(floorDir, 'checkout', '-q', '--detach');
    const told: { id: string; text: string }[] = [];
    const ok = await mergeLocal(ctx, floor, { branch: 'dev/DC-3', sha: a1 }, pat, { deliver: (id, text) => (told.push({ id, text }), undefined) });
    assert.ok(ok.ok, JSON.stringify(ok));
    const done = ok as import('../src/shared/local-merge.js').LocalMergeDone;
    assert.equal(done.sha, a1);
    assert.equal(done.newer, 1);
    assert.equal(done.words, `Merged @${a1.slice(0, 7)} (reviewed). The branch has 1 newer commit, not included.`);
    assert.equal(git(bare, 'rev-parse', 'main'), done.merge);
    const parents = git(bare, 'rev-list', '--parents', '-n', '1', done.merge).split(' ');
    assert.equal(parents.length, 3, '--no-ff: a merge commit');
    assert.equal(parents[2], a1, 'its second parent is the reviewed commit, not the head');
    assert.throws(() => git(bare, 'merge-base', '--is-ancestor', a2, 'main'), 'the unreviewed commit is not on main');
    assert.equal(git(bare, 'log', '-1', '--format=%cn|%an', done.merge), 'Mx Office|Mx Office');
    assert.match(git(bare, 'log', '-1', '--format=%B', done.merge), /1 newer commit on dev\/DC-3 .* not included/);
    assert.equal(git(floorDir, 'rev-parse', 'main'), done.merge, 'the local main follows too (fast-forward), not only origin/main');
    assert.deepEqual(told.map((t) => t.id), ['w-rhea'], 'the branch’s own worker (no team lead in this project)');
    assert.deepEqual(done.told, ['Rhea']);
    assert.match(told[0].text, new RegExp(`^main is now @${done.merge.slice(0, 7)} \\(merged DC-3\\)\\.`));
    assert.match(told[0].text, /1 newer commit on dev\/DC-3 .* not merged: it needs a new review/);
    assert.match(told[0].text, /git fetch origin/);
    assert.match(pull(await mergeLocal(ctx, floor, { branch: 'dev/DC-3', sha: a1 }, pat)), /on main already/);

    // ---- Notes only: merged as notes, its kind stated ----
    const nHead = git(wNotes, 'rev-parse', 'HEAD');
    assert.equal((await reviewLocal(ctx, floor, { branch: 'office/barbara-2', sha: nHead, verdict: 'approve' }, pat)).ok, true);
    const cn = await confirmLocal(ctx, floor, 'office/barbara-2', nHead);
    assert.equal((cn as { confirm: { kind: string } }).confirm.kind, 'notes');
    const nm = await mergeLocal(ctx, floor, { branch: 'office/barbara-2', sha: nHead }, pat, { deliver: () => undefined });
    assert.ok(nm.ok);
    assert.match(git(bare, 'log', '-1', '--format=%s', (nm as { merge: string }).merge), /^Merge office\/barbara-2 @[0-9a-f]{7} into main \(notes only\)/);
    assert.ok(n1);

    // ---- Audited, with the reviewed commit, the head and what stayed out ----
    const ev = readAudit({ floor: 'app' }).events;
    const merges = ev.filter((e) => e.action === 'local-merge.merge');
    assert.equal(merges.length, 2);
    const m3 = merges.find((e) => e.target?.id === 'dev/DC-3')!;
    assert.equal((m3.details as { sha: string }).sha, a1);
    assert.equal((m3.details as { newer: number }).newer, 1);
    assert.deepEqual((m3.details as { told: string[] }).told, ['Rhea']);
    assert.equal((merges.find((e) => e.target?.id === 'office/barbara-2')!.details as { kind: string }).kind, 'notes');
    assert.ok(ev.some((e) => e.action === 'local-merge.review' && /at [0-9a-f]{7}/.test(e.summary)));
    assert.equal(bookOf(data, 'app').merges.length, 2);
  } finally {
    useAudit(undefined);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('merge-safe routes: confirm, review and merge are the Project Manager’s (admins) only', async () => {
  const ctx = { cfg: { dataDir: tmpdir(), trustProxy: false }, meOf: () => ({ admin: false }), floors: new Map([['app', { id: 'app', dir: tmpdir() }]]) } as never;
  const res = () => {
    const r = { status: 0, body: '', writeHead(s: number) { r.status = s; }, end(b: string) { r.body = b; } };
    return r;
  };
  const req = { method: 'POST', headers: { host: 'localhost:4700', origin: 'http://localhost:4700' } } as never;
  const session = { account: { id: 'u2', name: 'Sam' } };
  for (const route of [localMergeRoutes.review, localMergeRoutes.merge]) {
    const r = res();
    await route.handle(ctx, { req, res: r, session, url: new URL('http://localhost:4700/') } as never);
    assert.equal(r.status, 403, route.path);
    assert.match(r.body, /Only the Project Manager/);
  }
  const r = res();
  await localMergeRoutes.confirm.handle(ctx, { req: { method: 'GET', headers: {} }, res: r, session, url: new URL('http://localhost:4700/api/local-merge/confirm?floor=app&branch=x&sha=abcdef1') } as never);
  assert.equal(r.status, 403);
});

test('merge-safe words: merging, notes, main-is-now, and the hand-over carries main', () => {
  assert.equal(mergingWords('3d6ca6b0000', 2), 'Merging @3d6ca6b (reviewed). The branch has 2 newer commits, not included.');
  assert.equal(mergingWords('3d6ca6b0000', 0), 'Merging @3d6ca6b (reviewed).');
  assert.deepEqual(classify(['journal/a.md', 'docs/x.png']), { files: { model: 0, code: 0, notes: 2 }, kind: 'notes' });
  assert.equal(classify(['App.mpr', 'docs/x.md']).kind, 'change');
  assert.equal(classify(['mprcontents/ab/cd/x.mxunit']).files.model, 1);
  assert.equal(classify([]).kind, 'change', 'no files: not offered as notes');
  const t = mainNowWords({ main: 'main', merge: 'abcdef1234', branch: 'dev/DC-8', sha: '1234567aaa', dcs: [{ id: 'DC-8', title: 'x' }], newer: 0, reviewedBy: 'Pat' });
  assert.match(t, /^main is now @abcdef1 \(merged DC-8\)\./);
  assert.doesNotMatch(t, /newer/);
  const task = requestTaskText({ id: 'CR-9', text: 'Rename the button', by: 'Pat', main: 'f00dfeed1234567890', change: { id: 'DC-9', source: { kind: 'main', sha: 'f00dfeed1234567890' } } });
  assert.match(task, /^main: f00dfeed1234 \(main when this was handed over: `git fetch origin` and compare with origin\/main/m);
  assert.doesNotMatch(requestTaskText({ id: 'CR-9', text: 'Rename the button', by: 'Pat' }), /^main: /m);
});
