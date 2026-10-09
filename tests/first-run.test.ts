// 🚀 First-run setup (server/first-run/, shared/first-run.ts, http/routes/first-run.ts): when a new office
// opens it by itself, each prerequisite check against fakes (never a real gh or claude), the
// organization setting and its fallbacks for existing offices, picking up where a reload left off,
// admins only after the welcome, and the toolkit clone's progress stream against a fake git.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { firstRunReasons, nodeVersionOk, prereqsReady, cloneUrlProblem, PREREQ_META, type CloneEvent, type PrereqResult } from '../src/shared/first-run.js';
import { checkPrereqs, prereqIdsFor, type CheckDeps } from '../src/server/first-run/checks.js';
import { closeConnections, officeSettings, openConnections } from '../src/server/connections/store.js';
import { fileCipher } from '../src/server/connections/vault.js';
import { LEGACY_PROJECT_ORG, preferredMendix, projectOrg } from '../src/server/wizard/config.js';
import { currentStep, finishSetup, rerunSetup, setOrg, setStep, setupReasons, setMxcli } from '../src/server/first-run/index.js';
import { cloneToolkit, cloneDirProblem } from '../src/server/first-run/clone.js';
import { Auth } from '../src/server/auth.js';
import { requestHandler } from '../src/server/http/router.js';
import { firstRunRoutes } from '../src/server/http/routes/first-run.js';
import { useAudit } from '../src/server/audit/index.js';
import type { Ctx } from '../src/server/office/context.js';
import type { AuditInput } from '../src/shared/audit.js';

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

/** Audit events recorded from now until stop(). */
function audited(): { events: AuditInput[]; stop(): void } {
  const events: AuditInput[] = [];
  useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);
  return { events, stop: () => useAudit(undefined) };
}

test('a new office opens the setup when its password is still generated or it has no projects folder; a finished one only when asked again', () => {
  const base = { passwordGenerated: false, adminAccount: false, projectsDirExists: true, setup: undefined };
  assert.deepEqual(firstRunReasons(base), [], 'an existing office with a password set is left alone');
  assert.equal(firstRunReasons({ ...base, passwordGenerated: true }).length, 1, 'generated password: show it');
  assert.deepEqual(firstRunReasons({ ...base, passwordGenerated: true, adminAccount: true }), [], 'accounts with an admin count as configured');
  assert.equal(firstRunReasons({ ...base, projectsDirExists: false }).length, 1, 'no projects folder: show it');
  assert.deepEqual(firstRunReasons({ ...base, passwordGenerated: true, setup: { completedAt: 1 } }), [], 'finished: never by itself again');
  assert.equal(firstRunReasons({ ...base, setup: { completedAt: 1, rerun: true } }).length, 1, 'Run setup again');
});

test('Node is new enough from 22.5; a required check that fails holds things up, an optional one does not', () => {
  assert.equal(nodeVersionOk('22.5.0'), true);
  assert.equal(nodeVersionOk('v24.1.0'), true);
  assert.equal(nodeVersionOk('22.4.9'), false);
  assert.equal(nodeVersionOk('20.18.0'), false);
  const ok = (id: PrereqResult['id']): PrereqResult => ({ id, status: 'ok', text: '' });
  assert.equal(prereqsReady([ok('node'), { id: 'postgres', status: 'missing', text: '' }]), true);
  assert.equal(prereqsReady([ok('node'), { id: 'gh', status: 'missing', text: '' }]), false);
  assert.equal(PREREQ_META.postgres.required, false);
  assert.ok(prereqIdsFor('linux').every((id) => !PREREQ_META[id].windowsOnly), 'Git Bash and jq only on Windows');
  assert.ok(prereqIdsFor('win32').includes('gitbash'));
});

