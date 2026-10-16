// Mx Office's desktop app (preview): the office in a window of its own, a tray icon with what needs you,
// native notifications, and restarts the app manages. The office itself runs as before, with the system
// Node from the user's own checkout and build (core/system.ts), as this app's child (core/supervisor.ts),
// or the app attaches to an office already running on its port. Everything that can be tested without
// Electron is in core/; this file is the Electron glue. See docs/site/administration/desktop-app.md.

import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, screen, shell, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, dataDirOf, officeArgv, officeEnv, officeUrl, parseOptions, probeUrl } from './core/options.js';
import { decideStart, fetchHealth, healthLabel, waitForHealth, type FetchLike, type Health } from './core/health.js';
import { emptySeen, needYouText, parseStatus, tooltipFor, type TrayState } from './core/needs.js';
import { afterLook, countLine, decideStartHere, freshStatus, initialConn, lookOf, nextConn, type ConnState, type Look } from './core/connection.js';
import { OfficeSupervisor, type ChildLike } from './core/supervisor.js';
import { atLeast, findOfficeDir, findOnPath, isBuilt, logFileOf, nodeVersion, officeEntry, openLog, portOpen, tailOf, type Problem } from './core/system.js';
import { badgeBitmap, dataUrl, fitBounds, pageHtml, type PageSpec } from './core/window.js';
import { DESKTOP_DOCS, actionOf, busyPortPage, crashPage, problemPage, refusedPage, startingPage } from './core/screens.js';
import { DesktopStore, officeKey } from './core/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const POLL_MS = 30_000;
// Automated checks (MX_OFFICE_DESKTOP_TEST=1, desktop/scripts/e2e.mjs): the window opens off-screen without taking focus,
// notifications are recorded (with a click to simulate), and questions are answered from a queue, never shown.
const TEST = process.env.MX_OFFICE_DESKTOP_TEST === '1';
const testNotes: { title: string; body: string; path: string; click: () => void }[] = [];
const testAsked: { message: string; buttons: string[]; answer: number }[] = [];
const testAnswers: number[] = [];

const opts = parseOptions(process.argv.slice(app.isPackaged ? 1 : 2), process.env, os.homedir());
if (opts.userData) app.setPath('userData', opts.userData);
app.setName('Mx Office');
if (process.platform === 'win32') app.setAppUserModelId('com.mxoffice.desktop');

const URL_BASE = officeUrl(opts.port);
const PROBE = probeUrl(opts.port);
const DATA_DIR = dataDirOf(opts.home);
const LOG_FILE = logFileOf(DATA_DIR);
const KEY = officeKey(opts.home, opts.port);
const fetchImpl = fetch as unknown as FetchLike;

let store: DesktopStore;
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let sup: OfficeSupervisor | undefined;
let mode: 'none' | 'owned' | 'attached' = 'none';
let health: Health | undefined;
/** Whether the office answers and how fresh the counts are (core/connection.ts). */
let conn: ConnState = initialConn();
let quitting = false;
let asking = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let officeDir: string | undefined;
const shownNotes: Notification[] = [];
let trayLabels: string[] = [];
let trayTip = '';

function icon(size?: number): NativeImage {
  const img = nativeImage.createFromPath(path.join(APP_ROOT, 'assets', 'icon.png'));
  return size ? img.resize({ width: size, height: size }) : img;
}

