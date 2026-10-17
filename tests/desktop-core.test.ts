// The desktop app's pure parts (desktop/src/core/): its options, the port decision, the health wait, the
// Needs-you diffing and dedupe, the restart sequencing with a fake child, and the helpers around them.
// No Electron needed: the app's Electron glue is desktop/src/main.ts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { officeArgv, officeEnv, parseOptions } from '../desktop/src/core/options.ts';
import { decideStart, healthLabel, parseHealth, waitForHealth, type FetchLike } from '../desktop/src/core/health.ts';
import { diffNeeds, emptySeen, FORGET_MS, MAX_PER_LOOK, notesFor, parseStatus, tooltipFor, type Need } from '../desktop/src/core/needs.ts';
import { OfficeSupervisor, RESTART_EXIT_CODE, type ChildLike } from '../desktop/src/core/supervisor.ts';
import { atLeast, findOfficeDir, findOnPath, lastLines, tailOf } from '../desktop/src/core/system.ts';
import { badgeBitmap, badgeLabel, fitBounds, pageHtml } from '../desktop/src/core/window.ts';
import { actionOf, act, crashPage, problemPage } from '../desktop/src/core/screens.ts';

test('options: flags, then the environment, then the defaults; office options after --', () => {
  const home = path.resolve('/u/me');
  const o = parseOptions(['--port', '4791', '--home=/t/h', '--inspect', '--', '--test-mode', '--port', '1'], { PORT: '5000' }, home);
  assert.equal(o.port, 4791);
  assert.equal(o.home, path.resolve('/t/h'));
  assert.deepEqual(o.officeArgs, ['--test-mode', '--port', '1']);
  assert.equal(o.attach, 'ask');
  const d = parseOptions([], { MX_OFFICE_PORT: 'x', PORT: '4700' }, home);
  assert.equal(d.port, 4700);
  assert.equal(d.home, path.join(home, 'agent-office'));
  assert.equal(parseOptions([], { AGENT_OFFICE_HOME: '/x' }, home).home, path.resolve('/x'));
  assert.equal(parseOptions([], {}, home).port, 4600);
  assert.equal(parseOptions(['--attach', 'always'], {}, home).attach, 'always');
  // The port the app watches is the office's: a --port among the office options gives way.
  assert.deepEqual(officeArgv({ port: 4791, officeArgs: ['--port', '1', '--port=2', '--test-mode'] }), ['--port', '4791', '--test-mode']);
  const env = officeEnv({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', NOPE: undefined }, { home: '/h' });
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.AGENT_OFFICE_LAUNCHER_LOOP, '1');
  assert.equal(env.AGENT_OFFICE_DESKTOP, '1');
  assert.equal(env.AGENT_OFFICE_NO_OPEN, '1');
  assert.equal(env.AGENT_OFFICE_HOME, '/h');
  assert.equal(env.PATH, 'p');
});

test('the port: an office there is attached to (or asked about, or refused), never started twice; a foreign port is busy', () => {
  const h = { ok: true as const, sha: 'abc' };
  assert.deepEqual(decideStart({ portOpen: false, attach: 'ask' }), { kind: 'start' });
  assert.deepEqual(decideStart({ portOpen: true, attach: 'ask' }), { kind: 'busy' });
  assert.equal(decideStart({ health: h, portOpen: true, attach: 'ask' }).kind, 'ask');
  assert.equal(decideStart({ health: h, portOpen: true, attach: 'always' }).kind, 'attach');
  assert.equal(decideStart({ health: h, portOpen: true, attach: 'never' }).kind, 'refuse');
});

test('health: only the office\'s body counts, and its label names the release and commit', () => {
  assert.equal(parseHealth({ ok: false }), undefined);
  assert.equal(parseHealth('ok'), undefined);
  const h = parseHealth({ ok: true, sha: '0d92abcdef', release: 50, ahead: 3, startedAt: 7, junk: 1 });
  assert.deepEqual(h, { ok: true, sha: '0d92abcdef', release: 50, ahead: 3, startedAt: 7 });
  assert.equal(healthLabel(h), 'release 50 + 3 (0d92abc)');
  assert.equal(healthLabel({ ok: true, sha: 'abcdef123' }), 'abcdef1');
  assert.equal(healthLabel(undefined), 'unknown build');
});

/** A clock that only moves when the wait sleeps. */
function fakeTime() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const answers = (list: (object | 'down')[]): FetchLike => {
  let i = 0;
  return async () => {
    const a = list[Math.min(i++, list.length - 1)];
    if (a === 'down') throw new Error('ECONNREFUSED');
    return { ok: true, status: 200, json: async () => a };
  };
};

test('health wait: answers once the office does, gives up at the time limit, and stops when the process is gone', async () => {
  const t = fakeTime();
  const ok = await waitForHealth({ fetch: answers(['down', 'down', { ok: true, sha: 'a' }]), base: 'http://x', timeoutMs: 10_000, intervalMs: 500, ...t });
  assert.equal(ok.ok, true);
  assert.equal(ok.ms, 1000);
  const t2 = fakeTime();
  const late = await waitForHealth({ fetch: answers(['down']), base: 'http://x', timeoutMs: 3000, intervalMs: 500, ...t2 });
  assert.deepEqual([late.ok, !late.ok && late.reason, late.ms], [false, 'timeout', 3000]);
  let looks = 0;
  const gone = await waitForHealth({ fetch: answers(['down']), base: 'http://x', timeoutMs: 60_000, gone: () => ++looks > 3, ...fakeTime() });
  assert.equal(!gone.ok && gone.reason, 'exited');
  // After a restart, the office from before doesn't count.
  const t3 = fakeTime();
  const fresh = await waitForHealth({ fetch: answers([{ ok: true, startedAt: 1 }, { ok: true, startedAt: 1 }, { ok: true, startedAt: 2 }]), base: 'http://x', timeoutMs: 10_000, accept: (h) => h.startedAt !== 1, ...t3 });
  assert.equal(fresh.ok && fresh.health.startedAt, 2);
});

const need = (id: string, extra: Partial<Need> = {}): Need => ({ id, floor: 'f', project: 'Travel', who: 'Ana', summary: `about ${id}`, urgency: 'Blocking', level: 'block', path: 'lite?floor=f', ...extra });

test('needs: the first look notifies once with a count; later only new items, each once, across restarts', () => {
  const first = diffNeeds(emptySeen(), [need('a'), need('b')], 1000);
  assert.equal(first.first, true);
  assert.deepEqual(notesFor(first).map((n) => n.body), ['2 need you.']);
  assert.deepEqual(notesFor(diffNeeds(emptySeen(), [], 1000)), []);
  // The state goes through JSON (desktop.json) between app runs.
  const kept = JSON.parse(JSON.stringify(first.seen));
  const second = diffNeeds(kept, [need('a'), need('b'), need('c', { urgency: 'URGENT' })], 2000);
  assert.deepEqual(second.fresh.map((n) => n.id), ['c']);
  const notes = notesFor(second);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, 'Travel: Ana');
  assert.equal(notes[0].body, 'URGENT: about c');
  assert.equal(notes[0].path, 'lite?floor=f');
  // Nothing new: nothing to say.
  assert.deepEqual(notesFor(diffNeeds(second.seen, [need('c')], 3000)), []);
  // An item that went and came back within the week isn't new; after it, it is.
  const back = diffNeeds(diffNeeds(second.seen, [], 4000).seen, [need('a')], 5000);
  assert.equal(back.fresh.length, 0);
  const later = diffNeeds(diffNeeds(second.seen, [], 4000).seen, [need('b')], 4000 + FORGET_MS + 1);
  assert.deepEqual(later.fresh.map((n) => n.id), ['b']);
});

