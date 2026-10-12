// The Portal Overview's dark band (ui/portal/pagehead.ts) is the floor's line (branch, folder, who's here,
// the budget chip, Running | Pause); the progress bar is in the Progress card under it (ui/portal/overview.ts). Release 34 drew the progress
// bar ON the floor's line: the Model tab's Page view (ui/model/page.css) styled a class of its own name,
// .pg-host, as position: absolute, and the progress bar's root (ui/progress) carries .pg-host too, so it
// left the band's flow and lay over the first row. Here: no class is shared between the two stylesheets,
// and in headless Chromium, with every client stylesheet on the page, the band's rows don't overlap, in
// Portal Light and Dark at 1440 and 390 px, with a progress bar (a toolkit project, with phases) and
// without one (a project with no phases: the bar is empty). scripts/check-alignment.mjs checks the same on
// a running office.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const classes = (css: string) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[a-z_][\w-]*)/gi)].map((m) => m[1]).filter((c) => !/^\d/.test(c)));

test('the Model tab’s Page view and the progress bar share no class name', () => {
  const model = classes(read('src/client/ui/model/page.css'));
  const progress = classes(read('src/client/ui/progress/progress.css'));
  const both = [...model].filter((c) => progress.has(c));
  assert.deepEqual(both, [], `both style ${both.map((c) => `.${c}`).join(', ')}`);
});

function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir)).sort()) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

/** The band as the Overview has it (the page's own floor line moved in), and the progress bar in the Progress card under it. */
function page(theme: string, phases: number): string {
  const segs = Array.from({ length: phases }, (_, i) => `<button class="pg-seg${i < 3 ? ' done' : ''}"><span class="pg-seg-id">${i}</span><span class="pg-seg-t">Phase ${i}</span></button>`).join('');
  const bar = phases ? `<div class="pg-bar"><button class="pg-fold">▾</button><div class="pg-track">${segs}</div><button class="pg-label">Stage 3 · Architecture &amp; Design</button></div>` : '';
  // Every client stylesheet, so a rule from any page that reaches the band shows (the bundle has them all).
  const css = sheets('src/client').map((f) => read(f).replace(/@import[^;]+;/g, '')).join('\n');
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head>
<body class="lite pt-has-nav"><main class="lite-main on-command">
<header class="pt-head pt-only pt-head-ov" id="pt-head"><div class="pt-head-id"><div class="pt-head-text"><h1 class="pt-head-title">Travel Approval</h1></div></div></header>
<div class="pt-band pt-only">
  <div class="bud-meta-row"><p id="floor-meta">main · example-co/travel-approval · 2 here</p><button class="bud-chip" id="budget-chip"><span class="bud-chip-t">$48 today · $1,161 / $2,400</span></button><button class="pr-toggle">Running <span class="pr-tg-act">Pause</span></button></div>
</div>
<section class="pt-ov-card pt-prog pt-only" id="pt-progress"><h2>Progress</h2><div id="progress-bar" class="pg-host">${bar}</div></section>
</main></body></html>`;
}

type Box = { top: number; bottom: number; height: number };
const chrome = findChrome();
test('the Overview band (the floor’s line), then the Progress card with the progress bar, never on top of each other', { skip: chrome ? false : 'no Chromium here (npx playwright-core install chromium)' }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const theme of ['portal-light', 'portal-dark']) {
      for (const width of [1440, 390]) {
        for (const phases of [10, 0]) {
          const at = `${theme} ${width}px, ${phases ? 'a toolkit project (phases)' : 'no phases'}`;
          const p = await browser.newPage({ viewport: { width, height: 800 } });
          await p.setContent(page(theme, phases));
          // A string, not a function: the test runner's transform adds helpers the page doesn't have.
          const m = (await p.evaluate(`(() => {
            const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
            const track = document.querySelector('.pg-track');
            return { band: box('.pt-band'), row: box('.bud-meta-row'), bar: track ? box('.pg-track') : { top: 0, bottom: 0, height: 0 }, next: box('#pt-progress'), pos: getComputedStyle(document.getElementById('progress-bar')).position };
          })()`)) as { band: Box; row: Box; bar: Box; next: Box; pos: string };
          await p.close();
          assert.equal(m.pos, 'static', `${at}: the progress bar is in the band's flow`);
          assert.ok(m.row.height >= 20, `${at}: the floor's line is drawn (${m.row.height} px)`);
          assert.ok(m.row.top >= m.band.top + 8 && m.row.bottom <= m.band.bottom - 8, `${at}: the floor's line inside the band with its padding`);
          if (phases) {
            assert.ok(m.bar.height >= 20, `${at}: the progress bar is drawn (${m.bar.height} px)`);
            assert.ok(m.bar.top >= m.band.bottom, `${at}: the progress bar (top ${m.bar.top}) starts below the band (bottom ${m.band.bottom})`);
            assert.ok(m.bar.top >= m.next.top && m.bar.bottom <= m.next.bottom, `${at}: the progress bar is inside its Progress card`);
          }
          assert.ok(m.next.top >= m.band.bottom, `${at}: the Progress card starts below the band`);
        }
      }
    }
  } finally {
    await browser.close();
  }
});
