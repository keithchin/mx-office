// Release 82, team flow #2: stale cards close by themselves with the reason recorded (server/card-sweep/): a merge
// ask or review request whose commit is on main, one about an agent branch that's gone, an office-filed chat card
// the Project Manager answered on another card; and the chat-to-card detection no longer files status sentences.
// Real git in a temp folder, fake roster records; no GitHub, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGit } from '../src/server/gitgraph/index.js';
import { sweepEscalations, autoResolve } from '../src/server/card-sweep/index.js';
import { answeredElsewhere, BRANCH_GRACE_MS, commitAskOf, judgeCommitAsk } from '../src/server/card-sweep/rules.js';
import { realAsk } from '../src/server/roster/jeff-ask.js';
import type { Escalation } from '../src/shared/roster/escalation.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'user.name=Agent', '-c', 'user.email=a@example.test', ...args], { cwd, encoding: 'utf8' }).trim();
function commit(dir: string, file: string, msg: string): string {
  writeFileSync(path.join(dir, file), `${msg}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

let n = 0;
const esc = (over: Partial<Escalation>): Escalation => ({ id: `e${++n}`, at: 1_000, workerId: 'w-dev', by: 'Blake', role: 'lead-developer', urgency: 'important', fyi: false, level: 2, title: 't', details: '', options: [], status: 'open', ...over }) as Escalation;

test('merge asks and review requests whose commit is on main are closed; one still off main stays', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r82-sweep-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'a.txt', 'setup');
    git(dir, 'checkout', '-q', '-b', 'office/blake-1');
    const merged = commit(dir, 'b.txt', 'Row 12: form page');
    const pending = commit(dir, 'c.txt', 'Row 13: list page');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge row 12', merged);
    const main = git(dir, 'rev-parse', 'HEAD');
    const all = [
      esc({ title: `Approve merge of ${merged.slice(0, 12)} (office/blake-1)` }),
      esc({ title: `Please review ${merged.slice(0, 12)}` }),
      esc({ title: `Approve merge of ${pending.slice(0, 12)}` }),
      esc({ title: 'Merge office/gone-branch please', at: 0 }),
      esc({ title: 'Merge office/gone-branch please (new)', at: 10 * 60_000 }),
      esc({ title: 'Is the copy on the form right?' }),
    ];
    const done = await sweepEscalations(all, dir, runGit, [main], 'main', 35 * 60_000);
    const ids = new Map(done.map((s) => [s.id, s]));
    assert.equal(ids.get(all[0].id)?.kind, 'commit-on-main');
    assert.match(ids.get(all[0].id)!.reason, /is on main now/);
    assert.equal(ids.get(all[1].id)?.kind, 'commit-on-main', 'a review request counts too');
    assert.equal(ids.has(all[2].id), false, 'its commit is not on main yet');
    assert.equal(ids.get(all[3].id)?.kind, 'branch-gone');
    assert.equal(ids.has(all[4].id), false, 'inside the grace period');
    assert.equal(ids.has(all[5].id), false, 'not about a commit');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the rules: paths are never branches; permission cards and Still-needed cards stay; grace for branches', () => {
  assert.equal(commitAskOf(esc({ title: 'Please review docs/team/journal.md' })), undefined);
  assert.equal(commitAskOf(esc({ title: 'Approve merge of abc1234', permission: { command: 'x', rule: 'Bash(x)', count: 1, lastAt: 0 } })), undefined);
  const e = esc({ title: 'Approve merge of abc1234', sourceGone: { at: 1, what: 'x', asked: 2 } });
  assert.equal(judgeCommitAsk(e, commitAskOf(e)!, { commits: [{ sha: 'abc1234'.padEnd(40, '0'), onMain: true }], branches: [] }, 'main', 9e9), undefined, 'the person said it is still needed');
  const b = esc({ title: 'Merge office/x-1', at: 0 });
  assert.equal(judgeCommitAsk(b, commitAskOf(b)!, { commits: [], branches: [{ name: 'office/x-1', exists: false }] }, 'main', BRANCH_GRACE_MS - 1), undefined);
  assert.equal(judgeCommitAsk(b, commitAskOf(b)!, { commits: [], branches: [{ name: 'office/x-1', exists: true }] }, 'main', BRANCH_GRACE_MS * 2), undefined);
});

test('a chat card answered on a later card from the same agent closes; an unanswered one stays', () => {
  const chat = esc({ title: 'From the chat: Should I start rows 14 to 16 next?', at: 100 });
  const other = esc({ title: 'From the chat: Which theme colour for the header?', at: 100 });
  const answered = esc({ title: 'Start rows 14 to 16 next?', at: 200, status: 'resolved', resolution: { verdict: 'approve', text: 'yes', by: 'Pat', at: 300, delivered: true } });
  const out = answeredElsewhere([chat, other, answered]);
  assert.deepEqual(out.map((s) => s.id), [chat.id]);
  assert.match(out[0].reason, new RegExp(`ESC-${answered.id}`));
});

test('autoResolve records the reason and sends nothing', () => {
  const e = esc({ title: 'Approve merge of abc1234' });
  let touched = 0;
  const lines: string[] = [];
  const roster = { data: () => ({ escalations: [e] }), deps: { now: () => 5 }, touch: () => touched++ } as never;
  const floor = { id: 'f1', activity: (t: string) => lines.push(t) } as never;
  assert.equal(autoResolve(roster, floor, { id: e.id, kind: 'commit-on-main', reason: 'The commit it asks about (@abc1234) is on main now' }), true);
  assert.equal(e.status, 'resolved');
  assert.deepEqual(e.resolution?.auto, { kind: 'commit-on-main', reason: 'The commit it asks about (@abc1234) is on main now' });
  assert.equal(e.resolution?.delivered, false);
  assert.equal(autoResolve(roster, floor, { id: e.id, kind: 'commit-on-main', reason: 'again' }), false);
  assert.equal(lines.length, 1);
});

test('chat-to-card: plain status sentences and pleasantries are not asks; real questions still are', () => {
  for (const text of [
    'Rows 12 to 15 are built and committed on office/blake-1.\n\nStatus: all green. Let me know if you want anything else.',
    '✅ Merged row 12.\n\nNext: rows 13 and 14. Happy to walk you through it.',
    "What's next? Row 14, the list page.",
    'Please note the build took 4 minutes.',
  ]) assert.equal(realAsk(text), undefined, text);
  assert.match(realAsk('Rows 12 to 15 are built.\n\nShould I start rows 16 to 18 next?') ?? '', /Should I start/);
  assert.match(realAsk('Can you merge @abc1234?') ?? '', /merge/);
});
