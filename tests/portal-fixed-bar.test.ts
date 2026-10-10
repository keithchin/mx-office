// The Portal top bar is fixed at the top of every Portal page that has it (ui/portal/topbar.css: the 1D
// view, Home, The Firm, setup), and the left navigation's own scroll doesn't scroll the page
// (ui/portal/nav.css: overscroll-behavior: contain). It was sticky: Home's and The Firm's scrolling body let
// go of it, so it scrolled away, and wheeling over the navigation scrolled the page under it. In headless
// Chromium with every client stylesheet: wheel over the pane, then over the page, at 1440 and 390 px (the
// drawer), and the bar stays at the top, the pane and the bar never cover the page's first content, and the
// pane's project card sits flush to its edges. scripts/check-alignment.mjs (the scroll surface) checks the
// same on a running office.
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

test('the rules: the bar fixed with its height kept free, the pane’s scroll contained, the pane flush', () => {
  const bar = read('src/client/ui/portal/topbar.css');
  assert.match(bar, /body\.lite\.lite:is\(\.pt-has-nav, \.home-page, \.firm-page, \.setup-page\) > header\.lite-bar \{ position: fixed; top: 0; left: 0; right: 0; z-index: 20; \}/);
  assert.match(bar, /body\.lite:is\(\.pt-has-nav, \.home-page, \.firm-page, \.setup-page\) \{ padding-top: calc\(var\(--pt-h\) \+ env\(safe-area-inset-top\)\); \}/);
  const nav = read('src/client/ui/portal/nav.css');
  assert.match(nav, /\.pt-nav-in \{[^}]*overscroll-behavior: contain;[^}]*padding: 0 0 24px;/);
  assert.doesNotMatch(read('src/client/ui/portal/layout.css'), /header\.lite-bar \{ position: sticky/);
});

// The pages' stylesheets in the order a page has them (the shared tokens and base first), without the other
// pages' own (the 2D view's, login's and the docs' set html and body unscrollable, or visible).
const css = () => {
  const all = sheets('src/client').filter((f) => !/(pixel|login)\.css$|[\\/]docs[\\/]/.test(f));
  const first = all.filter((f) => /[\\/]styles[\\/]/.test(f));
  return [...first, ...all.filter((f) => !first.includes(f))].map((f) => read(f).replace(/@import[^;]+;/g, '')).join('\n');
};
const items = Array.from({ length: 40 }, (_, i) => `<li><a class="pt-item" href="#">Item ${i}</a></li>`).join('');
const BAR = `<header class="lite-bar pt-bar"><button class="pt-iconbtn pt-navbtn pt-only">☰</button><a class="pt-brand pt-only"><span class="pt-wordmark">Mx Office</span></a></header>`;
const NAV = `<nav class="pt-nav pt-only" id="pt-nav"><div class="pt-nav-in"><div class="pt-proj"><span class="pt-proj-tile">TA</span><span class="pt-proj-name">Travel Approval</span></div><ul class="pt-groups"><li class="pt-group open"><ul class="pt-items">${items}</ul></li></ul></div></nav>`;
const LONG = Array.from({ length: 80 }, (_, i) => `<p>Line ${i}</p>`).join('');
const pages: Record<string, (theme: string, all: string) => string> = {
  lite: (theme, all) => `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${all}</style></head><body class="lite pt-has-nav">${BAR}${NAV}<main class="lite-main"><header class="pt-head pt-only" id="pt-head"><h1 class="pt-head-title">Board</h1></header>${LONG}</main></body></html>`,
  home: (theme, all) => `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${all}</style></head><body class="lite home-page">${BAR}<main class="lite-main" id="first"><h1>Projects</h1>${LONG}</main></body></html>`,
};

type State = { barTop: number; barBottom: number; sy: number; first: number; navTop: number | null; navLeft: number | null; projLeft: number | null; projRight: number | null; navRight: number | null; projTop: number | null };
const STATE = `(() => {
  const b = document.querySelector('header.lite-bar').getBoundingClientRect();
  const first = document.querySelector('.lite-main > *').getBoundingClientRect();
  const nav = document.getElementById('pt-nav');
  const n = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
  const p = document.querySelector('.pt-proj')?.getBoundingClientRect();
  return { barTop: b.top, barBottom: b.bottom, sy: scrollY, first: first.top + scrollY, navTop: n ? n.top : null, navLeft: n ? n.left : null, navRight: n ? n.right - (parseFloat(getComputedStyle(nav).borderRightWidth) || 0) : null, projLeft: p ? p.left : null, projRight: p ? p.right : null, projTop: p ? p.top : null };
})()`;

const chrome = findChrome();
test('wheeling over the navigation and over the page: the bar stays at the top, nothing hides under it', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const all = css();
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    for (const theme of ['portal-light', 'portal-dark']) {
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        for (const [name, make] of Object.entries(pages)) {
          const at = `${name} ${theme} ${width}px`;
          const p = await browser.newPage({ viewport: { width, height } });
          await p.setContent(make(theme, all));
          const s0 = (await p.evaluate(STATE)) as State;
          assert.equal(s0.barTop, 0, `${at}: the bar at the top`);
          assert.ok(s0.first >= s0.barBottom - 0.5, `${at}: the page's first content (${s0.first}) starts below the bar (${s0.barBottom})`);
          if (name === 'lite') {
            // On a phone the pane is a drawer: open it as its ☰ does.
            if (width < 761) await p.evaluate(`document.body.classList.add('pt-drawer-open')`);
            await p.waitForTimeout(300);
            const s1 = (await p.evaluate(STATE)) as State;
            assert.ok(s1.navTop !== null && s1.navTop >= s1.barBottom - 0.5, `${at}: the pane starts under the bar`);
            assert.ok(Math.abs((s1.projTop ?? 0) - (s1.navTop ?? 0)) <= 0.5, `${at}: the project card at the pane's top (${s1.projTop} vs ${s1.navTop})`);
            assert.ok(Math.abs((s1.projLeft ?? 0) - (s1.navLeft ?? 0)) <= 0.5 && Math.abs((s1.projRight ?? 0) - (s1.navRight ?? 0)) <= 0.5, `${at}: the project card flush to the pane's sides (${s1.projLeft}..${s1.projRight} in ${s1.navLeft}..${s1.navRight})`);
            await p.mouse.move((s1.navLeft ?? 0) + 60, 400);
            for (let i = 0; i < 10; i++) await p.mouse.wheel(0, 600);
            await p.waitForTimeout(300);
            const s2 = (await p.evaluate(STATE)) as State;
            assert.equal(s2.sy, 0, `${at}: wheeling over the pane (to its end and past it) doesn't scroll the page`);
            assert.equal(s2.barTop, 0, `${at}: nor the bar`);
            if (width < 761) await p.evaluate(`document.body.classList.remove('pt-drawer-open')`);
          }
          // A new wheel gesture (Chromium keeps a gesture on the scroller it started on for a moment).
          await p.waitForTimeout(1200);
          await p.mouse.move(width - 30, height - 100);
          for (let i = 0; i < 5; i++) await p.mouse.wheel(0, 500);
          await p.waitForTimeout(300);
          const s3 = (await p.evaluate(STATE)) as State;
          assert.ok(s3.sy > 0, `${at}: the page scrolls`);
          assert.equal(s3.barTop, 0, `${at}: the bar stays at the top while the page scrolls (scrollY ${s3.sy})`);
          await p.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
});
