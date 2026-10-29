// The office's headless Chromium is launched by a host process, never in the office's own (offloop/chromium.ts):
// the live office's stall profiles of 2026-10-28 were playwright-core `_launchProcess` → spawn holding the event
// loop for 1.5-3.6 s at a time. A guard that no server code launches a browser in-process any more, and a real
// launch (when this machine has Playwright's Chromium) that keeps the event loop turning, works as a Browser
// (a page, a route, a screenshot, a video saved with saveAs) and leaves no host behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromiumHosts, installedChromium, launchChromiumOff, launchHeadless } from '../src/server/offloop/chromium.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';

const SRC = path.join(import.meta.dirname, '..', 'src', 'server');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('no server code launches a browser in the office process: only the host does (offloop/chromium.ts)', () => {
  const bad = files(SRC)
    .filter((f) => !f.endsWith(path.join('offloop', 'chromium.ts')))
    .filter((f) => /\b(chromium|firefox|webkit)\s*\.\s*(launch|launchPersistentContext)\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => path.relative(SRC, f)), []);
});

interface Pg {
  setContent(html: string): Promise<void>;
  goto(url: string): Promise<unknown>;
  screenshot(o: { type: 'png' }): Promise<Buffer>;
  evaluate<R>(fn: () => R): Promise<R>;
  route(p: string, fn: (r: { fulfill(o: { status: number; contentType: string; body: string }): Promise<void> }) => unknown): Promise<void>;
  video(): { saveAs(to: string): Promise<void>; delete(): Promise<void> } | null;
}
interface Br {
  newContext(o?: Record<string, unknown>): Promise<{ newPage(): Promise<Pg>; close(): Promise<void> }>;
  close(): Promise<void>;
}

const haveChromium = !!(await installedChromium());

test('a real launch from the host: the event loop keeps turning, the Browser works, nothing is left running', { skip: haveChromium ? false : "Playwright's Chromium isn't installed here", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chromium-off-'));
  // playwright-core's client is loaded once per office (a few hundred ms of module loading, the first time only).
  await import('playwright-core');
  let gap = 0;
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 5);
  try {
    const t0 = performance.now();
    const browser = await launchHeadless<Br>(30_000);
    const launchMs = performance.now() - t0;
    clearInterval(ticker);
    // The in-process launch held the loop for the whole CreateProcess (1.5-3.6 s live); from the host, never long.
    assert.ok(gap < 400, `the event loop stood still for ${Math.round(gap)} ms during a ${Math.round(launchMs)} ms launch`);
    const ctx = await browser.newContext({ recordVideo: { dir: path.join(dir, 'v'), size: { width: 320, height: 240 } } });
    const page = await ctx.newPage();
    await page.route('http://example.invalid/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1 id="x">routed</h1>' }));
    await page.goto('http://example.invalid/a');
    assert.equal(await page.evaluate(() => document.getElementById('x')?.textContent), 'routed', 'routes run in the office, as before');
    const png = await page.screenshot({ type: 'png' });
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const video = page.video();
    await ctx.close();
    assert.ok(video, 'recordVideo works over the connection');
    const to = path.join(dir, 'raw.webm');
    await video.saveAs(to);
    assert.ok(statSync(to).size > 0, 'the video comes back with saveAs');
    await video.delete();
    await browser.close();
    // The host goes once the browser is closed.
    for (let i = 0; i < 200 && chromiumHosts() > 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(chromiumHosts(), 0, 'no browser host left running');
  } finally {
    clearInterval(ticker);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a launch that fails says what the browser said, and leaves no host', { timeout: 60_000 }, async () => {
  await assert.rejects(launchChromiumOff<Br>({ timeout: 10_000, executablePath: path.join(os.tmpdir(), 'no-such-browser', 'chrome.exe') }), /no-such-browser|doesn't exist|ENOENT|Failed to launch/i);
  for (let i = 0; i < 200 && chromiumHosts() > 0; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(chromiumHosts(), 0);
});

test.after(() => stopExecWorker());
