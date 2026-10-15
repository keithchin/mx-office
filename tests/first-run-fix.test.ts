// 🚀 First-run setup's one-click fixes (server/first-run/fixes.ts, gh-login.ts, confirm.ts,
// fix-machine.ts, http/routes/first-run-fix.ts): every fix builds the right command, nothing runs
// without the server-side confirm, gh's one-time code is read from real-looking output, gh's token goes
// into Connections without ever showing up in a line, a response or the audit, the API key is never
// echoed, a test office refuses to run anything real, admins only, Set up everything stops at the first
// failure, and the README's one-liner script is safe to run twice. Fakes only: no winget, npm, gh or
// claude is ever started, nothing is downloaded and nothing reaches GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mxcliAsset, mxcliUrl, parseDeviceCode, type FixEvent, type FixId, type FixStep } from '../src/shared/first-run-fix.js';
import { fixesFor, planFix, planFixes, runFixes, wingetArgs, wingetOk, type FixChild, type FixDeps } from '../src/server/first-run/fixes.js';
import { fakeFixDeps, scriptedChild } from '../src/server/first-run/fix-fake.js';
import { fixDepsFor, machineFixDeps, refusingDeps, TEST_MODE_REFUSAL, useFixDeps } from '../src/server/first-run/fix-machine.js';
import { holdPlan, takePlan } from '../src/server/first-run/confirm.js';
import { expandVars, mergePath, parseRegPath } from '../src/server/first-run/path-refresh.js';
import { closeConnections, connectionsVault, openConnections } from '../src/server/connections/store.js';
import { fileCipher } from '../src/server/connections/vault.js';
import { Auth } from '../src/server/auth.js';
import { requestHandler } from '../src/server/http/router.js';
import { firstRunFixRoutes } from '../src/server/http/routes/first-run-fix.js';
import { useAudit } from '../src/server/audit/index.js';
import { useTestMode } from '../src/server/testmode.js';
import type { Ctx } from '../src/server/office/context.js';
import type { AuditInput } from '../src/shared/audit.js';

const TOKEN = `gho_${'Q7x'.repeat(12)}`;
const API_KEY = `sk-ant-api03-${'k9'.repeat(20)}`;
/** What gh 2.6x prints over pipes for `gh auth login --web`. */
const GH_LOGIN_OUT = ['! First copy your one-time code: 8C3D-A1F7', 'Open this URL to continue in your web browser: https://github.com/login/device', '✓ Authentication complete.', '- gh config set -h github.com git_protocol https', '✓ Configured git protocol', '✓ Logged in as octocat'];

/** Fake deps that record every program started, terminal opened and download asked for. */
function spyDeps(over: Partial<FixDeps> = {}, programs: (file: string, args: string[]) => FixChild = () => scriptedChild(['ok'], 0, 1)) {
  const started: string[] = [];
  const base = fakeFixDeps({ checks: {} });
  const d: FixDeps = {
    ...base,
    waitMs: 2000,
    spawn: (file, args) => (started.push(`${path.win32.basename(file)} ${args.join(' ')}`), programs(file, args)),
    run: async (file, args) => (started.push(`${path.win32.basename(file)} ${args.join(' ')}`), { code: 0, out: args[1] === 'token' ? TOKEN : 'ok' }),
    openTerminal: async (cmd, args) => void started.push(`terminal ${cmd} ${args.join(' ')}`),
    download: async (url) => void started.push(`download ${url}`),
    ...over,
  };
  return { d, started };
}

function audited(): { events: AuditInput[]; stop(): void } {
  const events: AuditInput[] = [];
  useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);
  return { events, stop: () => useAudit(undefined) };
}

const commands = async (id: FixId, d: FixDeps) => {
  const p = await planFix(id, d);
  return 'commands' in p ? p.commands : [];
};

