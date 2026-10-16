// Runtime screenshots for the Design gallery: only when someone presses Capture now, only of the project's
// live app when it's already running (a capture never starts a runtime), with the office's headless Chromium
// (playwright-core, a child process: the page load and the rendering happen outside the office's event loop).
// One capture at a time, each time-limited. Each PNG is kept with what it shows (URL, viewport, colour scheme,
// the app's commit, the design version), so a stopped app's screenshots stay, labelled as history.

import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import type { CaptureRecord } from '../../shared/design/types.js';

export const CAPTURE_LIMIT_MS = 45_000;
export const VIEWPORTS = [{ width: 1440, height: 900 }] as const;

export interface Shot {
  url: string;
  width: number;
  height: number;
  scheme: 'light' | 'dark';
}

/** Takes one screenshot: a PNG's bytes. Tests pass their own. */
export type Shooter = (s: Shot) => Promise<Buffer>;

interface PwPage {
  goto(url: string, o: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o: { type: 'png'; fullPage: boolean }): Promise<Buffer>;
}
interface PwBrowser {
  newContext(o: { viewport: { width: number; height: number }; colorScheme: 'light' | 'dark'; serviceWorkers: 'block' }): Promise<{ newPage(): Promise<PwPage> }>;
  close(): Promise<void>;
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

export const playwrightShooter: Shooter = async (s) => {
  const pw = (await import('playwright-core')) as unknown as { chromium: { launch(o: { headless: boolean; timeout: number; executablePath?: string }): Promise<PwBrowser> } };
  const browser = await pw.chromium.launch({ headless: true, timeout: 20_000 }).catch(async (err: Error) => {
    const exe = /Executable doesn't exist/i.test(err.message) ? await installedChromium() : undefined;
    if (!exe) throw err;
    return pw.chromium.launch({ headless: true, timeout: 20_000, executablePath: exe });
  });
  const timer = setTimeout(() => void browser.close().catch(() => undefined), CAPTURE_LIMIT_MS);
  try {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, colorScheme: s.scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(s.url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(1500);
    return await page.screenshot({ type: 'png', fullPage: false });
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
};

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_-]/g, '_');

export class Captures {
  private queue: Promise<unknown> = Promise.resolve();
  private lists = new Map<string, CaptureRecord[]>();

  constructor(private root: string, private shoot: Shooter = playwrightShooter, private now: () => number = Date.now) {}

  dir(floor: string) {
    return path.join(this.root, 'captures', safe(floor));
  }

  async list(floor: string): Promise<CaptureRecord[]> {
    const hit = this.lists.get(floor);
    if (hit) return hit;
    const text = await readFile(path.join(this.dir(floor), 'index.jsonl'), 'utf8').catch(() => '');
    const out: CaptureRecord[] = [];
    for (const l of text.split('\n')) {
      if (!l.trim()) continue;
      try {
        out.push(JSON.parse(l) as CaptureRecord);
      } catch {
        // torn line
      }
    }
    this.lists.set(floor, out);
    return out;
  }

  /** A PNG of the floor's captures, by its id (never a path from the request). */
  async png(floor: string, id: string): Promise<Buffer | undefined> {
    const rec = (await this.list(floor)).find((c) => c.id === id);
    if (!rec) return undefined;
    return readFile(path.join(this.dir(floor), rec.file)).catch(() => undefined);
  }

  /** Captures light and dark at each viewport, one capture job at a time. */
  capture(floor: string, url: string, meta: { appSha?: string; design: string; by: string }): Promise<CaptureRecord[]> {
    const run = this.queue.then(async () => {
      const list = await this.list(floor);
      const made: CaptureRecord[] = [];
      await mkdir(this.dir(floor), { recursive: true });
      for (const vp of VIEWPORTS) {
        for (const scheme of ['light', 'dark'] as const) {
          const png = await this.shoot({ url, width: vp.width, height: vp.height, scheme });
          const id = `cap_${ulid(this.now())}`;
          const file = `${id}.png`;
          await writeFile(path.join(this.dir(floor), file), png);
          const rec: CaptureRecord = { id, file, url, viewport: { ...vp }, scheme, ...(meta.appSha ? { appSha: meta.appSha } : {}), design: meta.design, at: this.now(), by: meta.by };
          await appendFile(path.join(this.dir(floor), 'index.jsonl'), `${JSON.stringify(rec)}\n`);
          list.push(rec);
          made.push(rec);
        }
      }
      return made;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
