#!/usr/bin/env node
// A repeated-title audit of the Portal pages: opens each page in headless Chromium, per theme and window
// width, finds the page's title (the Portal page header's, ui/portal/pagehead.ts; on Home also the tab
// picked; on the Firm, setup and 2D Office pages the top bar's page name) and every visible heading in the
// first ~250 px under it: h1–h6, legends, [role=heading], *-title / *-head elements, and any short bold
// line in a large font (a page's own title drawn as a styled div). It flags:
//   dup      a heading that says the title again: their normalised words (emoji, counts and punctuation
//            dropped, plurals singular: "✅ Approvals (6)" → "approval") equal, or one adds only words that
//            name nothing ("Team" / "Team settings", "Audit" / "Audit log")
//   stacked  two page-level headings (h1–h4) in that strip that say the same thing as each other
// Every 1D tab, every Settings section, Home's five tabs, the Firm, setup and the 2D Office view.
// Point it at a TEST office, never someone's real one: it signs in and clicks like a person would.
//
//   node scripts/check-titles.mjs --base http://127.0.0.1:49xx --password <pw> --floor <id>
//     [--themes portal-light,portal-dark] [--viewports 1440x900,390x844] [--only approvals,settings-you]
//     [--shots <dir>] [--tag before] [--json <file>] [--chrome <chrome.exe>]
//
// It exits 1 when anything is flagged that isn't in EXCEPTIONS (each with why it's deliberate).

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from './perf/pages.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const base = arg('base', 'http://127.0.0.1:4931');
const password = arg('password');
const floor = arg('floor');
if (!floor) {
  console.error('usage: node scripts/check-titles.mjs --base <url> --password <pw> --floor <id>');
  process.exit(2);
}
const themes = arg('themes', 'portal-light,portal-dark').split(',');
const viewports = arg('viewports', '1440x900,390x844').split(',').map((v) => v.split('x').map(Number));
const only = arg('only')?.split(',');
const shots = arg('shots');
const tag = arg('tag', 'run');
const jsonOut = arg('json');
const WINDOW = 250;

const lite = (tab, extra = '') => `/lite?floor=${encodeURIComponent(floor)}&tab=${tab}${extra}`;
const LITE_HEAD = '#pt-head .pt-head-title';
/** The 1D view's tabs, as the Portal navigation lists them (ui/portal/nav-logic.ts). */
const TABS = ['command', 'org', 'teams', 'documents', 'board', 'approvals', 'standup', 'analysis', 'budget', 'audit', 'git', 'model', 'live', 'workers', 'settings', 'tests', 'testing', 'questions'];
const SETTINGS = ['you', 'workers', 'team', 'jeff', 'notify', 'budget', 'connections', 'deliverables', 'incidents', 'stuck', 'studio', 'appearance', 'advanced', 'testing', 'verification', 'danger'];
const homeTab = (t) => async (page) => {
  const b = page.locator(`[data-tab="${t}"], .home-tabs button:has-text("${t}")`).first();
  if (await b.count()) await b.click().catch(() => {});
  await page.waitForTimeout(1200);
};

/** Each page: its address, where its title is, and anything to do first. */
const PAGES = [
  ...TABS.map((t) => ({ name: t, url: lite(t), head: LITE_HEAD })),
  // Every Settings section: its own heading (the pane's) is checked against the header and against the section nav's label.
  ...SETTINGS.map((s) => ({ name: `settings-${s}`, url: lite('settings', `&section=${s}`), head: LITE_HEAD, nav: '.fs-nav .settings-tab.on' })),
  // Home: the page's title (Projects) and, under the tab row, the tab picked: a heading saying either again repeats it.
  ...['projects', 'stats', 'overview', 'audit', 'budget'].map((t) => ({ name: `home-${t}`, url: `/home?tab=${t}`, head: '.ph-title, .home-title h1', tab: '.home-tabs [role=tab][aria-selected=true]' })),
  // The pages with no page header of their own: the top bar's page name (ui/portal/topbar.ts) is their title.
  { name: 'firm', url: '/firm', head: 'header.lite-bar .pt-section' },
  { name: 'setup', url: '/setup', head: 'header.lite-bar .pt-section' },
  { name: 'office2d', url: `/pixel?floor=${encodeURIComponent(floor)}`, head: 'header.lite-bar label.lite-floor' },
];

