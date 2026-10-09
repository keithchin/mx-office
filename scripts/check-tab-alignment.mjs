#!/usr/bin/env node
// Checks that the 1D view's tab bar and each tab's content start at the same height on every tab as on
// the Command Center: opens /lite?floor=<floor> in headless Chromium, clicks through the tabs and
// measures, per tab, the tab bar's top and the gap between the tab bar's bottom and the first thing the
// tab shows. Fails when a tab's bar sits more than 1 px off the Command Center's, or when a tab leaves an
// empty band above its content (a gap wider than the Command Center's own). Point it at a TEST office,
// never someone's real one: it signs in and clicks like a person would.
//
//   node scripts/check-tab-alignment.mjs --base http://127.0.0.1:49xx --password <pw> --floor big-spike
//     [--viewports 1440x900,1280x720,390x844] [--themes default,dark,terminal,clean-light,clean-dark]
//     [--shots <dir>] [--json <file>] [--chrome <chrome.exe>]
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
const themes = arg('themes', 'default,dark,terminal,clean-light,clean-dark').split(',');
const TABS = ['command', 'board', 'workers', 'analysis', 'live', 'git', 'model', 'org', 'standup', 'approvals', 'settings', 'teams', 'budget', 'audit', 'tests'];
const TOL = 1;
if (!floor) {
  console.error('usage: node scripts/check-tab-alignment.mjs --base <url> --password <pw> --floor <id>');
  process.exit(2);
}

/** In the page: the tab bar's box and the first box the tab shows below it. */
const MEASURE = () => {
  const main = document.querySelector('.lite-main');
  const bar = document.querySelector('.lite-tabs');
  const r = bar.getBoundingClientRect();
  const after = [...main.children].slice([...main.children].indexOf(bar) + 1);
  let first = null;
  for (const el of after) {
    const b = el.getBoundingClientRect();
    if (el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || b.height < 1) continue;
    first = { id: el.id, top: Math.round(b.top + scrollY) };
    break;
  }
  const scrolls = document.documentElement.scrollHeight > innerHeight + 1;
  return { barTop: Math.round(r.top + scrollY), barBottom: Math.round(r.bottom + scrollY), first, gap: first ? first.top - Math.round(r.bottom + scrollY) : null, scrolls };
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
        } else await page.click(`#tab-${t}`);
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
