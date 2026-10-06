// office-workers export-pdf and screenshot (bin/office-render.js): a worker turns an HTML file in its
// own folder into a PDF or a PNG with the office's headless Chromium (playwright-core, a dependency, and the browsers
// in the office machine's Playwright cache), so a Lead can hand the client a BRD as a PDF or a
// storyboard of its wireframes without installing anything in the project. The input and the output
// must be inside the worker's own folder; the page may load files from there and nothing from the
// network (a Mermaid script from a CDN is answered with the office's own copy); each render has a time
// limit and the files a size limit, and renders run one at a time.

import type http from 'node:http';
import { realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { send } from '../http/util.js';
import { workspaceOf } from '../worktrees.js';
import { MERMAID_CDN, mermaidJs } from '../deliverables/content.js';

export const RENDER_LIMITS = { inputBytes: 10 * 1024 * 1024, outputBytes: 50 * 1024 * 1024, ms: 45_000, maxWidth: 3840, maxHeight: 2160 };

export interface RenderAsk {
  op: 'pdf' | 'screenshot';
  input: string;
  output: string;
  width?: number;
  height?: number;
  full?: boolean;
  landscape?: boolean;
}

/** The request read, or why it won't do. */
export function readRenderAsk(body: unknown): RenderAsk | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.op !== 'pdf' && b.op !== 'screenshot') return 'op is pdf or screenshot';
  if (typeof b.input !== 'string' || !b.input || typeof b.output !== 'string' || !b.output) return 'Give the input HTML file and the output file, as absolute paths';
  if (!/\.(html?|svg)$/i.test(b.input)) return 'The input is an .html (or .svg) file';
  if (b.op === 'pdf' && !/\.pdf$/i.test(b.output)) return 'export-pdf writes a .pdf file';
  if (b.op === 'screenshot' && !/\.png$/i.test(b.output)) return 'screenshot writes a .png file';
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(200, Math.min(Math.round(v), max)) : undefined);
  return { op: b.op, input: b.input, output: b.output, width: n(b.width, RENDER_LIMITS.maxWidth), height: n(b.height, RENDER_LIMITS.maxHeight), full: b.full === true, landscape: b.landscape === true };
}

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The input and output as real paths inside `root` (the output's folder must exist), or why not. */
export async function checkPaths(root: string, ask: RenderAsk): Promise<{ input: string; output: string } | string> {
  if (!path.isAbsolute(ask.input) || !path.isAbsolute(ask.output)) return 'Paths must be absolute';
  let base: string;
  let input: string;
  try {
    base = await realpath(root);
    input = await realpath(ask.input);
  } catch {
    return `No such file: ${ask.input}`;
  }
  if (!inside(base, input)) return 'The input must be inside your own worktree';
  const s = await stat(input);
  if (!s.isFile()) return 'The input is not a file';
  if (s.size > RENDER_LIMITS.inputBytes) return `The input is over ${RENDER_LIMITS.inputBytes / 1024 / 1024} MB`;
  let dir: string;
  try {
    dir = await realpath(path.dirname(ask.output));
  } catch {
    return `Make the output's folder first: ${path.dirname(ask.output)}`;
  }
  const output = path.join(dir, path.basename(ask.output));
  if (!inside(base, output)) return 'The output must be inside your own worktree';
  try {
    if ((await realpath(output)) !== output) return 'The output is a link: write somewhere else';
  } catch {
    // a new file: fine
  }
  return { input, output };
}

/** The bits of playwright-core used here, so the tests can hand in a fake browser. */
export interface RouteLike {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(): Promise<void>;
  fulfill(r: { status: number; contentType: string; body: string | Buffer }): Promise<void>;
}
export interface PageLike {
  route(pattern: string, fn: (r: RouteLike) => unknown): Promise<void>;
  goto(url: string, opts: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  pdf(opts: { printBackground: boolean; format: string; landscape: boolean; margin: Record<string, string> }): Promise<Buffer>;
  screenshot(opts: { fullPage: boolean; type: 'png' }): Promise<Buffer>;
}
export interface BrowserLike {
  newContext(opts: { viewport: { width: number; height: number }; javaScriptEnabled: boolean; serviceWorkers: 'block'; acceptDownloads: boolean }): Promise<{ newPage(): Promise<PageLike> }>;
  close(): Promise<void>;
}
export type Launch = () => Promise<BrowserLike>;

const defaultLaunch: Launch = async () => {
  const pw = (await import('playwright-core')) as unknown as { chromium: { launch(o: { headless: boolean; timeout: number }): Promise<BrowserLike> } };
  return pw.chromium.launch({ headless: true, timeout: 20_000 });
};


/** What the page may load: files inside `root`, and the CDN Mermaid (served from the office). Everything else is refused. */
export function allowRequest(root: string, url: string): 'continue' | 'mermaid' | 'abort' {
  if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return 'continue';
  if (url.startsWith('file:')) {
    try {
      const p = fileURLToPath(url);
      return p === root || inside(root, p) ? 'continue' : 'abort';
    } catch {
      return 'abort';
    }
  }
  return MERMAID_CDN.test(url) ? 'mermaid' : 'abort';
}

let queue: Promise<unknown> = Promise.resolve();

/** Renders `input` to `output` (both checked by checkPaths) with a fresh headless browser. */
export async function render(root: string, ask: RenderAsk, files: { input: string; output: string }, launch: Launch = defaultLaunch): Promise<{ bytes: number }> {
  const run = async () => {
    const base = await realpath(root);
    const browser = await launch();
    const timer = setTimeout(() => void browser.close().catch(() => undefined), RENDER_LIMITS.ms);
    try {
      const ctx = await browser.newContext({ viewport: { width: ask.width ?? 1280, height: ask.height ?? 800 }, javaScriptEnabled: true, serviceWorkers: 'block', acceptDownloads: false });
      const page = await ctx.newPage();
      await page.route('**/*', async (r) => {
        const verdict = allowRequest(base, r.request().url());
        if (verdict === 'continue') return r.continue();
        const mermaid = verdict === 'mermaid' ? await mermaidJs() : undefined;
        if (mermaid) return r.fulfill({ status: 200, contentType: 'text/javascript', body: mermaid });
        return r.abort();
      });
      await page.goto(pathToFileURL(files.input).href, { waitUntil: 'load', timeout: 20_000 });
      // Give Mermaid (or any small script) a moment to draw.
      const pending = Number(await page.evaluate("document.querySelectorAll('.mermaid:not([data-processed])').length")) || 0;
      await page.waitForTimeout(pending ? 1500 : 200);
      const body = ask.op === 'pdf' ? await page.pdf({ printBackground: true, format: 'A4', landscape: !!ask.landscape, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } }) : await page.screenshot({ fullPage: ask.full !== false, type: 'png' });
      if (body.length > RENDER_LIMITS.outputBytes) throw new Error(`The ${ask.op === 'pdf' ? 'PDF' : 'picture'} came out over ${RENDER_LIMITS.outputBytes / 1024 / 1024} MB`);
      await writeFile(files.output, body);
      return { bytes: body.length };
    } finally {
      clearTimeout(timer);
      await browser.close().catch(() => undefined);
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** POST /office/workers/render from `me`: its own folder is the only place it may read and write. */
export async function officeRender(_ctx: Ctx, floor: Floor, me: WorkerInfo, body: unknown, res: http.ServerResponse) {
  const ask = readRenderAsk(body);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  const rel = workspaceOf(me);
  const root = rel ? path.join(floor.dir, rel) : floor.dir;
  const files = await checkPaths(root, ask);
  if (typeof files === 'string') return send(res, 400, { error: files });
  try {
    const r = await render(root, ask, files);
    return send(res, 200, { ok: true, output: files.output, bytes: r.bytes });
  } catch (err) {
    const f = renderFailure((err as Error).message ?? String(err));
    return send(res, f.status, { error: f.error });
  }
}

/**
 * Why a render failed, as the answer to the worker. playwright-core is a dependency of the office, so
 * only its browser can be missing on a machine (501, with what to run); anything else is a 500.
 */
export function renderFailure(msg: string): { status: number; error: string } {
  const first = msg.split('\n')[0];
  if (/Executable doesn't exist|Please run the following command to download new browsers|playwright(-core)? install/i.test(msg)) {
    return { status: 501, error: `The office's Chromium isn't installed (npx playwright-core install chromium on the office machine), so it can't render HTML. Use py (matplotlib, openpyxl) meanwhile, or ask the Project Manager. ${first}` };
  }
  return { status: 500, error: `Couldn't render it: ${first}` };
}