/**
 * Deliberate exceptions: page (or '*'), check and a pattern over the flag's text, with why. Kept short and
 * specific; anything else flagged fails the run.
 */
const EXCEPTIONS = [
  { page: 'settings-budget', check: 'dup', match: /summary.bud-h "Settings"/, why: 'the Budget section’s fold-out (the budget tab’s own ▾ Settings disclosure), a control not a title: hiding it would leave a folded block no way to open' },
];

/** In the page: the title, the headings under it, and what repeats. */
function MEASURE({ head, nav, tab, win }) {
  const visible = (el) => {
    const c = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 && b.width > 1 && b.height > 1 && parseFloat(c.fontSize) > 1;
  };
  const norm = (s) =>
    (s || '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/\(\s*\d[^)]*\)/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const words = (s) => norm(s).split(' ').filter((w) => w.length > 1);
  /**
   * Same title: the same words (a plural is its singular), or one's words plus only words that name no
   * thing of their own ("Team" and "Team settings", "Audit" and "Audit log"): "Agents" and "Default agent" differ.
   */
  const GENERIC = new Set(['setting', 'page', 'overview', 'list', 'log', 'view', 'all', 'the', 'your', 'tab', 'queue']);
  const same = (a, b) => {
    const singular = (w) => w.replace(/s$/, '');
    const A = new Set(words(a).map(singular));
    const B = new Set(words(b).map(singular));
    if (!A.size || !B.size) return false;
    const [s, l] = A.size <= B.size ? [A, B] : [B, A];
    return [...s].every((w) => l.has(w)) && [...l].every((w) => s.has(w) || GENERIC.has(w));
  };
  // The page's own title: its text without what's nested in it as a control (a count chip stays).
  const ownText = (el) => {
    let t = '';
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) {
      const p = n.parentElement;
      if (!p || !visible(p) || p.closest('button, select, input, a.btn, .btn') !== (el.closest('button, select, input, a.btn, .btn') ?? null)) continue;
      t += ` ${n.textContent}`;
    }
    return t.replace(/\s+/g, ' ').trim();
  };
  const desc = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = [...el.classList].slice(0, 3).map((c) => `.${c}`).join('');
    return `${el.tagName.toLowerCase()}${id}${cls} "${ownText(el).slice(0, 40)}"`;
  };
  const title = [...document.querySelectorAll(head)].find(visible);
  if (!title) return { missing: true };
  const headEl = title.closest('#pt-head, header, .ph-head') ?? title;
  const below = Math.max(headEl.getBoundingClientRect().bottom, title.getBoundingClientRect().bottom);
  const band = document.querySelector('.pt-band');
  const top = band && visible(band) && band.getBoundingClientRect().top >= below - 2 ? band.getBoundingClientRect().bottom : below;
  const titleText = ownText(title);
  // A tab row under the title (Home's): the tab picked is a title too, and the strip starts under the row.
  const tabEl = tab ? [...document.querySelectorAll(tab)].find(visible) : undefined;
  const tabText = tabEl ? ownText(tabEl) : '';
  const top2 = tabEl ? Math.max(top, tabEl.getBoundingClientRect().bottom) : top;
  const HEADING = 'h1, h2, h3, h4, h5, h6, legend, [role=heading], .tab-title, [class$="-title"], [class*="-title "], [class$="-head"] > :is(b, strong, span:first-child), [class*="-h "], [class$="-h"]';
  const seen = new Set();
  const heads = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el === title || title.contains(el) || el.contains(title) || headEl.contains(el)) continue;
    if (el.closest('header.lite-bar, #pt-nav, nav, .modal, [role=dialog], #toasts, .lite-tabs, .home-tabs, [role=tablist], button, select, option, a.btn, .btn, svg')) continue;
    if (!visible(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.top < top2 - 4 || b.top > top2 + win) continue;
    const t = ownText(el);
    if (!t || t.length > 80) continue;
    // A badge, chip or figure is not a title.
    if (/badge|chip|pill|tile|rate|tag|count|kicker/.test(el.className && typeof el.className === 'string' ? el.className : '')) continue;
    let isHead = el.matches(HEADING);
    if (!isHead) {
      // A short bold line in a large font with text of its own (a page title drawn as a styled div).
      const c = getComputedStyle(el);
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      isHead = direct && parseFloat(c.fontSize) >= 17 && +c.fontWeight >= 600 && t.length <= 50 && !el.closest('p, li, td, label');
    }
    if (!isHead) continue;
    // The outermost of nested matches only.
    if ([...seen].some((s) => s.contains(el))) continue;
    seen.add(el);
    heads.push({ el, text: t, top: Math.round(b.top - top2) });
  }
  const flags = [];
  for (const x of heads) {
    if (same(x.text, titleText)) flags.push({ check: 'dup', el: desc(x.el), detail: `"${x.text}" ${x.top}px under the header repeats its title "${titleText}"` });
    else if (tabText && same(x.text, tabText)) flags.push({ check: 'dup', el: desc(x.el), detail: `"${x.text}" ${x.top}px under the tabs repeats the tab picked "${tabText}"` });
  }
  const pageLevel = (el) => el.matches('h1, h2, h3, h4, legend, [role=heading]');
  for (let i = 0; i < heads.length; i++)
    for (let j = i + 1; j < heads.length; j++) {
      const [a, b] = [heads[i], heads[j]];
      if (same(a.text, titleText) || same(b.text, titleText) || a.el.contains(b.el) || !pageLevel(a.el) || !pageLevel(b.el)) continue;
      if (same(a.text, b.text) && Math.abs(a.top - b.top) < 200) flags.push({ check: 'stacked', el: desc(b.el), detail: `"${b.text}" (${b.top}px) says again "${a.text}" (${a.top}px, ${desc(a.el)})` });
    }
  let navText;
  if (nav) {
    const n = document.querySelector(nav);
    navText = n ? ownText(n) : undefined;
  }
  return { title: titleText + (tabText ? ` › ${tabText}` : ''), headings: heads.map((x) => `${x.top}px ${desc(x.el)}`), flags, navText, sectionHead: nav ? ownText(document.querySelector('.settings-head h3') ?? document.body).slice(0, 60) : undefined };
}