test('each fix builds the right command and arguments', async () => {
  const { d } = spyDeps();
  assert.deepEqual(wingetArgs('git'), ['install', '--id', 'Git.Git', '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent']);
  assert.equal(wingetArgs('gh')[2], 'GitHub.cli');
  assert.equal(wingetArgs('node')[2], 'OpenJS.NodeJS.LTS');
  assert.equal(wingetArgs('jq')[2], 'jqlang.jq');
  assert.match((await commands('git', d))[0], /^winget install --id Git\.Git --exact --source winget --accept-package-agreements --accept-source-agreements --silent$/);
  assert.deepEqual(await commands('gh-auth', d), ['gh auth login --web --git-protocol https --hostname github.com', 'gh auth setup-git --hostname github.com']);
  assert.match((await commands('claude', d))[0], /^powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https:\/\/claude\.ai\/install\.ps1 \| iex"$/);
  assert.equal((await commands('longpaths', d))[0], 'git config --global core.longpaths true');
  assert.equal((await commands('mxcli', d))[0], 'download https://github.com/mendixlabs/mxcli/releases/latest/download/mxcli-windows-amd64.exe');
  assert.match((await commands('toolkit', d))[0], /^git clone --progress -- https:\/\/github\.com\/MendixMau\/mxcli-project-toolkit\.git /);
  assert.equal(mxcliAsset('darwin', 'arm64'), 'mxcli-darwin-arm64');
  assert.equal(mxcliAsset('linux', 'x64'), 'mxcli-linux-amd64');
  assert.equal(mxcliAsset('win32', 'ia32'), undefined);
  assert.equal(mxcliUrl('mxcli-linux-arm64'), 'https://github.com/mendixlabs/mxcli/releases/latest/download/mxcli-linux-arm64');
  // Claude Code elsewhere: the official shell installer, else npm, else the docs.
  const mac = spyDeps({ platform: 'darwin', arch: 'arm64', find: async (c) => (['bash', 'curl'].includes(c) ? `/usr/bin/${c}` : undefined) }).d;
  assert.equal((await commands('claude', mac))[0], 'bash -c "curl -fsSL https://claude.ai/install.sh | bash"');
  const npmOnly = spyDeps({ platform: 'linux', find: async (c) => (c === 'npm' ? '/usr/bin/npm' : undefined) }).d;
  assert.equal((await commands('claude', npmOnly))[0], 'npm install -g @anthropic-ai/claude-code');
  // No winget: links. Not Windows: the brew/apt lines, nothing run.
  const noWinget = await planFix('gh', spyDeps({ find: async () => undefined }).d);
  assert.ok('links' in noWinget && noWinget.links.includes('https://cli.github.com'));
  const linux = await planFix('jq', spyDeps({ platform: 'linux' }).d);
  assert.ok('links' in linux && linux.commands.some((c) => c.includes('brew install jq')) && linux.commands.some((c) => c.includes('sudo apt install jq')));
  // winget saying "already installed" counts as done, as a signed or unsigned exit code.
  assert.equal(wingetOk(0x8a150061), true);
  assert.equal(wingetOk(0x8a150061 | 0), true);
  assert.equal(wingetOk(1), false);
});

test('Set up everything plans what the check asks for, in order, with the gh token offered when the agents have none', async () => {
  const rows = [
    { id: 'gh', status: 'missing' },
    { id: 'git', status: 'ok' },
    { id: 'gitbash', status: 'missing' },
    { id: 'claude-auth', status: 'missing' },
    { id: 'studio', status: 'missing' },
    { id: 'gh-auth', status: 'missing' },
    { id: 'mxcli', status: 'missing' },
  ] as const;
  assert.deepEqual(fixesFor(rows.map((r) => ({ ...r, text: '' })), false), ['git', 'gh', 'gh-auth', 'gh-token', 'mxcli', 'claude-auth']);
  assert.ok(!fixesFor(rows.map((r) => ({ ...r, text: '' })), true).includes('gh-token'));
  const plan = await planFixes(['gh-token', 'git'], spyDeps().d);
  assert.deepEqual(plan.steps.map((s) => s.id), ['git', 'gh-token']);
  assert.equal(plan.steps[1].optional, true);
});

test('gh’s one-time code is read from what gh prints', () => {
  assert.deepEqual(parseDeviceCode(GH_LOGIN_OUT.slice(0, 2).join('\n')), { code: '8C3D-A1F7', url: 'https://github.com/login/device' });
  assert.deepEqual(parseDeviceCode('! First copy your one-time code: 1234-ABCD\r\nPress Enter to open github.com in your browser...'), { code: '1234-ABCD', url: 'https://github.com/login/device' });
  assert.equal(parseDeviceCode('- Logging in to github.com'), undefined);
});

test('the confirm is single use, for whoever asked, and runs out', () => {
  const step: FixStep = { id: 'git', title: 'Install Git', commands: [], sources: [] };
  const opt: FixStep = { id: 'gh-token', title: 'Token', commands: [], sources: [], optional: true };
  assert.match((takePlan(undefined, 'a') as { error: string }).error, /Nothing runs without a confirm/);
  const { confirm } = holdPlan([step, opt], 'a');
  assert.ok('error' in takePlan(confirm, 'b'), 'someone else’s token');
  const { confirm: c2 } = holdPlan([step, opt], 'a');
  assert.deepEqual((takePlan(c2, 'a', ['gh-token', 'git']) as { steps: FixStep[] }).steps.map((s) => s.id), ['git'], 'only optional steps can be left out');
  assert.ok('error' in takePlan(c2, 'a'), 'used up');
  const { confirm: c3 } = holdPlan([step], 'a', 0);
  assert.match((takePlan(c3, 'a', [], 11 * 60_000) as { error: string }).error, /ran out/);
});

test('Set up everything stops at the first failure and says which and why', async () => {
  const { d, started } = spyDeps({}, (file, args) => scriptedChild(['…'], args.includes('GitHub.cli') ? 1 : 0, 1));
  const events: FixEvent[] = [];
  const steps = (await planFixes(['git', 'gh', 'jq'], d)).steps;
  const r = await runFixes(steps, d, (e) => events.push(e), new AbortController().signal);
  assert.match(r.error!, /GitHub CLI.*GitHub\.cli.*exit 1/);
  assert.deepEqual(events.filter((e) => e.t === 'step').map((e) => (e as { id: string }).id), ['git', 'gh'], 'jq never started');
  assert.ok(!started.some((s) => s.includes('jqlang.jq')));
  const done = events.at(-1)!;
  assert.ok(done.t === 'done' && !done.ok && done.id === 'gh');
  assert.ok(events.some((e) => e.t === 'path' && e.refreshed), 'PATH read again after the install that worked');
});

test('signing gh in shows the code, sets git up, and saves its token into Connections without it ever showing', async () => {
  const saved: string[] = [];
  const { d, started } = spyDeps({ saveAgentToken: async (t) => void saved.push(t) }, (file, args) => scriptedChild(args[1] === 'login' ? GH_LOGIN_OUT : ['ok'], 0, 1));
  d.env = { GH_TOKEN: 'ghp_theofficesownagenttoken000000', PATH: 'C:\\x' };
  const events: FixEvent[] = [];
  const r = await runFixes((await planFixes(['gh-auth', 'gh-token'], d)).steps, d, (e) => events.push(e), new AbortController().signal);
  assert.equal(r.error, undefined);
  assert.deepEqual(events.find((e) => e.t === 'code'), { t: 'code', code: '8C3D-A1F7', url: 'https://github.com/login/device' });
  assert.ok(started.includes('gh.exe auth login --web --git-protocol https --hostname github.com'));
  assert.ok(started.includes('gh.exe auth setup-git --hostname github.com'));
  assert.ok(started.includes('gh.exe auth token --hostname github.com'));
  assert.deepEqual(saved, [TOKEN], 'straight from gh into Connections');
  assert.ok(!JSON.stringify(events).includes(TOKEN), 'never in a progress line');
});

test('a gh that won’t sign in without a terminal gets one, and the office waits for it', async () => {
  const { d, started } = spyDeps(
    {
      run: async (_f, args) => (started.push(`gh ${args.join(' ')}`), { code: 0, out: '' }),
      openTerminal: async (cmd, args) => void started.push(`terminal ${cmd} ${args.join(' ')}`),
    },
    () => scriptedChild(['--web is not supported when not running interactively'], 1, 1),
  );
  const events: FixEvent[] = [];
  const r = await runFixes((await planFixes(['gh-auth'], d)).steps, d, (e) => events.push(e), new AbortController().signal);
  assert.equal(r.error, undefined);
  assert.ok(started.includes('terminal gh auth login --git-protocol https --hostname github.com --web'));
  assert.ok(events.some((e) => e.t === 'line' && /opening a terminal window/.test(e.text)));
});

test('a test office refuses to run anything real, and starts nothing', async () => {
  const { d, started } = spyDeps();
  const refusing = refusingDeps(d);
  const events: FixEvent[] = [];
  const r = await runFixes((await planFixes(['git', 'gh-auth', 'claude', 'claude-auth', 'mxcli'], refusing)).steps, refusing, (e) => events.push(e), new AbortController().signal);
  assert.equal(r.error, TEST_MODE_REFUSAL);
  assert.deepEqual(started, [], 'no winget, npm, gh auth, claude, terminal or download');
  assert.throws(() => refusing.spawn('winget', []), /test office/);
  // The routes' deps in test mode: refusing, unless the scripted fakes are asked for.
  useTestMode({ flag: true, agentCmd: 'fake', agentExplicit: true });
  const was = process.env.AGENT_OFFICE_FAKE_SETUP;
  try {
    delete process.env.AGENT_OFFICE_FAKE_SETUP;
    const ctx = { cfg: { dir: os.tmpdir(), dataDir: os.tmpdir() } } as unknown as Ctx;
    const deps = fixDepsFor(ctx, { name: 'Ada' });
    assert.equal(deps.refuse, TEST_MODE_REFUSAL);
    assert.throws(() => deps.spawn('winget', ['install']), /test office/);
    assert.throws(() => deps.openTerminal('claude', [], {}), /test office/);
    process.env.AGENT_OFFICE_FAKE_SETUP = '1';
    assert.equal(fixDepsFor(ctx, { name: 'Ada' }).refuse, undefined, 'scripted fakes');
    assert.equal(fixDepsFor(ctx, { name: 'Ada' }).find === machineFixDeps(ctx, { name: 'Ada' }).find, false);
  } finally {
    useTestMode(undefined);
    if (was === undefined) delete process.env.AGENT_OFFICE_FAKE_SETUP;
    else process.env.AGENT_OFFICE_FAKE_SETUP = was;
  }
});

test('PATH is read again from Windows’ registry output and only ever grows', () => {
  const out = '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\r\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\GitHub CLI\\\r\n';
  assert.equal(parseRegPath(out), '%SystemRoot%\\system32;C:\\Program Files\\GitHub CLI\\');
  assert.equal(expandVars('%SYSTEMROOT%\\system32;%NOPE%', { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\system32;%NOPE%');
  const m = mergePath('C:\\node;C:\\Windows\\system32', ['C:\\Windows\\System32\\;C:\\Program Files\\GitHub CLI\\', 'C:\\Users\\me\\.local\\bin']);
  assert.deepEqual(m.added, ['C:\\Program Files\\GitHub CLI\\', 'C:\\Users\\me\\.local\\bin']);
  assert.equal(m.value, 'C:\\node;C:\\Windows\\system32;C:\\Program Files\\GitHub CLI\\;C:\\Users\\me\\.local\\bin');
});

/** A test office's HTTP side: the fix routes, an admin (the shared password) and a member account. */
async function office() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'frfix-'));
  const data = path.join(dir, '.agent-office');
  mkdirSync(data, { recursive: true });
  openConnections(data, fileCipher);
  const salt = randomBytes(16);
  const member = { id: 'm1', name: 'Mia', role: 'member' };
  const accounts = { sharedPassword: true, get: (id: string) => (id === 'm1' ? member : undefined), state: () => ({ accounts: [member], invites: [], sharedPassword: true }) };
  const cfg = { port: 0, trustProxy: false, dataDir: data, dir, salt, passwordGenerated: false, verifier: scryptSync('pw', salt, 32) } as unknown as Ctx['cfg'];
  const auth = new Auth(cfg.verifier, salt, 'secret', accounts as never);
  const ctx = { cfg, auth, accounts, floors: new Map(), meOf: (id?: string) => ({ admin: !id }), services: { lookup: () => undefined } } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [firstRunFixRoutes.api]));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  (cfg as { port: number }).port = port;
  const base = `http://127.0.0.1:${port}`;
  const call = (p: string, who: 'admin' | 'member', body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { cookie: `ao_session_${port}=${auth.issue(who === 'member' ? 'm1' : undefined)}`, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ctx, call, close: () => (server.close(), closeConnections()) };
}

