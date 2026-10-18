// The packaged desktop app, end to end, against throwaway TEST offices with fake agents (never the real
// office: port 4600 is refused, every office home is under a test-offices folder, test mode is forced on,
// GitHub tokens are taken out of the environment, and only scripts/perf/fakebin's fake agent can start).
// Run on Windows after `npm run build` and `npm run desktop:pack` (CI: the desktop job in release.yml):
//
//   node desktop/scripts/e2e.mjs [--exe <mx-office.exe>] [--root <dir under a test-offices folder>] [--logs <dir>] [--keep]
//
// MX_OFFICE_DESKTOP_TEST=1 keeps the window off-screen and unfocused, records notifications (with a click
// to simulate) and answers the app's questions from a queue. It checks, in two runs of the app:
//
//   owned     the app starts the office (health answers, the window signs in); a seeded Needs-you item
//             makes a notification whose click opens the item; quitting while a fake agent works asks,
//             and "Keep running in the tray" keeps it all running; killing the office shows the crash
//             page and Restart brings it back without notifying again; Quit stops the office it started.
//   attached  an office started outside the app is attached to without a second office starting; signed
//             out it says so; Edit in Studio Pro on a synthetic Mendix project gets a JSON sync answer, its
//             confirm, and an open that test mode's stand-in records (Studio Pro never starts); an Open live app link
//             opens one Live app window of its own (own session, sandboxed, no office cookie); the office disappearing makes it "disconnected" with its counts marked
//             stale, and the app starts nothing; the office coming back recovers without notifying
//             again; Quit leaves that office running.
//
// Logs (this run's output, the app's output, the offices' logs) go to --logs (default <root>/../desktop-e2e-logs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { FAKE_AGENT, FAKEBIN, PASSWORD, REPO, assertTestDir, freePort, killProcessesUnder, killTree, login, markSetupDone, removeTestDir, startTestOffice } from '../../scripts/perf/office.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_PORT = 4600;
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const exe = path.resolve(arg('exe', path.join(HERE, '..', 'out', `Mx Office-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'mx-office.exe' : 'mx-office')));
const root = path.resolve(arg('root', path.join(os.tmpdir(), 'test-offices', `desktop-e2e-${Date.now()}`)));
const logs = path.resolve(arg('logs', path.join(path.dirname(root), 'desktop-e2e-logs')));
const keep = process.argv.includes('--keep');
assertTestDir(root, 'the e2e folder');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(logs, { recursive: true });

const out = fs.createWriteStream(path.join(logs, 'e2e.log'), { flags: 'w' });
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`;
  console.log(line);
  out.write(`${line}\n`);
};
const results = [];
let failed = false;
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`PASS ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
    log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    results.push(`FAIL ${name}: ${e.message}`);
    log(`FAIL ${name}: ${e.stack ?? e}`);
    throw e;
  }
}
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits until `fn` returns something truthy; returns it. */
async function until(what, fn, ms = 60_000, every = 500) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(every);
  }
  throw new Error(`timed out after ${ms / 1000} s waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 300)})`);
}
async function healthy(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}
/** Office processes (bin/agent-office.js) on `home`'s data or on `port` (the app passes the port, the home by environment). */
function officesOn(home, port) {
  const h = path.resolve(home).toLowerCase().replaceAll('\\', '/');
  const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine } | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
  const all = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).split(/\r?\n/);
  const onPort = port ? new RegExp(`--port[ =]"?${port}\\b`) : undefined;
  return all.filter((l) => /agent-office\.js/i.test(l) && (l.toLowerCase().replaceAll('\\', '/').includes(h) || onPort?.test(l))).map((l) => Number(l.split('|')[0]));
}

// ---- the environment: test mode, fake agents only, no tokens

const env = { ...process.env };
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'AGENT_OFFICE_PASSWORD', 'ANTHROPIC_API_KEY', 'ELECTRON_RUN_AS_NODE']) delete env[k];
// Windows names it Path, not PATH: find the real key, keep one, and put the fake bin in front of it.
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const basePath = env[pathKey] ?? '';
for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
const fakeEnv = { FAKE_MODE: 'live', FAKE_RATE_MS: '1500', FAKE_DIR: path.join(root, 'fake-transcripts') };
Object.assign(env, fakeEnv, {
  [pathKey]: `${FAKEBIN}${path.delimiter}${basePath}`,
  AGENT_OFFICE_TEST_MODE: '1',
  AGENT_OFFICE_AGENT: FAKE_AGENT,
  AGENT_OFFICE_ALLOW_REAL_AGENTS: '',
  AGENT_OFFICE_NO_OPEN: '1',
  MX_OFFICE_DESKTOP_TEST: '1',
});