test('needs: a flood is a few notifications and one summary; duplicates count once', () => {
  const primed = diffNeeds(emptySeen(), [], 0).seen;
  const many = Array.from({ length: MAX_PER_LOOK + 3 }, (_, i) => need(`n${i}`));
  const d = diffNeeds(primed, [...many, need('n0')], 1);
  assert.equal(d.fresh.length, MAX_PER_LOOK);
  assert.equal(d.more, 3);
  const notes = notesFor(d);
  assert.equal(notes.length, MAX_PER_LOOK + 1);
  assert.equal(notes.at(-1)!.body, '3 more need you.');
  assert.equal(new Set(notes.map((n) => n.id).filter(Boolean)).size, MAX_PER_LOOK);
});

test('needs: the status body is checked, and the tooltip says what needs you within Windows\' limit', () => {
  assert.equal(parseStatus({}), undefined);
  const s = parseStatus({ needs: [{ id: 'x', project: 'P', level: 'block' }, { nope: 1 }, null], working: 2.7 });
  assert.equal(s!.needs.length, 1);
  assert.equal(s!.working, 2);
  assert.equal(parseStatus({ needs: [], working: -1 })!.working, 0);
  assert.equal(tooltipFor({ state: 'running', count: 3, build: 'release 50 (0d92abc)' }), 'Mx Office: 3 need you\nrelease 50 (0d92abc)');
  assert.equal(tooltipFor({ state: 'running', count: 1 }), 'Mx Office: 1 needs you');
  assert.equal(tooltipFor({ state: 'signed-out' }), 'Mx Office: sign in to see what needs you');
  assert.ok(tooltipFor({ state: 'running', count: 2, build: 'x'.repeat(300) }).length <= 127);
});