test('fixes are admins only, and nothing runs without a confirm the office handed out', async () => {
  const o = await office();
  const { d, started } = spyDeps();
  useFixDeps(() => d);
  const a = audited();
  try {
    for (const p of ['/api/setup/fix/plan', '/api/setup/fix/run', '/api/setup/claude-key']) assert.equal((await o.call(p, 'member', { ids: ['git'], confirm: 'x', key: API_KEY })).status, 403, p);
    const none = await o.call('/api/setup/fix/run', 'admin', {});
    assert.equal(none.status, 400);
    assert.match((await none.json()).error, /Nothing runs without a confirm/);
    assert.equal((await o.call('/api/setup/fix/run', 'admin', { confirm: 'made-up' })).status, 400);
    assert.deepEqual(started, [], 'refused before anything started');
    assert.ok(a.events.some((e) => /without a valid confirm/.test(e.summary)), 'the refusal is audited');
    const plan = await (await o.call('/api/setup/fix/plan', 'admin', { ids: ['gh'] })).json();
    assert.equal(plan.steps[0].commands[0], `winget ${wingetArgs('gh').join(' ')}`);
    assert.deepEqual(started, [], 'planning runs nothing');
    const run = await o.call('/api/setup/fix/run', 'admin', { confirm: plan.confirm });
    const events = (await run.text()).trim().split('\n').map((l) => JSON.parse(l) as FixEvent);
    assert.ok(events.at(-1)!.t === 'done' && (events.at(-1) as { ok: boolean }).ok);
    assert.ok(started.some((s) => s.startsWith('winget.exe install --id GitHub.cli')));
    assert.equal((await o.call('/api/setup/fix/run', 'admin', { confirm: plan.confirm })).status, 400, 'a confirm runs once');
    assert.ok(a.events.some((e) => /confirmed and started first-run fixes/.test(e.summary)));
  } finally {
    a.stop();
    useFixDeps(undefined);
    o.close();
  }
});

