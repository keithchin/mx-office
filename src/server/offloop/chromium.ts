// The office's headless Chromium, launched off the event loop. playwright-core's chromium.launch() starts
// the browser with child_process.spawn on the thread that asks, and on Windows that one call (CreateProcess
// of a big, freshly scanned chrome.exe) held the office's event loop for 1.5-3.6 s at a time: the live
// office's stall profiles of 2026-10-28 were playwright-core `_launchProcess` → spawn, again and again,
// for hours (journey runs, walkthroughs, design captures, office-render).
//
// So the office never launches a browser in its own process. `launchChromiumOff` starts a small Node child
// (the host, below) from the process-starter thread (./exec.ts spawnOff: the child's own start doesn't hold
// the loop either), and the host owns the browser: it calls chromium.launchServer() there, on 127.0.0.1 with
// a random path, and prints the endpoint. The office then connects to it (chromium.connect: a WebSocket, no
// process started here) and gets an ordinary Browser back, so every caller keeps its pages, routes, videos
// (saveAs: the video file is the host's), screenshots and timeouts exactly as before.
//
// The host lives exactly as long as the browser: close() closes the browser and ends the host; the host
// also ends when its stdin closes (the office went away), so no browser outlives the office. A host that
// doesn't answer within the launch timeout is killed and the launch fails with the timeout, as launch did.

import { createRequire } from 'node:module';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnOff, type OffChild } from './exec.js';

/** The host: launches the browser server, says its endpoint (one JSON line), and ends with its stdin or the browser. */
const HOST = `
const pw = require(process.argv[1]);
const opts = JSON.parse(process.argv[2]);
const say = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
let server;
let ending = false;
const end = (code) => {
  if (ending) return;
  ending = true;
  Promise.resolve(server && server.close()).catch(() => {}).then(() => process.exit(code));
};
process.stdin.on('end', () => end(0));
process.stdin.on('close', () => end(0));
process.stdin.on('error', () => end(0));
process.stdin.resume();
pw.chromium.launchServer(opts).then((s) => {
  server = s;
  s.on('close', () => end(0));
  say({ ws: s.wsEndpoint() });
}, (err) => {
  say({ error: String((err && err.message) || err) });
  end(1);
});
`;

/** What a launch takes: how long the browser may take to start, and a browser binary when playwright's own isn't there. */
export interface LaunchOffOptions {
  timeout: number;
  executablePath?: string;
}

/** The part of a connected browser the office needs to wrap. */
interface Closable {
  close(): Promise<void>;
  on?(ev: 'disconnected', fn: () => void): unknown;
}

let pwPath: string | undefined;
/** Where playwright-core is, for the host to require (resolved once, from the office's own install). */
function playwrightPath(): string {
  pwPath ??= createRequire(import.meta.url).resolve('playwright-core');
  return pwPath;
}

/** Launches calls in flight (the tests and the perf guard). */
let hosts = 0;
export const chromiumHosts = () => hosts;

/**
 * Starts the host and waits for its endpoint: the endpoint and the host, or an error carrying what the
 * browser launch said (so "Executable doesn't exist" reads the same as from chromium.launch).
 */
function startHost(o: LaunchOffOptions): Promise<{ ws: string; host: OffChild }> {
  const args = ['-e', HOST, playwrightPath(), JSON.stringify({ headless: true, timeout: o.timeout, host: '127.0.0.1', ...(o.executablePath ? { executablePath: o.executablePath } : {}) })];
  return new Promise((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE: under a desktop wrapper process.execPath is Electron, which then runs as plain Node.
    const host = spawnOff(process.execPath, args, { stdin: true, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    hosts++;
    let out = '';
    let err = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    // The browser's own timeout plus the host's start (Node and playwright-core loading).
    const timer = setTimeout(() => finish(() => (host.kill(), reject(new Error(`Timeout ${o.timeout}ms exceeded: the browser didn't start`)))), o.timeout + 15_000);
    (timer as { unref?: () => void }).unref?.();
    host.on('stdout', (d: string) => {
      out += d;
      const nl = out.indexOf('\n');
      if (nl < 0) return;
      let m: { ws?: string; error?: string } = {};
      try {
        m = JSON.parse(out.slice(0, nl));
      } catch {
        m = { error: `the browser host said something unexpected: ${out.slice(0, 200)}` };
      }
      finish(() => (m.ws ? resolve({ ws: m.ws, host }) : (host.kill(), reject(new Error(m.error ?? 'the browser host said nothing')))));
    });
    host.on('stderr', (d: string) => {
      if (err.length < 4000) err += d;
    });
    host.on('error', (e: Error) => finish(() => reject(e)));
    host.on('close', (code: number | null) => {
      hosts--;
      finish(() => reject(new Error(`the browser host stopped before the browser started (exit ${code ?? 'signal'})${err.trim() ? `: ${err.trim().split(/\r?\n/).slice(-3).join(' ')}` : ''}`)));
    });
  });
}

/**
 * A headless Chromium owned by a host process (see above), connected over a WebSocket: a playwright-core
 * Browser, typed as the caller's own view of one (`B`). Its close() also ends the host.
 */
export async function launchChromiumOff<B extends Closable>(o: LaunchOffOptions): Promise<B> {
  const { ws, host } = await startHost(o);
  try {
    const pw = (await import('playwright-core')) as unknown as { chromium: { connect(ws: string, o: { timeout: number }): Promise<B> } };
    const browser = await pw.chromium.connect(ws, { timeout: o.timeout });
    const close = browser.close.bind(browser);
    let ended = false;
    const endHost = () => {
      if (ended) return;
      ended = true;
      host.end();
      // A host that doesn't go by itself within a few seconds is stopped.
      const t = setTimeout(() => host.kill(), 5_000);
      (t as { unref?: () => void }).unref?.();
      host.on('close', () => clearTimeout(t));
    };
    browser.on?.('disconnected', endHost);
    browser.close = async () => {
      try {
        await close();
      } finally {
        endHost();
      }
    };
    return browser;
  } catch (err) {
    host.kill();
    throw err;
  }
}

/**
 * The newest Chromium in the machine's Playwright cache, for when the build playwright-core expects isn't the one
 * installed (0a: it wants chromium_headless_shell-1243, the machine has 1248). Undefined: let playwright say.
 */
export async function installedChromium(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const roots = [env.PLAYWRIGHT_BROWSERS_PATH, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'ms-playwright'), env.HOME && path.join(env.HOME, '.cache', 'ms-playwright')].filter((x): x is string => !!x);
  const subs = ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome', 'chrome-linux/chrome'];
  for (const root of roots) {
    const dirs = (await readdir(root).catch(() => [] as string[])).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)));
    for (const d of dirs) for (const s of subs) if (await stat(path.join(root, d, s)).then(() => true, () => false)) return path.join(root, d, s);
  }
  return undefined;
}

/** launchChromiumOff, falling back to the newest Chromium in the cache when playwright's own build isn't installed. */
export async function launchHeadless<B extends Closable>(timeout: number): Promise<B> {
  return launchChromiumOff<B>({ timeout }).catch(async (err: Error) => {
    const exe = /Executable doesn't exist/i.test(err.message) ? await installedChromium() : undefined;
    if (!exe) throw err;
    return launchChromiumOff<B>({ timeout, executablePath: exe });
  });
}
