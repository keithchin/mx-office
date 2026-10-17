// The review gate and the agents' own commit identity (server/review-gate/, workers/git-identity.ts,
// roster/git-identity.ts; packtrack audit 2026-10-16 findings 6 and 8 and "gate erosion"): each agent
// commits as itself with the office as committer; an agent's PR merged fast, without a review by another
// agent recorded on it, reviewed only by itself, or called "(reviewed)" with nothing behind it, is
// flagged and its task never reads as verified; a qualifying review by another lead is fine; pushes
// straight to the default branch, force pushes, and lint-baseline resets or waivers without a decision
// are flagged too. Synthetic data shaped like packtrack's PR list; local temp git repos only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';
import { agentFromAuthor, claimsReviewed, openerFromBody, parseReview, reviewComplete, reviewRule } from '../src/shared/review-gate.js';
import { agentGitEnv } from '../src/server/workers/git-identity.js';
import { holdSeat, rosterSeat } from '../src/server/roster/git-identity.js';
import { ROLES } from '../src/shared/roster/roles.js';
import type { Roster } from '../src/server/roster/index.js';
import { flaggedPulls, judgePull, markTasks, pullItem } from '../src/server/review-gate/judge.js';
import { gateFieldsOf } from '../src/server/review-gate/fields.js';
import { directPushes, lookPushes, pushItem } from '../src/server/review-gate/pushes.js';
import { lookWaivers, waiverHits, waiverItem } from '../src/server/review-gate/waivers.js';
import { countsAsDelivered, taskStateOf } from '../src/server/roster/task-verify.js';
import type { Assignment } from '../src/server/roster/resume.js';
import { outcome } from '../src/server/roster/task-outcome.js';
import { actMessage, detectAsks } from '../src/server/asks/detect.js';

const OFFICE = { name: 'Mx Office Bot', email: 'office@example.test' };
const NOW = Date.parse('2026-10-16T15:00:00Z');

function tmp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'review-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A git run with no identity of its own besides `env` (and a throwaway one where a test needs any). */
const gitIn = (dir: string, args: string[], env: Record<string, string> = {}) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env } }).trim();
const ME = { GIT_AUTHOR_NAME: 'Keith Chin', GIT_AUTHOR_EMAIL: 'keith@example.test', GIT_COMMITTER_NAME: 'Keith Chin', GIT_COMMITTER_EMAIL: 'keith@example.test' };

function repo(t: { after(fn: () => void): void }): string {
  const dir = tmp(t);
  gitIn(dir, ['init', '-q', '-b', 'main']);
  return dir;
}
function commit(dir: string, file: string, text: string, msg: string, env: Record<string, string> = ME): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
  gitIn(dir, ['add', '-A'], env);
  gitIn(dir, ['commit', '-qm', msg], env);
  return gitIn(dir, ['rev-parse', 'HEAD']);
}

const worker = (over: Partial<WorkerInfo> = {}) => ({ id: 'a1b2c3d4e5f6', name: 'Pixel', kind: 'agent' as const, deskId: 'desk-3', ...over });

// ---- 1. The agents' commit identity ----------------------------------------------------------------

test('an agent worker commits as its seat ("Sophie (Mx Office Lead Developer)" at its profile address), the office as committer', () => {
  const env = agentGitEnv(worker(), { name: 'Sophie', role: 'Lead Developer', key: 'prf_01M51ABCDEFGHJKMNPQRSTVWXY' }, OFFICE);
  assert.deepEqual(env, {
    GIT_AUTHOR_NAME: 'Sophie (Mx Office Lead Developer)',
    GIT_AUTHOR_EMAIL: 'prf_01m51abcdefghjkmnpqrstvwxy@agents.mx-office.local',
    GIT_COMMITTER_NAME: 'Mx Office Bot',
    GIT_COMMITTER_EMAIL: 'office@example.test',
  });
});

