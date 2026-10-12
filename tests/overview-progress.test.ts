// The Overview's Progress card (Portal) with the team-lead panel open: the mockup cut the stage names off
// ("Require…", "confirm…") at 1440 px with the panel open. Here, in headless Chromium with every client
// stylesheet on the page, a toolkit project's nine stages at 1440 and 1920 px, panel open and collapsed,
// in Portal Light and Dark: every stage's name and the line under it are shown whole (they wrap onto a
// second line), and the segments' tooltip (on hover and focus) keeps the full text besides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

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

const STAGES: [string, string, string, string][] = [
  ['P', 'Kickoff', 'done', 'done'],
  ['0', 'Triage', 'done', '✋ confirmed 2 Oct'],
  ['1', 'Analysis', 'done', 'done'],
  ['2', 'Requirements', 'done', 'done'],
  ['3', 'Architecture & Design', 'done', '✋ confirmed 6 Oct'],
  ['4', 'Build Plan', 'done', '✋ confirmed 7 Oct'],
  ['5', 'Build', 'active current', '9 of 14 stories'],
  ['6', 'Test', 'pending', 'next'],
  ['7', 'Cutover', 'pending', '✋ needs a decision'],
];

function page(theme: string, collapsed: boolean): string {
  const segs = STAGES.map(([id, t, st, d]) => `<button class="pg-seg ${st} k-stage" data-phase="${id}" aria-label="Stage ${id}, ${t}"><span class="pg-seg-id">${id}</span><span class="pg-seg-t">${t}</span><span class="pg-seg-n" aria-hidden="true">${id} · ${t}</span><span class="pg-seg-d" aria-hidden="true">${d}</span></button>`).join('');
  const css = sheets('src/client').map((f) => read(f).replace(/@import[^;]+;/g, '')).join('\n');
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head>
<body class="lite pt-has-nav lp-on${collapsed ? ' lp-collapsed' : ''}"><main class="lite-main on-command board">
<section class="pt-ov-card pt-prog pt-only" id="pt-progress"><h2>Progress</h2><div id="progress-bar" class="pg-host"><div class="pg-bar"><button class="pg-fold">▾</button><div class="pg-track">${segs}</div><button class="pg-label">Stage 5 · Build</button></div></div></section>
</main></body></html>`;
}

const chrome = findChrome();
test('with the panel open at 1440 px the stage names wrap, never cut off', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const theme of ['portal-light', 'portal-dark'])
      for (const width of [1440, 1920])
        for (const collapsed of [false, true]) {
          const at = `${theme} ${width}px, panel ${collapsed ? 'collapsed' : 'open'}`;
          const p = await browser.newPage({ viewport: { width, height: 900 } });
          await p.setContent(page(theme, collapsed));
          const m = (await p.evaluate(`(() => [...document.querySelectorAll('.pg-seg-n, .pg-seg-d')].map((el) => ({ t: el.textContent, cut: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1, h: el.clientHeight, shown: getComputedStyle(el).display !== 'none' })))()`)) as { t: string; cut: boolean; h: number; shown: boolean }[];
          await p.close();
          assert.equal(m.length, STAGES.length * 2);
          for (const x of m) {
            assert.ok(x.shown, `${at}: "${x.t}" is shown`);
            assert.ok(!x.cut, `${at}: "${x.t}" is cut off`);
          }
        }
  } finally {
    await browser.close();
  }
});
