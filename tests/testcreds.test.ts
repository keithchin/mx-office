// Test offices can't reach GitHub with real credentials (server/testcreds.ts): in test mode the office
// drops GH_TOKEN and friends from its environment as it starts, gives gh an empty config and git no
// credential helper, and 🔌 Connections hands out no outside token (stored, launcher or dot-file), so a
// real gh that runs where a fake was meant (a gh.cmd fake ahead of the real gh.exe, 2026-10-11) has no
// login to use. Outside test mode nothing changes; a test with a fake gh may let tokens through with
// AGENT_OFFICE_TEST_ALLOW_GH_TOKEN=1. Never a real token here: the values are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dropTestCredentials, forgetDroppedCredentials, ALLOW_TOKEN_ENV } from '../src/server/testcreds.js';
import { useTestMode } from '../src/server/testmode.js';
import { closeConnections, openConnections, connectionsVault, storedSecret } from '../src/server/connections/store.js';
import { fileCipher } from '../src/server/connections/vault.js';
import { credential, resolveCredential } from '../src/server/connections/resolve.js';
import { readAdminToken } from '../src/server/wizard/admin-token.js';
import { removeDir } from './support/cleanup.js';
import { isWin, runnable } from './support/winshim.js';

const FAKE = 'ghp_fakeTokenForTestsOnly000000000000';
const root = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), 'testcreds-')));

test('a test office drops every GitHub variable, gives gh an empty config and git no credential helper, and says so once', (t) => {
  const dir = path.join(root(), 'test-office-x');
  t.after(() => removeDir(path.dirname(dir)));
  const env: NodeJS.ProcessEnv = { GH_TOKEN: FAKE, GITHUB_TOKEN: FAKE, GH_ENTERPRISE_TOKEN: FAKE, GITHUB_ENTERPRISE_TOKEN: FAKE, PATH: 'x' };
  const said: string[] = [];
  assert.equal(dropTestCredentials({ dir }, env, (l) => said.push(l)), true, 'its folder alone puts it in test mode');
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) assert.equal(env[k], undefined, k);
  assert.ok(env.GH_CONFIG_DIR && existsSync(env.GH_CONFIG_DIR) && readdirSync(env.GH_CONFIG_DIR).length === 0, 'an empty gh config');
  assert.equal(env.GIT_CONFIG_KEY_0, 'credential.helper');
  assert.equal(env.GIT_CONFIG_VALUE_0, '');
  assert.equal(said.length, 1);
  assert.match(said[0], /GitHub credentials dropped \(GH_TOKEN, GITHUB_TOKEN, GH_ENTERPRISE_TOKEN, GITHUB_ENTERPRISE_TOKEN\)/);
  assert.ok(!said[0].includes(FAKE));
  // A later start empties the folder again, whatever gh wrote there.
  writeFileSync(path.join(env.GH_CONFIG_DIR!, 'hosts.yml'), 'github.com: {}');
  const again: NodeJS.ProcessEnv = { GH_TOKEN: FAKE };
  dropTestCredentials({ testMode: true, dir }, again, () => undefined);
  assert.deepEqual(readdirSync(again.GH_CONFIG_DIR!), []);
});

test('outside test mode, or with the test-only override, the environment is left as it is', () => {
  const real: NodeJS.ProcessEnv = { GH_TOKEN: FAKE };
  assert.equal(dropTestCredentials({ dir: path.join(os.tmpdir(), 'my-office') }, real, () => assert.fail('no log')), false);
  assert.deepEqual(real, { GH_TOKEN: FAKE });
  const allowed: NodeJS.ProcessEnv = { GH_TOKEN: FAKE, [ALLOW_TOKEN_ENV]: '1' };
  assert.equal(dropTestCredentials({ testMode: true, dir: 'x' }, allowed, () => undefined), false);
  assert.equal(allowed.GH_TOKEN, FAKE);
});

test('🔌 Connections hands out no outside token in test mode: not a stored one, not the admin token file; a real office is unchanged', async (t) => {
  const dir = root();
  t.after(() => {
    useTestMode(undefined);
    delete process.env[ALLOW_TOKEN_ENV];
    closeConnections();
    removeDir(dir);
  });
  openConnections(dir, fileCipher);
  await connectionsVault()!.set('github-agents', FAKE, 'test');
  await connectionsVault()!.set('mendix', 'mx-fake-pat', 'test');
  const adminFile = path.join(dir, 'admin-token');
  writeFileSync(adminFile, `${FAKE}\n`);
  // A real office: everything as saved.
  assert.equal(credential('github-agents'), FAKE);
  assert.equal(storedSecret('mendix'), 'mx-fake-pat');
  assert.equal(readAdminToken(adminFile), FAKE);
  // A test office: nothing, wherever it would come from.
  useTestMode({ flag: true, agentCmd: 'fake', agentExplicit: true });
  assert.equal(credential('github-agents'), undefined);
  assert.deepEqual(resolveCredential('github-agents'), {});
  assert.equal(storedSecret('github-agents'), undefined, 'the vault itself withholds it');
  assert.equal(credential('mendix'), undefined);
  assert.equal(readAdminToken(adminFile), undefined);
  // The test-only override (a test driving a fake gh).
  process.env[ALLOW_TOKEN_ENV] = '1';
  assert.equal(credential('github-agents'), FAKE);
});