test('the token from gh’s sign-in goes into Connections and never into a response or the audit', async () => {
  const o = await office();
  const realFetch = globalThis.fetch;
  const a = audited();
  try {
    useFixDeps((ctx, who) => {
      const real = machineFixDeps(ctx, who);
      // Only what this office saved counts (the shell running the tests may have a GH_TOKEN of its own).
      return spyDeps({ saveAgentToken: real.saveAgentToken, hasAgentToken: () => !!connectionsVault()?.get('github-agents') }, (file, args) => scriptedChild(args[1] === 'login' ? GH_LOGIN_OUT : ['ok'], 0, 1)).d;
    });
    const plan = await (await o.call('/api/setup/fix/plan', 'admin', { ids: ['gh-auth', 'gh-token'] })).json();
    // Saving tests the token against GitHub: answered here, offline, so nothing leaves the machine.
    globalThis.fetch = (async (url: unknown, init?: unknown) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url as string, init as RequestInit) : Promise.reject(new Error('offline')))) as typeof fetch;
    const text = await (await o.call('/api/setup/fix/run', 'admin', { confirm: plan.confirm })).text();
    assert.match(text, /"t":"code","code":"8C3D-A1F7"/);
    assert.match(text, /Saved as the agents’ GitHub token/);
    assert.ok(!text.includes(TOKEN), 'not in the response');
    assert.equal(connectionsVault()!.get('github-agents'), TOKEN, 'in Connections');
    assert.ok(a.events.some((e) => /token saved from gh sign-in/.test(e.summary)));
    assert.ok(!JSON.stringify(a.events).includes(TOKEN), 'not in the audit');
  } finally {
    globalThis.fetch = realFetch;
    a.stop();
    useFixDeps(undefined);
    o.close();
  }
});

