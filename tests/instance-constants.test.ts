// Instance constants (shared/instance-constants.ts, server/app-instance/constants.ts): a project keeps its seed
// off in the model and says once, in .agent-office/instance-constants.json, which constants its app instances run
// with; an agent can add one for its own run (office-app start --const, MCP app_start constants); the seed
// password constant gets a strong generated value per instance, given only to its agent (status) and to the
// office's own smoke runs and journeys, never the log. Unknown names and wrong types are said before anything
// starts; secret-looking values are refused. Fakes only: a stand-in mxcli (node), a stand-in psql, a fake model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { constTypeOf, parseConstantsFile, parseRequested, planConstants, requestKey, valueFor, type ConstType } from '../src/shared/instance-constants.js';
import { constantsFileAt, generatePassword, instanceConstants, liveAppConstants, modelConstantsAt, testRunConstants } from '../src/server/app-instance/constants.js';
import { startAppInstance, type InstanceSpec } from '../src/server/app-instance/index.js';
import type { Psql } from '../src/server/app-instance/db.js';
import { LIVE_APP_DEFAULTS } from '../src/server/liveapp/config.js';
import { LiveApp } from '../src/server/liveapp/app.js';
import type { ModelUnits } from '../src/server/model/units.js';
import { AgentApps, type Booted, type BootSpec } from '../src/server/agent-app/service.js';
import { identitiesFor } from '../src/server/agent-app/identity.js';
import { RUNTIME_RULE } from '../src/server/agent-app/playbook.js';
import { viewLine } from '../src/shared/agent-app.js';
import { parseApp, passwordLine, runAppTool, APP_TOOLS } from '../bin/office-app.js';
import { removeDir } from './support/cleanup.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
const MODEL: Map<string, ConstType> = new Map([
  ['Core.SeedDemoData', 'boolean'],
  ['Core.SeedPassword', 'string'],
  ['Core.MaxItems', 'integer'],
  ['Core.Rate', 'decimal'],
  ['Core.Banner', 'string'],
]);
const FILE = { constants: { 'Core.SeedDemoData': true }, seedPassword: 'Core.SeedPassword', seedUsers: ['test.requester', { user: 'test.approver', role: 'Approver' }] };

test('the project’s file: constants, the seed password constant and seed users; secrets and bad names refused', () => {
  const ok = parseConstantsFile(JSON.stringify(FILE));
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.file, { constants: { 'Core.SeedDemoData': true }, seedPassword: 'Core.SeedPassword', seedUsers: [{ user: 'test.requester' }, { user: 'test.approver', role: 'Approver' }] });
  const bad = parseConstantsFile(JSON.stringify({ constants: { 'Core.ApiKey': 'abc', 'Core.AdminPassword': 'x', NoModule: 1, 'Core.Obj': {} }, seedPassword: 'Core.ApiKey', extra: 1 }));
  assert.equal(bad.problems.length, 5, bad.problems.join('\n'));
  assert.ok(bad.problems.some((p) => /Core\.ApiKey looks like a secret.*committed/.test(p)));
  assert.ok(bad.problems.some((p) => /Core\.AdminPassword looks like a secret/.test(p)));
  assert.ok(bad.problems.some((p) => /"NoModule" isn't a constant's name/.test(p)));
  assert.ok(bad.problems.some((p) => /unknown field "extra"/.test(p)));
  assert.match(parseConstantsFile(JSON.stringify({ constants: { 'Core.SeedPassword': 'x1' }, seedPassword: 'Core.SeedPassword' })).problems.join(), /Core.SeedPassword looks like a secret.*generates one per instance/, 'a password value never sits in the file');
  assert.match(parseConstantsFile('{nope').problems[0], /isn't JSON/);
  assert.deepEqual(parseConstantsFile(JSON.stringify({ constants: { 'Core.PasswordMinLength': 8 } })).problems, [], 'a name that only mentions password is no secret');
});

