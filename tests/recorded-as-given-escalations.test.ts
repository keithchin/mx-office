// Recorded as given, escalations (Slice 1B-2, server/followthrough/): the answer carries the citation
// `Decided per ESC-<id> rev <n>`; the office finds it on the asks look's reads (the project folder, the
// agents' worktrees, the branch heads), compares the words with the revision, and keeps where it is (working
// copy, committed on a branch, merged into main: path, commit and blob apart). Real git in throwaway repos
// with a bare origin; no office, no Claude, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { faithful, followLine, wordsMatch } from '../src/shared/followthrough.js';
import { citations, judgeCitation } from '../src/server/followthrough/judge.js';
import { escalationAnswerPrompt } from '../src/server/roster/prompts.js';
import { detectStuck } from '../src/server/stuck/detect.js';
import { STUCK_DEFAULTS } from '../src/shared/stuck.js';
import { git, journal, JOURNAL, team, worktree } from './followthrough-helpers.js';
import { settle } from './dispatch-helpers.js';

test('the answer prompt and its marker carry the citation Decided per ESC-<id> rev <n>', async () => {
  const t = await team();
  const typed = t.floor.prompts.map((p) => p.text).join('\n');
  assert.match(typed, new RegExp(`Decided per ESC-${t.e.id} rev 1: <the decision, worded as given>`));
  assert.match(typed, new RegExp(`\\[office answer dsp_\\w+ · ESC-${t.e.id} rev 1\\]`));
  assert.match(escalationAnswerPrompt(t.e, 'approve', '', 'Keith', undefined, 3), /Decided per ESC-\w+ rev 3/);
});

test('matching rule: case, quotes, punctuation and spacing aside, the expected words appear whole', () => {
  assert.ok(wordsMatch('Decided per ESC-x rev 1: we’ll **use SSO** (Entra), per Keith.', 'Use SSO'));
  assert.ok(wordsMatch('“USE   SSO.”', 'Use SSO'));
  assert.ok(!wordsMatch('use SSO-lite', 'Use SSO lite please'));
  assert.ok(!wordsMatch('use ssoish', 'use sso'), 'whole words only');
  assert.ok(!wordsMatch('anything', ''), 'an empty expectation never matches');
  // The citation only locates: its words are taken out before comparing; a table row is its own record.
  const c = citations('| OW-1 | Decided per ESC-ab12 rev 2: Use SSO | CONFIRMED |\n| OW-2 | other | x |\n\nDecided per ESC-cd34 rev 1: magic links\nfor guests too.\n\nNext paragraph.');
  assert.equal(c.length, 2);
  assert.equal(c[0].block, '| OW-1 | Decided per ESC-ab12 rev 2: Use SSO | CONFIRMED |');
  assert.equal(c[1].block, 'Decided per ESC-cd34 rev 1: magic links\nfor guests too.');
  const hist = [{ rev: 1, kind: 'reply' as const, text: 'Go with: Use SSO' }];
  assert.equal(judgeCitation({ rev: 1, block: 'Decided per ESC-x rev 1: Use SSO for staff' }, hist)?.outcome, 'recorded');
  assert.equal(judgeCitation({ rev: 3, block: 'Decided per ESC-x rev 3: Use SSO' }, hist), undefined, 'a revision that does not exist says nothing');
});

test('citation-wrong-answer: the correct citation with different content is recorded differently, both texts kept', async () => {
  const t = await team();
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: use magic links for everyone.`);
  const r = await t.scan();
  assert.equal(r?.outcome, 'recorded-differently');
  assert.equal(r?.rev, 1);
  assert.match(r?.text ?? '', /use magic links for everyone/);
  assert.equal(r?.location?.where, 'working-copy');
  const v = await t.ft.view(t.floor.id, true);
  const it = v.items.find((i) => i.decision === `esc:${t.e.id}`)!;
  assert.equal(it.decided, 'Go with: Use SSO');
  assert.match(followLine(it), /^Decided \(rev 1\) · Sent \(Typed \(the office saw it go\)\) · Recorded differently · In a working copy, not committed/);
  assert.ok(t.audits.some((a) => a.action === 'followthrough.recorded' && /recorded differently/.test(a.summary)));
});

test('citation-old-revision: citing rev 1 after rev 2 is recorded, but for rev 1', async () => {
  const t = await team();
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: Use SSO.`);
  assert.equal((await t.scan())?.outcome, 'recorded');
  // A second revision (a change of answer): the old record no longer stands for it.
  const line = await t.o.roster.dispatch.answers.append(t.floor.id, { decision: `esc:${t.e.id}`, kind: 'reply', text: 'Go with: Use magic links', by: 'Keith', at: 2, supersedes: 1 });
  t.e.resolution!.answerRev = line.rev;
  const r = await t.scan();
  assert.equal(r?.outcome, 'recorded-older-rev');
  assert.equal(r?.rev, 1);
  const it = (await t.ft.view(t.floor.id, true)).items[0];
  assert.match(followLine(it), /Decided \(rev 2\) · .* · Recorded for rev 1/);
});

