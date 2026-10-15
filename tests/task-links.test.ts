// Links from a decision revision to the work (Slice 1B-4, shared/task-links.ts, server/tasks/evaluate.ts):
// a candidate is only the recipient's task when the answer went, an associated link is named by a commit or
// PR, inferred is a build-plan row. Evidence is tied to the revision: acknowledged needs the citation in the
// same session after the typed answer; an associated change is a citing commit on the task's branch; checks
// count only at a revision containing that commit; implemented as decided only by a person's acceptance.
// "No links found" is never "No implementation work required". Real git in a temp repo; no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerMarker, withMarker, type DispatchRecord } from '../src/shared/dispatch.js';
import { cleanDecisionRevs, linkWords, noneWords, NO_LINKS_FOUND, NO_WORK_REQUIRED, type DecisionLinks } from '../src/shared/task-links.js';
import { citedAfter } from '../src/server/dispatch/evidence.js';
import { evaluateLinks, type EvalInput, type EvalIo } from '../src/server/tasks/evaluate.js';
import { branchCommits, commitsSince, contains } from '../src/server/tasks/git.js';
import { assistantEntry, userEntry } from './dispatch-helpers.js';

const TSK = 'tsk_01JB0000000000000000000001';
const OTHER = 'tsk_01JB0000000000000000000002';
const DSP = 'dsp_01JB0000000000000000000000';
const DECISION = 'esc:3f9c2a1b7e';
const CITE = 'ESC-3f9c2a1b7e rev 2';

function dispatch(over: Partial<DispatchRecord> = {}): DispatchRecord {
  const marker = answerMarker(DSP, DECISION, 2);
  return { id: DSP, decision: DECISION, answerRev: 2, workerId: 'a1', workerName: 'Linus', payload: withMarker('APPROVED — use SSO', marker), marker, channel: 'type', state: 'submitted', confirmedBy: 'system', task: { taskId: TSK, executionId: 'exe_01JB0000000000000000000001', text: 'Visitor checkout', branch: 'feat/checkout', pr: 98 }, createdAt: 1, updatedAt: 1, history: [], ...over };
}

const base = (over: Partial<EvalInput> = {}): EvalInput => ({ decision: DECISION, rev: 2, answerAt: 1000, dispatches: [dispatch()], commits: [], pulls: [], planRows: [], verifications: [], acceptances: [], now: 5, ...over });
const io = (over: Partial<EvalIo> = {}): EvalIo => ({ acknowledged: async () => false, onBranch: async () => undefined, contains: async () => false, ...over });

test('link-candidate-vs-associated: the recipient task is only a candidate; a commit or PR naming the revision or the task is associated', async () => {
  const only = await evaluateLinks(base(), io());
  assert.equal(only.links.length, 1);
  assert.equal(only.links[0].strength, 'candidate');
  assert.deepEqual(only.links[0].evidence, {}, 'a candidate is never proof of anything');
  assert.equal(linkWords(only.links[0]), `Task ${TSK} "Visitor checkout" (Linus): candidate`);
  // A PR that names the revision, for a task nobody was told: associated, with its own task id from its body.
  const pr = await evaluateLinks(base({ pulls: [{ number: 120, title: 'Use SSO on the admin pages', body: `Decided per ${CITE}\n\nTask: ${OTHER}` }] }), io());
  const assoc = pr.links.find((l) => l.pr === 120)!;
  assert.equal(assoc.strength, 'associated');
  assert.equal(assoc.taskId, OTHER);
  // A commit after the answer that cites it: associated, its change named as such (never "implemented").
  const commit = await evaluateLinks(base({ dispatches: [], commits: [{ sha: 'c'.repeat(40), at: 2000, message: `Add SSO\n\nDecided per ${CITE}` }] }), io());
  assert.equal(commit.links[0].strength, 'associated');
  assert.match(linkWords(commit.links[0]), /associated change commit ccccccc/);
  assert.doesNotMatch(linkWords(commit.links[0]), /implemented/i);
  // "rev 2" is not "rev 21"; a commit from before the answer is not its change.
  const wrong = await evaluateLinks(base({ dispatches: [], commits: [{ sha: 'd'.repeat(40), at: 2000, message: 'ESC-3f9c2a1b7e rev 21' }, { sha: 'e'.repeat(40), at: 500, message: CITE }] }), io());
  assert.equal(wrong.links.length, 0);
  // A build-plan row naming the escalation: inferred, and labelled so.
  const plan = await evaluateLinks(base({ dispatches: [], planRows: [{ file: 'architecture/build-plan.md', line: 12, text: '7 | Admin SSO (ESC-3f9c2a1b7e) | planned' }] }), io());
  assert.equal(plan.links[0].strength, 'inferred');
  assert.match(plan.links[0].via, /inferred/);
  // A legacy task (captured without an id) says so.
  const legacy = await evaluateLinks(base({ dispatches: [dispatch({ task: { text: 'work on GitHub issue #1' } })] }), io());
  assert.match(linkWords(legacy.links[0]), /^legacy task \(no id\) "work on GitHub issue #1" \(Linus\): candidate$/);
});