const running = { app: undefined, appPid: undefined, offices: [] };

async function launch(name, port, home, userData, extra = []) {
  assert(port !== REAL_PORT, 'refused: port 4600 is the real office');
  assertTestDir(home);
  assertTestDir(userData, 'the app data folder');
  const appLog = fs.createWriteStream(path.join(logs, `app-${name}.log`), { flags: 'a' });
  const app = await electron.launch({
    executablePath: exe,
    args: ['--port', String(port), '--home', home, '--user-data', userData, '--office-dir', REPO, ...extra, '--', '--test-mode', '--password', PASSWORD, '--agent', FAKE_AGENT, '--no-open'],
    env: { ...env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_PROJECTS: path.join(home, 'projects') },
    timeout: 120_000,
  });
  running.app = app;
  running.appPid = app.process().pid;
  app.process().stdout?.on('data', (d) => appLog.write(d));
  app.process().stderr?.on('data', (d) => appLog.write(d));
  await until('the app hooks', () => app.evaluate(() => !!globalThis.__mxDesktop?.win()), 60_000);
  // Where the window went, for the log and the failures.
  await app.evaluate(() => {
    const w = globalThis.__mxDesktop.win();
    globalThis.__nav = [];
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-fail-load']) w.webContents.on(ev, (...a) => globalThis.__nav.push(`${ev} ${a.filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x).slice(0, 160)).join(' ')}`));
  });
  return app;
}
// Playwright hands the main process's electron module in first: a hook taking an argument reads it second.
const hook = (app, fn, a) => app.evaluate(fn, a);
const winUrl = (app) => app.evaluate(() => globalThis.__mxDesktop.win()?.webContents.getURL() ?? '');
const conn = (app) => app.evaluate(() => globalThis.__mxDesktop.conn());
async function quitApp(app) {
  const gone = new Promise((r) => (app.process().exitCode !== null ? r() : app.process().once('exit', r)));
  await app.evaluate(() => void globalThis.__mxDesktop.requestQuit()).catch(() => {});
  let timer;
  const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("the app didn't exit within 60 s of Quit")), 60_000)));
  await Promise.race([gone, late]).finally(() => clearTimeout(timer));
  running.app = undefined;
}

// ---- the office the app runs: a small big-data fixture (two projects, open escalations, live fake workers)

