#!/usr/bin/env node
// The docs screenshots, made the same way every time: starts a throwaway TEST office on a believable demo
// (scripts/docs/demo.ts: two Mendix projects, a team, issues and pull requests, a stage-3 progress bar,
// budget numbers that add up), opens each page in headless Chromium in a theme and window size, and saves
// the named shots into docs/site/images/. Then it stops everything it started and removes the office.
//
//   npm run build   (once: it runs the built office)
//   node scripts/docs-shots.mjs [--only command-center,readme-projects] [--theme portal-light]
//     [--viewport 1440x900] [--scale 2] [--width 1440] [--out docs/site/images] [--keep] [--list]
//
//   --only      just these shots (names from SHOTS below, comma-separated)
//   --theme     every shot in this theme instead of its own (default, dark, terminal, clean-light,
//               clean-dark, portal-light, portal-dark)
//   --viewport  the browser window, CSS pixels (default: the shot's own, else 1440x900)
//   --scale     device pixels per CSS pixel while drawing (default 2, for crisp text)
//   --width     the saved PNG's width in pixels (default: the viewport's); scaled down from the drawing
//   --keep      leave the test office's folder for a look afterwards (its processes are still stopped)
//
// What's published must not carry anything of the machine or the person running it, so:
//   - the office runs in its own temporary test-office folder, with its own ~ (nothing of the person's
//     ~/.claude, gh or git identity is read), a stand-in gh (scripts/docs/gh.mjs: the demo's issues and
//     pull requests, nothing leaves the machine) and a stand-in agent (scripts/docs/agent.mjs: no model);
//   - the projects show their (made-up) GitHub repository, never their folder;
//   - AGENT_OFFICE_DOCS_SHOTS=1 leaves the TEST MODE badge off (honoured in test mode only);
//   - before each shot the page's visible text is checked for the machine's user and host names, home
//     folder paths and test words (fake, perf, spike, test-office, TEST MODE): a hit fails the shot.
// Deterministic: the demo is fixed (seeded ids, fixed dates), the office's clock starts at AT
// (scripts/docs/clock.mjs), the browser's is fixed there too, and both run in UTC with en-US.
//
// To add a shot, add a row to SHOTS: its name (the file), the page, what to wait for and, if needed, what
// to do first (open a dialog, scroll). The full docs refresh adds the rest of docs/site/images this way.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { FAKEBIN, REPO, cleanupTestDir, killProcessesUnder, startTestOffice } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';
import { makeStubs } from './perf/journey/stubs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, 'docs');

/** The moment every shot is taken at: Thursday 8 October 2026, 14:20 UTC. */
export const AT = Date.UTC(2026, 9, 8, 14, 20);
const MAIN = 'travel-approval';

/** Waits until the 1D view has drawn (the boot screen gone) and `sel` is there. */
const drawn = (sel) => async (page) => {
  await page.waitForFunction((s) => !window.__aoBoot?.shown?.() && !!document.querySelector(s), sel, { timeout: 45000 });
};

/**
 * Every shot: its file name (docs/site/images/<name>.png), the page, its theme, what to wait for, and
 * anything to do before it's taken. `settle` is how long to let late answers (git, the budget feed) land.
 */
export const SHOTS = [
  {
    name: 'command-center',
    what: 'The Overview of a project (Portal theme): the progress bar, Needs you, the project console and the Team, Technical contact and Details cards',
    url: `/lite?floor=${MAIN}&tab=command`,
    theme: 'portal-light',
    ready: async (page) => {
      await drawn('#summary .pmc')(page);
      await page.waitForFunction(() => document.querySelectorAll('.pt-details dt').length >= 4 && !!document.querySelector('.pt-band') && !!document.querySelector('.pt-face-list'), null, { timeout: 30000 });
    },
    settle: 4000,
  },
  {
    name: 'readme-projects',
    what: 'The Projects page (Portal theme): a card per project with its progress, status and spend',
    url: '/home',
    theme: 'portal-light',
    // Two projects fill the top of the page: no empty half below them.
    viewport: '1440x700',
    ready: async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.ph-card').length >= 2 && [...document.querySelectorAll('.ph-card')].every((c) => /$/.test(c.textContent ?? '')), null, { timeout: 30000 });
    },
    settle: 4000,
  },
];