test('acknowledged-needs-citation-in-same-session: a turn that merely follows, another session, or the citation before the answer is not enough', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tl-ack-'));
  const file = path.join(dir, 'sess-A.jsonl');
  const r = dispatch({ sessionId: 'sess-A', transcriptPath: file, transcriptOffset: 0 });
  const typed = userEntry('sess-A', r.payload);
  const run = async (lines: string[]) => {
    writeFileSync(file, `${lines.join('\n')}\n`);
    return citedAfter(r, CITE);
  };
  assert.equal(await run([typed, assistantEntry('sess-A', 'Got it, carrying on with the checkout.')]), false, 'a turn merely following');
  assert.equal(await run([typed, assistantEntry('sess-B', `Recorded: Decided per ${CITE}`)]), false, 'another session');
  assert.equal(await run([assistantEntry('sess-A', `Decided per ${CITE}`), typed]), false, 'before the typed answer');
  assert.equal(await run([assistantEntry('sess-A', `Decided per ${CITE}`)]), false, 'no typed answer at all');
  assert.equal(await run([typed, assistantEntry('sess-A', `Decided per ESC-3f9c2a1b7e rev 21: …`)]), false, 'another revision');
  assert.equal(await run([typed, assistantEntry('sess-A', `Recorded in the journal: Decided per ${CITE}: use SSO.`)]), true);
  // Only a system-confirmed submission counts: a person's "it went through" is not acknowledged.
  const person = await evaluateLinks(base({ dispatches: [dispatch({ state: 'person-confirmed-sent', confirmedBy: 'person' })] }), io({ acknowledged: async () => true }));
  assert.equal(person.links[0].evidence.acknowledged, undefined);
  const sys = await evaluateLinks(base(), io({ acknowledged: async () => true }));
  assert.deepEqual(sys.links[0].evidence.acknowledged, { dispatchId: DSP });
});

const sh = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