test('an Anthropic API key is saved in Connections and never echoed', async () => {
  const o = await office();
  const a = audited();
  try {
    const bad = await o.call('/api/setup/claude-key', 'admin', { key: 'not-a-key-at-all' });
    assert.equal(bad.status, 400);
    const res = await o.call('/api/setup/claude-key', 'admin', { key: API_KEY });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text), { saved: true });
    assert.ok(!text.includes(API_KEY.slice(-8)), 'not even its tail');
    assert.equal(connectionsVault()!.get('anthropic'), API_KEY);
    assert.ok(!JSON.stringify(a.events).includes(API_KEY));
  } finally {
    a.stop();
    o.close();
  }
});

test('the README’s one-line install: a short script that pulls instead of cloning twice, builds and starts the office', () => {
  const ps1 = readFileSync(path.join('scripts', 'get-mx-office.ps1'), 'utf8');
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /## Get Mx Office/);
  assert.ok(readme.includes('irm https://raw.githubusercontent.com/keithchin/mx-office/main/scripts/get-mx-office.ps1 | iex'));
  assert.match(ps1, /https:\/\/github\.com\/keithchin\/mx-office\.git/);
  assert.match(ps1, /if \(Test-Path \(Join-Path \$dir '\.git'\)\) \{[\s\S]*?git -C \$dir pull --ff-only[\s\S]*?\} else \{[\s\S]*?git clone \$repo \$dir/, 'an existing folder is pulled, not cloned again');
  for (const s of ['Need git', 'Need node', 'Git.Git', 'OpenJS.NodeJS.LTS', 'Read-Host', 'npm ci', 'npm run build', 'start-office.ps1']) assert.ok(ps1.includes(s), s);
  assert.ok(ps1.split(/\r?\n/).length < 60, 'short and readable');
});