test('recorded-location-working-copy-vs-branch-vs-main: where the record is, from local git only', async () => {
  const t = await team();
  const entry = `Decided per ESC-${t.e.id} rev 1: Use SSO.`;
  // 1. Written in the project folder, not committed.
  journal(t.repo.dir, entry);
  let r = await t.scan();
  assert.deepEqual([r?.outcome, r?.location?.where, r?.location?.commitSha, r?.location?.blobId], ['recorded', 'working-copy', undefined, undefined]);
  git(t.repo.dir, 'checkout', '--', JOURNAL);
  // 2. Committed on Ada's branch in her worktree.
  const wt = worktree(t.repo.dir, 'dev');
  journal(wt, entry);
  git(wt, 'commit', '-qam', 'journal');
  const people = [{ name: 'Ada', dir: wt, branch: 'office/dev' }];
  r = await t.scan(people);
  assert.equal(r?.location?.where, 'committed-on-branch');
  assert.equal(r?.location?.branch, 'office/dev');
  assert.equal(r?.location?.commitSha, git(wt, 'rev-parse', 'HEAD').trim());
  assert.ok(!faithful(r, 1), 'on a branch is not merged');
  // 3. Merged into main and pushed: reachable from origin/main.
  git(t.repo.dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'office/dev');
  git(t.repo.dir, 'push', '-q', 'origin', 'main');
  r = await t.scan(people);
  assert.equal(r?.location?.where, 'merged-into-main');
  assert.equal(r?.location?.branch, 'main');
  assert.ok(faithful(r, 1));
  // Faithful: off the follow-through list by itself.
  assert.equal((await t.ft.view(t.floor.id, true)).items.length, 0);
});

test('recorded-blob-vs-commit: the blob id is the file at the commit, never the commit, and both are kept', async () => {
  const t = await team();
  const wt = worktree(t.repo.dir, 'dev');
  journal(wt, `Decided per ESC-${t.e.id} rev 1: Use SSO.`);
  git(wt, 'commit', '-qam', 'journal');
  const r = await t.scan([{ name: 'Ada', dir: wt, branch: 'office/dev' }]);
  const sha = git(wt, 'rev-parse', 'HEAD').trim();
  assert.equal(r?.location?.commitSha, sha);
  assert.equal(r?.location?.blobId, git(wt, 'rev-parse', `${sha}:${JOURNAL}`).trim());
  assert.notEqual(r?.location?.blobId, r?.location?.commitSha);
  assert.equal(r?.location?.path, JOURNAL);
  // A branch head nobody has checked out is read from its commit, with the same fields.
  git(t.repo.dir, 'worktree', 'remove', '--force', wt);
  const r2 = await t.scan();
  assert.equal(r2?.location?.commitSha, sha);
  assert.equal(r2?.location?.where, 'committed-on-branch');
});