test('what an agent asks for: Module.Name=value or an object; secret-looking names refused', () => {
  assert.deepEqual(parseRequested(['Core.MaxItems=5', 'Core.Banner=a=b']), { constants: { 'Core.MaxItems': '5', 'Core.Banner': 'a=b' }, problems: [] });
  assert.deepEqual(parseRequested({ 'Core.SeedDemoData': true }).constants, { 'Core.SeedDemoData': true });
  assert.match(parseRequested(['Core.Token=abc']).problems[0], /looks like a secret.*process list/);
  assert.match(parseRequested(['nonsense']).problems[0], /Module\.Name=value/);
  assert.match(parseRequested('x').problems[0], /list of Module\.Name=value/);
  assert.equal(requestKey({ b: '1', a: true }), requestKey({ a: true, b: '1' }));
});

test('the plan: the file, then the agent (wins), then the generated password; names and types checked against the model', () => {
  const { file } = parseConstantsFile(JSON.stringify(FILE));
  const plan = planConstants(file, { 'Core.MaxItems': '7', 'Core.SeedDemoData': 'FALSE' }, MODEL, 'Gen-pw_123');
  assert.ok(typeof plan !== 'string', String(plan));
  assert.deepEqual(plan.args, ['Core.SeedDemoData=false', 'Core.MaxItems=7', 'Core.SeedPassword=Gen-pw_123']);
  assert.deepEqual(plan.names, ['Core.SeedDemoData', 'Core.MaxItems', 'Core.SeedPassword']);
  assert.deepEqual(plan.generated, { constant: 'Core.SeedPassword', value: 'Gen-pw_123', users: file.seedUsers });
  const unknown = planConstants(file, { 'Core.SeedDemodata': 'true' }, MODEL, 'x');
  assert.match(String(unknown), /no constant Core\.SeedDemodata \(did you mean Core\.SeedDemoData\?\)/);
  assert.match(String(planConstants(undefined, { 'Core.MaxItems': 'many' }, MODEL)), /Core\.MaxItems is an Integer constant: give a whole number/);
  assert.match(String(planConstants(undefined, { 'Core.SeedDemoData': 'yes' }, MODEL)), /Boolean constant: give true or false/);
  assert.match(String(planConstants(undefined, { 'Core.Rate': '1,5' }, MODEL)), /Decimal constant/);
  assert.match(String(planConstants(file, { 'Core.SeedPassword': 'mine' }, MODEL, 'x')), /generates it for each instance/);
  assert.match(String(planConstants({ constants: {}, seedPassword: 'Core.MaxItems', seedUsers: [] }, {}, MODEL, 'x')), /must be a String constant/);
  assert.match(String(planConstants({ constants: { 'Old.Gone': 1 }, seedUsers: [] }, {}, MODEL)), /no constant Old\.Gone.*from \.agent-office\/instance-constants\.json/);
  // The model couldn't be read: mxcli judges the names, the values pass as given.
  assert.deepEqual((planConstants(undefined, { 'Any.Thing': 'v' }, undefined) as { args: string[] }).args, ['Any.Thing=v']);
  assert.equal(constTypeOf('DataTypes$BooleanType'), 'boolean');
  assert.equal(constTypeOf('DataTypes$LongType'), 'integer');
  assert.deepEqual(valueFor('A.B', '2026-01-31T09:00:00Z', 'datetime'), { value: '2026-01-31T09:00:00Z' });
});

