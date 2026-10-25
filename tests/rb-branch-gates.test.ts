// Real-build fixes: the gates on the team's working branch are shown next to main's (server/wizard/branch-gates.ts,
// docs/mockups/product-assessment/real-build-test.md P1-5). The lead answered the intake and recorded the Stage 0
// sign-off on its branch while the Overview read Kickoff PENDING from main.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { branchAhead, teamBranchGates } from '../src/server/wizard/branch-gates.js';
import { setupViewOf } from '../src/server/wizard/setup.js';
import { derivePhases } from '../src/shared/progress.js';
import { segmentDetail } from '../src/client/ui/progress/bar.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

const register = (rows: string[]) => `# Project\n\n**Entry mode:** Greenfield\n\n## Decisions\n\n| Stage | Decision | Status | Notes |\n|---|---|---|---|\n${rows.join('\n')}\n`;
const MAIN_ROWS = ['| P | Entry mode: Greenfield | CONFIRMED 2026-10-24 | wizard |', '| 0 | Scope: project brief approved | CONFIRMED 2026-10-24 | wizard |'];
const intake = (answered: boolean) => `# intake.md\n\n## 1. Entry mode?\n\nAnswered (CONFIRMED): greenfield\n\n## 3. Fidelity?\n\n${answered ? 'Answered (CONFIRMED): improve as we go' : '_Not yet asked._'}\n`;

test('what the branch has that main hasn’t: the intake answered there, and new CONFIRMED decisions (never an artifact waiver)', () => {
  const main = setupViewOf({ 'PROJECT.md': register(MAIN_ROWS), 'intake.md': intake(false) });
  const branch = setupViewOf({
    'PROJECT.md': register([...MAIN_ROWS, '| 0 | Stage 0 triage and scope: 1 module | CONFIRMED 2026-10-24 | triage.md signed off |', '| 5 | Waived artifact improvement-register-html: small tier | CONFIRMED 2026-10-24 | tier |']),
    'intake.md': intake(true),
  });
  const ahead = branchAhead(main, branch);
  assert.deepEqual(
    ahead.map((x) => x.id),
    ['P', '0'],
  );
  assert.equal(ahead[0].text, 'every intake question answered');
  assert.match(ahead[1].text, /^confirmed: Stage 0 triage and scope/);
});

test('from git: the team’s newest branch ahead of main is read, and Progress says "on the team’s branch (not merged)" next to main’s state', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rb-branch-gates-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(dir, 'PROJECT.md'), register(MAIN_ROWS));
    writeFileSync(path.join(dir, 'intake.md'), intake(false));
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'scaffold');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'office/pixel-a20c');
    writeFileSync(path.join(dir, 'intake.md'), intake(true));
    git(dir, 'commit', '-q', '-am', 'kickoff answers');
    git(dir, 'checkout', '-q', 'main');
    const tb = await teamBranchGates(dir, 'main', mainSha, { 'PROJECT.md': register(MAIN_ROWS), 'intake.md': intake(false) });
    assert.ok(tb);
    assert.equal(tb!.branch, 'office/pixel-a20c');
    assert.equal(tb!.ahead, 1);
    assert.deepEqual(tb!.stages, [{ id: 'P', text: 'every intake question answered' }]);
    // The Overview's Progress card: main's state kept, the branch's said beside it.
    const phases = derivePhases({ toolkit: true, entry: 'greenfield', verdicts: [{ id: 'P', title: 'Kickoff', status: 'PENDING', detail: '1 intake question still to ask' }], decisions: [], acceptance: { version: 'v1', cycle: 1, earlier: [] }, teamBranch: tb });
    const p = phases.find((x) => x.id === 'P')!;
    assert.equal(p.status, 'pending', 'main still says pending');
    assert.equal(p.onBranch?.branch, 'office/pixel-a20c');
    assert.match(segmentDetail(p), /^on the team's branch \(not merged\) · main: not started/);
    assert.ok(p.measures.some((m) => /On the team's branch \(not merged\): every intake question answered \(office\/pixel-a20c @[0-9a-f]{7}\)/.test(m)));
    // Merged: nothing ahead, nothing said.
    git(dir, 'merge', '-q', '--ff-only', 'office/pixel-a20c');
    assert.equal(await teamBranchGates(dir, 'main', git(dir, 'rev-parse', 'HEAD'), { 'PROJECT.md': register(MAIN_ROWS), 'intake.md': intake(true) }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
