// 🔌 Connections (server/connections/, shared/connections.ts): the vault (DPAPI on Windows, a 0600
// file elsewhere), which value of each credential the office uses (Connections → environment variable →
// dot-file), the Test calls against a fake fetch, the workers' environment, the office password, the
// wizard's admin token, Jeff's key and the git / gh check. Every value here is a made-up stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CREDENTIAL_META, githubTokenUrl, maskTail, withExpiry } from '../src/shared/connections.js';
import { Vault, dpapiCipher, fileCipher } from '../src/server/connections/vault.js';
import { dotenvValue, resolveCredential, type ResolveDeps } from '../src/server/connections/resolve.js';
import { closeConnections, openConnections, officeSettings, updateOfficeSettings, toolkitDirState } from '../src/server/connections/store.js';
import { parseGithubExpiry, testGithub, testMendix } from '../src/server/connections/checks.js';
import { withConnections, mendixOn } from '../src/server/connections/env.js';
import { changePassword, passwordProblem } from '../src/server/connections/password.js';
import { checkTools, cleanIdentity, type Runner } from '../src/server/connections/tools.js';
import { adminTokenConfigured, adminTokenSource, readAdminToken } from '../src/server/wizard/admin-token.js';
import { JevKey } from '../src/server/judge/key.js';

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));
const FAKE_GH = `github_pat_${'A1b2C3d4'.repeat(4)}fake`;
const OTHER_GH = `github_pat_${'Z9y8X7w6'.repeat(4)}other`;

test('the vault keeps values encrypted on disk, reads them back, and keeps only a masked tail and the last test beside them', async () => {
  const dir = tmp('cx-vault-');
  const file = path.join(dir, 'credentials.json');
  const v = new Vault(file, fileCipher).load();
  await v.set('github-agents', `  ${FAKE_GH}\n`, 'Probe');
  assert.equal(v.get('github-agents'), FAKE_GH);
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes(FAKE_GH), 'the value is never on disk as it is');
  assert.equal(v.entry('github-agents')?.tail, maskTail(FAKE_GH));
  assert.equal(v.entry('github-agents')?.savedBy, 'Probe');
  v.setCheck('github-agents', FAKE_GH, { at: 1, status: 'connected', summary: 'ok' });
  const again = new Vault(file, fileCipher).load();
  assert.equal(again.get('github-agents'), FAKE_GH);
  assert.equal(again.check('github-agents', FAKE_GH)?.summary, 'ok');
  assert.equal(again.check('github-agents', OTHER_GH), undefined, 'a test of another value does not count');
  // Written with another scheme (another machine): unreadable, not garbage.
  const dpapiFile = JSON.parse(raw);
  dpapiFile.entries['github-agents'].scheme = 'dpapi';
  writeFileSync(file, JSON.stringify(dpapiFile));
  const other = new Vault(file, fileCipher).load();
  assert.equal(other.get('github-agents'), undefined);
  assert.equal(other.entry('github-agents')?.unreadable, true);
  assert.ok(other.remove('github-agents'));
  assert.equal(new Vault(file, fileCipher).load().entry('github-agents'), undefined);
});

test('on Windows the vault uses DPAPI for the current user, through PowerShell, with the value only on stdin', { skip: process.platform !== 'win32' }, async () => {
  const c = dpapiCipher();
  const [enc] = await c.protect(['not-a-real-secret-123']);
  assert.ok(enc.length > 40 && !Buffer.from(enc, 'base64').toString('utf8').includes('not-a-real-secret'));
  assert.deepEqual(c.unprotectSync([enc, 'bm90IGRwYXBp']), ['not-a-real-secret-123', undefined]);
});

