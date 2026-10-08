import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeConfigFile, forgetTrust, isolated, trustFloor, trustFolders, trustKey, trusts } from '../src/server/claude-trust.js';

const fresh = (t: { after(fn: () => void): void }) => {
  forgetTrust();
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-trust-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("Claude Code's config file: CLAUDE_CONFIG_DIR's .claude.json, the legacy .config.json when it's there", (t) => {
  const dir = fresh(t);
  assert.equal(claudeConfigFile({ CLAUDE_CONFIG_DIR: dir }), path.join(dir, '.claude.json'));
  writeFileSync(path.join(dir, '.config.json'), '{}');
  assert.equal(claudeConfigFile({ CLAUDE_CONFIG_DIR: dir }), path.join(dir, '.config.json'));
});

test('keys are absolute with forward slashes on Windows, as Claude Code writes them', () => {
  assert.equal(trustKey('C:\\Users\\me\\agent-office\\Org\\app', 'win32'), path.resolve('C:\\Users\\me\\agent-office\\Org\\app').replaceAll('\\', '/'));
  assert.equal(trustKey('/home/me/app', 'linux'), path.resolve('/home/me/app'));
});

test('a floor is marked trusted without touching anything else in the file, and only written when needed', (t) => {
  const dir = fresh(t);
  const file = path.join(dir, '.claude.json');
  const floor = path.join(dir, 'projects', 'Org', 'app');
  const other = { numStartups: 7, oauthAccount: { emailAddress: 'x@example.com' }, projects: { '/elsewhere': { allowedTools: ['Bash'], hasTrustDialogAccepted: false } } };
  writeFileSync(file, JSON.stringify(other));
  assert.equal(trustFloor(floor, { CLAUDE_CONFIG_DIR: dir }), 'trusted');
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(after.oauthAccount, other.oauthAccount);
  assert.equal(after.numStartups, 7);
  assert.deepEqual(after.projects['/elsewhere'], other.projects['/elsewhere']);
  assert.equal(after.projects[trustKey(floor)].hasTrustDialogAccepted, true);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temporary file left behind');

  // Already trusted (this run, or by Claude Code itself): the file isn't written again.
  writeFileSync(file, JSON.stringify({ ...after, numStartups: 8 }));
  forgetTrust();
  const before = readFileSync(file, 'utf8');
  assert.equal(trustFloor(floor, { CLAUDE_CONFIG_DIR: dir }), 'already');
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('an existing entry keeps its other fields; a missing file is made; a corrupt one is left alone', (t) => {
  const dir = fresh(t);
  const floor = path.join(dir, 'floor');
  const file = path.join(dir, 'a.json');
  writeFileSync(file, JSON.stringify({ projects: { [trustKey(floor)]: { allowedTools: ['Read'], lastCost: 1.5 } } }));
  assert.equal(trustFolders(file, [floor]), 'trusted');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).projects[trustKey(floor)], { allowedTools: ['Read'], lastCost: 1.5, hasTrustDialogAccepted: true });

  const missing = path.join(dir, 'b.json');
  assert.equal(trustFolders(missing, [floor]), 'trusted');
  assert.equal(JSON.parse(readFileSync(missing, 'utf8')).projects[trustKey(floor)].hasTrustDialogAccepted, true);

  for (const bad of ['{"projects": {', '[1, 2]', '"text"', '{"projects": 3}']) {
    const corrupt = path.join(dir, 'c.json');
    writeFileSync(corrupt, bad);
    forgetTrust();
    assert.equal(trustFolders(corrupt, [floor]), 'unreadable', bad);
    assert.equal(readFileSync(corrupt, 'utf8'), bad, 'left as it was');
  }
});

test("trust on a floor's checkout covers its worktrees when asked (ancestors), case-blind on Windows", () => {
  const config = { projects: { 'C:/Users/me/agent-office/Org/app': { hasTrustDialogAccepted: true }, 'C:/Users/me/other': { hasTrustDialogAccepted: false } } };
  const wt = 'C:\\Users\\me\\agent-office\\Org\\app\\.agent-office\\worktrees\\ada';
  if (process.platform === 'win32') {
    assert.equal(trusts(config, wt, { ancestors: true, platform: 'win32' }), true);
    assert.equal(trusts(config, wt, { platform: 'win32' }), false, 'not by its own key');
    assert.equal(trusts(config, 'c:\\users\\me\\agent-office\\org\\app', { platform: 'win32' }), true);
    assert.equal(trusts(config, 'C:\\Users\\me\\other\\x', { ancestors: true, platform: 'win32' }), false);
  }
  const posix = { projects: { '/home/me/app': { hasTrustDialogAccepted: true } } };
  assert.equal(trusts(posix, '/home/me/app/.agent-office/worktrees/ada', { ancestors: true, platform: 'linux' }), process.platform !== 'win32');
  assert.equal(trusts(posix, '/home/me/apple', { ancestors: true, platform: 'linux' }), false);
});

test("a test folder is never trusted in a real config: tests and test offices don't write the person's ~/.claude.json", (t) => {
  const dir = fresh(t);
  const realish = path.join(path.parse(dir).root, 'Users', 'someone', '.claude.json');
  assert.equal(isolated(realish, path.join(dir, 'floor')), false, 'a temporary floor, a real config');
  assert.equal(isolated(realish, path.join('C:', 'x', 'scratch', 'test-offices', 'busy', 'floor')), false, "a test office's floor");
  assert.equal(isolated(path.join(dir, '.claude.json'), path.join(dir, 'floor')), true);
  assert.equal(isolated(realish, path.join(path.parse(dir).root, 'Users', 'someone', 'agent-office', 'Org', 'app')), true, 'a real floor, a real config');
});

test("a Claude worker's start marks its floor trusted in the config it starts with, the office's or its account's", async (t) => {
  const dir = fresh(t);
  const { claude } = await import('../src/server/providers/claude.js');
  const floor = path.join(dir, 'projects', 'Org', 'app');
  const plan = claude.launch({ h: { info: { id: 'w1', kind: 'agent' } } as never, args: [], cwd: path.join(floor, '.agent-office', 'worktrees', 'ada'), setup: { settings: 'hooks.json', floorDir: floor } } as never);
  for (const config of ['office', 'account']) {
    const env = { CLAUDE_CONFIG_DIR: path.join(dir, config) };
    mkdirSync(env.CLAUDE_CONFIG_DIR);
    plan.finishEnv!(env);
    const saved = JSON.parse(readFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'), 'utf8'));
    // The floor's checkout: Claude Code looks a worktree's trust up by the checkout it belongs to.
    assert.deepEqual(Object.keys(saved.projects), [trustKey(floor)], config);
    assert.equal(saved.projects[trustKey(floor)].hasTrustDialogAccepted, true);
  }
});