test('the generated password: strong, different every time, nothing to escape', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    assert.equal(p.length, 24);
    assert.match(p, /[a-z]/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[0-9]/);
    assert.match(p, /[-_.]/);
    assert.match(p, /^[A-Za-z0-9._-]+$/);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test('read at the commit: the file from git (not the working folder) and the model’s constants with their types', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'inst-const-'));
  try {
    git(root, 'init', '-q', '-b', 'main');
    mkdirSync(path.join(root, '.agent-office'));
    writeFileSync(path.join(root, '.agent-office', 'instance-constants.json'), JSON.stringify(FILE));
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'constants');
    const sha = git(root, 'rev-parse', 'HEAD');
    writeFileSync(path.join(root, '.agent-office', 'instance-constants.json'), '{"constants": {"Core.Banner": "uncommitted"}}');
    const got = await constantsFileAt(root, sha);
    assert.deepEqual(got.file?.constants, { 'Core.SeedDemoData': true }, 'the commit’s file, not the working folder’s');
    const plan = await instanceConstants(root, sha, ['Core.MaxItems=3'], { model: async () => MODEL, password: () => 'Fixed-pw_9' });
    assert.ok(typeof plan !== 'string', String(plan));
    assert.deepEqual(plan.args, ['Core.SeedDemoData=true', 'Core.MaxItems=3', 'Core.SeedPassword=Fixed-pw_9']);
    // A microflow test run: the file's constants and a generated seed password (masked), the model's password constants named on demand.
    const tr = await testRunConstants(path.join(root, 'data'), root, sha, { model: async () => MODEL, password: () => 'Test-pw_42' });
    assert.ok('args' in tr);
    assert.deepEqual(tr.args, ['Core.SeedDemoData=true', 'Core.SeedPassword=Test-pw_42']);
    assert.deepEqual(tr.secrets, ['Test-pw_42']);
    assert.equal(tr.seedPassword, 'Core.SeedPassword');
    assert.deepEqual(await tr.passwordConstants(), ['Core.SeedPassword']);
    // No file and nothing asked: nothing to read, nothing to pass.
    assert.deepEqual(await instanceConstants(root, sha, undefined, { file: async () => ({ problems: [] }), model: async () => assert.fail('the model is not read for nothing') }), { args: [], names: [] });
    assert.match(String(await instanceConstants(root, sha, ['Core.Secret=x'])), /looks like a secret/);
    // The model reader: Constants$Constant units and their Type.
    const units = new Map([
      ['1', { id: '1', type: 'Constants$Constant', qn: 'Core.SeedDemoData', container: '', name: 'SeedDemoData', hash: 'h1' }],
      ['2', { id: '2', type: 'Constants$Constant', qn: 'Core.MaxItems', container: '', name: 'MaxItems', hash: 'h2' }],
      ['3', { id: '3', type: 'Microflows$Microflow', qn: 'Core.ACT_X', container: '', name: 'ACT_X', hash: 'h3' }],
    ]);
    const types: Record<string, string> = { '1': 'DataTypes$BooleanType', '2': 'DataTypes$IntegerType' };
    const fake = { commit: async () => ({ ix: { units, read: async (id: string) => ({ Type: { $Type: types[id] } }) } }) } as unknown as ModelUnits;
    assert.deepEqual([...((await modelConstantsAt(fake, root, sha)) ?? [])], [['Core.SeedDemoData', 'boolean'], ['Core.MaxItems', 'integer']]);
    assert.equal(await modelConstantsAt({ commit: async () => null } as unknown as ModelUnits, root, sha), undefined);
  } finally {
    removeDir(root);
  }
});

// A stand-in for `mxcli run --local` that serves --app-port and answers with its arguments, echoing each constant.
const FAKE_MXCLI = `const a = process.argv.slice(2);
const at = (k) => a[a.indexOf(k) + 1];
for (let i = 0; i < a.length; i++) if (a[i] === '--constant') console.log('constant ' + a[i + 1]);
console.log('Starting mxbuild --serve...');
require('http').createServer((q, s) => s.end(JSON.stringify({ args: a }))).listen(Number(at('--app-port')), () => console.log('Runtime started'));`;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'inst-const-app-'));
  const repo = path.join(root, 'project');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'Sample.mpr'), '');
  writeFileSync(path.join(repo, 'run'), FAKE_MXCLI);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'sample');
  return { root, repo, sha: git(repo, 'rev-parse', 'HEAD'), data: path.join(root, 'data') };
}
const psql: Psql = async () => '';
const cfg = { ...LIVE_APP_DEFAULTS, ports: { from: 8360, to: 8399 }, readyTimeoutMs: 30_000, db: { host: '127.0.0.1', port: 5432, user: 'mendix', password: 'Sample-db-pw-7' } };
const spec = (p: ReturnType<typeof project>, more: Partial<InstanceSpec>): InstanceSpec => ({ floorId: 'demo', floorDir: p.repo, commit: p.sha, purpose: 'cst', dataDir: p.data, cfg, mxcli: process.execPath, psql, mxbuild: { pick: () => ({ skipped: [] }), supportsFlag: async () => false }, webClientTimeout: async () => false, ...more });
const argsOf = (port: number) =>
  new Promise<string[]>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve((JSON.parse(b) as { args: string[] }).args));
    }).on('error', reject);
  });

