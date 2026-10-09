#!/usr/bin/env node
// Checks that the 1D view's tab bar and each tab's content start at the same height on every tab as on
// the Command Center: opens /lite?floor=<floor> in headless Chromium, clicks through the tabs and
// measures, per tab, the tab bar's top and the gap between the tab bar's bottom and the first thing the
// tab shows. Fails when a tab's bar sits more than 1 px off the Command Center's, or when a tab leaves an
// empty band above its content (a gap wider than the Command Center's own). Point it at a TEST office,
// never someone's real one: it signs in and clicks like a person would.
//
//   node scripts/check-tab-alignment.mjs --base http://127.0.0.1:49xx --password <pw> --floor big-spike
//     [--viewports 1440x900,1280x720,390x844] [--themes default,dark,terminal,clean-light,clean-dark,portal-light,portal-dark]
//     [--shots <dir>] [--json <file>] [--chrome <chrome.exe>]
//
// In a Portal theme there's no tab row: the left navigation (ui/portal/nav.ts) opens each page and the page
// header (#pt-head) and the band under it (.pt-band: the floor's line and the progress bar) come first, so
// it checks those instead: the header's top, the content's left edge and the navigation's box are the same
// on every page, and no page leaves an empty gap between the band and its content wider than the
// Overview's (the content must not jump between pages). The Firm's banner is on the Audit log page.
//
// It also shows the "someone's waiting on another floor" line (#elsewhere) on the Board, the way the page
// does when another floor waits on someone, and checks the tab bar doesn't move for it either.
//
// What it caught: on a desktop window only the Command Center took the Firm's banner out of the flow onto
// the floor's line (ui/command-layout.css, ui/budget/budget.css), so every other tab dropped its tab bar
// and content by the banner's height (about 40 px), and #elsewhere, hidden on the Command Center only,
// sat above the tabs and dropped them further on the others.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const base = arg('base', 'http://127.0.0.1:4931');
const password = arg('password');
const floor = arg('floor');
const shots = arg('shots');
const jsonOut = arg('json');
const viewports = arg('viewports', '1440x900,1280x720,390x844')
  .split(',')
  .map((s) => s.split('x').map(Number))
  .map(([width, height]) => ({ width, height }));
const themes = arg('themes', 'default,dark,terminal,clean-light,clean-dark,portal-light,portal-dark').split(',');
const TABS = ['command', 'board', 'workers', 'analysis', 'live', 'git', 'model', 'org', 'standup', 'approvals', 'settings', 'teams', 'budget', 'audit', 'tests'];
const TOL = 1;
if (!floor) {
  console.error('usage: node scripts/check-tab-alignment.mjs --base <url> --password <pw> --floor <id>');
  process.exit(2);
}

/** In the page: the tab bar's box (in Portal, the page header's) and the first box the tab shows below it. */
const MEASURE = () => {
  const main = document.querySelector('.lite-main');
  const portal = document.documentElement.dataset.theme.startsWith('portal');
  const bar = portal ? document.getElementById('pt-head') : document.querySelector('.lite-tabs');
  const r = bar.getBoundingClientRect();
  // In Portal the band under the header (the floor's line and the progress bar) ends what's above the content.
  const band = portal ? main.querySelector(':scope > .pt-band') : null;
  const end = band && band.getBoundingClientRect().height ? band : bar;
  const from = [...main.children].indexOf(end);
  const after = [...main.children].slice(from + 1).flatMap((el) => (getComputedStyle(el).display === 'contents' ? [...el.children] : [el]));
  const nav = portal ? document.getElementById('pt-nav')?.getBoundingClientRect() : null;
  let first = null;
  for (const el of after) {
    const b = el.getBoundingClientRect();
    if (el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || b.height < 1) continue;
    first = { id: el.id, top: Math.round(b.top + scrollY) };
    break;
  }
  const scrolls = document.documentElement.scrollHeight > innerHeight + 1;
  const below = Math.round(end.getBoundingClientRect().bottom + scrollY);
  return { barTop: Math.round(r.top + scrollY), barBottom: below, left: Math.round(r.left), nav: nav && `${Math.round(nav.left)},${Math.round(nav.top)},${Math.round(nav.width)}`, first, gap: first ? first.top - below : null, scrolls };
};