test('each credential resolves Connections first, then its environment variable, then its dot-file', () => {
  const home = tmp('cx-home-');
  writeFileSync(path.join(home, '.agent-office-gh-token'), `${FAKE_GH}\n`);
  mkdirSync(path.join(home, 'Mendix'));
  writeFileSync(path.join(home, 'Mendix', '.env'), 'MX_APP_ID=abc\nexport MX_PAT="mx-fake-pat-123456"\n');
  writeFileSync(path.join(home, '.agent-office-jev-key'), 'jev-fake-key\n');
  const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : undefined);
  const deps = (over: Partial<ResolveDeps> = {}): ResolveDeps => ({ env: {}, started: {}, home, stored: () => undefined, read, ...over });

  assert.deepEqual(resolveCredential('github-agents', deps()), { value: FAKE_GH, source: 'file', where: '~/.agent-office-gh-token' });
  // The launcher copies the file into GH_TOKEN: it's the variable, and says where it came from.
  assert.deepEqual(resolveCredential('github-agents', deps({ started: { GH_TOKEN: FAKE_GH } })), { value: FAKE_GH, source: 'env', where: 'GH_TOKEN (from ~/.agent-office-gh-token)' });
  assert.equal(resolveCredential('github-agents', deps({ started: { GITHUB_TOKEN: OTHER_GH } })).where, 'GITHUB_TOKEN');
  assert.deepEqual(resolveCredential('github-agents', deps({ started: { GH_TOKEN: OTHER_GH }, stored: (id) => (id === 'github-agents' ? 'saved' : undefined) })), { value: 'saved', source: 'connections' });

  assert.equal(resolveCredential('mendix', deps()).value, 'mx-fake-pat-123456');
  assert.equal(resolveCredential('mendix', deps({ env: { MX_PAT: 'from-env' } })).value, 'from-env');
  assert.equal(resolveCredential('jev', deps()).value, 'jev-fake-key');
  assert.equal(resolveCredential('jev', deps({ env: { TYPESAFE_API_KEY: 'env-key' } })).value, 'env-key', 'the variable beats the dot-file');
  assert.equal(resolveCredential('jev', deps({ env: { TYPESAFE_API_KEY: 'env-key', AGENT_OFFICE_JEV_KEY_FILE: path.join(home, '.agent-office-jev-key') } })).value, 'jev-fake-key', 'the key file the launcher names beats TYPESAFE_API_KEY, as before');
  assert.equal(resolveCredential('github-admin', deps()).value, undefined);
  writeFileSync(path.join(home, 'admin'), 'admin-fake\n');
  assert.deepEqual(resolveCredential('github-admin', deps({ env: { AGENT_OFFICE_ADMIN_GH_TOKEN_FILE: path.join(home, 'admin') } })).source, 'env');
  // No home (a test, a CLI command): no dot-files are read at all.
  assert.equal(resolveCredential('github-agents', deps({ home: undefined })).value, undefined);
  assert.equal(resolveCredential('password', deps()).value, undefined, 'the password never resolves to a value');
});

