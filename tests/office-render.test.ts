// office-workers export-pdf and screenshot (bin/office-render.js, src/server/hooks/office-render.ts):
// a worker's own HTML file to a PDF or PNG with the office's headless Chromium. A stubbed browser here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { UsageError, parseArgs } from '../bin/office-workers.js';
import { formatRendered } from '../bin/office-render.js';
import { allowRequest, checkPaths, readRenderAsk, render, renderFailure, type BrowserLike, type PageLike, type RouteLike } from '../src/server/hooks/office-render.js';

function dirs(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-render-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const wt = path.join(root, 'wt');
  mkdirSync(path.join(wt, 'design', 'wireframes'), { recursive: true });
  writeFileSync(path.join(wt, 'design', 'wireframes', 'home.html'), '<h1>Home</h1>');
  writeFileSync(path.join(root, 'outside.html'), '<h1>No</h1>');
  return { root, wt };
}

test('the command line: two paths made absolute, the right extensions, options per command', () => {
  const pdf = parseArgs(['export-pdf', 'analysis/brd-report.html', 'docs/requirements/BRD-x.pdf', '--landscape']);
  assert.equal(pdf.cmd, 'render');
  assert.equal(pdf.op, 'pdf');
  assert.equal(pdf.landscape, true);
  assert.ok(path.isAbsolute(String(pdf.input)) && String(pdf.output).endsWith('BRD-x.pdf'));
  const shot = parseArgs(['screenshot', 'a.html', 'a.png', '--width', '1440', '--viewport']);
  assert.deepEqual([shot.op, shot.width, shot.full], ['screenshot', 1440, false]);
  assert.equal(parseArgs(['screenshot', 'a.html', 'a.png']).full, true);
  assert.throws(() => parseArgs(['export-pdf', 'a.html']), UsageError);
  assert.throws(() => parseArgs(['export-pdf', 'a.md', 'a.pdf']), UsageError);
  assert.throws(() => parseArgs(['screenshot', 'a.html', 'a.jpg']), UsageError);
  assert.throws(() => parseArgs(['screenshot', 'a.html', 'a.png', '--landscape']), UsageError);
  assert.throws(() => parseArgs(['screenshot', 'a.html', 'a.png', '--width', 'wide']), UsageError);
  assert.equal(formatRendered({ output: 'C:/x/a.pdf', bytes: 20480 }), 'Wrote C:/x/a.pdf (20 KB).');
});

test('the request: op, kinds and sizes clamped', () => {
  assert.equal(typeof readRenderAsk({ op: 'print', input: 'a.html', output: 'a.pdf' }), 'string');
  assert.equal(typeof readRenderAsk({ op: 'pdf', input: 'a.html', output: 'a.png' }), 'string');
  assert.equal(typeof readRenderAsk({ op: 'pdf', input: 'a.exe', output: 'a.pdf' }), 'string');
  const ok = readRenderAsk({ op: 'screenshot', input: 'a.html', output: 'a.png', width: 99999, height: 5 });
  assert.ok(typeof ok !== 'string');
  assert.deepEqual([ok.width, ok.height], [3840, 200]);
});