const browser = await chromium.launch({ headless: true, executablePath: arg('chrome') });
const results = [];
const failures = [];
try {
  for (const vp of viewports) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: vp });
      await ctx.addInitScript((t) => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Check', color: '#00a6a6', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', t);
        localStorage.setItem('agent-office.pmc-view', 'chat');
      }, theme);
      if (password) await ctx.request.post(`${base}/api/login`, { data: { password } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log('page error:', e.message));
      await page.goto(`${base}/lite?floor=${encodeURIComponent(floor)}&tab=command`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction(() => !window.__aoBoot?.shown?.() && !!document.querySelector('#summary .pmc'), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const row = { viewport: `${vp.width}x${vp.height}`, theme, tabs: {} };
      for (const t of TABS) {
        if (t === 'tests') {
          await page.goto(`${base}/lite?floor=${encodeURIComponent(floor)}&tab=tests`, { waitUntil: 'load' });
          await page.waitForFunction(() => !window.__aoBoot?.shown?.(), null, { timeout: 30000 }).catch(() => {});
        } else if (theme.startsWith('portal')) await page.evaluate((id) => document.querySelector(`.pt-nav [data-nav="${id}"]`).click(), t);
        else await page.click(`#tab-${t}`);
        await page.waitForTimeout(700);
        await page.evaluate(() => scrollTo(0, 0));
        row.tabs[t] = await page.evaluate(MEASURE);
        if (shots) {
          fs.mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: path.join(shots, `${vp.width}x${vp.height}-${theme}-${t}.png`) });
        }
      }
      // The other floors' waiting line, as shared/floors.ts draws it, on the Board.
      await page.goto(`${base}/lite?floor=${encodeURIComponent(floor)}&tab=board`, { waitUntil: 'load' });
      await page.waitForFunction(() => !window.__aoBoot?.shown?.(), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(700);
      row.tabs['board+elsewhere'] = await page.evaluate((measure) => {
        const box = document.getElementById('elsewhere');
        box.classList.remove('hidden');
        box.innerHTML = '<button class="btn lite-go" type="button">🙋 2 waiting on Another floor <span aria-hidden="true">→</span></button>';
        return new Function(`return (${measure})()`)();
      }, MEASURE.toString());
      const cc = row.tabs.command;
      for (const [t, m] of Object.entries(row.tabs)) {
        if (t === 'command') continue;
        const where = `${row.viewport} ${theme} ${t}`;
        if (Math.abs(m.barTop - cc.barTop) > TOL) failures.push(`${where}: the tab bar's top is ${m.barTop} px, the Command Center's ${cc.barTop} px`);
        if (m.left !== cc.left) failures.push(`${where}: the content starts ${m.left} px from the left, the Overview's ${cc.left} px`);
        if (m.nav !== cc.nav) failures.push(`${where}: the navigation is at ${m.nav}, on the Overview at ${cc.nav}`);
        if (t !== 'board+elsewhere' && m.gap != null && cc.gap != null && m.gap > cc.gap + TOL) failures.push(`${where}: ${m.gap} px of empty band above the content (#${m.first.id}), the Command Center has ${cc.gap} px`);
      }
      results.push(row);
      console.log(`${row.viewport} ${theme}: ${Object.entries(row.tabs).map(([t, m]) => `${t} ${m.barTop}/${m.gap}`).join(', ')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close().catch(() => {});
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log(`ok: the tab bar and the content start at the same height on all ${TABS.length} tabs (${viewports.length} sizes × ${themes.length} themes)`);
