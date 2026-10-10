#!/usr/bin/env node
// Checks that the 🎨's list of themes (ui/colortheme.ts) opens as a popover on every page that has it:
// opens each page in headless Chromium, per theme and window width, and checks the list is hidden at
// first, opens under the 🎨 as an overlay (position fixed, the top bar's height unchanged, inside the
// window), and closes on Esc and on a click elsewhere. Point it at a TEST office, never someone's real one.
//
//   node scripts/check-theme-menu.mjs --base http://127.0.0.1:49xx --password <pw> --floor <id>
//     [--viewports 1440x900,390x844] [--themes portal-light,portal-dark,clean-light,default,terminal]
//     [--shots <dir>] [--chrome <chrome.exe>]
//
// What it caught: the list's rules went with the old view dropdown (the 3D removal), so the list opened
// inline inside the top bar, stretching the Portal bar from 44 px to 235 px.

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
if (!floor) {
  console.error('usage: node scripts/check-theme-menu.mjs --base <url> --password <pw> --floor <id>');
  process.exit(2);
}
const viewports = arg('viewports', '1440x900,390x844')
  .split(',')
  .map((s) => s.split('x').map(Number))
  .map(([width, height]) => ({ width, height }));
const themes = arg('themes', 'portal-light,portal-dark,clean-light,default,terminal').split(',');
const ALL = { home: '/home', lite: `/lite?floor=${encodeURIComponent(floor)}`, pixel: `/pixel?floor=${encodeURIComponent(floor)}`, firm: '/firm', docs: '/docs', setup: '/setup' };

const PAGES = Object.fromEntries(Object.entries(ALL).filter(([k]) => !arg('pages') || arg('pages').split(',').includes(k)));

/** In the page: the list's and the 🎨's state, and the height of the bar the 🎨 sits in. */
const MEASURE = () => {
  const list = document.getElementById('theme-list');
  const btn = document.querySelector('[aria-controls="theme-list"]');
  if (!list || !btn) return null;
  const c = getComputedStyle(list);
  const r = list.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  return {
    shown: c.display !== 'none' && !list.hidden,
    position: c.position,
    list: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) },
    button: { bottom: Math.round(b.bottom), right: Math.round(b.right) },
    expanded: btn.getAttribute('aria-expanded'),
    bar: Math.round(btn.parentElement.getBoundingClientRect().height),
    width: document.documentElement.clientWidth,
  };
};

const browser = await chromium.launch({ headless: true, executablePath: arg('chrome') });
const failures = [];
let checked = 0;
try {
  for (const vp of viewports) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: vp });
      // A profile, as someone who's been here before has (else the page asks for a name first).
      await ctx.addInitScript((t) => {
        localStorage.setItem('agent-office.color-theme', t);
        if (!localStorage.getItem('agent-office.profile')) localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex', color: '#0b6bcb', skin: 0, hair: 0, style: 0 }));
      }, theme);
      if (password) await ctx.request.post(`${base}/api/login`, { data: { password } });
      const page = await ctx.newPage();
      for (const [name, url] of Object.entries(PAGES)) {
        const at = `${name} ${theme} ${vp.width}x${vp.height}`;
        const fail = (why) => failures.push(`${at}: ${why}`);
        const t0 = Date.now();
        await page.goto(base + url, { waitUntil: 'load' });
        await page.waitForSelector('[aria-controls="theme-list"]', { timeout: 30000 }).catch(() => {});
        // The loading screen gone (it sits over the bar while a project loads).
        await page.waitForFunction(() => !window.__aoBoot?.shown?.() && !document.querySelector('#ao-boot:not([hidden])')?.checkVisibility?.(), null, { timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(800);
        const closed = await page.evaluate(MEASURE);
        if (!closed) {
          fail('no 🎨 list on the page');
          continue;
        }
        checked++;
        if (process.argv.includes('--verbose')) console.log(`${at}: ready in ${Date.now() - t0} ms`);
        if (closed.shown) fail('the list shows before the 🎨 is clicked');
        try {
          await page.click('[aria-controls="theme-list"]', { timeout: 15000 });
        } catch (e) {
          fail(`the 🎨 can't be clicked (${String(e?.message ?? e).split('\n')[0]})`);
          continue;
        }
        await page.waitForTimeout(250);
        const open = await page.evaluate(MEASURE);
        if (!open.shown) fail('the 🎨 does not open the list');
        if (open.position !== 'fixed') fail(`the list is position: ${open.position}, not an overlay`);
        if (open.bar !== closed.bar) fail(`the bar grew from ${closed.bar} to ${open.bar} px when the list opened`);
        if (open.expanded !== 'true') fail('aria-expanded is not true while open');
        if (open.list.top < open.button.bottom) fail('the list is not under the 🎨');
        if (open.list.left < 0 || open.list.right > open.width) fail(`the list leaves the window (${open.list.left}..${open.list.right} of ${open.width})`);
        if (shots) {
          fs.mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: path.join(shots, `theme-menu-${name}-${theme}-${vp.width}.png`) });
        }
        await page.keyboard.press('Escape');
        if ((await page.evaluate(MEASURE)).shown) fail('Esc does not close the list');
        await page.click('[aria-controls="theme-list"]');
        // A press on the page outside the list and the 🎨 (dispatched, so nothing under it is clicked).
        await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
        if ((await page.evaluate(MEASURE)).shown) fail('a click elsewhere does not close the list');
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`check-theme-menu: ${checked} page×theme×size checked, ${failures.length} failure(s)`);
for (const f of failures) console.log(`  ✖ ${f}`);
if (failures.length) process.exit(1);