/** A machine where everything is installed, as fakes; `over` takes parts away. */
function fakeMachine(over: Partial<CheckDeps> = {}, programs: Record<string, (args: string[]) => { code: number; out: string }> = {}) {
  const ran: string[] = [];
  const all: Record<string, (args: string[]) => { code: number; out: string }> = {
    git: () => ({ code: 0, out: 'git version 2.47.1.windows.1' }),
    gh: (a) => (a[0] === 'auth' ? { code: 0, out: 'github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Token: gho_************' } : { code: 0, out: 'gh version 2.63.0 (2024-11-27)' }),
    claude: () => ({ code: 0, out: '2.1.3 (Claude Code)' }),
    mxcli: () => ({ code: 0, out: 'mxcli v0.9.0' }),
    ...programs,
  };
  const files = new Set(['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\home\\.claude\\.credentials.json', 'C:\\tools\\mxcli.exe', 'C:\\jq\\jq.exe']);
  const d: CheckDeps = {
    platform: 'win32',
    env: {},
    home: 'C:\\home',
    nodeVersion: '22.11.0',
    find: async (cmd) => (all[cmd] ? `C:\\bin\\${cmd}.exe` : undefined),
    run: async (file, args) => {
      ran.push(`${path.win32.basename(file)} ${args.join(' ')}`);
      const name = path.win32.basename(file).replace(/\.exe$/, '');
      return all[name]?.(args) ?? { code: 127, out: '' };
    },
    exists: async (p) => files.has(p),
    mendix: () => ({ dir: 'C:\\Program Files\\Mendix', versions: ['11.12.4', '11.6.4'] }),
    mxcli: () => 'C:\\tools\\mxcli.exe',
    bash: () => 'C:\\Program Files\\Git\\bin\\bash.exe',
    jqDir: () => 'C:\\jq',
    toolkit: () => ({ dir: '~/mendix-toolkit' }),
    db: () => ({ host: '127.0.0.1', port: 5432 }),
    reach: async () => true,
    secrets: () => ['gho_supersecrettoken1234567890'],
    ...over,
  };
  return { d, ran };
}