// ---- The command line ----------------------------------------------------------------------------------

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  if (has('list')) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(22)} ${s.theme.padEnd(13)} ${(s.viewport ?? '1440x900').padEnd(10)} ${s.url}\n${' '.repeat(23)}${s.what}`);
    return;
  }
  const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = only?.filter((n) => !SHOTS.some((s) => s.name === n)) ?? [];
  if (unknown.length) throw new Error(`no such shot: ${unknown.join(', ')} (see --list)`);
  const shots = SHOTS.filter((s) => !only || only.includes(s.name));
  const scale = Number(arg('scale', '2'));
  const outDir = path.resolve(REPO, arg('out', path.join('docs', 'site', 'images')));
  if (!fs.existsSync(path.join(REPO, 'dist', 'server', 'server', 'cli.js'))) throw new Error('the office is not built: run npm run build first');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-office-docs-shots-'));
  let office;
  let browser;
  try {
    console.log('docs-shots: writing the demo office…');
    const demo = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', path.join(DOCS, 'demo.ts'), '--out', root, '--at', String(AT - 2 * 60_000)], { cwd: REPO, encoding: 'utf8', windowsHide: true }));
    const stubs = makeStubs(root);
    fs.copyFileSync(path.join(DOCS, 'gh.mjs'), path.join(stubs.bin, 'gh.mjs'));
    const userHome = path.join(root, 'userhome');
    fs.mkdirSync(userHome, { recursive: true });
    const sep = process.platform === 'win32' ? ';' : ':';
    const env = {
      ...stubs.env,
      FAKE_GH_DIR: demo.github,
      DEMO_AGENTS: demo.agents,
      USERPROFILE: userHome,
      HOME: userHome,
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: 'agents@example.com',
      GIT_COMMITTER_NAME: 'Ada',
      GIT_COMMITTER_EMAIL: 'agents@example.com',
      PATH: `${stubs.bin}${sep}${FAKEBIN}${sep}${process.env.PATH}`,
      TZ: 'UTC',
      DOCS_CLOCK_AT: String(AT - 60_000),
      AGENT_OFFICE_DOCS_SHOTS: '1',
    };
    const agent = path.join(DOCS, 'bin', process.platform === 'win32' ? 'demo-claude.cmd' : 'demo-claude');
    // The office's clock (scripts/docs/clock.mjs), through the runner's node flags.
    const before = process.env.PERF_OFFICE_NODE_ARGS;
    process.env.PERF_OFFICE_NODE_ARGS = `--import=${pathToFileURL(path.join(DOCS, 'clock.mjs')).href}`;
    console.log('docs-shots: starting the test office…');
    try {
      office = await startTestOffice({ home: demo.officeDir, env, agent, timeoutMs: 90000 });
    } finally {
      if (before === undefined) delete process.env.PERF_OFFICE_NODE_ARGS;
      else process.env.PERF_OFFICE_NODE_ARGS = before;
    }
    // Let the live agents wake and say what they're doing.
    await new Promise((r) => setTimeout(r, 6000));

    browser = await chromium.launch({ headless: true, executablePath: findChrome() });
    const banned = bannedWords();
    fs.mkdirSync(outDir, { recursive: true });
    for (const shot of shots) {
      const theme = arg('theme', shot.theme);
      const [vw, vh] = arg('viewport', shot.viewport ?? '1440x900').split('x').map(Number);
      const width = Number(arg('width', String(vw)));
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale, timezoneId: 'UTC', locale: 'en-US', colorScheme: theme.endsWith('dark') || theme === 'dark' || theme === 'terminal' ? 'dark' : 'light' });
      await ctx.clock.setFixedTime(AT);
      await ctx.addInitScript((t) => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex', color: '#0b6bcb', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', t);
        localStorage.setItem('agent-office.pmc-view', 'chat');
      }, theme);
      await ctx.request.post(`${office.base}/api/login`, { data: { password: office.password } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log(`  page error (${shot.name}): ${e.message}`));
      await page.goto(`${office.base}${shot.url}`, { waitUntil: 'load', timeout: 45000 });
      await shot.ready(page);
      if (shot.prepare) await shot.prepare(page);
      await page.waitForTimeout(shot.settle ?? 2000);
      // No caret, hover or focus ring in a published picture.
      await page.mouse.move(vw - 1, vh - 1);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      const text = await page.evaluate(() => document.body.innerText);
      const hits = banned.filter((b) => b.re.test(text)).map((b) => b.why);
      if (hits.length) throw new Error(`${shot.name}: the page shows ${hits.join(', ')}; not saved`);
      const raw = await page.screenshot({ type: 'png' });
      const file = path.join(outDir, `${shot.name}.png`);
      const bytes = await savePng(browser, raw, width, file);
      console.log(`docs-shots: ${shot.name}.png ${width}px wide, ${Math.round(bytes / 1024)} KB (${theme}, ${vw}x${vh} @${scale}x)`);
      await ctx.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    if (office) await office.stop().catch((e) => console.error(`docs-shots: stopping the office: ${e.message}`));
    killProcessesUnder(root);
    if (has('keep')) console.log(`docs-shots: kept ${root}`);
    else await cleanupTestDir(root);
  }
}

/** What a published page must not show: this machine's user and host, home-folder paths, test words. */
function bannedWords() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [
    { re: /[A-Za-z]:\\Users\\|\/Users\/|\/home\/|AppData/i, why: 'a home-folder path' },
    { re: /test-office/i, why: 'the test office’s folder' },
    { re: /TEST MODE/, why: 'the TEST MODE badge' },
    { re: /\bfake\b|claude-fake/i, why: '“fake”' },
    { re: /\bperf\b|perf-tester/i, why: '“perf”' },
    { re: /\bspike\b|big-spike/i, why: '“spike”' },
    { re: /\bstep-\d+/i, why: 'a perf step' },
  ];
  const user = os.userInfo().username;
  if (user && user.length > 2) out.push({ re: new RegExp(esc(user), 'i'), why: 'this machine’s user name' });
  const host = os.hostname();
  if (host && host.length > 2) out.push({ re: new RegExp(`\\b${esc(host)}\\b`, 'i'), why: 'this machine’s name' });
  return out;
}

// ---- Saving: scaled down in the browser, then written as a well-compressed PNG ---------------------------

/** Scales the drawing to `width` (the browser's high-quality resampling) and writes it; returns its size. */
async function savePng(browser, raw, width, file) {
  const page = await browser.newPage();
  try {
    const { w, h, data } = await page.evaluate(
      async ({ b64, width }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const w = Math.min(width, img.naturalWidth);
        const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
        // Halve step by step (each with smoothing) for a sharp, clean downscale.
        let src = img;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        while (sw / 2 >= w) {
          const c = new OffscreenCanvas(Math.round(sw / 2), Math.round(sh / 2));
          const x = c.getContext('2d');
          x.imageSmoothingQuality = 'high';
          x.drawImage(src, 0, 0, c.width, c.height);
          src = c;
          sw = c.width;
          sh = c.height;
        }
        const c = new OffscreenCanvas(w, h);
        const x = c.getContext('2d');
        x.imageSmoothingQuality = 'high';
        x.drawImage(src, 0, 0, w, h);
        const px = x.getImageData(0, 0, w, h).data;
        let s = '';
        for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
        return { w, h, data: btoa(s) };
      },
      { b64: raw.toString('base64'), width },
    );
    const png = encodePng(w, h, Buffer.from(data, 'base64'));
    fs.writeFileSync(file, png);
    return png.length;
  } finally {
    await page.close();
  }
}

/** RGBA pixels to an RGB PNG (screenshots are opaque), each row with the filter that packs it best. */
export function encodePng(w, h, rgba) {
  const bpp = 3;
  const stride = w * bpp;
  const rgb = Buffer.alloc(stride * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  const out = Buffer.alloc((stride + 1) * h);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const up = y ? rgb.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = up[i];
        const cc = i >= bpp ? up[i - bpp] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - cc;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - cc);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        const v = (row[i] - pred) & 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) ((bestSum = sum), (best = f));
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(tb) >>> 0);
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`docs-shots: ${e.message}`);
    process.exitCode = 1;
  });
}
