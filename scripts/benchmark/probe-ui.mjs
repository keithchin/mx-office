// Discovery probe (benchmark E3): drives a running Mendix app with playwright-core as several test
// identities and prints what each one sees. Not a verifier: it shows the access path works.
//
//   node scripts/benchmark/probe-ui.mjs --url http://127.0.0.1:8210 [--user emp.alice] [--shots <dir>]
//
// Password comes from BENCH_PASSWORD (the baseline's test identities all share one).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const base = arg('url', 'http://127.0.0.1:8210').replace(/\/$/, '');
const users = (arg('user', 'emp.alice,mgr.maria,admin.ada')).split(',');
const shots = arg('shots');
const password = process.env.BENCH_PASSWORD ?? 'Bench-Passw0rd-2026';

/** Logs in through the app's own login page (login.html: #usernameInput, #passwordInput, #loginButton). */
async function login(page, user) {
  await page.goto(`${base}/login.html`);
  await page.fill('#usernameInput', user);
  await page.fill('#passwordInput', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('login.html'), { timeout: 30_000 }), page.click('#loginButton')]);
  // The React client is up once its root has content.
  await page.waitForSelector('.mx-page, .mx-placeholder', { timeout: 60_000 });
}

/** The visible rows of the first data grid on the page, as arrays of cell texts. */
async function gridRows(page) {
  await page.waitForSelector('.widget-datagrid, .mx-datagrid', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  return page.$$eval('.widget-datagrid .tr[role="row"], .widget-datagrid [role="row"]', (rows) =>
    rows.map((r) => [...r.querySelectorAll('[role="gridcell"], .td')].map((c) => c.textContent.trim())).filter((cells) => cells.length && cells.some(Boolean)),
  );
}

const t0 = Date.now();
const browser = await chromium.launch({ headless: true });
try {
  // Anonymous: pages behind login must not render data.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto(`${base}/p/directory`);
    await page.waitForTimeout(3000);
    console.log(JSON.stringify({ user: 'anonymous', page: '/p/directory', http: res?.status(), url: page.url(), rows: (await gridRows(page)).length }));
    await ctx.close();
  }
  for (const user of users) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    const t = Date.now();
    await login(page, user);
    const loginMs = Date.now() - t;
    // What the client exposes to a script running as this user: the session's roles, and whether the
    // legacy mx.data API (arbitrary XPath) is there at all.
    const client = await page.evaluate(() => {
      const mx = globalThis.mx;
      return {
        hasMx: !!mx,
        hasMxData: !!mx?.data,
        hasMxDataGet: typeof mx?.data?.get === 'function',
        userName: mx?.session?.getUserName?.() ?? null,
        roles: mx?.session?.getUserRoleNames?.() ?? null,
      };
    });
    const out = { user, loginMs, client };
    for (const p of ['/p/directory', '/p/notices']) {
      await page.goto(`${base}${p}`);
      await page.waitForTimeout(2000);
      const title = await page.$eval('.mx-page h1, .mx-page .mx-title, h1', (e) => e.textContent.trim()).catch(() => null);
      out[p] = { title, rows: await gridRows(page) };
      if (shots) {
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, `${user}${p.replace(/\//g, '_')}.png`) });
      }
    }
    // A raw XPath retrieve from the browser, as a malicious script could try (legacy client API).
    out.xpathProbe = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const mx = globalThis.mx;
          if (!mx?.data?.get) return resolve({ available: false });
          try {
            mx.data.get({
              xpath: '//HR.Employee',
              callback: (objs) => resolve({ available: true, count: objs.length }),
              error: (e) => resolve({ available: true, error: String(e?.message ?? e) }),
            });
          } catch (e) {
            resolve({ available: true, threw: String(e?.message ?? e) });
          }
          setTimeout(() => resolve({ available: true, timeout: true }), 10_000);
        }),
    );
    out.consoleErrors = consoleErrors.slice(0, 5);
    console.log(JSON.stringify(out));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ totalMs: Date.now() - t0 }));
