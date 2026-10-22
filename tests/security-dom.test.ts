// The 🔐 Security page (src/client/ui/security/), in headless Chromium with every client stylesheet: a tab of
// App Insights; the app's security as read at main (level, strict mode, demo users, anonymous access,
// password length, entities without access rules) with the commit and how it was read; "Not read yet" when
// nothing was; the last mx check with its commit (and that it isn't main's head when it isn't); the baseline
// with each gate's "Would be refused" and what's missing, or "Meets the baseline"; Run mx check and the
// policy's editor for admins only, posting what they say. Never the word "secure" as a claim.
// SECURITY_SHOTS=<folder> also saves screenshots of the card and a blocked gate there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { judgeGate, DEFAULT_POLICY, type SecurityView } from '../src/shared/security.js';
import { navGroups } from '../src/client/ui/portal/nav-logic.js';
import { registeredTab } from '../src/client/tabs/registry.js';
import '../src/client/tabs/index.js';

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

const MAIN = '4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345';
const OLD = '9a8b7c6d5e4f30211203948576a5b4c3d2e1f0aa';
const now = Date.now();
const STATE = { commit: MAIN, readAt: now - 120_000, source: 'model' as const, level: 'off' as const, strict: false, demoUsers: { enabled: true, count: 2 }, guest: { enabled: false }, passwordMinLength: 8, userRoles: 2, entities: { total: 5, withoutRules: 2, sample: ['Orders.Order', 'Orders.Line'] } };
const CHECK = { commit: OLD, at: now - 3_600_000, status: 'fail' as const, errors: 6, warnings: 1, codes: [{ code: 'CE2729', count: 6 }], first: ['[error] [CE2729] "The demo user \'demo_x\' has no user roles." at Demo user \'demo_x\''], ms: 84_000, tool: 'C:\\Program Files\\Mendix\\11.12.4\\modeler\\mx · mxcli nightly-test', by: 'Pat' };
const BLOCKED: SecurityView = {
  floor: 'demo',
  admin: true,
  policy: DEFAULT_POLICY,
  main: { branch: 'main', commit: MAIN },
  state: STATE,
  check: CHECK,
  gates: { build: judgeGate(DEFAULT_POLICY, 'build', MAIN, STATE, undefined), release: judgeGate(DEFAULT_POLICY, 'release', MAIN, STATE, undefined) },
};
const GOOD_STATE = { ...STATE, level: 'production' as const, strict: true, demoUsers: { enabled: false, count: 2 }, entities: { total: 5, withoutRules: 0, sample: [] } };
const GOOD_CHECK = { ...CHECK, commit: MAIN, status: 'pass' as const, errors: 0, codes: [], first: [], at: now - 60_000 };
const MET: SecurityView = { ...BLOCKED, state: GOOD_STATE, check: GOOD_CHECK, gates: { build: judgeGate(DEFAULT_POLICY, 'build', MAIN, GOOD_STATE, GOOD_CHECK), release: judgeGate(DEFAULT_POLICY, 'release', MAIN, GOOD_STATE, GOOD_CHECK) } };
const UNREAD: SecurityView = { floor: 'demo', admin: false, policy: DEFAULT_POLICY, main: { branch: 'main', commit: MAIN }, gates: { build: judgeGate(DEFAULT_POLICY, 'build', MAIN, undefined, undefined), release: judgeGate(DEFAULT_POLICY, 'release', MAIN, undefined, undefined) } };

test('the page is a tab of App Insights, nothing of it in lite.ts', () => {
  const t = registeredTab('security');
  assert.ok(t);
  assert.equal(t.group, 'insights');
  assert.equal(t.label, 'Security');
  assert.ok(navGroups().find((g) => g.id === 'insights')!.items.some((i) => i.id === 'security'));
  assert.doesNotMatch(read('src/client/lite.ts'), /security-gate|ui\/security/);
});