test('an instance runs with its constants as mxcli’s --constant, the generated password never in its log; an mxcli without --constant is said plainly', { timeout: 90_000 }, async () => {
  const p = project();
  try {
    const pw = 'Gen-erated_pw9';
    const one = await startAppInstance(spec(p, { constants: ['Core.SeedDemoData=true', `Core.SeedPassword=${pw}`], secrets: [pw], constantFlag: async () => true }));
    try {
      const args = await argsOf(one.appPort);
      assert.deepEqual(args.filter((_, i) => args[i - 1] === '--constant'), ['Core.SeedDemoData=true', `Core.SeedPassword=${pw}`]);
      const log = readFileSync(one.logFile, 'utf8');
      assert.ok(!log.includes(pw), 'the generated password is masked in the log');
      assert.match(log, /constant Core\.SeedPassword=\*\*\*/);
      assert.match(log, /constants for this run only: Core\.SeedDemoData, Core\.SeedPassword/);
      assert.equal(git(p.repo, 'status', '--porcelain'), '', 'nothing written to the project');
    } finally {
      await one.stop();
    }
    await assert.rejects(startAppInstance(spec(p, { constants: ['Core.SeedDemoData=true'], constantFlag: async () => false })), /instance constants \(Core\.SeedDemoData\).*no `mxcli run --constant`.*update mxcli/);
  } finally {
    removeDir(p.root);
  }
});

function fakeApps(root: string) {
  const booted: BootSpec[] = [];
  const seenGenerated: unknown[] = [];
  const apps = new AgentApps({
    dataDir: root,
    floorDir: () => root,
    boot: async (s): Promise<Booted> => {
      booted.push(s);
      let up = true;
      return { url: 'http://127.0.0.1:8361/', appPort: 8361, pid: 1, commit: s.commit, dbName: 'x', logFile: 'x.log', runtimeLog: 'runtime.log', timing: { ms: 1, phases: {} }, alive: () => up, freshDatabase: async () => undefined, stop: async () => void (up = false), workspace: root };
    },
    constants: (dir, commit, requested) => instanceConstants(dir, commit, requested, { file: async () => parseConstantsFile(JSON.stringify(FILE)), model: async () => MODEL }),
    users: async (_d, _c, _l, generated) => {
      seenGenerated.push(generated);
      return { users: [{ user: 'test.requester', role: 'seed user' }], passwords: 'the seed password the office generated for this instance (Core.SeedPassword; office-app status shows it)' };
    },
    freeMemory: async () => 8 * 1024 ** 3,
    leftovers: { list: async () => [], kill: () => undefined },
  });
  return { apps, booted, seenGenerated };
}