function fixture(dir) {
  const r = execFileSync(process.execPath, ['--import', 'tsx', path.join(REPO, 'scripts', 'perf', 'fixture.ts'), '--out', dir, '--scale', '0.5'], { cwd: REPO, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return JSON.parse(r.slice(r.indexOf('{')));
}
const officeKey = (home, port) => `${path.resolve(home).toLowerCase()}|${port}`;

// Edit in Studio Pro's project: the fixture's small project made a Mendix one (an .mpr) with a local bare
// origin one commit ahead, so the sync has something to fast-forward. Test mode never starts Studio Pro.
const STUDIO_FLOOR = 'small-app';
function studioProject(f) {
  const dir = f.floors.find((x) => x.id === STUDIO_FLOOR).dir;
  const origin = path.join(root, 'small-app-origin.git');
  const other = path.join(root, 'small-app-other');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env, stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(path.join(dir, 'SmallApp.mpr'), 'not a real Mendix project');
  git(dir, 'add', 'SmallApp.mpr');
  git(dir, 'commit', '-qm', 'Add the Mendix project');
  git(root, 'clone', '-q', '--bare', dir, origin);
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'fetch', '-q', 'origin');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  git(dir, 'branch', '-q', '--set-upstream-to', 'origin/main');
  git(root, 'clone', '-q', origin, other);
  fs.writeFileSync(path.join(other, 'merged.md'), 'merged on GitHub\n');
  git(other, 'add', 'merged.md');
  git(other, 'commit', '-qm', 'A pull request merged');
  git(other, 'push', '-q', 'origin', 'main');
}

async function owned(home) {
  const port = await freePort();
  const userData = path.join(root, 'app-owned');
  // The app has seen this office before with nothing waiting: each Needs-you item is new, one notification each.
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'desktop.json'), JSON.stringify({ seen: { [officeKey(home, port)]: { primed: true, keys: {} } } }));
  log(`owned: port ${port}, home ${home}`);
  const app = await launch('owned', port, home, userData);
  let pid;
  await check('owned: startup and health (the app starts the office, the window signs in)', async () => {
    await until('the office running', () => hook(app, () => globalThis.__mxDesktop.sup()?.state === 'running'), 150_000);
    assert(await healthy(port), '/api/health does not answer');
    pid = await hook(app, () => globalThis.__mxDesktop.sup()?.child?.pid);
    assert(pid, 'no office process');
    running.offices.push(pid);
    // Signed in, the window lands on Home (the sign-in link, then the flat view handing over to Home): settled there.
    await until('the window on Home, signed in', async () => (await winUrl(app)) === `http://localhost:${port}/home` && (await sleep(2000), (await winUrl(app)) === `http://localhost:${port}/home`), 60_000);
  });
  let note;
  await check('owned: notification navigation (a seeded Needs-you item notifies; its click opens the item)', async () => {
    const notes = await until('notifications', async () => {
      await hook(app, () => globalThis.__mxDesktop.poll());
      const n = await hook(app, () => globalThis.__mxDesktop.notes());
      return n.length ? n : undefined;
    });
    const c = await conn(app);
    assert(c.conn === 'running' && c.status?.needs.length, `not running with counts: ${JSON.stringify(c).slice(0, 200)}`);
    const i = notes.findIndex((n) => n.path && n.path !== 'home');
    assert(i >= 0, `no notification for an item: ${JSON.stringify(notes)}`);
    note = notes[i];
    await hook(app, (_electron, k) => globalThis.__mxDesktop.clickNote(k), i);
    // The item's page: its path and every query parameter the notification named (the page may add its own).
    const want = new URL(`http://localhost:${port}/${note.path}`);
    const at = (u) => {
      try {
        const x = new URL(u);
        return x.origin === want.origin && x.pathname === want.pathname && [...want.searchParams].every(([k, v]) => x.searchParams.get(k) === v);
      } catch {
        return false;
      }
    };
    let last = '';
    await until(`the window at ${want}`, async () => at((last = await winUrl(app))), 30_000).catch(async (e) => {
      throw new Error(`${e.message}; the window is at ${last}; it went: ${(await app.evaluate(() => globalThis.__nav.slice(-8))).join(' → ')}`);
    });
  });
  await check('owned: active-worker quit (asks; "Keep running in the tray" keeps the app and the office)', async () => {
    await until('a fake agent working', async () => {
      await hook(app, () => globalThis.__mxDesktop.poll());
      return (await hook(app, () => globalThis.__mxDesktop.status()?.working ?? 0)) > 0;
    }, 120_000, 2000);
    await hook(app, () => globalThis.__mxDesktop.answer(1));
    await hook(app, () => globalThis.__mxDesktop.requestQuit());
    const asked = await hook(app, () => globalThis.__mxDesktop.asked());
    const q = asked.at(-1);
    assert(q && /agents? (is|are) working/.test(q.message) && q.buttons.includes('Keep running in the tray'), `quit didn't ask: ${JSON.stringify(asked)}`);
    log(`  quit asked: ${q.message} [${q.buttons.join(" / ")}] → ${q.buttons[q.answer]}`);
    await sleep(1500);
    assert(app.process().exitCode === null, 'the app quit');
    assert(await healthy(port), 'the office stopped');
    assert(!(await hook(app, () => globalThis.__mxDesktop.win()?.isVisible())), 'the window is still shown');
  });
  await check('owned: crash recovery (office killed: crash page; Restart brings it back; nothing notified again)', async () => {
    const before = (await hook(app, () => globalThis.__mxDesktop.notes())).length;
    killTree(pid);
    await until('the crash page', async () => (await hook(app, () => globalThis.__mxDesktop.sup()?.state)) === 'crashed' && (await winUrl(app)).startsWith('data:'), 30_000);
    assert(/stopped unexpectedly/.test(await hook(app, () => globalThis.__mxDesktop.tooltip())), 'the tray does not say it stopped');
    await hook(app, () => void globalThis.__mxDesktop.onAction('restart'));
    await until('the office running again', () => hook(app, () => globalThis.__mxDesktop.sup()?.state === 'running'), 150_000);
    assert(await healthy(port), '/api/health does not answer after the restart');
    pid = await hook(app, () => globalThis.__mxDesktop.sup()?.child?.pid);
    running.offices.push(pid);
    await until('a confirmed look', async () => (await hook(app, () => globalThis.__mxDesktop.poll()), (await conn(app)).conn === 'running'), 60_000, 2000);
    const notes = await hook(app, () => globalThis.__mxDesktop.notes());
    const replayed = notes.slice(before).filter((n) => n.path && n.path !== 'home');
    assert(!replayed.length, `items notified again after the restart: ${JSON.stringify(replayed)}`);
  });
  await check('owned: shutdown ownership (Quit stops the office the app started)', async () => {
    await hook(app, () => globalThis.__mxDesktop.answer(0));
    await quitApp(app);
    await until('the office stopped', async () => !(await healthy(port)), 30_000);
    await until('its process gone', () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 30_000);
  });
}