test('unrelated-passing-check: a check passing on a commit that does not contain the associated change is not verified', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tl-git-'));
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), '1');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'start');
  const before = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'checkout', '-q', '-b', 'feat/checkout');
  writeFileSync(path.join(dir, 'a.txt'), '2');
  sh(dir, 'commit', '-q', '-am', `Use SSO\n\nDecided per ${CITE}\nTask: ${TSK}`);
  const change = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'checkout', '-q', 'main');
  writeFileSync(path.join(dir, 'b.txt'), 'x');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'unrelated docs fix');
  const unrelated = sh(dir, 'rev-parse', 'HEAD');
  const answerAt = (Number(sh(dir, 'log', '-1', '--format=%ct', before)) - 5) * 1000;
  const commits = await commitsSince(dir, answerAt);
  assert.ok(commits.some((c) => c.sha === change));
  const gitIo = io({ onBranch: (b) => branchCommits(dir, b, answerAt), contains: (sha, into) => contains(dir, sha, into) });
  const run = (pulls: EvalInput['pulls'], verifications: EvalInput['verifications'] = []) => evaluateLinks(base({ answerAt, commits, pulls, verifications }), gitIo);
  // The associated change: on the task's branch, after the answer, citing the revision.
  const plain = await run([{ number: 98, title: 'Checkout', headRefName: 'feat/checkout' }]);
  assert.equal(plain.links[0].evidence.updated?.commit, change);
  // Checks passed, but on a revision without the change (the PR head was the old one, or main's unrelated commit): not verified.
  assert.equal((await run([{ number: 98, title: 'Checkout', headRefName: 'feat/checkout', checks: 'pass', headRefOid: before }])).links[0].evidence.verified, undefined);
  assert.equal((await run([{ number: 98, title: 'Checkout', checks: 'pass', headRefOid: unrelated }], [{ taskId: TSK, pr: 98, revision: unrelated, state: 'verified' }])).links[0].evidence.verified, undefined);
  // Another PR's pass proves nothing for this task.
  assert.equal((await run([{ number: 98, title: 'Checkout', headRefName: 'feat/checkout' }, { number: 99, title: 'Other', checks: 'pass', headRefOid: change }])).links[0].evidence.verified, undefined);
  // At a revision containing the change, on the task's PR: checks passed on the associated change.
  const ok = await run([{ number: 98, title: 'Checkout', headRefName: 'feat/checkout', checks: 'pass', headRefOid: change }]);
  assert.deepEqual(ok.links[0].evidence.verified, { revision: change, pr: 98, source: 'pr-checks' });
  assert.equal(linkWords(ok.links[0]), `Task ${TSK} "Visitor checkout" (Linus): candidate · associated change PR #98 · checks passed on the associated change @${change.slice(0, 7)}`);
});

test('implemented-only-by-acceptance: verified checks are never "implemented"; only an acceptance naming the revision is', async () => {
  const io2 = io({ onBranch: async () => new Set(['c'.repeat(40)]), contains: async () => true });
  const commits = [{ sha: 'c'.repeat(40), at: 2000, message: CITE }];
  const pulls = [{ number: 98, title: 'Checkout', checks: 'pass', headRefOid: 'c'.repeat(40) }];
  const v = await evaluateLinks(base({ commits, pulls }), io2);
  assert.ok(v.links[0].evidence.verified);
  assert.equal(v.implemented, undefined);
  // An acceptance of another revision, or one with no decisions, doesn't count.
  const other = await evaluateLinks(base({ commits, pulls, acceptances: [{ id: 'acc_1', version: 'v1', by: 'Keith', at: 3, decisions: [{ decision: DECISION, rev: 1 }] }, { id: 'acc_2', version: 'v2', by: 'Keith', at: 4 }] }), io2);
  assert.equal(other.implemented, undefined);
  const yes = await evaluateLinks(base({ acceptances: [{ id: 'acc_3', version: 'v1.2', by: 'Keith', at: 6, decisions: [{ decision: DECISION, rev: 2 }] }] }), io());
  assert.deepEqual(yes.implemented, { acceptanceId: 'acc_3', version: 'v1.2', by: 'Keith', at: 6 });
  // The record's field is cleaned: junk dropped.
  assert.deepEqual(cleanDecisionRevs([{ decision: DECISION, rev: 2 }, { decision: 'bogus', rev: 1 }, { decision: DECISION, rev: 0 }, 'x']), [{ decision: DECISION, rev: 2 }]);
});

test('no-links-vs-no-work-required: nothing located is not the same as a person saying no work is needed', async () => {
  const none = await evaluateLinks(base({ dispatches: [] }), io());
  assert.deepEqual(none.links, []);
  assert.equal(none.noWorkRequired, undefined);
  assert.equal(noneWords(none), NO_LINKS_FOUND);
  assert.doesNotMatch(NO_LINKS_FOUND, /no work required|no impact/i);
  const said: DecisionLinks = await evaluateLinks(base({ dispatches: [], kind: 'no-work-required', by: 'Keith', note: 'SSO is already on' }), io());
  assert.deepEqual(said.noWorkRequired, { by: 'Keith', at: 1000, note: 'SSO is already on' });
  assert.equal(noneWords(said), `${NO_WORK_REQUIRED} (stated by Keith: SSO is already on)`);
});