test('an agent’s instance: the constants reach the start, the password only its own status; other constants replace it, bad ones are refused first', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'inst-const-agent-'));
  const sha = 'c'.repeat(40);
  try {
    const { apps, booted, seenGenerated } = fakeApps(root);
    const first = await apps.start('shop', { id: 'w1', name: 'Rhea' }, sha, { constants: ['Core.MaxItems=4'] });
    assert.ok(typeof first !== 'string', String(first));
    await apps.all()[0].started;
    const spec0 = booted[0];
    const pw = spec0.constants.find((c) => c.startsWith('Core.SeedPassword='))?.split('=')[1] ?? '';
    assert.equal(pw.length, 24);
    assert.deepEqual(spec0.constants.slice(0, 2), ['Core.SeedDemoData=true', 'Core.MaxItems=4']);
    assert.deepEqual(spec0.secrets, [pw], 'the log masks it');
    assert.deepEqual(seenGenerated[0], { constant: 'Core.SeedPassword', value: pw, users: [{ user: 'test.requester' }, { user: 'test.approver', role: 'Approver' }] }, 'its smoke runs and journeys sign in with it');
    const plain = apps.view('shop', 'w1')!;
    assert.equal(plain.testPassword, undefined, 'a view is not the status call');
    assert.ok(!JSON.stringify(plain).includes(pw));
    assert.ok(!viewLine(plain).includes(pw), 'the line never says it');
    assert.match(viewLine(plain), /constants for this run: Core\.SeedDemoData, Core\.MaxItems, Core\.SeedPassword .*generated for this instance/);
    const status = apps.view('shop', 'w1', true, true)!;
    assert.deepEqual(status.testPassword, { constant: 'Core.SeedPassword', value: pw });
    assert.match(passwordLine(status), new RegExp(`Core\\.SeedPassword\\): ${pw}[\\s\\S]*never write it`));
    // The same ask reuses it; other constants replace it (and a new password).
    await apps.start('shop', { id: 'w1', name: 'Rhea' }, sha, { constants: { 'Core.MaxItems': '4' } });
    assert.equal(booted.length, 1);
    await apps.start('shop', { id: 'w1', name: 'Rhea' }, sha, { constants: ['Core.MaxItems=9'] });
    await apps.all()[0].started;
    assert.equal(booted.length, 2);
    assert.notEqual(booted[1].secrets[0], pw);
    // Wrong ones are said before anything stops or starts.
    const bad = await apps.start('shop', { id: 'w1', name: 'Rhea' }, sha, { constants: ['Core.Nope=1'] });
    assert.match(String(bad), /no constant Core\.Nope/);
    assert.equal(booted.length, 2);
    assert.equal(apps.view('shop', 'w1', false)?.state, 'ready', 'the running one is left alone');
    await apps.stop('shop', 'w1');
    assert.equal(apps.view('shop', 'w1', false, true)?.testPassword, undefined, 'the password goes with the instance');
  } finally {
    removeDir(root);
  }
});