const sameOffice = (u: string) => {
  try {
    const a = new URL(u);
    return a.port === String(opts.port) && (a.hostname === 'localhost' || a.hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

// ---- the window

function createWindow() {
  const fit = TEST ? { bounds: { x: -5000, y: 0, width: 1400, height: 900 }, maximized: false } : fitBounds(store.data.window, screen.getAllDisplays().map((d) => d.workArea));
  win = new BrowserWindow({
    ...fit.bounds,
    show: false,
    title: 'Mx Office',
    icon: icon(),
    autoHideMenuBar: true,
    backgroundColor: '#14171c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (fit.maximized) win.maximize();
  win.once('ready-to-show', () => (TEST ? win?.showInactive() : win?.show()));
  guard(win);
  win.webContents.on('did-navigate', (_e, u) => {
    if (sameOffice(u)) setTimeout(() => void poll(), 1500);
  });
  win.webContents.on('did-create-window', (child) => guard(child));
  const remember = () => {
    if (!win || win.isMinimized() || TEST) return;
    const max = win.isMaximized();
    const b = max ? (store.data.window ?? win.getNormalBounds()) : win.getBounds();
    store.data.window = { ...b, maximized: max };
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', (e) => {
    remember();
    store.save();
    if (quitting) return;
    e.preventDefault();
    void requestQuit();
  });
}

/** Office pages stay in the app; every other address opens in the default browser; the app's own buttons act. */
function guard(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOffice(url)) return { action: 'allow' };
    if (/^https?:/i.test(url) && !actionOf(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    const a = actionOf(url);
    if (a) {
      e.preventDefault();
      void onAction(a);
      return;
    }
    if (sameOffice(url) || url.startsWith('data:')) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
  });
}

function showPage(p: PageSpec) {
  void win?.loadURL(dataUrl(pageHtml(p)));
}

function showOffice(p = 'home') {
  void win?.loadURL(`${URL_BASE}/${p.replace(/^\//, '')}`);
}

function showWindow() {
  if (!win || TEST) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

type Question = { type: 'question' | 'warning' | 'info'; buttons?: string[]; defaultId?: number; cancelId?: number; title?: string; message: string; detail?: string };

/** A question in a dialog: its button's index. In test mode answered from the queue (else its cancel button) and recorded. */
async function ask(o: Question): Promise<number> {
  if (TEST) {
    const answer = testAnswers.length ? testAnswers.shift()! : (o.cancelId ?? 0);
    testAsked.push({ message: o.message, buttons: o.buttons ?? ['OK'], answer });
    return answer;
  }
  return (await dialog.showMessageBox(win!, o)).response;
}

const onOfficePage = () => !!win && sameOffice(win.webContents.getURL());

async function onAction(a: string) {
  switch (a) {
    case 'restart':
      if (mode === 'owned' && sup) {
        showPage(startingPage({ url: URL_BASE, restarting: true }));
        await sup.start(true);
      } else void boot();
      break;
    case 'retry':
      void boot();
      break;
    case 'attach':
      if (health) attach(health);
      break;
    case 'open-log':
      void shell.openPath(LOG_FILE);
      break;
    case 'choose-dir': {
      const r = await dialog.showOpenDialog(win!, { title: 'Your Mx Office folder (with its package.json)', properties: ['openDirectory'] });
      if (!r.canceled && r.filePaths[0]) {
        store.update((d) => (d.officeDir = r.filePaths[0]));
        void boot();
      }
      break;
    }
    case 'quit':
      void requestQuit();
      break;
  }
}

// ---- starting, attaching

async function boot() {
  // Automated checks never touch the real office's port.
  if (TEST && opts.port === DEFAULT_PORT) return showPage({ title: 'Refused in test mode', lines: [`MX_OFFICE_DESKTOP_TEST=1 never uses port ${DEFAULT_PORT} (the real office's): give --port.`] });
  showPage(startingPage({ url: URL_BASE }));
  const h = await fetchHealth(fetchImpl, PROBE);
  const d = decideStart({ health: h, portOpen: h ? true : await portOpen(opts.port), attach: opts.attach });
  if (d.kind === 'busy') return showPage(busyPortPage(opts.port));
  if (d.kind === 'refuse') {
    health = d.health;
    return showPage(refusedPage(URL_BASE));
  }
  if (d.kind === 'ask') {
    const r = await ask({
      type: 'question',
      buttons: ['Open it here', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      message: `An office is already running at ${URL_BASE}`,
      detail: `${healthLabel(d.health)}. The app opens that office instead of starting a second one on the same data. It won't stop or restart it when you quit.`,
    });
    if (r !== 0) return finalQuit();
    return attach(d.health);
  }
  if (d.kind === 'attach') return attach(d.health);
  await startOwned();
}

function attach(h: Health) {
  mode = 'attached';
  health = h;
  conn = initialConn();
  showOffice('home');
  startPolling();
  refreshTray();
}

async function checks(): Promise<{ node: string; dir: string } | Problem> {
  const node = opts.node ?? findOnPath('node', process.env);
  if (!node) return { kind: 'no-node' };
  const v = await nodeVersion(node);
  if (!v) return { kind: 'no-node' };
  if (!atLeast(v)) return { kind: 'old-node', node, version: v };
  const found = findOfficeDir({ given: opts.officeDir, remembered: store.data.officeDir, near: [APP_ROOT, path.dirname(process.execPath)] });
  if (!found.dir) return { kind: 'no-checkout', tried: found.tried };
  if (!isBuilt(found.dir)) return { kind: 'not-built', dir: found.dir };
  return { node, dir: found.dir };
}

function killTree(child: ChildLike) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(child.pid, 'SIGKILL');
  } catch {
    // gone already
  }
}

async function startOwned() {
  const c = await checks();
  if ('kind' in c) return showPage(problemPage(c));
  officeDir = c.dir;
  store.update((d) => (d.officeDir = c.dir));
  mode = 'owned';
  if (!sup) {
    sup = new OfficeSupervisor({
      spawn() {
        const fd = openLog(LOG_FILE);
        writeSync(fd, `\n==== ${new Date().toISOString()} desktop app: starting the office from ${c.dir} with ${c.node} (port ${opts.port}, home ${opts.home})\n`);
        try {
          return spawn(c.node, [officeEntry(c.dir), ...officeArgv(opts)], { cwd: c.dir, env: officeEnv(process.env, opts), stdio: ['ignore', fd, fd, 'ipc'], windowsHide: true });
        } finally {
          closeSync(fd);
        }
      },
      waitHealthy: (child, accept) => waitForHealth({ fetch: fetchImpl, base: PROBE, timeoutMs: 120_000, gone: () => child.exitCode !== null, accept }),
      killTree,
      logTail: () => tailOf(LOG_FILE, 40),
    });
    sup.on('state', (s) => {
      // Restarting, stopped or crashed: the counts the tray holds are no longer confirmed.
      if (s !== 'running' && s !== 'starting') conn = nextConn(conn, { kind: 'down' }, Date.now());
      refreshTray();
      if (s === 'restarting' && !onOfficePage()) showPage(startingPage({ url: URL_BASE, restarting: true }));
    });
    sup.on('ready', (h: Health, info: { restarted: boolean; signIn?: string }) => {
      health = h;
      // The first start signs the window in; after a restart the office's pages reconnect by themselves.
      if (!info.restarted && info.signIn) void win?.loadURL(URL_BASE + info.signIn);
      else if (!onOfficePage()) showOffice('home');
      startPolling();
      void poll();
    });
    sup.on('crashed', (crash) => {
      stopPolling();
      setBadge(0);
      showPage(crashPage(crash, LOG_FILE));
      if (win && !win.isVisible()) notify({ title: 'Mx Office stopped unexpectedly', body: crash.why, onClick: () => showWindow() });
      refreshTray();
    });
  }
  await sup.start();
}

// ---- what needs you

async function cookieHeader(): Promise<string> {
  if (!win) return '';
  const cookies = await win.webContents.session.cookies.get({ url: URL_BASE });
  return cookies.map((k) => `${k.name}=${k.value}`).join('; ');
}

/** A request to the office as the window's signed-in person. */
async function officeFetch(p: string, init: { method?: string; body?: string; timeoutMs?: number } = {}) {
  const cookie = await cookieHeader();
  return fetch(`${PROBE}${p}`, {
    method: init.method ?? 'GET',
    headers: { ...(cookie ? { cookie } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  });
}

const running = () => mode === 'attached' || sup?.state === 'running';

/** One look: /api/health, then the status with the window's sign-in. A failure never keeps the old answer as the new one. */
async function look(): Promise<Look> {
  const h = await fetchHealth(fetchImpl, PROBE);
  if (h) health = h;
  let code: number | undefined;
  let body: unknown;
  try {
    const r = await officeFetch('/api/desktop/status', { timeoutMs: h ? 15_000 : 4000 });
    code = r.status;
    if (r.ok) body = await r.json().catch(() => undefined);
  } catch {
    // nothing answered (refused, timed out)
  }
  return lookOf({ healthy: !!h, code, status: body === undefined ? undefined : parseStatus(body) });
}

let looking: Promise<void> | undefined;

async function poll(): Promise<void> {
  if (!running()) return;
  if (looking) return looking;
  looking = (async () => {
    // Notifications only from a confirmed look, against what was seen (kept across failures, restarts and reconnections).
    const r = afterLook({ conn, seen: store.data.seen?.[KEY] ?? emptySeen(), muted: store.data.muted }, await look(), Date.now());
    conn = r.conn;
    if (r.seen) store.update((f) => (f.seen = { ...(f.seen ?? {}), [KEY]: r.seen! }));
    for (const n of r.notes) notify({ title: n.title, body: n.body, path: n.path, onClick: () => (showWindow(), showOffice(n.path)) });
    setBadge(freshStatus(conn)?.needs.length ?? 0);
    refreshTray();
  })().finally(() => (looking = undefined));
  return looking;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => void poll(), POLL_MS);
  setTimeout(() => void poll(), 2000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = undefined;
}

function notify(n: { title: string; body: string; path?: string; onClick: () => void }) {
  if (TEST) return void testNotes.push({ title: n.title, body: n.body, path: n.path ?? '', click: n.onClick });
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: n.title, body: n.body, icon: icon(64) });
  note.on('click', n.onClick);
  note.show();
  // Kept, so a click still finds its handler after a garbage collection.
  shownNotes.push(note);
  if (shownNotes.length > 20) shownNotes.shift();
}

function setBadge(n: number) {
  if (process.platform === 'win32') {
    win?.setOverlayIcon(n ? nativeImage.createFromBitmap(badgeBitmap(n), { width: 32, height: 32, scaleFactor: 2 }) : null, n ? needYouText(n) : '');
  } else app.setBadgeCount(n);
}

// ---- the tray

function trayState(): TrayState {
  if (mode === 'attached') return conn.conn;
  switch (sup?.state) {
    case 'running':
      return conn.conn;
    case 'restarting':
      return 'restarting';
    case 'crashed':
      return 'crashed';
    case 'stopped':
    case 'stopping':
      return 'stopped';
    default:
      return 'starting';
  }
}

function refreshTray() {
  if (!tray) return;
  const state = trayState();
  const connected = state === 'running' || state === 'signed-out' || state === 'disconnected' || state === 'unknown';
  // What needs you, and how fresh that is: counts the last look couldn't confirm say when they're from.
  const line = connected ? countLine(conn) : tooltipFor({ state }).replace('Mx Office: ', '');
  const build = health ? `${healthLabel(health)}${state === 'disconnected' ? ', not answering' : ''}` : undefined;
  trayTip = tooltipFor({ state, line, build, attached: mode === 'attached' });
  tray.setToolTip(trayTip);
  // An office started elsewhere that stopped answering: the app never stops or restarts it, but can start one here if nothing answers.
  const here: MenuItemConstructorOptions[] = mode === 'attached' && state === 'disconnected' ? [{ label: 'Start the office here…', click: () => void startHere() }] : [];
  const template: MenuItemConstructorOptions[] = [
    { label: 'Open Mx Office', click: () => showWindow() },
    { type: 'separator' },
    { label: line.charAt(0).toUpperCase() + line.slice(1), enabled: false },
    ...(build ? [{ label: `${mode === 'attached' ? 'Attached: ' : ''}${build}`, enabled: false }] : []),
    ...here,
    { type: 'separator' },
    { label: 'Mute notifications', type: 'checkbox', checked: !!store.data.muted, click: (i) => store.update((d) => (d.muted = i.checked)) },
    { label: 'Restart office…', enabled: running(), click: () => void restartOffice() },
    { label: 'Open office log', enabled: existsSync(LOG_FILE), click: () => void shell.openPath(LOG_FILE) },
    { label: 'About Mx Office', click: () => void about() },
    { type: 'separator' },
    { label: 'Quit Mx Office', click: () => void requestQuit() },
  ];
  trayLabels = template.map((t) => (t.type === 'separator' ? '---' : `${t.type === 'checkbox' ? (t.checked ? '[x] ' : '[ ] ') : ''}${t.label}${t.enabled === false ? ' (disabled)' : ''}`));
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(icon(16));
  tray.on('click', () => showWindow());
  refreshTray();
}

function appMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Office',
      submenu: [
        { label: 'Home', accelerator: 'Alt+Home', click: () => showOffice('home') },
        { label: 'Restart office…', click: () => void restartOffice() },
        { label: 'Open office log', click: () => void shell.openPath(LOG_FILE) },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => void requestQuit() },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'About Mx Office', click: () => void about() }, { label: 'Desktop app docs', click: () => void shell.openExternal(DESKTOP_DOCS) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function about() {
  const started = health?.startedAt ? new Date(health.startedAt).toLocaleString() : 'unknown';
  await ask({
    type: 'info',
    title: 'About Mx Office',
    message: 'Mx Office (desktop preview)',
    detail: [
      `Office: ${healthLabel(health)}${mode === 'attached' ? ' (attached: started elsewhere)' : ''}`,
      `Running since: ${started}`,
      `Status: ${countLine(conn)}${conn.checkedAt ? ` (last confirmed ${new Date(conn.checkedAt).toLocaleString()})` : ''}`,
      `Address: ${URL_BASE}`,
      `Office folder: ${officeDir ?? store.data.officeDir ?? 'unknown'}`,
      `Data: ${DATA_DIR}`,
      `Log: ${LOG_FILE}`,
      '',
      `Desktop app ${app.getVersion()} · Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    ].join('\n'),
  });
}

// ---- restarting, quitting

/** 🔁 Restart safely through the office's API (its pages show the progress), else, for the app's own office, "Restart now". */
async function restartOffice() {
  showWindow();
  let err: string;
  try {
    const r = await officeFetch('/api/office/restart', { method: 'POST', body: JSON.stringify({ action: 'start', by: 'Desktop app' }) });
    if (r.ok) return;
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    err = r.status === 401 ? 'You are not signed in.' : (b.error ?? `The office answered ${r.status}.`);
  } catch (e) {
    err = `The office didn't answer (${(e as Error).message}).`;
  }
  if (mode !== 'owned' || !sup?.owned) {
    await ask({ type: 'warning', message: "The office couldn't start a safe restart", detail: `${err}\n\nThis office was started outside the app, so the app doesn't restart it itself.` });
    return;
  }
  const c = await ask({
    type: 'question',
    buttons: ['Restart now', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: "The office couldn't start a safe restart",
    detail: `${err}\n\nRestart it now? Agents that are mid-turn are cut off; their sessions are saved and they carry on when the office is back.`,
  });
  if (c === 0) await sup.restartNow();
}

/** How many agents are mid-turn now; undefined when the office can't say (then quitting asks). Never the last look's count. */
async function workingNow(): Promise<number | undefined> {
  try {
    const r = await officeFetch('/api/desktop/status', { timeoutMs: 4000 });
    if (r.ok) return parseStatus(await r.json())?.working;
  } catch {
    // not answering
  }
  return undefined;
}

/**
 * "Start the office here", after an office started elsewhere stopped answering: only when the user asks,
 * and only on a port nothing answers on (one answering again is attached to again). The other office's
 * process is never stopped or restarted by the app.
 */
async function startHere() {
  const c = await ask({
    type: 'question',
    buttons: ['Start the office here', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `The office at ${URL_BASE} isn't answering`,
    detail: "It was started outside the app, so the app doesn't stop or restart it. Start an office here from your checkout instead? The app checks first that nothing answers on the port, so there are never two offices on the same data.",
  });
  if (c !== 0) return;
  const h = await fetchHealth(fetchImpl, PROBE);
  const d = decideStartHere({ health: h, portOpen: h ? true : await portOpen(opts.port) });
  if (d.kind === 'attach') return attach(d.health);
  if (d.kind === 'busy') return showPage(busyPortPage(opts.port));
  mode = 'none';
  conn = initialConn();
  await startOwned();
}

async function requestQuit() {
  if (asking || quitting) return;
  asking = true;
  try {
    if (mode !== 'owned' || !sup?.owned) return finalQuit();
    const working = await workingNow();
    if (working !== 0) {
      const c = await ask({
        type: 'warning',
        buttons: ['Stop the office and quit', 'Keep running in the tray', 'Cancel'],
        defaultId: 1,
        cancelId: 2,
        message: working === undefined ? 'Stop the office and quit?' : `${working} agent${working === 1 ? ' is' : 's are'} working. Stop the office and quit?`,
        detail: 'Stopping the office stops its agents: their sessions are saved, but work mid-turn is cut off. Keep it running in the tray to let them finish.',
      });
      if (c === 1) return void win?.hide();
      if (c === 2) return;
    }
    stopPolling();
    showPage({ busy: true, title: 'Stopping Mx Office…', lines: ['Saving what the office holds and stopping its agents.'] });
    await sup.stop();
    finalQuit();
  } finally {
    asking = false;
  }
}

function finalQuit() {
  quitting = true;
  store?.save();
  tray?.destroy();
  app.quit();
}

// ---- go

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('window-all-closed', () => {
    // The tray keeps the app (and its office) going; Quit ends it.
  });
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    void requestQuit();
  });
  void app.whenReady().then(() => {
    store = new DesktopStore(path.join(app.getPath('userData'), 'desktop.json'));
    appMenu();
    createWindow();
    createTray();
    // Screenshots and checks drive the app from outside (Playwright's electron.evaluate): only on request.
    if (TEST) {
      const hooks = { tray: () => tray, win: () => win, sup: () => sup, mode: () => mode, poll, restartOffice, requestQuit, startHere, onAction, officeFetch, status: () => freshStatus(conn), conn: () => conn, notes: () => testNotes.map(({ click: _, ...n }) => n), clickNote: (i: number) => testNotes[i]?.click(), answer: (...a: number[]) => testAnswers.push(...a), asked: () => testAsked };
      Object.assign(globalThis, { __mxDesktop: { ...hooks, badge: (n: number) => nativeImage.createFromBitmap(badgeBitmap(n), { width: 32, height: 32, scaleFactor: 2 }).toPNG().toString('base64'), menu: () => trayLabels, tooltip: () => trayTip } });
    }
    void boot();
  });
}
