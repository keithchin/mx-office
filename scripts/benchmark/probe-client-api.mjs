// Discovery probe (benchmark E3): what a logged-in user can do through the Mendix client API from
// a browser session (mx.data.*), i.e. "direct data/API access" without the app's UI. The runtime
// must enforce entity access and microflow access here, which is what the C3/C4/C5 negative tests
// rely on. Prints one JSON line per user.
//
//   node scripts/benchmark/probe-client-api.mjs --url http://127.0.0.1:8210 --user emp.alice
import { chromium } from 'playwright-core';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const base = arg('url', 'http://127.0.0.1:8210').replace(/\/$/, '');
const users = arg('user', 'emp.alice,admin.ada').split(',');
const password = process.env.BENCH_PASSWORD ?? 'Bench-Passw0rd-2026';

async function login(page, user) {
  await page.goto(`${base}/login.html`);
  await page.fill('#usernameInput', user);
  await page.fill('#passwordInput', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('login.html'), { timeout: 30_000 }), page.click('#loginButton')]);
  await page.waitForSelector('.mx-page, .mx-placeholder', { timeout: 60_000 });
}

/** Runs in the page: every probe is a promise that resolves to a plain result, never rejects. */
const PROBES = () => {
  const mx = globalThis.mx;
  const settle = (fn) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timeout: true }), 10_000);
      const done = (v) => {
        clearTimeout(timer);
        resolve(v);
      };
      try {
        fn(done);
      } catch (e) {
        done({ threw: String(e?.message ?? e) });
      }
    });
  const get = (xpath) =>
    settle((done) =>
      mx.data.get({ xpath, callback: (objs) => done({ count: objs.length, guids: objs.slice(0, 3).map((o) => o.getGuid()) }), error: (e) => done({ error: String(e?.message ?? e) }) }),
    );
  const action = (actionname) =>
    settle((done) => mx.data.action({ params: { actionname }, callback: (r) => done({ ok: true, result: String(r) }), error: (e) => done({ error: String(e?.message ?? e) }) }));
  const create = (entity, attrs) =>
    settle((done) =>
      mx.data.create({
        entity,
        callback: (obj) => {
          for (const [k, v] of Object.entries(attrs)) obj.set(k, v);
          mx.data.commit({ mxobj: obj, callback: () => done({ committed: true, guid: obj.getGuid() }), error: (e) => done({ createdButCommitFailed: String(e?.message ?? e) }) });
        },
        error: (e) => done({ error: String(e?.message ?? e) }),
      }),
    );
  return Promise.all([
    get('//HR.Employee'),
    get('//Administration.Account'),
    get('//System.UserRole'),
    get('//Notices.Notice'),
    action('HR.ASu_SeedBaseline'),
    create('Notices.Notice', { Title: 'probe notice from client API' }),
  ]).then(([employees, accounts, userRoles, notices, startupMf, noticeCreate]) => ({ employees, accounts, userRoles, notices, startupMf, noticeCreate }));
};

const browser = await chromium.launch({ headless: true });
try {
  for (const user of users) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, user);
    const result = await page.evaluate(PROBES);
    console.log(JSON.stringify({ user, ...result }));
    await ctx.close();
  }
} finally {
  await browser.close();
}