test('a test office started with GH_TOKEN and a misresolved gh: the gh that really runs has no token and no login, and git no credential helper', { skip: !isWin && 'the misresolution (a .cmd fake ahead of a real gh.exe) is Windows-only' }, (t) => {
  const base = root();
  t.after(() => removeDir(base));
  const office = path.join(base, 'test-office-creds');
  const fakeDir = path.join(office, 'fakebin');
  const realDir = path.join(base, 'Program Files', 'GitHub CLI');
  mkdirSync(fakeDir, { recursive: true });
  mkdirSync(realDir, { recursive: true });
  // The fake that was meant: a .cmd, which execFile never runs.
  writeFileSync(path.join(fakeDir, 'gh.cmd'), '@echo off\r\necho fake\r\n');
  // Standing in for the real gh.exe: it writes down what it could have used.
  const seen = path.join(base, 'seen.json');
  const spy = path.join(realDir, 'gh');
  writeFileSync(spy, `#!/usr/bin/env node\nconst fs = require('fs');\nconst d = process.env.GH_CONFIG_DIR;\nfs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ GH_TOKEN: process.env.GH_TOKEN ?? null, GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null, ENT: process.env.GH_ENTERPRISE_TOKEN ?? null, configDir: d ?? null, configFiles: d && fs.existsSync(d) ? fs.readdirSync(d) : null }));\n`);
  runnable(spy);
  // The office's own start, in a process of its own: test mode by its folder, a token in its environment and in Connections.
  const script = path.join(base, 'start.mts');
  const src = (p: string) => JSON.stringify(pathToFileURL(path.join(import.meta.dirname, '..', 'src', 'server', p)).href);
  writeFileSync(
    script,
    `import { execFileSync } from 'node:child_process';
import { dropTestCredentials } from ${src('testcreds.ts')};
import { openConnections, connectionsVault } from ${src('connections/store.ts')};
import { fileCipher } from ${src('connections/vault.ts')};
import { applyAgentToken, credential } from ${src('connections/resolve.ts')};
import { childEnv } from ${src('workers/env.ts')};
dropTestCredentials({ dir: ${JSON.stringify(office)} });
openConnections(${JSON.stringify(path.join(office, '.agent-office'))}, fileCipher);
await connectionsVault().set('github-agents', ${JSON.stringify(FAKE)}, 'test');
applyAgentToken();
execFileSync('gh', ['api', 'user'], { stdio: 'ignore' });
const helpers = execFileSync('git', ['config', '--get-all', 'credential.helper'], { encoding: 'utf8' }).split(/\\r?\\n/).filter((l, i, a) => i < a.length - 1);
const worker = childEnv();
console.log(JSON.stringify({ credential: credential('github-agents') ?? null, envToken: process.env.GH_TOKEN ?? null, workerToken: worker.GH_TOKEN ?? null, workerConfig: worker.GH_CONFIG_DIR, lastHelper: helpers[helpers.length - 1] ?? null }));
`,
  );
  const env = { ...process.env, GH_TOKEN: FAKE, GITHUB_TOKEN: FAKE, GH_ENTERPRISE_TOKEN: FAKE, PATH: [fakeDir, realDir, process.env.PATH].join(';') };
  delete (env as Record<string, string | undefined>).AGENT_OFFICE_TEST_ALLOW_GH_TOKEN;
  const out = execFileSync(process.execPath, ['--import', 'tsx', script], { cwd: path.join(import.meta.dirname, '..'), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const r = JSON.parse(out.trim().split(/\r?\n/).pop()!);
  const g = JSON.parse(readFileSync(seen, 'utf8'));
  assert.deepEqual({ GH_TOKEN: g.GH_TOKEN, GITHUB_TOKEN: g.GITHUB_TOKEN, ENT: g.ENT }, { GH_TOKEN: null, GITHUB_TOKEN: null, ENT: null }, 'the gh that really ran had no token');
  assert.deepEqual(g.configFiles, [], 'and an empty config: no stored login');
  assert.equal(r.credential, null, 'Connections hands out nothing');
  assert.equal(r.envToken, null, 'nor puts it back in the environment');
  assert.equal(r.workerToken, null, "an agent's environment has none either");
  assert.equal(r.workerConfig, g.configDir, 'and the same empty gh config');
  assert.equal(r.lastHelper, '', "git's credential helpers are cleared");
});

test.after(() => forgetDroppedCredentials());