test('input and output must be inside the worker\'s own folder', async (t) => {
  const { root, wt } = dirs(t);
  const ask = (input: string, output: string) => ({ op: 'pdf' as const, input, output });
  const home = path.join(wt, 'design', 'wireframes', 'home.html');
  const ok = await checkPaths(wt, ask(home, path.join(wt, 'design', 'home.pdf')));
  assert.equal(typeof ok, 'object');
  assert.equal(await checkPaths(wt, ask(path.join(root, 'outside.html'), path.join(wt, 'a.pdf'))), 'The input must be inside your own worktree');
  assert.equal(await checkPaths(wt, ask(home, path.join(root, 'a.pdf'))), 'The output must be inside your own worktree');
  assert.equal(await checkPaths(wt, ask(home, path.join(wt, '..', 'a.pdf'))), 'The output must be inside your own worktree');
  assert.match(String(await checkPaths(wt, ask(home, path.join(wt, 'nope', 'a.pdf')))), /Make the output's folder first/);
  assert.equal(await checkPaths(wt, ask('design/home.html', path.join(wt, 'a.pdf'))), 'Paths must be absolute');
  try {
    symlinkSync(root, path.join(wt, 'escape'), 'junction');
    assert.equal(await checkPaths(wt, ask(path.join(wt, 'escape', 'outside.html'), path.join(wt, 'a.pdf'))), 'The input must be inside your own worktree');
    assert.equal(await checkPaths(wt, ask(home, path.join(wt, 'escape', 'a.pdf'))), 'The output must be inside your own worktree');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
  }
});

test('the page may load files from the worktree and the CDN Mermaid (served locally), nothing else', (t) => {
  const { root, wt } = dirs(t);
  assert.equal(allowRequest(wt, pathToFileURL(path.join(wt, 'design', 'ds.css')).href), 'continue');
  assert.equal(allowRequest(wt, pathToFileURL(path.join(root, 'outside.html')).href), 'abort');
  assert.equal(allowRequest(wt, 'https://example.com/track.png'), 'abort');
  assert.equal(allowRequest(wt, 'http://127.0.0.1:4600/api/roster'), 'abort');
  assert.equal(allowRequest(wt, 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'), 'mermaid');
  assert.equal(allowRequest(wt, 'https://cdn.jsdelivr.net/npm/evil/dist/mermaid.min.js'), 'abort');
  assert.equal(allowRequest(wt, 'data:image/png;base64,AAAA'), 'continue');
});

test('render drives the browser: routes every request, writes the PDF or PNG, closes the browser', async (t) => {
  const { wt } = dirs(t);
  const calls: string[] = [];
  let routed: ((r: RouteLike) => unknown) | undefined;
  const fake = (): BrowserLike => ({
    newContext: async (o) => {
      calls.push(`context ${o.viewport.width}x${o.viewport.height}`);
      const page: PageLike = {
        route: async (_p, fn) => void (routed = fn),
        goto: async (url) => {
          calls.push(`goto ${url.startsWith('file:') ? 'file' : url}`);
          // The page asks for something on the network: the route refuses it.
          const req = { request: () => ({ url: () => 'https://example.com/x.png' }), continue: async () => void calls.push('continue'), abort: async () => void calls.push('abort'), fulfill: async () => void calls.push('fulfill') };
          await routed?.(req);
        },
        waitForTimeout: async () => undefined,
        evaluate: async () => 0,
        pdf: async (o) => (calls.push(`pdf ${o.format}`), Buffer.from('%PDF-1.4 fake')),
        screenshot: async () => (calls.push('png'), Buffer.from('PNG fake')),
      };
      return { newPage: async () => page };
    },
    close: async () => void calls.push('close'),
  });
  const input = path.join(wt, 'design', 'wireframes', 'home.html');
  const output = path.join(wt, 'design', 'home.pdf');
  const r = await render(wt, { op: 'pdf', input, output }, { input, output }, async () => fake());
  assert.equal(r.bytes, 13);
  assert.equal(readFileSync(output, 'utf8'), '%PDF-1.4 fake');
  assert.deepEqual(calls, ['context 1280x800', 'goto file', 'abort', 'pdf A4', 'close']);
  calls.length = 0;
  const png = path.join(wt, 'design', 'home.png');
  await render(wt, { op: 'screenshot', input, output: png, width: 800, height: 600 }, { input, output: png }, async () => fake());
  assert.deepEqual(calls, ['context 800x600', 'goto file', 'abort', 'png', 'close']);
  // A browser that fails still gets closed, and the error comes back.
  calls.length = 0;
  const broken = (): BrowserLike => ({ ...fake(), newContext: async () => Promise.reject(new Error('boom')) });
  await assert.rejects(render(wt, { op: 'pdf', input, output }, { input, output }, async () => broken()), /boom/);
  assert.deepEqual(calls, ['close']);
});

test('a failed render: 501 only when the browser is missing, else 500', () => {
  const missing = renderFailure("browserType.launch: Executable doesn't exist at C:\ms-playwright\chromium-1247\chrome.exe\n╔═══╗");
  assert.equal(missing.status, 501);
  assert.match(missing.error, /npx playwright-core install chromium/);
  assert.equal(renderFailure('page.goto: Timeout 20000ms exceeded.\nCall log').status, 500);
  assert.equal(renderFailure("Cannot find package 'playwright-core'").status, 500, 'playwright-core is a dependency now: no special case');
});
