// The setup panel reads a toolkit project's gates from its default branch on GitHub, not from whatever
// branch the floor's folder is on (src/server/wizard/gate-source.ts), and renders the verdicts again
// in a temporary worktree when that branch moves. Temp git repos: a bare "origin" and a floor clone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GateSource, branchInfo, defaultBranch } from '../src/server/wizard/gate-source.js';
import { setupView, setupViewOf } from '../src/server/wizard/setup.js';
import { collectNeeds, STALE_COMMITS } from '../src/client/ui/needsyou/logic.js';

const REGISTER = '# Project\n\nEntry mode: Requirements-driven\n\n## Decisions\n\n| Stage | Decision | Status |\n|---|---|---|\n';
const dashboard = (stage0: string) => `<table><tr><td>0</td><td>Triage</td><td>${stage0}</td><td>why</td></tr></table>`;

function repos(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-gates-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' }).toString().trim();
  const put = (dir: string, file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  const origin = path.join(root, 'origin.git');
  g(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  g(root, 'clone', '-q', origin, seed);
  g(seed, 'checkout', '-q', '-b', 'main');
  put(seed, 'PROJECT.md', REGISTER);
  put(seed, 'index.html', dashboard('FAIL'));
  put(seed, 'triage.md', '## Sign-off\n\n(placeholder)\n');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'scaffold');
  g(seed, 'push', '-q', 'origin', 'main');
  const floor = path.join(root, 'floor');
  g(root, 'clone', '-q', origin, floor);
  // The floor's folder goes off on an old branch, and main moves on without it.
  g(floor, 'checkout', '-q', '-b', 'run4/discovery-p-4');
  put(seed, 'triage.md', '## Sign-off\n\nSigned off by the PM.\n');
  put(seed, 'index.html', dashboard('PASS'));
  g(seed, 'commit', '-qam', 'triage signed off');
  for (let i = 0; i < 11; i++) {
    put(seed, `docs/n${i}.md`, `${i}`);
    g(seed, 'add', '.');
    g(seed, 'commit', '-qm', `n${i}`);
  }
  g(seed, 'push', '-q', 'origin', 'main');
  g(floor, 'fetch', '-q', 'origin');
  return { root, origin, seed, floor, g, put };
}

const worktreeCount = (g: (cwd: string, ...a: string[]) => string, dir: string) => g(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

test('the default branch comes from origin/HEAD, else main or master, and the folder says how far behind it is', (t) => {
  const { floor, g } = repos(t);
  return (async () => {
    assert.equal(await defaultBranch(floor), 'main');
    g(floor, 'remote', 'set-head', 'origin', '-d');
    assert.equal(await defaultBranch(floor), 'main', 'no origin/HEAD: main');
    const info = await branchInfo(floor);
    assert.equal(info?.branch, 'run4/discovery-p-4');
    assert.equal(info?.def, 'main');
    assert.equal(info?.behind, 12);
  })();
});

test('the gates are read from origin/<default>, not the folder (which still says Stage 0 FAIL)', async (t) => {
  const { floor } = repos(t);
  const gates = new GateSource(async () => undefined, { fetch: false, throttleMs: 60_000 });
  // Folder: the stale dashboard.
  assert.equal(setupView(floor).stages.find((s) => s.id === '0')?.status, 'FAIL');
  const r = await gates.read(floor);
  assert.ok(r);
  assert.match(r.files['triage.md'] ?? '', /Signed off by the PM/);
  assert.equal(setupViewOf(r.files).stages.find((s) => s.id === '0')?.status, 'PASS');
  assert.deepEqual({ branch: r.info.branch, behind: r.info.behind, def: r.info.def }, { branch: 'run4/discovery-p-4', behind: 12, def: 'main' });
  await gates.regenerate(floor, r.info);
});

test('no remote: nothing from the default branch, and the panel reads the folder as before', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-gates-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  writeFileSync(path.join(root, 'PROJECT.md'), REGISTER);
  writeFileSync(path.join(root, 'index.html'), dashboard('PASS'));
  assert.equal(await defaultBranch(root), undefined);
  assert.equal(await new GateSource(async () => undefined, { fetch: false }).read(root), undefined);
  assert.equal(setupView(root).stages.find((s) => s.id === '0')?.status, 'PASS');
});

test('gate-check runs on origin/<default> in a temporary worktree that is removed afterwards; throttled, one at a time', async (t) => {
  const { floor, g } = repos(t);
  const ran: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let clock = 1_000_000;
  const gates = new GateSource(
    async (tmp, floorDir) => {
      ran.push(tmp);
      assert.equal(floorDir, floor);
      assert.ok(existsSync(path.join(tmp, 'triage.md')), 'a checkout of origin/main');
      assert.notEqual(path.resolve(tmp), path.resolve(floor));
      await gate;
      writeFileSync(path.join(tmp, 'index.html'), dashboard('PASS') + '<!-- rendered -->');
    },
    { fetch: false, throttleMs: 180_000 },
    () => clock,
  );
  const before = worktreeCount(g, floor);
  const first = await gates.read(floor);
  assert.ok(first);
  // origin/main moved since anything was rendered: a run started by itself.
  assert.equal(first.regenerating, true);
  assert.equal(gates.regenerate(floor, first.info), gates.regenerate(floor, first.info), 'one at a time: the running one is handed back');
  release();
  await gates.regenerate(floor, first.info);
  assert.equal(ran.length, 1);
  assert.equal(existsSync(ran[0]), false, 'the temporary worktree is gone');
  assert.equal(worktreeCount(g, floor), before, 'and git forgot it');
  const after = await gates.read(floor);
  assert.match(after?.files['index.html'] ?? '', /rendered/);
  assert.equal(after?.renderedAt, clock);
  // Throttled: not again within a few minutes, unless asked; then again after.
  assert.equal(gates.regenerate(floor, first.info), undefined);
  clock += 60_000;
  assert.equal(gates.regenerate(floor, first.info), undefined);
  await gates.regenerate(floor, first.info, true);
  assert.equal(ran.length, 2);
  clock += 181_000;
  await gates.regenerate(floor, first.info);
  assert.equal(ran.length, 3);
  assert.equal(readdirSync(tmpdir()).filter((d) => ran.some((r) => path.basename(r) === d)).length, 0);
  // The floor's own folder was never written to.
  assert.equal(g(floor, 'status', '--porcelain'), '');
});

test('a gate-check that fails or hangs still cleans up, and is given up on after the time limit', async (t) => {
  const { floor, g } = repos(t);
  const seen: string[] = [];
  const gates = new GateSource(
    async (tmp) => {
      seen.push(tmp);
      await new Promise(() => undefined);
    },
    { fetch: false, timeoutMs: 200 },
  );
  const info = (await branchInfo(floor))!;
  await gates.regenerate(floor, info, true);
  assert.equal(existsSync(seen[0]), false);
  assert.equal(worktreeCount(g, floor), 1);
  assert.equal(gates.busy(floor), false);
});

test('Needs you mentions a floor folder only when it is more than ten commits behind', () => {
  const setup = (behind: number) => ({ show: true, stages: [], questions: [], checking: false, checkout: { branch: 'run4/discovery-p-4', behind, defaultBranch: 'main' } });
  const base = { floor: 'f1', workers: [], pulls: [], floors: [] };
  const far = collectNeeds({ ...base, setup: setup(STALE_COMMITS + 13) });
  assert.deepEqual(far.map((n) => [n.key, n.level, n.text]), [['setup-stale', 'warn', "This floor's folder is on run4/discovery-p-4, 23 commits behind main"]]);
  assert.deepEqual(collectNeeds({ ...base, setup: setup(3) }), []);
});
