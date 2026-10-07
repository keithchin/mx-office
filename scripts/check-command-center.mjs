#!/usr/bin/env node
// Checks that the 1D Command Center stays responsive on a floor: opens /lite?floor=<floor>&tab=command
// in headless Chromium, keeps asking the page for a trivial answer for a while, and fails when the page
// stops answering (a hang: one synchronous task that never ends) or any task runs longer than 2 s. Point
// it at a TEST office, never someone's real one: it signs in and watches like a person would.
//
//   node scripts/check-command-center.mjs --base http://localhost:4931 --password test-only-123 --floor mx-spike
//     [--seconds 12] [--chrome <chrome.exe>] [--view chat|terminal]
//
// Release 15's freeze (the PM console's terminal drawn while hidden, ui/pm/term-park.ts) showed only with
// the floor's Project Coordinator live: wake the floor's workers first (with a fake --agent) to cover it.

import { chromium } from 'playwright-core';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const base = arg('base', 'http://localhost:4931');
const password = arg('password');
const floor = arg('floor');
const seconds = Number(arg('seconds', '12'));
const view = arg('view');
const LONG_MS = 2000;
const HANG_MS = 4000;
if (!floor) {
  console.error('usage: node scripts/check-command-center.mjs --base <url> --password <pw> --floor <id>');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true, executablePath: arg('chrome') });
const killer = setTimeout(() => {
  console.error('FAIL: the check itself timed out');
  process.exit(1);
}, (seconds + 60) * 1000);
let failed = '';
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((v) => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Check', color: '#00a6a6', skin: 0, hair: 0, style: 0 }));
    if (v) localStorage.setItem('agent-office.pmc-view', v);
    window.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: true });
  }, view);
  if (password) await ctx.request.post(`${base}/api/login`, { data: { password } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  const t0 = Date.now();
  await page.goto(`${base}/lite?floor=${encodeURIComponent(floor)}&tab=command`, { waitUntil: 'commit', timeout: 20000 });
  while (Date.now() - t0 < seconds * 1000) {
    const r = await Promise.race([page.evaluate(() => 'ok'), new Promise((res) => setTimeout(() => res('hang'), HANG_MS))]);
    if (r === 'hang') {
      failed = `the page stopped answering for ${HANG_MS} ms, ${Date.now() - t0} ms after opening`;
      break;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (!failed) {
    const long = await page.evaluate(() => window.__long);
    const worst = Math.max(0, ...long);
    console.log(`long tasks (ms): ${long.join(', ') || 'none'}`);
    if (worst > LONG_MS) failed = `a task ran ${worst} ms (over ${LONG_MS})`;
    else if (!(await page.$('#summary .pmc'))) failed = 'the Command Center never drew its console';
  }
} finally {
  clearTimeout(killer);
  await browser.close().catch(() => {});
}
if (failed) {
  console.error(`FAIL: ${failed}`);
  process.exit(1);
}
console.log(`ok: ${floor}'s Command Center stayed responsive for ${seconds} s`);