class FakeChild extends EventEmitter implements ChildLike {
  static last: FakeChild[] = [];
  pid = 1000 + FakeChild.last.length;
  exitCode: number | null = null;
  connected = true;
  sent: unknown[] = [];
  constructor() {
    super();
    FakeChild.last.push(this);
  }
  send(m: unknown) {
    this.sent.push(m);
    return true;
  }
  exit(code: number | null, signal: string | null = null) {
    this.exitCode = code ?? 1;
    this.connected = false;
    this.emit('exit', code, signal);
  }
}

function supervisor(o: { healthy?: (c: FakeChild) => Promise<boolean>; stopTimeoutMs?: number } = {}) {
  FakeChild.last = [];
  const killed: number[] = [];
  let n = 0;
  const sup = new OfficeSupervisor({
    spawn: () => new FakeChild(),
    waitHealthy: async (child, accept) => {
      const c = child as FakeChild;
      if (o.healthy && !(await o.healthy(c))) return c.exitCode !== null ? { ok: false, reason: 'exited', ms: 5 } : { ok: false, reason: 'timeout', ms: 90_000 };
      const h = { ok: true as const, sha: 'abc', startedAt: ++n };
      return !accept || accept(h) ? { ok: true, health: h, ms: 5 } : { ok: false, reason: 'timeout', ms: 1 };
    },
    killTree: (c) => {
      killed.push(c.pid!);
      (c as FakeChild).exit(null, 'SIGKILL');
    },
    logTail: () => 'line 1\nline 2',
    stopTimeoutMs: o.stopTimeoutMs ?? 50,
  });
  const states: string[] = [];
  sup.on('state', (s) => states.push(s));
  return { sup, killed, states };
}

test('restarts: an exit with 75 starts the office again and says it\'s ready; the sign-in link comes over the channel', async () => {
  const { sup, states } = supervisor();
  const ready: { restarted: boolean; signIn?: string }[] = [];
  sup.on('ready', (_h, info) => ready.push(info));
  const p = sup.start();
  FakeChild.last[0].emit('message', { t: 'ready', signIn: '/login#key=k1' });
  FakeChild.last[0].emit('message', { t: 'ready', signIn: 'https://evil.example/' });
  await p;
  assert.equal(sup.state, 'running');
  assert.deepEqual(ready, [{ restarted: false, signIn: '/login#key=k1' }]);
  FakeChild.last[0].exit(RESTART_EXIT_CODE);
  await new Promise((r) => sup.once('ready', r));
  assert.equal(FakeChild.last.length, 2);
  assert.equal(ready[1].restarted, true);
  assert.deepEqual(states, ['starting', 'running', 'restarting', 'running']);
});