const byId = (rows: PrereqResult[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('every prerequisite is green on a machine that has it all, and Claude Code is only ever asked its version', async () => {
  const { d, ran } = fakeMachine();
  const rows = byId(await checkPrereqs(d));
  for (const r of Object.values(rows)) assert.equal(r.status, 'ok', `${r.id}: ${r.text}`);
  assert.match(rows.git.text, /git version 2\.47/);
  assert.match(rows['gh-auth'].text, /Logged in to github\.com account octo/);
  assert.match(rows.claude.text, /Claude Code/);
  assert.match(rows.studio.text, /11\.12\.4/);
  assert.match(rows.mxcli.text, /mxcli v0\.9\.0/);
  const claudeCalls = ran.filter((r) => r.startsWith('claude'));
  assert.deepEqual(claudeCalls, ['claude.exe --version'], 'never a session, a prompt or an API call');
});

test('each prerequisite says what is missing and how to fix it', async () => {
  const { d } = fakeMachine(
    {
      nodeVersion: '20.11.1',
      find: async (cmd) => (cmd === 'gh' ? 'C:\\bin\\gh.exe' : undefined),
      exists: async () => false,
      mendix: () => ({ dir: 'C:\\Program Files\\Mendix', versions: [] }),
      mxcli: () => undefined,
      jqDir: () => undefined,
      toolkit: () => ({ dir: '~/mendix-toolkit', problem: '~/mendix-toolkit isn’t there' }),
      reach: async () => false,
    },
    { gh: (a) => (a[0] === 'auth' ? { code: 1, out: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' } : { code: 0, out: 'gh version 2.63.0' }) },
  );
  const rows = byId(await checkPrereqs(d));
  for (const id of ['node', 'git', 'gitbash', 'gh-auth', 'claude', 'claude-auth', 'studio', 'mxcli', 'jq', 'toolkit', 'postgres'] as const) {
    assert.equal(rows[id].status, 'missing', id);
    assert.ok(rows[id].fix, `${id} says how to fix it`);
  }
  assert.equal(rows.gh.status, 'ok');
  assert.match(rows['gh-auth'].text, /not logged/);
  assert.match(rows.node.text, /20\.11\.1 is too old/);
  assert.equal(prereqsReady(Object.values(rows)), false);
});

test('Claude Code counts as signed in from an API key or its credentials file, and gh’s output never shows a token', async () => {
  const env = fakeMachine({ env: { ANTHROPIC_API_KEY: 'sk-fake' }, exists: async () => false }).d;
  assert.match(byId(await checkPrereqs(env))['claude-auth'].text, /ANTHROPIC_API_KEY/);
  const leaky = fakeMachine({}, { gh: (a) => (a[0] === 'auth' ? { code: 1, out: 'X Failed to log in to github.com using token (GH_TOKEN)\n- token gho_supersecrettoken1234567890 is invalid' } : { code: 0, out: 'gh version 2' }) }).d;
  const r = byId(await checkPrereqs(leaky))['gh-auth'];
  assert.equal(r.status, 'missing');
  assert.ok(!JSON.stringify(r).includes('gho_supersecret'), 'the token is redacted');
  // A check that throws is a red row, not a failed page.
  const broken = fakeMachine({ mendix: () => { throw new Error('boom'); } }).d; // prettier-ignore
  assert.match(byId(await checkPrereqs(broken)).studio.text, /boom/);
});

test('the organization: the one saved in setup, else AGENT_OFFICE_PROJECT_ORG, else the old default an existing office had', async () => {
  const dir = tmp('fr-org-');
  openConnections(dir, fileCipher);
  const a = audited();
  try {
    assert.deepEqual(projectOrg({}), { value: LEGACY_PROJECT_ORG, source: 'default' }, 'an existing office carries on as it was');
    assert.deepEqual(projectOrg({ AGENT_OFFICE_PROJECT_ORG: 'env-org' }), { value: 'env-org', source: 'env' });
    assert.equal(setOrg('not a name!', { name: 'Ada' }), 'That isn’t a GitHub organization or user name (letters, digits and single dashes)');
    assert.equal(setOrg('https://github.com/acme-labs/', { name: 'Ada' }), undefined);
    assert.deepEqual(projectOrg({ AGENT_OFFICE_PROJECT_ORG: 'env-org' }), { value: 'acme-labs', source: 'settings' }, 'the setting beats the variable');
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'office-settings.json'), 'utf8')).projectOrg, 'acme-labs');
    assert.ok(a.events.some((e) => e.target?.id === 'projectOrg' && /acme-labs/.test(e.summary) && e.actor.name === 'Ada'), 'in the audit log');
    setOrg('', { name: 'Ada' });
    assert.equal(projectOrg({}).source, 'default', 'cleared: back to the fallbacks');
  } finally {
    a.stop();
    closeConnections();
  }
});

test('setup picks up where a reload left it, finishes, and Run setup again starts it over without losing anything', () => {
  const dir = tmp('fr-step-');
  openConnections(dir, fileCipher);
  const a = audited();
  try {
    assert.equal(currentStep(), 'welcome');
    assert.equal(setStep('nope', { name: 'Ada' }), 'No such step');
    assert.equal(setStep('github', { name: 'Ada' }), undefined);
    setOrg('acme', { name: 'Ada' });
    // The office restarts (or the page reloads): the step is read back from office-settings.json.
    closeConnections();
    openConnections(dir, fileCipher);
    assert.equal(currentStep(), 'github');
    finishSetup({ name: 'Ada' });
    assert.equal(officeSettings().setup?.completedBy, 'Ada');
    rerunSetup({ name: 'Bo' });
    assert.equal(currentStep(), 'welcome');
    assert.equal(officeSettings().setup?.rerun, true);
    assert.equal(officeSettings().projectOrg, 'acme', 'what was set stays');
    assert.ok(a.events.filter((e) => e.target?.id === 'firstRun').length >= 3);
  } finally {
    a.stop();
    closeConnections();
  }
});

test('mxcli and the default Studio Pro version are checked before they are saved', () => {
  const dir = tmp('fr-mx-');
  openConnections(dir, fileCipher);
  try {
    assert.match(setMxcli('relative\\mxcli.exe', { name: 'Ada' })!, /full path/);
    assert.match(setMxcli(path.join(dir, 'nope', 'mxcli.exe'), { name: 'Ada' })!, /no mxcli/);
    const exe = path.join(dir, process.platform === 'win32' ? 'mxcli.exe' : 'mxcli');
    writeFileSync(exe, '');
    assert.equal(setMxcli(dir, { name: 'Ada' }), undefined, 'a folder means the mxcli in it');
    assert.equal(officeSettings().mxcliPath, exe);
    assert.equal(preferredMendix(['11.12.4', '11.6.4']), '11.12.4', 'nothing saved: the wizard’s own pick');
  } finally {
    closeConnections();
  }
});

/** A test office's HTTP side: the setup's routes, an admin (the shared password) and a member account. */
async function office(opts: { generated?: boolean } = {}) {
  const dir = tmp('fr-http-');
  const data = path.join(dir, '.agent-office');
  mkdirSync(data, { recursive: true });
  openConnections(data, fileCipher);
  const salt = randomBytes(16);
  const member = { id: 'm1', name: 'Mia', role: 'member' };
  const accounts = { sharedPassword: true, get: (id: string) => (id === 'm1' ? member : undefined), state: () => ({ accounts: [member], invites: [], sharedPassword: true }) };
  const cfg = { port: 0, trustProxy: false, dataDir: data, dir, salt, passwordGenerated: opts.generated ?? true, verifier: scryptSync('generated-pw', salt, 32) } as unknown as Ctx['cfg'];
  const auth = new Auth(cfg.verifier, salt, 'secret', accounts as never);
  const ctx = {
    cfg,
    auth,
    accounts,
    publicDir: dir,
    building: { projectsDir: dir, projectsDirState: () => ({ dir, custom: false }), setProjectsDir: () => undefined },
    floors: new Map(),
    meOf: (id?: string) => ({ admin: !id }),
    services: { lookup: () => undefined },
  } as unknown as Ctx;
  writeFileSync(path.join(dir, 'setup.html'), '<!doctype html><title>Setup</title>');
  const server = http.createServer(requestHandler(ctx, [firstRunRoutes.api, firstRunRoutes.page]));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  (cfg as { port: number }).port = port;
  const base = `http://127.0.0.1:${port}`;
  const cookie = (account?: string) => `ao_session_${port}=${auth.issue(account)}`;
  const call = (p: string, who: 'admin' | 'member', body?: unknown) =>
    fetch(`${base}${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: cookie(who === 'member' ? 'm1' : undefined), origin: base, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ctx, base, call, close: () => (server.close(), closeConnections()) };
}

test('anyone signed in learns there is a setup to do; only admins see its details and change anything', async () => {
  const o = await office();
  try {
    const needed = await (await o.call('/api/setup/needed', 'member')).json();
    assert.deepEqual(needed, { needed: true, admin: false });
    const memberView = await (await o.call('/api/setup', 'member')).json();
    assert.equal(memberView.admin, false);
    assert.equal(memberView.org.value, '', 'no details for a member');
    assert.equal((await o.call('/api/setup/checks', 'member')).status, 403);
    for (const p of ['/api/setup/step', '/api/setup/org', '/api/setup/password', '/api/setup/finish', '/api/setup/toolkit/clone']) assert.equal((await o.call(p, 'member', { step: 'github', org: 'x', password: 'abcdefgh1' })).status, 403, p);
    const adminView = await (await o.call('/api/setup', 'admin')).json();
    assert.equal(adminView.admin, true);
    assert.equal(adminView.password.source, 'generated');
    assert.equal(adminView.org.value, LEGACY_PROJECT_ORG);
    const moved = await o.call('/api/setup/step', 'admin', { step: 'mendix' });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).step, 'mendix');
    assert.equal((await (await o.call('/api/setup', 'admin')).json()).step, 'mendix', 'a reload opens on the same step');
    // Signed out: nothing at all.
    assert.equal((await fetch(`${o.base}/api/setup`)).status, 401);
    assert.equal((await fetch(`${o.base}/setup`, { redirect: 'manual' })).status, 302);
    const setPage = await fetch(`${o.base}/setup`, { headers: { cookie: `ao_session_${new URL(o.base).port}=${o.ctx.auth.issue()}` } });
    assert.equal(setPage.status, 200);
  } finally {
    o.close();
  }
});

test('a finished setup stops sending the admin to it; an office with a password from its launcher never sends anyone', async () => {
  const fresh = await office();
  try {
    assert.equal(setupReasons(fresh.ctx).length, 1);
    assert.equal((await fresh.call('/api/setup/finish', 'admin', {})).status, 200);
    assert.deepEqual(await (await fresh.call('/api/setup/needed', 'admin')).json(), { needed: false, admin: true });
  } finally {
    fresh.close();
  }
  const existing = await office({ generated: false });
  try {
    assert.deepEqual(await (await existing.call('/api/setup/needed', 'admin')).json(), { needed: false, admin: true });
  } finally {
    existing.close();
  }
});

/** A stand-in for spawnOff's child that prints `lines` and exits with `code`. */
function fakeGit(lines: string[], code: number, made?: (dir: string) => void) {
  const calls: string[][] = [];
  const spawn = ((file: string, args: readonly string[]) => {
    calls.push([file, ...args]);
    const child = Object.assign(new EventEmitter(), { kill: () => undefined });
    setImmediate(() => {
      for (const l of lines) child.emit('stderr', l);
      made?.(args.at(-1)!);
      child.emit('close', code, null);
    });
    return child;
  }) as never;
  return { spawn, calls };
}

test('cloning the toolkit streams git’s progress, refuses bad URLs and folders, and checks it is the toolkit', async () => {
  const root = tmp('fr-clone-');
  const into = path.join(root, 'mendix-toolkit');
  assert.equal(cloneUrlProblem('--upload-pack=evil'), 'That isn’t a Git URL');
  assert.equal(cloneUrlProblem('https://github.com/MendixMau/mxcli-project-toolkit.git'), undefined);
  assert.equal(cloneUrlProblem('git@github.com:acme/toolkit.git'), undefined);
  assert.match(cloneDirProblem('relative/dir').problem!, /full path/);
  mkdirSync(path.join(root, 'full'));
  writeFileSync(path.join(root, 'full', 'x'), '');
  assert.match(cloneDirProblem(path.join(root, 'full')).problem!, /isn’t empty/);

  const events: CloneEvent[] = [];
  const git = fakeGit(['Cloning into \'mendix-toolkit\'...\n', 'Receiving objects:  50% (5/10)\rReceiving objects: 100% (10/10), done.\n'], 0, (d) => {
    mkdirSync(path.join(d, 'bin'), { recursive: true });
    writeFileSync(path.join(d, 'bin', 'init-project.sh'), '');
  });
  const got = await cloneToolkit('https://github.com/MendixMau/mxcli-project-toolkit.git', into, (e) => events.push(e), { spawn: git.spawn });
  assert.equal(got, into);
  assert.deepEqual(git.calls[0], ['git', 'clone', '--progress', '--', 'https://github.com/MendixMau/mxcli-project-toolkit.git', into], 'the URL after --, never as an option');
  assert.ok(events.some((e) => e.t === 'line' && /Receiving objects: 100%/.test(e.text)));
  assert.deepEqual(events.at(-1), { t: 'done', ok: true, dir: into });

  const failed: CloneEvent[] = [];
  assert.equal(await cloneToolkit('https://example.com/x.git', path.join(root, 'other'), (e) => failed.push(e), { spawn: fakeGit(['fatal: repository not found\n'], 128).spawn }), undefined);
  assert.equal(failed.at(-1)?.t, 'done');
  assert.match((failed.at(-1) as { error: string }).error, /exit 128/);

  const notIt: CloneEvent[] = [];
  await cloneToolkit('https://example.com/y.git', path.join(root, 'empty'), (e) => notIt.push(e), { spawn: fakeGit([], 0, (d) => mkdirSync(d)).spawn });
  assert.match((notIt.at(-1) as { error: string }).error, /init-project\.sh/);
});