test('dotenv values, masks, expiry and the GitHub token link', () => {
  assert.equal(dotenvValue('A=1\n  export MX_PAT = \'x y\'\n', 'MX_PAT'), 'x y');
  assert.equal(dotenvValue('MX_PAT=\n', 'MX_PAT'), undefined);
  assert.equal(maskTail('short'), '••••');
  assert.equal(maskTail(FAKE_GH), `••••${FAKE_GH.slice(-4)}`);
  const now = Date.parse('2026-10-06T00:00:00Z');
  assert.equal(withExpiry('connected', now + 5 * 86_400_000, now), 'expiring');
  assert.equal(withExpiry('connected', now - 1, now), 'invalid');
  assert.equal(withExpiry('connected', now + 60 * 86_400_000, now), 'connected');
  assert.equal(withExpiry('invalid', now + 60 * 86_400_000, now), 'invalid');
  const url = new URL(githubTokenUrl({ name: 'n', description: 'd', owner: 'Org', perms: { contents: 'write' } }));
  assert.equal(url.origin + url.pathname, 'https://github.com/settings/personal-access-tokens/new');
  assert.equal(url.searchParams.get('target_name'), 'Org');
  assert.equal(url.searchParams.get('contents'), 'write');
  assert.match(CREDENTIAL_META['github-agents'].createUrl!('AI-Taskforce-Labs'), /pull_requests=write/);
  assert.match(CREDENTIAL_META['github-admin'].createUrl!('AI-Taskforce-Labs'), /administration=write/);
  assert.ok(CREDENTIAL_META['github-agents'].shape!.test(FAKE_GH));
  assert.equal(parseGithubExpiry('2026-11-01 00:00:00 UTC'), Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(parseGithubExpiry('2026-11-01 00:00:00 +0200'), Date.parse('2026-10-31T22:00:00Z'));
  assert.equal(parseGithubExpiry(null), undefined);
});

/** A fetch that answers from a table of URL prefixes, and records the Authorization it was given. */
function fakeFetch(table: [string, number, unknown, Record<string, string>?][], seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${url} ${(init?.headers as Record<string, string>)?.Authorization ?? ''}`);
    const hit = table.find(([p]) => url.startsWith(p));
    if (!hit) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(hit[2]), { status: hit[1], headers: hit[3] });
  }) as typeof fetch;
}

test('Test on a GitHub token says who it is, when it expires, what it sees and whether it reaches the office’s projects', async () => {
  const seen: string[] = [];
  const f = fakeFetch(
    [
      ['https://api.github.com/user/repos', 200, [{ full_name: 'Org/app' }, { full_name: 'Org/lib' }]],
      ['https://api.github.com/user', 200, { login: 'office-bot' }, { 'github-authentication-token-expiration': '2099-01-01 00:00:00 UTC' }],
      ['https://api.github.com/repos/Org/app/', 200, []],
      ['https://api.github.com/repos/Org/app', 200, {}],
      ['https://api.github.com/repos/Org/gone', 404, {}],
    ],
    seen,
  );
  const c = await testGithub(FAKE_GH, { want: ['Org/app', 'Org/gone'], fetch: f });
  assert.equal(c.status, 'connected');
  assert.equal(c.login, 'office-bot');
  assert.deepEqual(c.repos, ['Org/app', 'Org/lib']);
  assert.deepEqual(c.owners, ['Org']);
  assert.match(c.summary, /office-bot \(fine-grained, expires 2099-01-01\)/);
  assert.ok(c.details!.some((d) => d.includes('Org/gone')));
  assert.ok(c.details!.some((d) => /On Org\/app it can read contents, issues, pull requests/.test(d)));
  assert.ok(seen.every((s) => s.endsWith(`Bearer ${FAKE_GH}`)), 'the token only ever goes in the Authorization header');
  const bad = await testGithub(FAKE_GH, { fetch: fakeFetch([['https://api.github.com/user', 401, {}]]) });
  assert.equal(bad.status, 'invalid');
  const soon = await testGithub(FAKE_GH, { fetch: fakeFetch([['https://api.github.com/user', 200, { login: 'x' }, { 'github-authentication-token-expiration': new Date(Date.now() + 3 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' }]]) });
  assert.equal(soon.status, 'expiring');
  const offline = await testGithub(FAKE_GH, { fetch: (async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch });
  assert.equal(offline.status, 'connected', 'an unreachable GitHub doesn’t make the token invalid');
});

test('Test on a Mendix token: 401 is invalid, 403 is a token without mx:deployment:read, 200 counts the apps', async () => {
  assert.equal((await testMendix('mx', fakeFetch([['https://deploy.mendix.com/api/v4/apps', 401, {}]]))).status, 'invalid');
  const scoped = await testMendix('mx', fakeFetch([['https://deploy.mendix.com/api/v4/apps', 403, {}]]));
  assert.equal(scoped.status, 'connected');
  assert.match(scoped.summary, /mx:deployment:read/);
  const seen: string[] = [];
  assert.match((await testMendix('mx-pat', fakeFetch([['https://deploy.mendix.com/api/v4/apps', 200, [{}, {}]]], seen))).summary, /2 apps/);
  assert.ok(seen[0].endsWith('MxToken mx-pat'));
});

test('workers get the agents’ token, the Mendix token only on a floor where it’s switched on, and the office’s commit identity', async () => {
  const data = tmp('cx-data-');
  const vault = openConnections(data, fileCipher);
  try {
    await vault.set('github-agents', FAKE_GH, 'Probe');
    await vault.set('mendix', 'mx-fake-pat-999999', 'Probe');
    const floorA = path.join(data, 'a');
    const env = withConnections({ MX_PAT: 'inherited', PATH: 'x' }, floorA);
    assert.equal(env.GH_TOKEN, FAKE_GH);
    assert.equal(env.GITHUB_TOKEN, FAKE_GH);
    assert.equal(env.MX_PAT, undefined, 'never by default, even when the office has it');
    updateOfficeSettings({ mendixFloors: [floorA], gitIdentity: { name: 'Agent Office', email: 'bots@example.com' } });
    assert.ok(mendixOn(floorA.toUpperCase()) === (process.platform === 'win32'));
    const on = withConnections({}, floorA);
    assert.equal(on.MENDIX_TOKEN, 'mx-fake-pat-999999');
    assert.equal(on.MX_PAT, 'mx-fake-pat-999999');
    assert.equal(withConnections({}, path.join(data, 'b')).MX_PAT, undefined);
    assert.equal(on.GIT_AUTHOR_NAME, 'Agent Office');
    assert.equal(withConnections({ GIT_AUTHOR_NAME: 'Mine' }).GIT_AUTHOR_NAME, 'Mine', 'a worker’s own identity stays');
    assert.deepEqual(JSON.parse(readFileSync(path.join(data, 'office-settings.json'), 'utf8')).mendixFloors, [floorA]);
    // The wizard's admin token: Connections first, then the file.
    const file = path.join(data, 'admin-token');
    assert.equal(adminTokenConfigured(file), false);
    writeFileSync(file, 'file-admin\n');
    assert.equal(readAdminToken(file), 'file-admin');
    assert.equal(adminTokenSource(file), 'file');
    await vault.set('github-admin', OTHER_GH, 'Probe');
    assert.equal(readAdminToken(file), OTHER_GH);
    assert.equal(adminTokenSource(file), 'connections');
    // Jeff's key: Connections first.
    await vault.set('jev', 'jev-saved', 'Probe');
    assert.equal(new JevKey({ TYPESAFE_API_KEY: 'env' }).get(), 'jev-saved');
    // The toolkit folder: Settings, then the variable, then the default.
    assert.equal(toolkitDirState({ AGENT_OFFICE_TOOLKIT_DIR: data }).source, 'env');
    updateOfficeSettings({ toolkitDir: floorA });
    assert.deepEqual(toolkitDirState({ AGENT_OFFICE_TOOLKIT_DIR: data }), { dir: floorA, source: 'settings' });
    assert.equal(officeSettings().toolkitDir, floorA);
  } finally {
    closeConnections();
  }
});

test('changing the office password keeps only its hash, beats the launcher’s, and switches the running office over', () => {
  const dataDir = tmp('cx-pw-');
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ password: 'generated-plain', verifier: 'aa', salt: salt.toString('hex'), secret: 's' }));
  const cfg = { dataDir, salt, verifier: Buffer.from('aa', 'hex'), password: 'generated-plain', passwordGenerated: true, claimed: false } as unknown as Parameters<typeof changePassword>[0];
  let set: Buffer | undefined;
  assert.equal(passwordProblem('short'), 'Pick a password of at least 8 characters');
  assert.ok(changePassword(cfg, { setVerifier: (v) => (set = v) }, 'short', 'Probe'));
  assert.equal(changePassword(cfg, { setVerifier: (v) => (set = v) }, 'a-new-office-pw', 'Probe'), undefined);
  const stored = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.equal(stored.password, undefined, 'no plaintext left');
  assert.equal(stored.verifierFrom, 'connections');
  assert.equal(stored.verifier, scryptSync('a-new-office-pw', salt, 32).toString('hex'));
  assert.ok(set?.equals(scryptSync('a-new-office-pw', salt, 32)));
  assert.equal(cfg.password, undefined);
  assert.ok(!readFileSync(path.join(dataDir, 'config.json'), 'utf8').includes('a-new-office-pw'));
});

test('the git / gh check runs gh with the agents’ token in a throwaway config and only reads git’s identity', async () => {
  const calls: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const runner: Runner = async (cmd, args, env) => {
    calls.push({ cmd, args, env });
    if (args[0] === '--version') return { code: 0, out: `${cmd} version 9.9` };
    if (cmd === 'gh') return { code: 0, out: `github.com\n  ✓ Logged in to github.com account office-bot (GH_TOKEN)\n  - Token: ${FAKE_GH}` };
    if (args.includes('user.name')) return { code: 1, out: '' };
    return { code: 0, out: 'me@example.com' };
  };
  const t = await checkTools(FAKE_GH, runner);
  assert.ok(t.git.ok && t.gh.ok && t.ghAuth.ok);
  assert.match(t.ghAuth.text, /office-bot/);
  assert.ok(!JSON.stringify(t).includes(FAKE_GH), 'the token never comes back');
  const gh = calls.find((c) => c.cmd === 'gh' && c.args[0] === 'auth')!;
  assert.equal(gh.env!.GH_TOKEN, FAKE_GH);
  assert.ok(gh.env!.GH_CONFIG_DIR && gh.env!.GH_CONFIG_DIR !== process.env.GH_CONFIG_DIR, 'never the user’s own gh config');
  assert.ok(!existsSync(gh.env!.GH_CONFIG_DIR!), 'the throwaway config is gone afterwards');
  assert.ok(calls.filter((c) => c.cmd === 'git').every((c) => c.args[0] === '--version' || (c.args[0] === 'config' && c.args.length === 3)), 'git config is only read');
  assert.equal(t.identity.ok, false);
  const missing = await checkTools(undefined, async (cmd) => ({ code: 127, out: '', missing: true }));
  assert.equal(missing.git.ok, false);
  assert.match(missing.git.fix!, /winget install Git\.Git/);
  assert.deepEqual(cleanIdentity({ name: ' Bot <x> ', email: 'b@x.io' }), { name: 'Bot x', email: 'b@x.io' });
  assert.equal(cleanIdentity({ name: 'Bot', email: 'nope' }), 'Give it an email address');
});