test('restart now: asks the office over its channel, and the new office answers', async () => {
  const { sup } = supervisor();
  await sup.start();
  const done = sup.restartNow();
  assert.deepEqual(FakeChild.last[0].sent, [{ t: 'restart-now' }]);
  FakeChild.last[0].exit(RESTART_EXIT_CODE);
  const h = await done;
  assert.equal(h?.startedAt, 2);
  assert.equal(sup.state, 'running');
});

test('a crash: an exit nobody asked for reports why with the log, and a crash loop of restarts stops', async () => {
  const { sup } = supervisor();
  const crashes: { why: string; tail: string }[] = [];
  sup.on('crashed', (c) => crashes.push(c));
  await sup.start();
  FakeChild.last[0].exit(1);
  assert.equal(sup.state, 'crashed');
  assert.deepEqual(crashes, [{ code: 1, signal: null, why: 'exited with code 1', tail: 'line 1\nline 2' }]);
  // Started again by hand, then restarting over and over.
  await sup.start();
  for (let i = 0; i < 6 && sup.state !== 'crashed'; i++) {
    FakeChild.last.at(-1)!.exit(RESTART_EXIT_CODE);
    if (sup.state !== 'crashed') await new Promise((r) => sup.once('ready', r));
  }
  assert.equal(sup.state, 'crashed');
  assert.match(crashes.at(-1)!.why, /restarted 6 times/);
});

test('a start that never answers is killed and reported; one that exits first is reported once', async () => {
  const slow = supervisor({ healthy: async () => false });
  const crashes: string[] = [];
  slow.sup.on('crashed', (c) => crashes.push(c.why));
  assert.equal(await slow.sup.start(), undefined);
  assert.deepEqual(slow.killed, [1000]);
  assert.deepEqual(crashes, ["didn't answer within 90 s"]);
  const dead = supervisor({ healthy: async (c) => (c.exit(2), false) });
  const why: string[] = [];
  dead.sup.on('crashed', (c) => why.push(c.why));
  await dead.sup.start();
  assert.deepEqual(why, ['exited with code 2']);
});

test('stop: asks over the channel and waits; an office that doesn\'t go in time is killed', async () => {
  const { sup, killed } = supervisor();
  await sup.start();
  const stopping = sup.stop();
  assert.deepEqual(FakeChild.last[0].sent, [{ t: 'stop' }]);
  FakeChild.last[0].exit(0);
  await stopping;
  assert.equal(sup.state, 'stopped');
  assert.deepEqual(killed, []);
  // A stop isn't a crash, and nothing starts again.
  assert.equal(FakeChild.last.length, 1);

  const stuck = supervisor({ stopTimeoutMs: 20 });
  await stuck.sup.start();
  await stuck.sup.stop();
  assert.deepEqual(stuck.killed, [1000]);
  assert.equal(stuck.sup.state, 'stopped');
});

test('system: Node found on PATH with PATHEXT, versions compared, the checkout found above the app', () => {
  const files = new Set([path.join('C:\\b', 'node.exe'), path.join('/usr/bin', 'node')]);
  assert.equal(findOnPath('node', { PATH: 'C:\\a;C:\\b' }, 'win32', (f) => files.has(f)), path.join('C:\\b', 'node.exe'));
  assert.equal(findOnPath('node', { PATH: '/bin:/usr/bin' }, 'linux', (f) => files.has(f)), path.join('/usr/bin', 'node'));
  assert.equal(findOnPath('node', { PATH: '' }, 'linux', () => true), undefined);
  assert.ok(atLeast('v22.5.0'));
  assert.ok(atLeast('24.1.0'));
  assert.ok(!atLeast('22.4.9'));
  assert.ok(!atLeast('20.19.0'));
  const root = path.resolve('/work/mx-office');
  const isOffice = (d: string) => d === root;
  assert.equal(findOfficeDir({ near: [path.join(root, 'desktop', 'out', 'Mx Office-win32-x64', 'resources')] }, isOffice).dir, root);
  assert.equal(findOfficeDir({ given: '/nope', remembered: root, near: [] }, isOffice).dir, root);
  const none = findOfficeDir({ given: '/nope', near: [] }, isOffice);
  assert.equal(none.dir, undefined);
  assert.deepEqual(none.tried, ['/nope']);
});