async function attached(home) {
  const port = await freePort();
  const userData = path.join(root, 'app-attached');
  const officeLog = path.join(logs, 'office-attached.log');
  log(`attached: port ${port}, home ${home}`);
  let office = await startTestOffice({ home, port, env: fakeEnv, log: officeLog });
  running.offices.push(office.proc.pid);
  const app = await launch('attached', port, home, userData, ['--attach', 'always']);
  await check('attached: attach without a duplicate launch (no second office process)', async () => {
    await until('attached', async () => (await hook(app, () => globalThis.__mxDesktop.mode())) === 'attached', 60_000);
    await until('the window on the office', async () => (await winUrl(app)).startsWith(`http://localhost:${port}/`), 30_000);
    await sleep(3000);
    assert(!(await hook(app, () => !!globalThis.__mxDesktop.sup())), 'the app made a supervisor');
    const offices = officesOn(home, port);
    assert(offices.length === 1, `office processes on the test home: ${JSON.stringify(offices)} (want only ${office.proc.pid})`);
  });
  await check('attached: 401 is signed out', async () => {
    await hook(app, () => globalThis.__mxDesktop.poll());
    const c = await conn(app);
    assert(c.conn === 'signed-out', `conn ${c.conn}`);
    assert(/sign in/.test(await hook(app, () => globalThis.__mxDesktop.tooltip())), 'the tray does not say sign in');
  });
  const signIn = async () => {
    const [name, value] = (await login(office.base)).split(';')[0].split('=');
    await hook(app, (_electron, [u, n, v]) => globalThis.__mxDesktop.win().webContents.session.cookies.set({ url: u, name: n, value: v }), [`http://localhost:${port}`, name, value]);
  };
  let notesBefore = 0;
  await check('attached: signed in, the counts are confirmed', async () => {
    await signIn();
    await hook(app, () => globalThis.__mxDesktop.poll());
    const c = await conn(app);
    assert(c.conn === 'running' && c.status?.needs.length > 0 && c.checkedAt, `conn ${JSON.stringify(c).slice(0, 200)}`);
    notesBefore = (await hook(app, () => globalThis.__mxDesktop.notes())).length;
    assert(notesBefore === 1, `the first look makes one summary: ${notesBefore}`);
  });
  await check('attached: Edit in Studio Pro (the sync answers JSON, the open uses test mode’s stand-in, never Studio Pro)', async () => {
    const w = (js) => hook(app, (_electron, code) => globalThis.__mxDesktop.win().webContents.executeJavaScript(code), js);
    // Every answer to the Studio Pro calls, as the window's own session saw it.
    await hook(app, () => {
      globalThis.__studio = [];
      globalThis.__mxDesktop.win().webContents.session.webRequest.onCompleted({ urls: ['*://*/api/studio*'] }, (d) => globalThis.__studio.push({ method: d.method, url: d.url, status: d.statusCode, type: String(d.responseHeaders?.['content-type'] ?? d.responseHeaders?.['Content-Type'] ?? '') }));
    });
    await w(`localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Desktop e2e', color: '#00a6a6', skin: 0, hair: 0, style: 0 })); true`);
    await hook(app, (_electron, u) => globalThis.__mxDesktop.win().loadURL(u), `http://localhost:${port}/lite?floor=${STUDIO_FLOOR}&open=studio`);
    const shown = await until('the Open in Studio Pro confirm (or a toast saying why not)', () => w(`(() => { const m = document.querySelector('.st-modal'); if (m) return 'modal'; const t = [...document.querySelectorAll('.toast.error, .toast.warn')].map((e) => e.textContent).join(' | '); return t || ''; })()`), 90_000);
    const calls = await hook(app, () => globalThis.__studio);
    const sync = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/studio/sync'));
    assert(sync && sync.status === 200 && sync.type.includes('application/json'), `the sync answered ${JSON.stringify(sync)} (all: ${JSON.stringify(calls)})`);
    assert(shown === 'modal', `no confirm: ${shown}`);
    await w(`document.querySelector('.st-modal .btn.primary').click(); true`);
    await until('the open answered', async () => (await hook(app, () => globalThis.__studio)).some((c) => c.method === 'POST' && c.url.endsWith('/api/studio/open')), 60_000);
    const open = (await hook(app, () => globalThis.__studio)).find((c) => c.method === 'POST' && c.url.endsWith('/api/studio/open'));
    assert(open.status === 200 && open.type.includes('application/json'), `the open answered ${JSON.stringify(open)}`);
    await until('the stand-in in the office log', () => /test mode: Studio Pro not started \(it would have run VersionSelector\.exe \/file:/.test(fs.readFileSync(officeLog, 'utf8')), 15_000);
    log('  Edit in Studio Pro: sync 200 JSON, confirm shown, open 200 JSON, Studio Pro not started (test mode)');
  });
  await check('attached: Open live app opens a Live app window of its own (own session, no office cookie), once per project', async () => {
    // A stand-in for the live app's address (the office's recording proxy in real use): records the cookies it gets.
    const cookies = [];
    const fake = http.createServer((req, res) => {
      cookies.push(req.headers.cookie ?? '');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Order desk</title><h1>Order desk</h1>');
    });
    const appPort = await freePort();
    await new Promise((r) => fake.listen(appPort, '127.0.0.1', r));
    try {
      const w = (js) => hook(app, (_electron, code) => globalThis.__mxDesktop.win().webContents.executeJavaScript(code, true), js);
      const click = `(() => { const a = document.createElement('a'); a.href = 'http://localhost:${appPort}/'; a.target = 'mxoffice-liveapp-small-app'; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); return true; })()`;
      await w(click);
      await until('the Live app window on the app', async () => (await hook(app, () => globalThis.__mxDesktop.liveWindows().map((x) => x.url))).some((u) => u === `http://localhost:${appPort}/`), 30_000);
      const info = await hook(app, () => {
        const [lw] = globalThis.__mxDesktop.liveWindows();
        return { n: globalThis.__mxDesktop.liveWindows().length, own: lw.win.webContents.session !== globalThis.__mxDesktop.win().webContents.session, sandboxed: lw.win.webContents.getLastWebPreferences().sandbox, title: lw.win.getTitle() };
      });
      assert(info.n === 1 && info.own && info.sandboxed, `the Live app window: ${JSON.stringify(info)}`);
      assert(cookies.length > 0 && cookies.every((c) => !/ao_session/.test(c)), `the office's cookie reached the app: ${JSON.stringify(cookies)}`);
      await w(click);
      await sleep(1500);
      assert((await hook(app, () => globalThis.__mxDesktop.liveWindows().length)) === 1, 'opening again reuses the window');
      assert(/^http:\/\/localhost:\d+\//.test(await winUrl(app)), 'the office window stayed on the office');
      await hook(app, () => globalThis.__mxDesktop.liveWindows().forEach((x) => x.win.close()));
      await until('the Live app window closed', async () => (await hook(app, () => globalThis.__mxDesktop.liveWindows().length)) === 0, 10_000);
      log(`  Live app window: own session, sandboxed, "${info.title}", no office cookie, reused`);
    } finally {
      fake.closeAllConnections();
      await new Promise((r) => fake.close(r));
    }
  });
  await check('attached: the office disappearing is "disconnected", counts stale, nothing started', async () => {
    // Its process only (office.stop() also ends every process naming the home, the app among them).
    killTree(office.proc.pid);
    await until('the office gone', async () => office.proc.exitCode !== null && !(await healthy(port)), 30_000);
    await hook(app, () => globalThis.__mxDesktop.poll());
    const c = await conn(app);
    assert(c.conn === 'disconnected', `conn ${c.conn}`);
    assert((await hook(app, () => globalThis.__mxDesktop.status())) === undefined, 'stale counts are still offered as fresh');
    const tip = await hook(app, () => globalThis.__mxDesktop.tooltip());
    assert(/as of .*office not answering|office not answering/.test(tip), `tooltip: ${tip}`);
    const menu = await hook(app, () => globalThis.__mxDesktop.menu());
    assert(menu.includes('Start the office here…'), `menu: ${menu.join(' | ')}`);
    await sleep(2000);
    assert(!(await healthy(port)) && officesOn(home, port).length === 0, 'something started an office');
    assert(!(await hook(app, () => !!globalThis.__mxDesktop.sup())), 'the app made a supervisor');
  });
  await check('attached: the office back again recovers without notifying again', async () => {
    office = await startTestOffice({ home, port, env: fakeEnv, log: officeLog });
    running.offices.push(office.proc.pid);
    await until('running again', async () => (await hook(app, () => globalThis.__mxDesktop.poll()), (await conn(app)).conn === 'running'), 60_000, 2000);
    const n = (await hook(app, () => globalThis.__mxDesktop.notes())).length;
    assert(n === notesBefore, `notifications replayed: ${n - notesBefore}`);
  });
  await check('attached: Quit leaves the office it attached to running', async () => {
    await quitApp(app);
    await sleep(2000);
    assert(await healthy(port), 'the attached office stopped');
  });
  await office.stop();
}

// ---- go

let code = 0;
// A run that hangs still ends, with everything it started stopped.
setTimeout(() => {
  log('FAIL the run took over 20 minutes');
  if (running.appPid) killTree(running.appPid);
  for (const pid of running.offices) killTree(pid);
  killProcessesUnder(root);
  process.exit(1);
}, 20 * 60_000).unref();
try {
  assert(fs.existsSync(exe), `no packaged app at ${exe}: run npm run desktop:pack first`);
  assert(fs.existsSync(path.join(REPO, 'dist', 'server', 'server', 'cli.js')), 'the office is not built: run npm run build first');
  log(`app ${exe}`);
  log(`root ${root}`);
  const f = fixture(path.join(root, 'fixture'));
  const home = f.officeDir;
  markSetupDone(home);
  log(`fixture: ${JSON.stringify(f.counts)}`);
  await owned(home);
  killProcessesUnder(root);
  studioProject(f);
  await attached(home);
} catch (e) {
  code = 1;
  if (!failed) {
    results.push(`FAIL setup: ${e.message}`);
    log(`FAIL ${e.stack ?? e}`);
  }
} finally {
  // Not app.close(): the app asks before quitting, and nobody answers. Its whole tree goes.
  if (running.appPid) killTree(running.appPid);
  for (const pid of running.offices) killTree(pid);
  await sleep(1000);
  killProcessesUnder(root);
  for (const f of [path.join(root, 'fixture', 'office', '.agent-office', 'desktop-office.log')]) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(logs, 'office-owned.log'));
  const left = (() => {
    try {
      return officesOn(path.join(root, 'fixture'));
    } catch {
      return [];
    }
  })();
  if (left.length) log(`WARNING: office processes still running: ${left.join(', ')}`);
  log('');
  for (const r of results) log(r);
  if (failed) code = 1;
  log(code ? 'desktop e2e: FAILED' : 'desktop e2e: all checks passed');
  await new Promise((r) => out.end(r));
  if (!keep && !code) {
    try {
      removeTestDir(root);
    } catch (e) {
      console.warn(`couldn't remove ${root}: ${e.message}`);
    }
  }
}
process.exit(code);