test('identities with a generated password: every seeded user signs in with it, the config’s own password passed over, the words never say it', async () => {
  const generated = { constant: 'Core.SeedPassword', value: 'Gen-pw_1234', users: [{ user: 'test.approver', role: 'Approver' }] };
  const ids = await identitiesFor('x', 'y', undefined, { runnerConfig: async () => ({ user: 'test.requester', pass: 'old-known', roles: [] }), personas: async () => ['test.clerk'], generated });
  assert.equal(ids.cfg?.user, 'test.requester');
  assert.equal(ids.cfg?.pass, generated.value);
  assert.deepEqual(ids.cfg?.roles.map((r) => [r.user, r.pass]), [['test.requester', generated.value], ['test.approver', generated.value], ['test.clerk', generated.value]]);
  assert.deepEqual(ids.users.map((u) => u.user), ['test.requester', 'test.approver', 'test.clerk']);
  assert.match(ids.passwords, /generated for this instance \(Core\.SeedPassword/);
  assert.ok(!ids.passwords.includes(generated.value));
});

test('office-app start --const and the MCP tool’s constants; status gives the password', async () => {
  assert.deepEqual(parseApp(['start', '--const', 'Core.SeedDemoData=true', '--const=Core.Banner=a=b']).constants, ['Core.SeedDemoData=true', 'Core.Banner=a=b']);
  assert.throws(() => parseApp(['start', '--const', 'SeedDemoData']), /Module\.Name=value/);
  assert.throws(() => parseApp(['status', '--const', 'Core.A=1']), /--const is for office-app start/);
  const schema = APP_TOOLS.find((t) => t.name === 'app_start')?.inputSchema as { properties: Record<string, unknown> };
  assert.ok(schema.properties.constants);
  const calls: { url: string; body?: string }[] = [];
  const app = { state: 'ready', commit: 'c'.repeat(40), url: 'http://127.0.0.1:8361/', testPassword: { constant: 'Core.SeedPassword', value: 'Gen-pw_77' } };
  const io = {
    env: { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' },
    cwd: process.cwd(),
    fetch: async (url: string, init: { body?: string }) => {
      calls.push({ url, body: init.body });
      return new Response(JSON.stringify({ app, line: 'Your app instance is ready' }), { status: 200 });
    },
  };
  const st = await runAppTool('app_status', {}, io);
  assert.match(st.text, /Test password for this instance only \(Core\.SeedPassword\): Gen-pw_77/);
  await runAppTool('app_start', { commit: 'main', constants: { 'Core.SeedDemoData': true } }, io);
  assert.deepEqual(JSON.parse(calls.find((c) => c.url.includes('/start'))?.body ?? '{}'), { commit: 'main', constants: { 'Core.SeedDemoData': true } });
  assert.equal(passwordLine({ state: 'ready' }), '');
});

test('the Live app: the file’s constants only (no generated password), said and skipped when they can’t be used', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inst-const-live-'));
  try {
    assert.deepEqual(await liveAppConstants(dir, 'mxcli', async () => true), [], 'no file, nothing');
    mkdirSync(path.join(dir, '.agent-office'));
    writeFileSync(path.join(dir, '.agent-office', 'instance-constants.json'), JSON.stringify(FILE));
    assert.deepEqual(await liveAppConstants(dir, 'mxcli', async () => true), ['Core.SeedDemoData=true']);
    await assert.rejects(liveAppConstants(dir, 'mxcli', async () => false), /no `mxcli run --constant`.*started without them/);
    writeFileSync(path.join(dir, '.agent-office', 'instance-constants.json'), '{"constants": {"Core.ApiToken": "x"}}');
    await assert.rejects(liveAppConstants(dir, 'mxcli', async () => true), /looks like a secret/);
  } finally {
    removeDir(dir);
  }
});

test('the Playbook: seeds off in the model, test accounts from instance constants, never demo users or known passwords', () => {
  const text = RUNTIME_RULE.join('\n');
  assert.match(text, /keep the seed off in the model/);
  assert.match(text, /\.agent-office\/instance-constants\.json/);
  assert.match(text, /Never add demo users, a demo admin or a known or throwaway password to the model/);
  assert.match(text, /--const Module\.Name=value/);
});

test('the Live app runs with the project’s constants from its checkout (mxcli’s --constant)', { timeout: 120_000 }, async () => {
  const p = project();
  mkdirSync(path.join(p.repo, '.agent-office'));
  writeFileSync(path.join(p.repo, '.agent-office', 'instance-constants.json'), JSON.stringify(FILE));
  git(p.repo, 'add', '.');
  git(p.repo, 'commit', '-q', '-m', 'instance constants');
  const app = new LiveApp({ cfg: { ...LIVE_APP_DEFAULTS, ports: { from: 8380, to: 8399 }, readyTimeoutMs: 30_000 }, mxcli: process.execPath, floorId: 'demo', floorDir: p.repo, liveDir: path.join(p.root, 'live'), taken: () => new Set(), changed: () => undefined, constants: (dir) => liveAppConstants(dir, process.execPath, async () => true) });
  try {
    await app.start('Probe');
    for (let i = 0; i < 300 && app.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(app.status, 'running');
    const run = readFileSync(path.join(p.root, 'live', 'demo.log'), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('$ mxcli run')).pop() ?? '';
    assert.match(run, /--constant Core\.SeedDemoData=true/);
    assert.ok(!run.includes('Core.SeedPassword'), 'no generated password for the Live app');
  } finally {
    await app.stop('Probe');
    removeDir(p.root);
  }
});
