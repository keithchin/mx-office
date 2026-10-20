// The honesty fixes' words on the page, in headless Chromium with every client stylesheet: the Live app's
// readiness card with a milestone built but with no journey (tagged "No journeys", never "Ready"), and the
// Team tab's coverage table for a Solo team saying that you review every pull request.
// HONESTY_SHOTS=<dir> also saves screenshots of both in Portal Light and Dark there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { computeReadiness } from '../src/shared/liveapp/readiness.js';
import { parseJourney, parsePlan } from '../src/shared/liveapp/plan.js';
import { PLAN } from './fixtures/liveapp/plan.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir)).sort()) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

const journey = parseJourney('tests/e2e/skeleton.journey.json', JSON.stringify({ id: 'skeleton', requirement: ['build-plan row 10'] }))!;
const readiness = computeReadiness({
  plan: parsePlan(PLAN),
  planFile: 'architecture/build-plan.md',
  running: true,
  live: { sha: 'dd960bd0000000000000000000000000000000000', rows: new Set([3, 4, 6, 7, 8, 10]) },
  main: { sha: 'dd960bd0000000000000000000000000000000000', branch: 'main', rows: new Set([3, 4, 6, 7, 8, 10]) },
  branches: [{ branch: 'office/feature-1', rows: new Set([19, 20, 21, 23]), pr: { number: 6 } }],
  journeys: [journey],
  results: [{ journey: 'skeleton', status: 'passed' }],
  now: 1,
});
const solo = { floor: 'f1', shape: 'solo', level: 'fast', coverage: { management: 'solo-lead', analysis: 'solo-lead', design: 'solo-lead', development: 'solo-lead', testing: 'solo-lead' }, members: [{ role: 'solo-lead', name: 'Sam' }] };

const chrome = findChrome();
test('in a browser: "No journeys" on a built milestone with no journey; the Solo coverage table says you review every PR', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { readinessCard } from './liveapp/readiness';
        import { coverageTable } from './roster/coverage';
        const host = document.getElementById('host');
        host.append(readinessCard({ floor: 'f1', status: 'running', log: [], available: true, readiness: ${JSON.stringify(readiness)} }), coverageTable(${JSON.stringify(solo)}));`,
      resolveDir: path.join(root, 'src/client/ui'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const css = sheets('src/client')
    .filter((f) => !/login\.css$|[\/]mobile[\/]|[\/]first-run[\/]/.test(f))
    .map((f) => read(f).replace(/@import[^;]+;/g, ''))
    .join('\n');
  const shots = process.env.HONESTY_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    for (const theme of ['portal-light', 'portal-dark']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><div id="liveapp-view" class="la"><div id="host" style="display:flex;flex-direction:column;gap:16px"></div></div></main></body></html>`);
      await page.addScriptTag({ content: out.outputFiles[0].text });
      const rows = await page.$$eval('.lr-m', (els) => els.map((e) => [e.className, e.querySelector('.lr-tag')?.textContent, e.querySelector('.lr-line')?.textContent]));
      assert.deepEqual(rows[0], ['lr-m no-evidence', 'No journeys', 'Prerequisites: built, no journey evidence yet (no journey names its rows, so nothing has checked it against this build)']);
      assert.deepEqual(rows[1].slice(0, 2), ['lr-m ready', 'Ready'], 'a milestone whose journey passed against this build is still ready');
      const tag = await page.$eval('.lr-m.no-evidence .lr-tag', (e) => getComputedStyle(e).backgroundColor);
      const readyTag = await page.$eval('.lr-m.ready .lr-tag', (e) => getComputedStyle(e).backgroundColor);
      assert.notEqual(tag, readyTag, 'drawn apart from Ready');
      assert.match(await page.$eval('.ro-leaves', (e) => e.textContent ?? ''), /^You review every pull request/);
      assert.deepEqual(errors, []);
      if (shots) await page.screenshot({ path: path.join(shots, `readiness-and-coverage-${theme}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
