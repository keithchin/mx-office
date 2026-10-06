// Open in Studio Pro (server/studio/): which program opens the floor's .mpr and with what arguments,
// and every reason it won't. Nothing here starts Studio Pro: spawn is a stand-in that writes down
// what it was asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkStudio, launcherFor, mprVersion, openInStudio, type StudioDeps } from '../src/server/studio/open.js';
import { lastOpenedInStudio, onStudioOpened, studioInfo, studioOpened } from '../src/server/studio/index.js';
import { onDesktop } from '../src/server/browser.js';
import { studioRoutes } from '../src/server/http/routes/studio.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { findMpr } from '../src/server/liveapp/checkout.js';

const MX = 'C:\\Program Files\\Mendix';
const SELECTOR = `${MX}\\Version Selector\\VersionSelector.exe`;
const studioExe = (v: string) => `${MX}\\${v}\\modeler\\studiopro.exe`;
const MPR = 'C:\\Users\\Pat Smith\\My Projects\\Shop App\\Shop App.mpr';

interface Spawned {
  cmd: string;
  args: string[];
  opts: unknown;
  unrefed: boolean;
}

/** A Windows desktop with `files` on it (and the folders they're in), and a spawn that only notes what it was asked. */
function machine(files: string[], over: Partial<StudioDeps> = {}): StudioDeps & { spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  const set = new Set(files);
  return {
    platform: 'win32',
    env: { ProgramFiles: MX.replace('\\Mendix', '') },
    exists: (p) => set.has(p),
    readdir: (p) => {
      const kids = [...set].filter((f) => f.startsWith(`${p}\\`)).map((f) => f.slice(p.length + 1).split('\\')[0]);
      if (!kids.length) throw new Error('ENOENT');
      return [...new Set(kids)];
    },
    findMpr: () => MPR,
    readVersion: () => '11.6.4',
    spawn(cmd, args, opts) {
      const s: Spawned = { cmd, args, opts, unrefed: false };
      spawned.push(s);
      return { on: () => undefined, unref: () => void (s.unrefed = true) };
    },
    spawned,
    ...over,
  };
}

test('the Version Selector opens the project, its path one argument however many spaces it has', () => {
  const l = launcherFor(MPR, '11.6.4', machine([SELECTOR, studioExe('11.12.4')]));
  assert.deepEqual(l, { via: 'version-selector', cmd: SELECTOR, args: [`/file:${MPR}`] });
});

test("without the Version Selector, the studiopro.exe of the project's version, or the newest when its version isn't known", () => {
  const d = machine([studioExe('10.24.15.93102'), studioExe('11.6.4'), studioExe('11.9.1'), studioExe('11.12.0'), `${MX}\\gradle-8.5\\bin\\gradle`]);
  assert.deepEqual(launcherFor(MPR, '11.6.4', d), { via: 'studiopro', cmd: studioExe('11.6.4'), args: [MPR] });
  assert.deepEqual(launcherFor(MPR, '10.24.15', d), { via: 'studiopro', cmd: studioExe('10.24.15.93102'), args: [MPR] }, 'a folder with the build number after it is that version');
  assert.deepEqual(launcherFor(MPR, undefined, d), { via: 'studiopro', cmd: studioExe('11.12.0'), args: [MPR] }, '11.12 is newer than 11.9');
});

