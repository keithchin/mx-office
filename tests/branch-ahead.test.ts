// "main is behind the work" (shared/branch-ahead.ts, server/branch-ahead/): an agent's branch ahead of main
// with model changes and an open PR is named with its review state; a branch with no model changes, or
// merged, isn't; and the lead's ask says what the review gate wants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aheadLine, reviewAsk, type AheadBranch } from '../src/shared/branch-ahead.js';
import { aheadOf, reviewOf } from '../src/server/branch-ahead/index.js';
import type { GhPull } from '../src/shared/protocol.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
const sophie: AheadBranch = { branch: 'office/pixel-b1e9', sha: 'abc', owner: 'Sophie', ahead: 75, modelFiles: 40, pr: { number: 6, url: 'https://x/6' }, review: { state: 'not-reviewed' } };

test('the banner line: whose branch, how far ahead, its PR and review state; several listed compactly', () => {
  assert.equal(aheadLine({ main: 'main', branches: [sophie] }), "main is 75 commits behind Sophie's branch, which has model changes (PR #6, open, not reviewed)");
  const two = aheadLine({ main: 'main', branches: [sophie, { branch: 'office/rhea-1', sha: 'd', owner: 'Rhea', ahead: 3, modelFiles: 2, review: { state: 'no-pr' } }] });
  assert.match(two, /; also Rhea's branch \(3 ahead, no PR yet\)$/);
  assert.equal(aheadLine({ main: 'main', branches: [] }), '');
  assert.match(aheadLine({ main: 'main', branches: [{ ...sophie, review: { state: 'reviewed', by: ['Katherine'] } }] }), /reviewed by Katherine/);
  const ask = reviewAsk('main', sophie);
  assert.match(ask, /review of PR #6 \(office\/pixel-b1e9\), Sophie's work: it is 75 commits ahead of main with model changes \(40 model files\)/);
  assert.match(ask, /`Review:` comment on the PR naming the reviewer, each check with its result, and the files read/);
});

test('review state by the review gate: a complete Review: by someone other than the opener', () => {
  const pr = (bodies: string[]) => ({ number: 6, reviewNotes: bodies.map((body) => ({ author: 'bot', body, at: '2026-10-17T00:00:00Z' })) }) as unknown as GhPull;
  const full = (who: string) => `Review: ${who}\nChecks:\n- mx check: pass\nFiles read:\n- mdlsource/3-sheet/08.mdl`;
  assert.deepEqual(reviewOf(undefined, 'Sophie'), { state: 'no-pr' });
  assert.deepEqual(reviewOf(pr([]), 'Sophie'), { state: 'not-reviewed' });
  assert.deepEqual(reviewOf({ number: 6 } as GhPull, 'Sophie'), { state: 'unknown' }, 'comments never read: not "not reviewed"');
  assert.match(aheadLine({ main: 'main', branches: [{ ...sophie, review: { state: 'unknown' } }] }), /\(PR #6, open, review not checked yet\)$/);
  assert.deepEqual(reviewOf(pr([full('Sophie')]), 'Sophie'), { state: 'not-reviewed' }, 'its own opener does not count');
  assert.deepEqual(reviewOf(pr(['Review: Katherine\nlooks fine']), 'Sophie'), { state: 'not-reviewed' }, 'no checks and files: not a review');
  assert.deepEqual(reviewOf(pr([full('Katherine')]), 'Sophie'), { state: 'reviewed', by: ['Katherine'] });
});

test('from the repo: the branch ahead with model changes and an open PR is listed; one with docs only and a merged one are not', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ahead-'));
  try {
    const origin = path.join(dir, 'origin');
    mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(origin, 'App.mpr'), 'v1');
    git(origin, 'add', '.');
    git(origin, 'commit', '-q', '-m', 'starter');
    for (const [b, file] of [
      ['office/pixel-b1e9', 'mdlsource/3-sheet/08.mdl'],
      ['office/docs-1', 'docs/notes.md'],
    ]) {
      git(origin, 'checkout', '-q', '-b', b, 'main');
      for (let i = 0; i < 3; i++) {
        mkdirSync(path.dirname(path.join(origin, file)), { recursive: true });
        writeFileSync(path.join(origin, file), `v${i}`);
        git(origin, 'add', '.');
        git(origin, 'commit', '-q', '-m', `${b} ${i}`);
      }
    }
    git(origin, 'checkout', '-q', 'main');
    const floorDir = path.join(dir, 'floor');
    git(dir, 'clone', '-q', origin, floorDir);
    const pull = (number: number, head: string): GhPull => ({ number, title: `pr ${number}`, state: 'OPEN', isDraft: false, url: `https://x/${number}`, headRefName: head, body: 'Opened by Sophie (Lead Developer) via Mx Office', checks: 'pass', updatedAt: '', author: 'bot', reviewNotes: [] }) as unknown as GhPull;
    const floor = { id: 'demo', dir: floorDir, workers: { list: () => [] }, github: { pulls: { items: [pull(6, 'office/pixel-b1e9'), pull(7, 'office/docs-1')] } } };
    const v = await aheadOf({ cfg: {} } as never, floor as never);
    assert.equal(v.main, 'main');
    assert.deepEqual(
      v.branches.map((b) => [b.branch, b.ahead, b.modelFiles, b.owner, b.pr?.number, b.review.state]),
      [['office/pixel-b1e9', 3, 1, 'Sophie', 6, 'not-reviewed']],
    );
    assert.equal(v.lead, undefined, 'no team here: no one to ask');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