const chrome = findChrome();
test('in a browser: what was read, the last mx check with its commit, the gates blocked and met, admin actions', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: { contents: `import { securityPage } from './page'; window.T = { page: securityPage(document.getElementById('host'), () => window.FLOOR) };`, resolveDir: path.join(root, 'src/client/ui/security'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const css = sheets('src/client')
    .filter((f) => !/login\.css$|[\\/]mobile[\\/]|[\\/]first-run[\\/]/.test(f))
    .map((f) => read(f).replace(/@import[^;]+;/g, ''))
    .join('\n');
  const shots = process.env.SECURITY_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    const posted: Record<string, unknown>[] = [];
    let view: SecurityView = BLOCKED;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://office.test/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><h2 style="margin:0 0 8px">Security</h2><div id="host"></div></main><div id="toasts"></div><script>window.FLOOR='demo'</script></body></html>` });
      if (u.pathname === '/api/security' && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(view) });
      if (u.pathname === '/api/security') {
        posted.push(JSON.parse(r.request().postData() ?? '{}'));
        return r.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://office.test/');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const T = <R>(js: string) => page.evaluate(js) as Promise<R>;
    await T(`T.page.show()`);
    await page.waitForSelector('.sec-card');
    const text = await T<string>(`document.querySelector('.secp').innerText`);
    // What was read, at which commit, how.
    assert.match(text, /App security\s+at main @4f2c9e1/);
    assert.match(text, /Security level\s+Off/);
    assert.match(text, /Strict mode\s+Off/);
    assert.match(text, /Demo users\s+On \(2 defined\)/);
    assert.match(text, /Entities without access rules\s+2 of 5 persistable \(Orders\.Order, Orders\.Line\)/);
    assert.match(text, /Read from the model's units in git at 4f2c9e1, 2m ago\. What the model says is set, not a verdict that the app is secure/);
    // The last mx check, with its commit, and that it isn't main's head.
    assert.match(text, /6 errors at @9a8b7c6 \(not main’s head @4f2c9e1: run it again for this commit\)/);
    assert.match(text, /CE2729 ×6/);
    // The gates: what's missing.
    const gates = await T<string[]>(`[...document.querySelectorAll('.sec-gate')].map((g) => g.dataset.point + ': ' + g.innerText.replace(/\\s+/g, ' '))`);
    assert.match(gates[0], /^build: Before the build Would be refused .*Missing: App security is Off at 4f2c9e1; the policy needs Production/);
    assert.match(gates[1], /^release: Build done and delivery Would be refused .*No mx check at 4f2c9e1 yet/);
    assert.match(gates[1], /Flagged: .*Demo users are on/);
    assert.doesNotMatch(text.replace(/not a verdict that the app is secure|it never says the app is secure/g, ''), /\bsecure\b/i, 'never claims secure');
    if (shots) {
      await (await page.$('.secp'))!.screenshot({ path: path.join(shots, 'security-card-blocked.png') });
      await (await page.$('.sec-baseline'))!.screenshot({ path: path.join(shots, 'blocked-gate-reasons.png') });
    }
    // Admin: Run mx check posts; the policy editor posts what it says.
    await page.click('text=Run mx check on main @4f2c9e1');
    await page.waitForTimeout(150);
    assert.deepEqual(posted.at(-1), { floor: 'demo', action: 'check' });
    await page.click('.sec-policy summary');
    await page.selectOption('.sec-policy select[aria-label="Security level policy"]', 'prototype');
    await page.fill('.sec-reason', 'a two-day spike');
    await page.click('text=Save policy');
    await page.waitForTimeout(150);
    assert.deepEqual(posted.at(-1), { floor: 'demo', action: 'policy', policy: { level: 'prototype', strict: 'recommended', enforce: true, reason: 'a two-day spike' } });
    // Met.
    view = MET;
    await T(`T.page.refresh()`);
    await page.waitForSelector('.sec-gate.meets[data-point="release"]');
    const met = await T<string>(`document.querySelector('.secp').innerText`);
    assert.match(met, /0 errors at @4f2c9e1, /);
    assert.doesNotMatch(met, /not main’s head/);
    assert.equal(await T<number>(`document.querySelectorAll('.sec-gate.meets').length`), 2);
    await T(`document.getElementById('toasts').replaceChildren()`);
    if (shots) await (await page.$('.secp'))!.screenshot({ path: path.join(shots, 'security-card-met.png') });
    // Not read yet, and a member: no actions.
    view = UNREAD;
    await T(`T.page.refresh()`);
    await page.waitForFunction(`document.querySelector('.secp').innerText.includes('Not read yet')`);
    const unread = await T<string>(`document.querySelector('.secp').innerText`);
    assert.match(unread, /App security\s+at main @4f2c9e1\s+Not read yet\./);
    assert.match(unread, /Not run yet on this project/);
    assert.match(unread, /App security not read at 4f2c9e1 yet/);
    assert.equal(await T<number>(`document.querySelectorAll('.sec-policy, .sec-actions button').length`), 0, 'members see no actions');
    // Phone width: no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 800 });
    view = BLOCKED;
    await T(`T.page.refresh()`);
    await page.waitForSelector('.sec-gate');
    assert.ok(await T<boolean>(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal scroll at phone width');
    if (shots) await (await page.$('.secp'))!.screenshot({ path: path.join(shots, 'security-card-phone.png') });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