const browser = await chromium.launch({ headless: true, executablePath: arg('chrome') ?? findChrome() });
const report = [];
try {
  for (const theme of themes)
    for (const [vw, vh] of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, reducedMotion: 'reduce' });
      await ctx.addInitScript((t) => {
        localStorage.setItem('agent-office.color-theme', t);
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex', color: '#0b6bcb', skin: 0, hair: 0, style: 0 }));
      }, theme);
      if (password) await ctx.request.post(`${base}/api/login`, { data: { password } });
      const page = await ctx.newPage();
      for (const p of PAGES) {
        if (only && !only.includes(p.name)) continue;
        await page.goto(base + p.url, { waitUntil: 'load' });
        await page.waitForFunction(() => !window.__aoBoot?.shown?.(), null, { timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(2500);
        if (p.prepare) await p.prepare(page);
        await page.mouse.move(vw - 2, vh - 2);
        const m = await page.evaluate(MEASURE, { head: p.head, nav: p.nav, tab: p.tab, win: WINDOW });
        const entry = { page: p.name, theme, viewport: `${vw}x${vh}`, ...m, flags: m.flags ?? [] };
        for (const f of entry.flags) {
          const ex = EXCEPTIONS.find((e) => (e.page === '*' || e.page === p.name) && e.check === f.check && e.match.test(`${f.el} ${f.detail}`));
          if (ex) f.exception = ex.why;
        }
        if (shots) {
          fs.mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: path.join(shots, `${tag}-${p.name}-${theme}-${vw}.png`) });
        }
        report.push(entry);
        const open = entry.flags.filter((f) => !f.exception);
        console.log(`${p.name.padEnd(22)} ${theme.padEnd(13)} ${String(vw).padEnd(5)} ${m.missing ? 'no title on the page' : `${open.length} flagged · title "${m.title}"${m.navText ? ` · nav "${m.navText}" · pane "${m.sectionHead}"` : ''}`}`);
        for (const f of entry.flags) console.log(`    ${f.exception ? '·' : '✖'} ${f.check.padEnd(7)} ${f.el}: ${f.detail}${f.exception ? `  [ok: ${f.exception}]` : ''}`);
      }
      await ctx.close();
    }
} finally {
  await browser.close();
}
const open = report.flatMap((r) => r.flags.filter((f) => !f.exception));
console.log(`check-titles: ${report.length} page×theme×width audited, ${open.length} flagged`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
if (open.length) process.exit(1);