test('with no office commit identity the committer is "Mx Office", never a person; a worker with no seat is named for itself; a shell keeps the person', () => {
  const env = agentGitEnv(worker(), undefined, { name: '', email: '' });
  assert.equal(env.GIT_AUTHOR_NAME, 'Pixel (Mx Office agent)');
  assert.equal(env.GIT_AUTHOR_EMAIL, 'worker-a1b2c3d4e5f6@agents.mx-office.local');
  assert.equal(env.GIT_COMMITTER_NAME, 'Mx Office');
  assert.equal(env.GIT_COMMITTER_EMAIL, 'office@agents.mx-office.local');
  assert.deepEqual(agentGitEnv(worker({ kind: 'shell', name: 'Pixel 🐚' }), undefined, OFFICE), {}, 'a shell is a person typing');
  assert.equal(agentGitEnv(worker(), { name: 'Eve "<x>"', role: 'Lead\nTester', key: 'lead-tester' }, OFFICE).GIT_AUTHOR_NAME, 'Eve x (Mx Office Lead Tester)', 'nothing that would break the author line');
});

test('the identity in the worker env wins over the person’s git config: a real commit reads as the agent, committed by the office', (t) => {
  const dir = repo(t);
  gitIn(dir, ['config', 'user.name', 'Keith Chin']);
  gitIn(dir, ['config', 'user.email', 'keith@example.test']);
  const env = agentGitEnv(worker(), { name: 'Katherine', role: 'Chief Analyst', key: 'chief-analyst' }, OFFICE);
  commit(dir, 'docs/x.md', 'x', 'SCG handover draft', env);
  assert.equal(gitIn(dir, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']), 'Katherine (Mx Office Chief Analyst) <chief-analyst@agents.mx-office.local>|Mx Office Bot <office@example.test>');
  assert.equal(agentFromAuthor(gitIn(dir, ['log', '-1', '--format=%an'])), 'Katherine', 'the gate reads the agent back off the author');
});

test('a hire holds its seat at its desk while the worker starts, so even its first launch commits as the member; then the member record says', () => {
  const members = Object.fromEntries(ROLES.map((r) => [r.id, { name: r.id === 'lead-developer' ? 'Sophie' : r.title, phase: 'none' as const, workerId: r.id === 'chief-analyst' ? 'w-kat' : undefined }]));
  const roster = { deps: { profiles: { profileOf: (_f: string, role: string) => (role === 'chief-analyst' ? 'prf_KAT' : undefined) } }, data: () => ({ members }) } as unknown as Roster;
  assert.deepEqual(rosterSeat(roster, 'f1', { id: 'w-kat', deskId: 'd9' }), { name: 'Chief Analyst', role: 'Chief Analyst', key: 'prf_KAT' });
  assert.equal(rosterSeat(roster, 'f1', { id: 'new', deskId: 'd2' }), undefined, 'not a member, no hire under way');
  const release = holdSeat('f1', 'd2', { name: 'Sophie', role: 'Lead Developer', key: 'lead-developer' });
  assert.deepEqual(rosterSeat(roster, 'f1', { id: 'new', deskId: 'd2' }), { name: 'Sophie', role: 'Lead Developer', key: 'lead-developer' });
  assert.equal(rosterSeat(roster, 'f2', { id: 'new', deskId: 'd2' }), undefined, 'another project’s desk');
  release();
  assert.equal(rosterSeat(roster, 'f1', { id: 'new', deskId: 'd2' }), undefined, 'let go once the hire is through');
});

// ---- 2. The review rule ------------------------------------------------------------------------------

const REVIEW = ['Review: Sophie (Lead Developer)', 'Checks:', '- npm test → 42 passed', '- mxcli check -p App.mpr → 0 errors', 'Files read:', '- docs/scg/handover.md', '- docs/team/analysis.md', 'Verdict: approve'].join('\n');

test('a Review comment is parsed for its reviewer, the checks with their results and the files read; a skim is not one', () => {
  const r = parseReview(REVIEW)!;
  assert.equal(r.reviewer, 'Sophie');
  assert.equal(r.role, 'Lead Developer');
  assert.deepEqual(r.checks, ['npm test → 42 passed', 'mxcli check -p App.mpr → 0 errors']);
  assert.deepEqual(r.files, ['docs/scg/handover.md', 'docs/team/analysis.md']);
  assert.ok(reviewComplete(r));
  assert.ok(reviewComplete(parseReview('**Review:** Maya (Lead Tester)\nChecks: npm test -> pass; lint -> 0 new\nFiles read: tests/a.test.ts')));
  assert.equal(reviewComplete(parseReview('Review: Sophie (Lead Developer)\nI read it end to end; it matches the journals.')), false, 'no checks, no files');
  assert.equal(reviewComplete(parseReview('Review: Sophie\nChecks:\n- looked at it\nFiles read:\n- all')), false, 'a check with no result');
  assert.equal(parseReview('LGTM'), undefined);
  assert.equal(openerFromBody('Opened by Katherine (Chief Analyst) via Mx Office\n\nDocs only.'), 'Katherine');
  assert.ok(claimsReviewed('SCG handover draft (reviewed, internal)'));
  assert.equal(claimsReviewed('Review protocol docs'), false);
});

test('the Playbook rule names the agent’s own opener line, the Review comment, the 10 minutes and the baseline/waiver decision', () => {
  const rule = reviewRule('Linus', 'Lead Developer');
  assert.match(rule, /`Opened by Linus \(Lead Developer\) via Mx Office`/);
  assert.match(rule, /starts `Review: <their name> \(<their role>\)`, then a `Checks:` list/);
  assert.match(rule, /never within 10 minutes of opening unless the Project Manager approved it/);
  assert.match(rule, /\.claude\/lint-baseline\.json/);
  assert.match(rule, /Decided per ESC-<id> rev <n>/);
});

/** Packtrack's PR #5 as the office's PR list has it (synthetic copy of the shape). */
function pr5(over: Partial<GhPull> = {}): GhPull {
  return {
    number: 5,
    title: 'SCG handover draft, journals',
    state: 'MERGED',
    isDraft: false,
    url: 'https://github.com/acme/demo/pull/5',
    author: 'keithchin',
    labels: [],
    reviewDecision: '',
    headRefName: 'office/pixel-9dad',
    mergeCommit: '5e3480966408161d46c7b79fd0190111e0a503b6',
    mergedAt: '2026-10-16T13:09:11Z',
    baseRefName: 'main',
    createdAt: '2026-10-16T13:08:59Z',
    updatedAt: '2026-10-16T13:09:11Z',
    additions: 10,
    deletions: 0,
    checks: 'none',
    body: 'Docs only: internal SCG handover draft (UNVERIFIED statuses marked), journals.\n\nTask: tsk_01M52NFYRXYKYZA1ZEGD3KMHZV',
    closes: [],
    mergedBy: 'keithchin',
    reviewNotes: [],
    claims: ['SCG handover draft (reviewed, internal)'],
    commitAuthors: ['Keith Chin'],
    ...over,
  };
}
const LOOK = { agents: ['Katherine', 'Sophie', 'Maya', 'Pia'], branchOwner: (b: string) => (b === 'office/pixel-9dad' ? 'Katherine' : b === 'office/pixel-b1e9' ? 'Sophie' : undefined) };
const note = (body: string, at: string, author = 'keithchin') => ({ kind: 'comment' as const, author, body, at });

test('PR #5: merged 12 s after opening by the agent itself, no review, "(reviewed)" in a commit title: flagged, and the card says so', () => {
  const j = judgePull(pr5(), LOOK)!;
  assert.deepEqual(j.flags, ['no-review', 'fast', 'reviewed-claim']);
  assert.equal(j.opener, 'Katherine');
  assert.equal(j.unreviewed, true);
  const it = pullItem(pr5(), j, 'Pia');
  assert.equal(it.text, 'PR #5 by Katherine merged 12 s after opening, without a review by another lead and called “(reviewed)” with no Review comment behind it');
  assert.equal(it.kind, 'gate');
  assert.equal(it.level, 'info');
  assert.ok(it.lines!.some((l) => /opened by keithchin, merged by keithchin \(one account/.test(l)), 'GitHub’s own record, and why it can’t tell');
  assert.ok(it.lines!.includes('Its task stays integrated (unreviewed), never verified.'));
  assert.deepEqual(it.acts.map((a) => a.act), ['ask-lead', 'seen']);
  assert.match(actMessage('ask-lead', it, 'Keith')!, /review gate.*Review:/s);
});

test('reviewed only by its own author (a self-review) is flagged as that, and still unreviewed', () => {
  const self = REVIEW.replace('Review: Sophie (Lead Developer)', 'Review: Katherine (Chief Analyst)');
  const j = judgePull(pr5({ reviewNotes: [note(self, '2026-10-16T13:09:05Z')], createdAt: '2026-10-16T12:00:00Z' }), LOOK)!;
  assert.deepEqual(j.flags, ['self-review', 'reviewed-claim']);
  assert.equal(j.unreviewed, true);
});

test('a qualifying Review by another lead, before the merge and 10+ minutes after opening: nothing flagged, the "(reviewed)" title is fine', () => {
  const p = pr5({ createdAt: '2026-10-16T12:40:00Z', reviewNotes: [note(REVIEW, '2026-10-16T13:05:00Z')], title: 'SCG handover (reviewed)' });
  const j = judgePull(p, LOOK)!;
  assert.deepEqual(j.flags, []);
  assert.deepEqual(j.reviewers, ['Sophie']);
  assert.equal(j.unreviewed, false);
  assert.deepEqual(flaggedPulls([p], LOOK, NOW), [], 'no card');
});

test('a review after the merge, an unknown reviewer or one without checks and files does not count', () => {
  const late = judgePull(pr5({ createdAt: '2026-10-16T12:00:00Z', reviewNotes: [note(REVIEW, '2026-10-16T13:30:00Z')] }), LOOK)!;
  assert.deepEqual(late.flags, ['no-review', 'reviewed-claim']);
  const stranger = judgePull(pr5({ createdAt: '2026-10-16T12:00:00Z', reviewNotes: [note(REVIEW.replace('Sophie', 'Bob'), '2026-10-16T13:00:00Z')] }), LOOK)!;
  assert.equal(stranger.unreviewed, true, 'Bob is no agent here and wrote from the same account');
  const skim = judgePull(pr5({ createdAt: '2026-10-16T12:00:00Z', reviewNotes: [note('Review: Sophie (Lead Developer)\nRead it, matches the journals.', '2026-10-16T13:00:00Z')] }), LOOK)!;
  assert.deepEqual(skim.incomplete, ['Sophie']);
  assert.ok(pullItem(pr5(), skim).lines!.some((l) => /lists no checks/.test(l)));
});

test('a fast merge is flagged even with a review, unless someone on another account approved it; failing checks are flagged', () => {
  const reviewed = [note(REVIEW, '2026-10-16T13:09:08Z')];
  const fast = judgePull(pr5({ reviewNotes: reviewed }), LOOK)!;
  assert.deepEqual(fast.flags, ['fast']);
  assert.equal(fast.unreviewed, false, 'reviewed: the task isn’t held back, the card still shows the rush');
  assert.match(pullItem(pr5(), fast).text, /merged 12 s after opening, under 10 minutes after opening, without your approval/);
  const approved = judgePull(pr5({ reviewNotes: [...reviewed, { kind: 'review', author: 'keith-own', body: '', at: '2026-10-16T13:09:09Z', state: 'APPROVED' }] }), LOOK)!;
  assert.deepEqual(approved.flags, []);
  const red = judgePull(pr5({ createdAt: '2026-10-16T12:00:00Z', reviewNotes: reviewed, checks: 'fail' }), LOOK)!;
  assert.deepEqual(red.flags, ['checks-failing']);
});

test('only agents’ PRs, and only the last week’s merges, are judged', () => {
  assert.equal(judgePull(pr5({ headRefName: 'keith/hotfix', body: 'by hand' }), LOOK), undefined, 'a person’s own PR');
  assert.ok(judgePull(pr5({ headRefName: 'feature/x', body: 'Opened by Sophie (Lead Developer) via Mx Office' }), LOOK), 'named in its body');
  assert.ok(judgePull(pr5({ headRefName: 'feature/x', body: '', commitAuthors: ['Sophie (Mx Office Lead Developer)'] }), LOOK), 'an agent’s commits');
  assert.deepEqual(flaggedPulls([pr5({ mergedAt: '2026-10-01T10:00:00Z' })], LOOK, NOW), []);
  assert.deepEqual(flaggedPulls([pr5({ state: 'OPEN', mergedAt: undefined })], LOOK, NOW), []);
});

test('the task a flagged PR delivered stays integrated (unreviewed), never verified, whatever its checks say; a reviewed one is untouched', () => {
  const task = (over: Partial<Assignment> = {}): Assignment => ({ text: 'Draft the SCG handover', at: 1, by: 'Keith', doneAt: 2, doneWhy: 'PR #5 merged', outcome: 'integrated', v: 2, pr: 5, verify: { v: 1, state: 'verified', pr: 5, at: 3, checks: [] }, ...over });
  const flagged = flaggedPulls([pr5()], LOOK, NOW);
  const t = task();
  assert.equal(markTasks([t, undefined], flagged, NOW), true);
  assert.equal(taskStateOf(t), 'unreviewed');
  assert.equal(countsAsDelivered(t), false);
  assert.equal(t.doneWhy, 'PR #5 merged (unreviewed)');
  assert.equal(markTasks([t], flagged, NOW), false, 'once');
  const byTaskLine = task({ pr: undefined, taskId: 'tsk_01M52NFYRXYKYZA1ZEGD3KMHZV' });
  assert.equal(markTasks([byTaskLine], flagged, NOW), true, 'found by the Task: line in the PR body');
  const other = task({ pr: 4 });
  assert.equal(markTasks([other], flagged, NOW), false);
  assert.equal(taskStateOf(other), 'verified');
  const okPull = pr5({ createdAt: '2026-10-16T12:40:00Z', reviewNotes: [note(REVIEW, '2026-10-16T13:05:00Z')] });
  const fine = task();
  assert.equal(markTasks([fine], [{ pull: okPull, j: judgePull(okPull, LOOK)! }], NOW), false);
  assert.equal(countsAsDelivered(fine), true);
});

test('a closed issue is not delivery while the task’s own PR is unmerged', () => {
  const closed = new Map([[12, 'COMPLETED']]);
  const base = { issue: 12, pr: 7, closed, claim: /task done/i };
  assert.equal(outcome({ ...base, pulls: [{ number: 7, state: 'OPEN' }] }), undefined, 'its PR is still open');
  assert.equal(outcome({ ...base, pulls: [{ number: 7, state: 'CLOSED', closedAt: '2026-10-16T10:00:00Z' }] })?.kind, 'decision', 'its PR was closed unmerged: the PM decides');
  // A merged PR counts only with evidence it carries the task (task-outcome-truth): merged after the task, Task: line.
  const carried = { ...base, taskId: 'tsk_X', since: Date.parse('2026-10-16T09:00:00Z') };
  assert.equal(outcome({ ...carried, pulls: [{ number: 7, state: 'MERGED', mergedAt: '2026-10-16T11:00:00Z', body: 'Task: tsk_X' }] })?.kind, 'integrated');
  assert.notEqual(outcome({ ...carried, pulls: [{ number: 7, state: 'MERGED', mergedAt: '2026-10-16T11:00:00Z' }] })?.kind, 'integrated', 'merged without the Task: line: not integrated');
  assert.equal(outcome({ issue: 12, closed, claim: /task done/i })?.kind, 'delivered', 'no PR of its own: the issue decides, as before');
  assert.equal(outcome({ ...base, closed: new Map([[12, 'NOT_PLANNED']]), pulls: [{ number: 7, state: 'OPEN' }] })?.kind, 'cancelled', 'dropped is still dropped');
});

test('the merged-PR list keeps mergedBy, the Review/Approved notes only, the "(reviewed)" commit titles and the commit authors', () => {
  const gh = {
    state: 'MERGED',
    mergedBy: { login: 'keithchin' },
    comments: [{ author: { login: 'keithchin' }, body: 'Nice', createdAt: 'x' }, { author: { login: 'keithchin' }, body: REVIEW, createdAt: '2026-10-16T13:05:00Z' }],
    reviews: [{ author: { login: 'maya' }, body: '', submittedAt: '2026-10-16T13:06:00Z', state: 'APPROVED' }],
    commits: [{ messageHeadline: 'SCG handover draft (reviewed, internal)', authors: [{ name: 'Keith Chin' }] }, { messageHeadline: 'Journals', authors: [{ name: 'Katherine (Mx Office Chief Analyst)' }] }],
  };
  const f = gateFieldsOf(gh);
  assert.equal(f.mergedBy, 'keithchin');
  assert.deepEqual(f.reviewNotes!.map((n) => [n.kind, n.author]), [['comment', 'keithchin'], ['review', 'maya']]);
  assert.deepEqual(f.claims, ['SCG handover draft (reviewed, internal)']);
  assert.deepEqual(f.commitAuthors, ['Keith Chin', 'Katherine (Mx Office Chief Analyst)']);
  assert.deepEqual(gateFieldsOf({ ...gh, state: 'OPEN' }), {}, 'open PRs carry none of it');
});

test('the surfaced asks carry the gate’s cards through to Needs you', () => {
  const it = pullItem(pr5(), judgePull(pr5(), LOOK)!);
  assert.deepEqual(detectAsks({ reads: [], now: NOW, gate: [it] }).items.map((i) => i.id), [it.id]);
});

// ---- 3. Pushes and force pushes -------------------------------------------------------------------

test('a first-parent commit that is no PR merge and wasn’t committed by GitHub is a direct push', () => {
  const c = (sha: string, committerEmail: string, subject: string) => ({ sha, author: 'Keith Chin <k@x>', committer: 'Keith Chin', committerEmail, at: 1000, subject });
  const pushes = directPushes([c('aaa', 'noreply@github.com', 'Merge pull request #7 from acme/x'), c('bbb', 'k@x', 'Merge branch office/x'), c('ccc', 'k@x', 'Toolkit scaffold')], new Set(['bbb']), 'main');
  assert.deepEqual(pushes.map((p) => p.sha), ['ccc']);
  assert.equal(pushItem(pushes[0]).text, 'Commit ccc reached main without a pull request (Keith Chin <k@x>: “Toolkit scaffold”)');
});

test('the office remembers where main was: a direct push and then a force push are each surfaced once, the first look flags nothing', async (t) => {
  const dir = repo(t);
  const data = tmp(t);
  const a = commit(dir, 'a.txt', 'a', 'Initial commit');
  assert.deepEqual(await lookPushes(data, 'f1', dir, { branch: 'main', sha: a }, new Set()), [], 'the first look only records the tip');
  // A PR merged on GitHub: committed by GitHub.
  const viaGh = commit(dir, 'b.txt', 'b', 'Merge pull request #2 from acme/office/x', { ...ME, GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' });
  const direct = commit(dir, 'c.txt', 'c', 'Hotfix straight on main');
  let events = await lookPushes(data, 'f1', dir, { branch: 'main', sha: direct }, new Set());
  assert.deepEqual(events.map((e) => [e.kind, e.sha]), [['direct', direct]], `${viaGh.slice(0, 7)} came through a PR`);
  assert.deepEqual(await lookPushes(data, 'f1', dir, { branch: 'main', sha: direct }, new Set()), events, 'unchanged: nothing new');
  // Rewrite main: a new commit on top of `a`, without `direct`.
  gitIn(dir, ['reset', '-q', '--hard', a]);
  const forced = commit(dir, 'd.txt', 'd', 'Rewritten history');
  events = await lookPushes(data, 'f1', dir, { branch: 'main', sha: forced }, new Set());
  assert.deepEqual(events.map((e) => [e.kind, e.sha]), [['direct', direct], ['force', forced]]);
  const card = pushItem(events[1], 'Pia');
  assert.match(card.text, new RegExp(`^main was force-pushed: it moved from ${direct.slice(0, 7)} to ${forced.slice(0, 7)}, which doesn't contain it$`));
  assert.deepEqual(card.acts.map((x) => x.act), ['ask-lead', 'seen']);
});

// ---- 4. Lint baseline resets and waivers -----------------------------------------------------------

test('baseline resets and waiver lines without a PM decision are listed; one citing a decision is not', async (t) => {
  const dir = repo(t);
  commit(dir, 'README.md', 'x', 'Scaffold');
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  commit(dir, '.claude/lint-baseline.json', '{"CONV009":1}', 'Old re-baseline, a month ago', { ...ME, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old });
  commit(dir, '.claude/lint-baseline.json', '{"CONV009":3}', 'Row 15: sheet core microflows applied; lint re-baselined (see journal)', { ...ME, GIT_AUTHOR_NAME: 'Sophie (Mx Office Lead Developer)' });
  commit(dir, 'docs/BUILD-LOG.md', '2026-10-16T03:42:54Z  SOURCE-WAIVED legacy/.dockerignore reason: no requirement\n2026-10-16T03:43:17Z  SOURCE-WAIVED legacy/Dockerfile reason: hosting only\n', 'Stage 1: sources triaged');
  commit(dir, 'docs/team/development.md', 'x', 'Row 16: sheet form page applied; fidelity 66% waived');
  commit(dir, '.claude/lint-baseline.json', '{"CONV009":4}', 'Lint re-baselined\n\nDecided per ESC-04e8b0c899 rev 1: accept the new baseline');
  const hits = await lookWaivers(dir, Date.now());
  assert.deepEqual(hits.map((h) => [h.subject, h.baseline, h.waivers]), [
    ['Row 15: sheet core microflows applied; lint re-baselined (see journal)', true, 0],
    ['Stage 1: sources triaged', false, 2],
  ], 'the decided reset is not listed; a commit outside the watched files is not read');
  const card = waiverItem(hits, 'Pia')!;
  assert.equal(card.text, 'Lint baseline reset 1 time and 2 waivers recorded in the last 7 days without your decision');
  assert.ok(card.lines![0].includes('Sophie (Mx Office Lead Developer)'));
  assert.equal(waiverItem([]), undefined);
});

test('a waiver said only in a commit title counts once', () => {
  const log = `\x01abc123\0Sophie\0${Math.floor(NOW / 1000)}\0Row 20: Overview fidelity waived\0\x02\ndiff --git a/PROJECT.md b/PROJECT.md\n+| row 20 | done |\n`;
  assert.deepEqual(waiverHits(log).map((h) => [h.sha, h.waivers, h.baseline]), [['abc123', 1, false]]);
});
