// Release 79, the rebuild run's merge findings: a Developer change's receipt merges the branch that actually
// carries the change (shared/merge-target.ts, server/local-merge/targets.ts), never `dev/DC-n` just by its name
// (a notes-only journal, or a script draft that failed the mxbuild gate and was never applied); a commit an agent
// asked for under a newer journal commit is the one offered; when it isn't clear nothing is picked. Plus the
// refusal words (no git trailer) and the mojibake repair for stored text. Real git in a temp folder, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeTargetsFor } from '../src/server/local-merge/targets.js';
import { settledAsks } from '../src/server/local-merge/asks.js';
import { forgetLocalMerges } from '../src/server/local-merge/index.js';
import { forgetLocalOnly } from '../src/server/local-only.js';
import { runGit } from '../src/server/gitgraph/index.js';
import { gateWords, judge, mergeAskOf, pickTarget, targetKind, type MergeOption } from '../src/shared/merge-target.js';
import { gitReason, refusalWords } from '../src/shared/merge-refusal.js';
import { fixDeep, fixText } from '../src/shared/text-repair.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
const as = (name: string) => ['-c', `user.name=${name}`, '-c', 'user.email=a@agents.mx-office.local'];
function commit(dir: string, who: string, file: string, text: string, msg: string): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '.');
  git(dir, ...as(who), 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

test('what a commit is: model or code applied, a script draft, notes only', () => {
  assert.equal(targetKind(['App.mpr', 'docs/a.md']), 'change');
  assert.equal(targetKind(['mprcontents/x/y.mxunit']), 'change');
  assert.equal(targetKind(['javascriptsource/a.js']), 'change');
  assert.equal(targetKind(['mdlsource/8-close/09-claim.mdl', 'docs/team/analysis.md']), 'script', 'a script that was never applied to the model');
  assert.equal(targetKind(['journal/2026-10-26.md']), 'notes');
  assert.equal(judge({ kind: 'script', checks: [], sha: 'a'.repeat(40) }).ok, false);
  assert.equal(judge({ kind: 'notes', checks: [], sha: 'a'.repeat(40) }).ok, false);
  const failed = judge({ kind: 'change', checks: [{ name: 'mxbuild', verdict: 'failed' }], sha: 'abc1234'.padEnd(40, '0') });
  assert.equal(failed.ok, false);
  assert.match(failed.why ?? '', /gate failed \(✗ mxbuild failed at @abc1234\)/);
  assert.equal(gateWords('abc1234'.padEnd(40, '0'), [{ name: 'smoke', verdict: 'passed' }]).words, '✓ 1 check passed at @abc1234');
});

test('the pick: the asked-for option that may merge, else the only one, else none (the PM chooses)', () => {
  const o = (branch: string, ok: boolean, asked = false): MergeOption => ({ branch, sha: branch.padEnd(40, '0').replace(/[^0-9a-f]/g, 'a'), head: '', subject: '', via: ['named'], kind: ok ? 'change' : 'notes', files: { model: 1, code: 0, notes: 0 }, checks: [], ok, ...(ok ? {} : { why: 'notes only' }), gate: 'no checks', ...(asked ? { asked: { by: 'Carl', at: 1 } } : {}) });
  assert.equal(pickTarget([o('dev/DC-9', false), o('office/carl-1', true)]).pick?.branch, 'office/carl-1', 'the only one that may merge');
  assert.equal(pickTarget([o('office/rhea-2', true), o('office/carl-1', true, true)]).pick?.branch, 'office/carl-1', 'the one an agent asked for');
  const amb = pickTarget([o('office/rhea-2', true), o('office/carl-1', true)]);
  assert.equal(amb.pick, undefined, 'ambiguous: nothing picked by default');
  assert.match(amb.words, /2 branches may carry this change: choose/);
  const none = pickTarget([o('dev/DC-9', false)]);
  assert.equal(none.pick, undefined);
  assert.match(none.words, /Nothing to merge yet: dev\/DC-9 is notes only/);
});

test('a merge ask read from an escalation: the change, the commit, the branch', () => {
  const a = mergeAskOf({ id: 'e1', by: 'Carl', at: 5, title: 'CR-7 / DC-7: approve merge of 3e9a360 (office/carl-c2b8)', details: 'Measured at 390 px in J-05.', options: ['Merge it', 'Wait'] });
  assert.deepEqual(a && { ids: a.ids, shas: a.shas, branches: a.branches }, { ids: ['CR-7', 'DC-7'], shas: ['3e9a360'], branches: ['office/carl-c2b8'] });
  assert.equal(mergeAskOf({ id: 'e2', by: 'Carl', at: 5, title: 'Which layout for DC-10?', details: 'A or B' }), undefined, 'no merge asked');
  assert.equal(mergeAskOf({ id: 'e3', by: 'Carl', at: 5, title: 'Please merge DC-10 when ready', details: 'build 1234567' })?.shas.length ?? 0, 0, 'digits only are a number, not a commit');
});

test('refusal words: which files conflict, never git’s command line or the trailer', () => {
  const raw = 'Command failed: git -c user.name=Mx Office merge --no-ff -m Merge office/carl-1 @53f945a into main (local only)\n\nReviewed at 53f945a00000 by Pat; merged by Pat in Mx Office.\nMx-Office-Local-Merge: office/carl-1@53f945a0000000000000000000000000000000\nCONFLICT (content): Merge conflict in App.mpr\nAutomatic merge failed; fix conflicts and then commit the result.';
  const w = refusalWords('53f945a'.padEnd(40, '0'), 'office/carl-1', 'main', [], raw);
  assert.doesNotMatch(w, /Mx-Office-Local-Merge|Command failed|Reviewed at/);
  assert.match(w, /^Not merged: @53f945a of office\/carl-1 conflicts with main \(CONFLICT \(content\): Merge conflict in App\.mpr\)\. Ask the lead/);
  assert.match(refusalWords('53f945a'.padEnd(40, '0'), 'office/carl-1', 'main', ['App.mpr', 'docs/x.md'], raw), /conflicts with main in 2 files \(App\.mpr, docs\/x\.md\)/);
  assert.equal(gitReason('fatal: refusing to merge unrelated histories'), 'fatal: refusing to merge unrelated histories');
});

test('mojibake repair: UTF-8 read as Windows-1252 is put right, real accents stay', () => {
  assert.equal(fixText('Testing â€º Prepare the test database'), 'Testing › Prepare the test database');
  assert.equal(fixText('still on the sign-in page (â€œThe username or password you entered is incorrect.â€\u009d)'), 'still on the sign-in page (“The username or password you entered is incorrect.”)');
  assert.equal(fixText('donâ€™t'), 'don’t');
  assert.equal(fixText('café in Zürich, naïve résumé'), 'café in Zürich, naïve résumé', 'real accented text is left alone');
  assert.equal(fixText('Ã©tÃ©'), 'été');
  assert.deepEqual(fixDeep({ title: 'Merge â€” now', options: ['A â€º B'], n: 3 }), { title: 'Merge — now', options: ['A › B'], n: 3 });
});

test('merge targets in real git: the lead’s branch, not the notes or script draft on dev/DC-n; the asked-for commit; settled asks', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r79-targets-'));
  try {
    const bare = path.join(dir, '.local-git', 'o', 'app.git');
    mkdirSync(path.dirname(bare), { recursive: true });
    git(dir, 'init', '-q', '--bare', '-b', 'main', bare);
    const floorDir = path.join(dir, 'o', 'app');
    git(dir, 'clone', '-q', bare, floorDir);
    git(floorDir, 'checkout', '-q', '-b', 'main');
    writeFileSync(path.join(floorDir, 'agent-office.project.json'), JSON.stringify({ localOnly: true }));
    commit(floorDir, 'Mx Office', 'App.mpr', 'model v1\n', 'setup');
    git(floorDir, 'push', '-q', '-u', 'origin', 'main');
    const wt = (name: string, branch: string) => {
      const p = path.join(dir, name);
      git(floorDir, 'worktree', 'add', '-q', '-b', branch, p, 'main');
      return p;
    };
    // The coordinator's draft on dev/DC-9: a script and notes, the model itself untouched (never applied).
    const wDraft = wt('wt-draft', 'dev/DC-9');
    commit(wDraft, 'Barbara (Mx Office Chief Analyst)', 'mdlsource/8-close/09-created-on.mdl', 'alter page\n', 'DC-9 draft script');
    commit(wDraft, 'Barbara (Mx Office Chief Analyst)', 'docs/team/analysis.md', '# DC-9\n', 'DC-9 analysis');
    // The lead's work on its own branch: the model changed, DC-9 named only in the subject, then a journal commit on top.
    const wLead = wt('wt-lead', 'office/carl-1cb4');
    const work = commit(wLead, 'Carl (Mx Office Lead Developer)', 'App.mpr', 'model v2: created on\n', 'DC-9: show the created date in the header');
    const journal = commit(wLead, 'Carl (Mx Office Lead Developer)', 'journal/carl.md', '# Journal\n', 'Journal');
    forgetLocalOnly();
    forgetLocalMerges();
    const ctx = { cfg: { dataDir: path.join(dir, 'data') } } as never;
    const floor = { id: 'app', dir: floorDir, workers: { list: () => [] }, github: { pulls: { items: [] } }, def: { repo: 'o/app' } } as never;

    const t = await mergeTargetsFor(ctx, floor, { id: 'DC-9' }, { asks: [] });
    const draft = t.options.find((o) => o.branch === 'dev/DC-9');
    const lead = t.options.find((o) => o.branch === 'office/carl-1cb4');
    assert.ok(draft && lead, JSON.stringify(t.options.map((o) => o.branch)));
    assert.equal(draft!.kind, 'script');
    assert.equal(draft!.ok, false, 'the draft is never offered');
    assert.equal(lead!.ok, true);
    assert.deepEqual(lead!.via, ['named']);
    assert.deepEqual(t.pick, { branch: 'office/carl-1cb4', sha: journal }, 'the only branch with the model work, at its head');

    // The lead asks to merge exactly the work commit (under the journal commit): that commit is offered.
    const ask = mergeAskOf({ id: 'e1', by: 'Carl', at: Date.now(), title: `DC-9: approve merge of ${work.slice(0, 7)} (office/carl-1cb4)`, details: 'Checked as a requester at 390 and 1280 px.' })!;
    const t2 = await mergeTargetsFor(ctx, floor, { id: 'DC-9' }, { asks: [ask] });
    assert.deepEqual(t2.pick, { branch: 'office/carl-1cb4', sha: work });
    assert.deepEqual(t2.options[0].asked?.by, 'Carl');
    assert.match(t2.words, /Carl asked to merge it for this change/);

    // Once that commit is on main, the ask is settled (marked gone for the person to confirm).
    assert.deepEqual(await settledAsks([ask], runGit, floorDir, 'main', 'main'), []);
    git(floorDir, ...as('Mx Office'), 'merge', '-q', '--no-ff', '-m', 'merge', work);
    const done = await settledAsks([ask], runGit, floorDir, 'main', 'main');
    assert.equal(done.length, 1);
    assert.match(done[0].what, new RegExp(`@${work.slice(0, 7)}\\) is on main now`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