test('accept-as-recorded-creates-revision: a new revision with the recorded words, basis recorded-differently, and no dispatch', async () => {
  const t = await team();
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: use magic links for everyone.`);
  await t.scan();
  const before = t.o.roster.dispatch.store.list(t.floor.id).length;
  const typed = t.floor.prompts.length;
  // A stale page is refused: nothing is written.
  const stale = await t.ft.act(t.floor.id, `esc:${t.e.id}`, 'accept-as-recorded', { by: 'Keith', expectedRev: 0 });
  assert.equal(stale.ok ? 0 : stale.status, 409);
  const r = await t.ft.act(t.floor.id, `esc:${t.e.id}`, 'accept-as-recorded', { by: 'Keith', expectedRev: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  const hist = await t.o.roster.dispatch.answers.history(t.floor.id, `esc:${t.e.id}`);
  assert.equal(hist.length, 2);
  assert.deepEqual([hist[1].rev, hist[1].kind, hist[1].basis, hist[1].supersedes], [2, 'accept-as-recorded', 'recorded-differently', 1]);
  assert.match(hist[1].text, /use magic links for everyone/);
  assert.equal(t.e.resolution?.answerRev, 2);
  assert.equal(t.o.roster.dispatch.store.list(t.floor.id).length, before, 'nothing to send');
  assert.equal(t.floor.prompts.length, typed);
  // The record citing rev 1 now stands for rev 2 (the words accepted are the words written).
  const again = await t.scan();
  assert.deepEqual([again?.outcome, again?.rev], ['recorded', 2]);
  assert.ok(t.audits.some((a) => a.action === 'followthrough.accept'));
});

test('send-correction-dispatches: a new revision and a dispatch through the dispatcher that supersedes the old one', async () => {
  const t = await team();
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: use magic links for everyone.`);
  await t.scan();
  const oldId = t.e.resolution!.dispatchId!;
  const r = await t.ft.act(t.floor.id, `esc:${t.e.id}`, 'send-correction', { by: 'Keith', expectedRev: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  await settle();
  const hist = await t.o.roster.dispatch.answers.history(t.floor.id, `esc:${t.e.id}`);
  assert.deepEqual([hist[1].rev, hist[1].kind, hist[1].text], [2, 'correction', 'Go with: Use SSO']);
  const recs = t.o.roster.dispatch.store.list(t.floor.id);
  const next = recs.find((x) => x.answerRev === 2)!;
  assert.equal(next.decision, `esc:${t.e.id}`);
  assert.equal(next.supersedes, oldId);
  assert.equal(recs.find((x) => x.id === oldId)?.supersededBy, next.id);
  assert.equal(t.e.resolution?.dispatchId, next.id);
  assert.match(next.payload, new RegExp(`Decided per ESC-${t.e.id} rev 2: `));
  assert.match(next.payload, /They decided: Go with: Use SSO/);
  assert.match(next.payload, /use magic links for everyone/);
  // The old record now cites an older revision until it's corrected.
  assert.equal((await t.scan())?.outcome, 'recorded-older-rev');
});

test('recorded-differently-never-clears-gates: a CONFIRMED register row does not settle a decision whose answer is recorded differently', async () => {
  const t = await team('OW-1: SSO or magic links?');
  assert.equal(t.e.refs?.decisionId, 'OW-1');
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: magic links.`);
  git(t.repo.dir, 'commit', '-qam', 'journal');
  git(t.repo.dir, 'push', '-q', 'origin', 'main');
  const r = await t.scan();
  assert.deepEqual([r?.outcome, r?.location?.where], ['recorded-differently', 'merged-into-main']);
  const check = await t.ft.settledFor(t.floor.id);
  assert.equal(check('OW-1'), 'pending', 'merged, but not as given');
  assert.equal(check('OW-9'), undefined, 'no answer revision: legacy');
  const project = { file: 'PROJECT.md', text: '## Open questions\n\n| ID | Question | Owner | Status |\n| --- | --- | --- | --- |\n| OW-1 | SSO or magic links? | PM | open since 2026-10-01 |\n\n## Decisions\n\n| ID | Decision | Status |\n| --- | --- | --- |\n| D-1 | OW-1: magic links | CONFIRMED 2026-10-14 |\n' };
  const base = { now: Date.parse('2026-10-15T12:00:00Z'), settings: { ...STUCK_DEFAULTS, on: true }, pulls: [], files: { project, reports: [] }, firstSeen: () => Date.parse('2026-10-01T00:00:00Z') };
  const strict = detectStuck({ ...base, settled: check });
  const d = strict.find((x) => x.id === 'decision-OW-1');
  assert.ok(d, 'still open: recorded differently never clears it');
  assert.match(d!.evidence[0].label, /not recorded as given and merged/);
  // legacy-items-unchanged: without an answer revision, CONFIRMED settles it as before.
  assert.equal(detectStuck(base).find((x) => x.id === 'decision-OW-1'), undefined);
  // Recorded as given and merged: settled.
  writeFileSync(path.join(t.repo.dir, JOURNAL), `# Development team journal\n\nDecided per ESC-${t.e.id} rev 1: Use SSO.\n`);
  git(t.repo.dir, 'commit', '-qam', 'fix');
  git(t.repo.dir, 'push', '-q', 'origin', 'main');
  await t.scan();
  const now = await t.ft.settledFor(t.floor.id);
  assert.equal(now('OW-1'), 'faithful');
  assert.equal(detectStuck({ ...base, settled: now }).find((x) => x.id === 'decision-OW-1'), undefined);
});

test('legacy-items-unchanged: an escalation answered with no answer revision is not followed through', async () => {
  const t = await team();
  delete t.e.resolution!.answerRev;
  assert.equal((await t.ft.view(t.floor.id, true)).items.length, 0);
  assert.equal(await t.scan(), undefined);
});

test('dismiss: the follow-through of this revision stops (a new revision shows again)', async () => {
  const t = await team();
  assert.equal((await t.ft.view(t.floor.id, true)).items.length, 1);
  assert.ok((await t.ft.act(t.floor.id, `esc:${t.e.id}`, 'dismiss', { by: 'Keith', expectedRev: 1 })).ok);
  assert.equal((await t.ft.view(t.floor.id, true)).items.length, 0);
  const line = await t.o.roster.dispatch.answers.append(t.floor.id, { decision: `esc:${t.e.id}`, kind: 'reply', text: 'Go with: Use magic links', by: 'Keith', at: 2 });
  t.e.resolution!.answerRev = line.rev;
  assert.equal((await t.ft.view(t.floor.id, true)).items.length, 1);
});
