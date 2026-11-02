// Release 83, P1: release 82's card sweep closed two UNANSWERED decision cards ("its subject is done") because
// they mentioned a commit that got merged: a Lead's Administrator-role decision and the Coordinator's blocking
// question "do old Administrators become Administrators automatically?". A card that asks the Project Manager a
// question or for a decision is never closed by commit or branch facts; only a true merge ask or review request
// whose own subject commit is on main is. Real git in a temp folder, fake roster records; no GitHub, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGit } from '../src/server/gitgraph/index.js';
import { sweepEscalations } from '../src/server/card-sweep/index.js';
import { commitAskOf, holdsDecision, judgeCommitAsk } from '../src/server/card-sweep/rules.js';
import { settledAsks } from '../src/server/local-merge/asks.js';
import type { Escalation } from '../src/shared/roster/escalation.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'user.name=Agent', '-c', 'user.email=a@example.test', ...args], { cwd, encoding: 'utf8' }).trim();
function commit(dir: string, file: string, msg: string): string {
  writeFileSync(path.join(dir, file), `${msg}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

let n = 0;
const esc = (over: Partial<Escalation>): Escalation => ({ id: `e${++n}`, at: 1_000, workerId: 'w-lead', by: 'Blake', role: 'lead-developer', urgency: 'important', fyi: false, level: 2, title: 't', details: '', options: [], status: 'open', ...over }) as Escalation;

test('the real case: two unanswered decision cards that mention a merged commit stay open; the merge ask closes', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r83-sweep-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'a.txt', 'setup');
    git(dir, 'checkout', '-q', '-b', 'office/blake-1');
    const roles = commit(dir, 'b.txt', 'Split the Administrator role');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge the role split', roles);
    const main = git(dir, 'rev-parse', 'HEAD');
    const short = roles.slice(0, 7);
    const all = [
      // The Lead's decision: options, a recommendation, and the commit it builds on (merged).
      esc({
        title: 'Decision: which role keeps user management after the Administrator split?',
        details: `The role split was merged in @${short} (office/blake-1). Before I build the user pages I need your call on who manages users.`,
        options: ['A: Administrator keeps user management', 'B: a new UserManager role'],
        recommendation: 'A, fewer roles to maintain',
        trigger: 'design',
      }),
      // The Coordinator's blocking question, no trigger, mentioning the merge.
      esc({
        workerId: 'w-coord',
        by: 'Casey',
        role: 'project-coordinator',
        urgency: 'urgent',
        title: 'Blocking: do old Administrators become Administrators automatically?',
        details: `After the merge of @${short} the old role is gone. Do existing Administrator accounts move to the new Administrator role automatically, or does someone assign them? The data migration waits on this.`,
      }),
      // A plain merge ask for the same commit: this one is done.
      esc({ title: `Approve merge of @${short} (office/blake-1)`, details: 'Row 7: the role split. Checks passed at that commit.' }),
    ];
    const done = await sweepEscalations(all, dir, runGit, [main], 'main', 9e9);
    assert.deepEqual(
      done.map((s) => s.id),
      [all[2].id],
      'only the merge ask is closed',
    );
    assert.equal(commitAskOf(all[0]), undefined);
    assert.equal(commitAskOf(all[1]), undefined);
    assert.match(holdsDecision(all[0]) ?? '', /design card/);
    assert.match(holdsDecision(all[1]) ?? '', /question|not a merge/);
    // The local merge's settle path (local-merge/asks.ts) closes by the same rule.
    const asks = all.map((e) => commitAskOf(e)).filter((a): a is NonNullable<typeof a> => !!a);
    assert.deepEqual(asks.map((a) => a.id), [all[2].id]);
    assert.deepEqual((await settledAsks(asks, runGit, dir, main, 'main')).map((s) => s.id), [all[2].id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('never swept, whatever commits they mention: decision kinds, proposals, AWAITING-PM, register refs, questions, decision options', () => {
  const sha = 'abc1234def';
  const onMain = { commits: [{ sha: sha.padEnd(40, '0'), onMain: true }], branches: [] };
  const cases: Partial<Escalation>[] = [
    { title: `Merge ${sha}?`, trigger: 'question' },
    { title: `Merge ${sha} then restart the database`, trigger: 'needs-human' },
    { title: `Blocked until ${sha} is merged`, trigger: 'blocked' },
    { title: `Merge ${sha}: changes the plan`, trigger: 'plan' },
    { title: `Merge ${sha} please`, from: { kind: 'proposal', key: 'p1' } },
    { title: `Merge ${sha} please`, from: { kind: 'awaiting', key: 'k1' } },
    { title: `Merge ${sha} please`, refs: { decisionId: 'OW-1' } },
    { title: `Please review ${sha}`, details: 'Also: should the export include archived rows?' },
    { title: `Approve merge of ${sha}`, options: ['Keep the old layout', 'Use the new layout'] },
    { title: 'Which colour for the header?', details: `Built on ${sha}, merged yesterday.` },
  ];
  for (const c of cases) {
    const e = esc(c);
    assert.ok(holdsDecision(e), JSON.stringify(c));
    assert.equal(commitAskOf(e), undefined, JSON.stringify(c));
  }
  // A merge ask whose options only answer the merge is still one, and closes when its commit is on main.
  const ask = esc({ title: `Approve merge of ${sha}`, options: ['Merge now', 'Hold for review'] });
  assert.equal(holdsDecision(ask), undefined);
  assert.equal(judgeCommitAsk(ask, commitAskOf(ask)!, onMain, 'main', 9e9)?.kind, 'commit-on-main');
  // "Can you merge it?" is the merge ask's own question.
  assert.equal(holdsDecision(esc({ title: `Can you merge ${sha}?` })), undefined);
  // A commit mentioned below the first paragraph is not the subject: a review of one branch stays tied to it.
  const later = esc({ title: 'Please review office/blake-2', details: `Ready for review.\n\nIt builds on ${sha}, already merged.` });
  assert.deepEqual(commitAskOf(later), { id: later.id, shas: [], branches: ['office/blake-2'] });
});