test("another version is never picked for a project whose version is known (it would offer to convert it)", () => {
  const l = launcherFor(MPR, '11.6.4', machine([studioExe('11.12.4')]));
  assert.ok('problem' in l && l.problem === 'not-installed');
  assert.match(l.error, /Studio Pro 11\.6\.4 isn't installed/);
  assert.match(l.error, /11\.12\.4/);
});

test("no Mendix folder at all: Studio Pro isn't installed", () => {
  const l = launcherFor(MPR, '11.6.4', machine([]));
  assert.ok('problem' in l && l.problem === 'not-installed');
  assert.match(l.error, /Studio Pro isn't installed/);
});

test('opening spawns it detached and lets go of it, and says what it opened', () => {
  const d = machine([SELECTOR]);
  const r = openInStudio('C:\\floors\\shop', d);
  assert.deepEqual(r, { ok: true, mpr: MPR, version: '11.6.4', via: 'version-selector' });
  assert.equal(d.spawned.length, 1);
  assert.deepEqual(d.spawned[0], { cmd: SELECTOR, args: [`/file:${MPR}`], opts: { detached: true, stdio: 'ignore', windowsHide: false }, unrefed: true });
});

test('a version it can\'t read is left out, and the Version Selector still opens it', () => {
  const d = machine([SELECTOR], { readVersion: () => undefined });
  assert.deepEqual(openInStudio('C:\\floors\\shop', d), { ok: true, mpr: MPR, via: 'version-selector' });
});

test('every reason it won\'t open, and nothing spawned for any of them', () => {
  const cases: [Partial<StudioDeps>, string, RegExp][] = [
    [{ findMpr: () => undefined }, 'no-mpr', /No Mendix project \(\.mpr\) in C:\\floors\\shop/],
    [{ findMpr: () => { throw new Error('ENOENT'); } }, 'no-mpr', /No Mendix project/],
    [{ env: { ProgramFiles: 'C:\\Program Files', SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' } }, 'no-desktop', /isn't running on a desktop/],
    [{ env: { CI: 'true' } }, 'no-desktop', /isn't running on a desktop/],
    [{ platform: 'linux', env: {} }, 'no-desktop', /desktop/],
    [{ platform: 'darwin', env: {} }, 'not-windows', /Windows only/],
    [{ exists: () => false }, 'not-installed', /isn't installed/],
  ];
  for (const [over, problem, error] of cases) {
    const d = machine([SELECTOR], over);
    const r = openInStudio('C:\\floors\\shop', d);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.problem === problem, `${problem}: ${JSON.stringify(r)}`);
    assert.match(!r.ok ? r.error : '', error);
    assert.equal(d.spawned.length, 0);
  }
});

test('checkStudio still names the project and its version when it can\'t be opened from here', () => {
  const c = checkStudio('C:\\floors\\shop', machine([SELECTOR], { platform: 'darwin', env: {} }));
  assert.equal(c.mpr, MPR);
  assert.equal(c.version, '11.6.4');
  assert.equal(c.problem, 'not-windows');
  assert.equal(c.launcher, undefined);
});

test('onDesktop: not over SSH, in CI, or on Linux without a display', () => {
  assert.equal(onDesktop({}, 'win32'), true);
  assert.equal(onDesktop({ SSH_TTY: '/dev/pts/0' }, 'win32'), false);
  assert.equal(onDesktop({ CI: '1' }, 'darwin'), false);
  assert.equal(onDesktop({}, 'linux'), false);
  assert.equal(onDesktop({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true);
});

test("mprVersion reads _MetaData's product version, and gives up quietly on anything else", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const junk = path.join(dir, 'junk.mpr');
  writeFileSync(junk, 'not a database');
  assert.equal(mprVersion(junk), undefined);
  assert.equal(mprVersion(path.join(dir, 'missing.mpr')), undefined);
  let sqlite: typeof import('node:sqlite') | undefined;
  try {
    sqlite = createRequire(import.meta.url)('node:sqlite');
  } catch {
    return t.skip('no node:sqlite in this Node');
  }
  const mpr = path.join(dir, 'App.mpr');
  const db = new sqlite!.DatabaseSync(mpr);
  db.exec("CREATE TABLE _MetaData (_FormatVersion INTEGER, _ProductVersion TEXT, _BuildVersion TEXT); INSERT INTO _MetaData VALUES (2, '11.6.4', '11.6.4');");
  db.close();
  assert.equal(mprVersion(mpr), '11.6.4');
});

const worker = (name: string, status: WorkerInfo['status'], kind: WorkerInfo['kind'] = 'agent') => ({ name, status, kind }) as WorkerInfo;

test("studioInfo: the project relative to the floor's checkout, and the agents mid-turn", () => {
  const dir = 'C:\\Users\\Pat Smith\\My Projects';
  const floor = { id: 'shop', dir, workers: { list: () => [worker('Ada', 'working'), worker('Bo', 'idle'), worker('Cy', 'needs_input'), worker('Sh', 'working', 'shell')] } };
  const s = studioInfo(floor as never, true, machine([SELECTOR]));
  assert.deepEqual(s, { hasMpr: true, mpr: 'Shop App\\Shop App.mpr', version: '11.6.4', available: true, admin: true, busy: ['Ada', 'Cy'] });
  const none = studioInfo(floor as never, false, machine([SELECTOR], { findMpr: () => undefined }));
  assert.equal(none.hasMpr, false);
  assert.equal(none.available, false);
  assert.equal(none.problem, 'no-mpr');
  assert.equal(none.admin, false);
});

test('an open is remembered for the floor and told to whoever listens', () => {
  const heard: string[] = [];
  const off = onStudioOpened((o) => heard.push(`${o.by}@${o.floor}`));
  studioOpened({ floor: 'shop-test', by: 'Pat', at: 1, mpr: MPR });
  off();
  studioOpened({ floor: 'shop-test', by: 'Lee', at: 2, mpr: MPR });
  assert.deepEqual(heard, ['Pat@shop-test']);
  assert.equal(lastOpenedInStudio('shop-test')?.by, 'Lee');
});

// ---- The route's refusals (none of them gets as far as opening anything) -----------------------
function call(opts: { origin?: string; admin: boolean; body: unknown }) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(opts.body))]), { method: 'POST', headers: { host: 'office.test', ...(opts.origin ? { origin: opts.origin } : {}) } });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: opts.admin }), floors: new Map() };
  return (studioRoutes.open.handle as (c: unknown, r: unknown) => Promise<void>)(ctx, { req, res, url: new URL('http://office.test/api/studio/open'), path: '/api/studio/open', session: {} }).then(() => ({ status, body }));
}

test('POST /api/studio/open: only from the office\'s own pages, only admins, only a real floor', async () => {
  assert.equal((await call({ admin: true, body: { floor: 'shop' } })).status, 403, 'no Origin');
  assert.equal((await call({ origin: 'https://evil.test', admin: true, body: { floor: 'shop' } })).status, 403, 'another origin');
  const notAdmin = await call({ origin: 'http://office.test', admin: false, body: { floor: 'shop' } });
  assert.equal(notAdmin.status, 403);
  assert.match((notAdmin.body as { error: string }).error, /Only admins/);
  assert.equal((await call({ origin: 'http://office.test', admin: true, body: { floor: 'nowhere' } })).status, 404);
});

test('findMpr on a floor checkout finds the project one folder down (the floor\'s own, not the live app\'s clone)', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-floor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'Shop App'));
  writeFileSync(path.join(dir, 'Shop App', 'Shop App.mpr'), '');
  const c = checkStudio(dir, { ...machine([SELECTOR]), findMpr });
  assert.equal(c.mpr, path.join(dir, 'Shop App', 'Shop App.mpr'));
});