test('system: the log\'s last lines', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'desktop-log-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 'office.log');
  writeFileSync(f, Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\r\n') + '\r\n\r\n');
  assert.equal(tailOf(f, 2), 'line 98\nline 99');
  assert.equal(tailOf(path.join(dir, 'none.log')), '');
  assert.equal(lastLines('a\nb\n', 5), 'a\nb');
});

test('window: a saved place is kept only on a screen; the badge is a red disc with the count', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  assert.deepEqual(fitBounds({ x: 100, y: 50, width: 1200, height: 800, maximized: true }, screens), { bounds: { x: 100, y: 50, width: 1200, height: 800 }, maximized: true });
  assert.deepEqual(fitBounds({ x: 5000, y: 50, width: 1200, height: 800 }, screens).bounds, { width: 1200, height: 800 });
  assert.deepEqual(fitBounds(undefined, screens).bounds, { width: 1400, height: 900 });
  assert.deepEqual(fitBounds({ x: 0, y: 0, width: 10, height: 10 }, screens).bounds, { width: 1400, height: 900 });
  assert.equal(badgeLabel(3), '3');
  assert.equal(badgeLabel(12), '9+');
  const bmp = badgeBitmap(3);
  assert.equal(bmp.length, 32 * 32 * 4);
  const px = (x: number, y: number) => [...bmp.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
  assert.equal(px(0, 0)[3], 0, 'a corner is clear');
  assert.deepEqual(px(16, 3), [0x2d, 0x2d, 0xd6, 255], 'red (BGRA) near the top');
  assert.ok(bmp.some((_, i) => i % 4 === 0 && bmp[i] === 0xff && bmp[i + 2] === 0xff), 'white digits');
});

test('screens: the app\'s pages escape what they show, and their buttons are actions the app catches', () => {
  const html = pageHtml(crashPage({ code: 1, signal: null, why: 'exited with code 1', tail: '<script>alert(1)</script>' }, 'C:\\d\\office.log'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes(act('restart')));
  assert.equal(actionOf(act('open-log')), 'open-log');
  assert.equal(actionOf('https://example.com/action/restart'), undefined);
  assert.match(pageHtml(problemPage({ kind: 'not-built', dir: 'C:\\o' })), /npm run build/);
  assert.match(pageHtml(problemPage({ kind: 'no-node' })), /new-machine\.md/);
});

test('icons: the Mx mark is in desktop/assets, and the packager, the window and the tray use it', () => {
  const desktop = path.join(import.meta.dirname, '..', 'desktop');
  const assets = path.join(desktop, 'assets');
  for (const f of ['icon.ico', 'icon.png', 'tray.png', 'tray@2x.png']) assert.ok(existsSync(path.join(assets, f)), f);
  // The .ico holds every Windows size (16 to 256; 0 in the directory means 256).
  const ico = readFileSync(path.join(assets, 'icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, k) => ico.readUInt8(6 + 16 * k) || 256);
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
  const side = (f: string) => readFileSync(path.join(assets, f)).readUInt32BE(16);
  assert.deepEqual([side('icon.png'), side('tray.png'), side('tray@2x.png')], [512, 16, 32]);
  // The exe and taskbar (packager), the window and the tray, and one app id for taskbar grouping and notifications.
  const has = (file: string, bits: string[]) => {
    const text = readFileSync(path.join(desktop, file), 'utf8');
    for (const b of bits) assert.ok(text.includes(b), `${file} has ${b}`);
  };
  has('scripts/pack.mjs', ["path.join(root, 'assets', 'icon.ico')", "icon: process.platform === 'win32' ? icoFile", "appBundleId: 'com.mxoffice.desktop'"]);
  has('src/main.ts', ["'icon.ico'", "'tray.png'", 'icon: windowIcon()', 'new Tray(trayIcon())', "app.setAppUserModelId('com.mxoffice.desktop')"]);
});
