#!/usr/bin/env node
// Checks that the Portal top bar stays at the top while you scroll, and that the left navigation's own scroll
// doesn't scroll the page: on each Portal page (the 1D view's Overview and Board, the 2D Office view, Home,
// The Firm, the docs, setup), in Portal Light and Dark at 1440x900 and 390x844 (the navigation as a drawer),
// it wheels over the navigation to its end and past it, then over the page, and fails when the page moved
// for the navigation's wheel or the bar left the top. Point it at a TEST office, never someone's real one.
//
//   node scripts/check-portal-scroll.mjs --base http://127.0.0.1:49xx --password <pw> --floor <id> [--shots <dir>] [--chrome <exe>]

import fs from 'node:fs';
import { chromium } from 'playwright-core';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const base = arg('base', 'http://127.0.0.1:4931');
const password = arg('password');
const F = arg('floor');
const out = arg('shots');
const tag = arg('tag', 'scroll');
if (!F) {
  console.error('usage: node scripts/check-portal-scroll.mjs --base <url> --password <pw> --floor <id>');
  process.exit(2);
}
if (out) fs.mkdirSync(out, { recursive: true });
const pages = { lite: `/lite?floor=${F}&tab=command`, board: `/lite?floor=${F}&tab=board`, pixel: `/pixel?floor=${F}`, home: '/home', firm: '/firm', docs: '/docs', setup: '/setup' };
const browser = await chromium.launch({ headless: true, executablePath: arg('chrome') });
const fails = [];
for (const theme of ['portal-light', 'portal-dark']) for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((t) => { localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex', color: '#0b6bcb', skin: 0, hair: 0, style: 0 })); localStorage.setItem('agent-office.color-theme', t); }, theme);
  await ctx.request.post(`${base}/api/login`, { data: { password } });
  const page = await ctx.newPage();
  for (const [name, url] of Object.entries(pages)) {
    await page.goto(base + url, { waitUntil: 'load' });
    await page.waitForFunction(() => !window.__aoBoot?.shown?.(), null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const at = `${name} ${theme} ${w}`;
    const state = () => page.evaluate(() => {
      const bar = document.querySelector('header.lite-bar, .dx-bar');
      const b = bar?.getBoundingClientRect();
      const nav = document.getElementById('pt-nav');
      const n = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      const navIn = nav?.querySelector('.pt-nav-in');
      return { barTop: b ? Math.round(b.top) : null, barBottom: b ? Math.round(b.bottom) : null, barPos: bar ? getComputedStyle(bar).position : null, sy: Math.round(scrollY), navTop: n ? Math.round(n.top) : null, navW: n ? Math.round(n.width) : 0, navScroll: navIn ? Math.round(navIn.scrollTop) : null, navScrollable: navIn ? navIn.scrollHeight > navIn.clientHeight : false, docH: document.documentElement.scrollHeight };
    });
    const s0 = await state();
    // On a phone, open the drawer first.
    if (w < 761) { const b = await page.$('.pt-navbtn'); if (b && await b.isVisible()) { await b.click(); await page.waitForTimeout(400); } }
    const s1 = await state();
    let sNav = null;
    if (s1.navW) {
      await page.mouse.move(Math.min(100, s1.navW / 2), Math.max(s1.navTop + 200, 300));
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(60); }
      await page.waitForTimeout(300);
      sNav = await state();
      if (sNav.sy !== s1.sy) fails.push(`${at}: scrolling the nav pane scrolled the page (${s1.sy} -> ${sNav.sy})`);
      if (sNav.barTop !== 0) fails.push(`${at}: bar top ${sNav.barTop} after scrolling the nav`);
      if (out) await page.screenshot({ path: `${out}/${tag}-${name}-${theme}-${w}-nav-scrolled.png` });
    }
    if (w < 761) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    await page.mouse.move(w - 40, h - 120);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(60); }
    await page.waitForTimeout(300);
    const sPage = await state();
    if (sPage.barTop !== null && sPage.barTop !== 0) fails.push(`${at}: bar top ${sPage.barTop} after scrolling the page (scrollY ${sPage.sy})`);
    console.log(`${at.padEnd(26)} bar ${sPage.barPos}, top ${sPage.barTop} after the page scrolled to ${sPage.sy}${sNav ? `; after the navigation: page at ${sNav.sy}, bar top ${sNav.barTop}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`check-portal-scroll: ${fails.length} failure(s)`);
for (const f of fails) console.log(`  ✖ ${f}`);
if (fails.length) process.exit(1);
