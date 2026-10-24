// Developer changes (the Developer view's first useful release, part 1) in a real, throwaway TEST office: the
// performance guard's fixture at scale 1 (fake agents only, test mode, no GitHub: GH tokens removed and an empty
// GH_CONFIG_DIR, no Claude), plus, when --project names one, a local copy of a realistic Mendix project added as a
// project of its own (no team, its runtime never started). Checks end to end and takes Portal Light, Dark and
// phone screenshots:
//
//   - Request a change gives DC-n: handed to the lead (with a team at work) or Queued, saying why (no team)
//   - a retry with the same idempotency key gives back the same change
//   - the revision strip: main @M, the preview not running, the active change's candidate
//   - Cancel on a queued change (two clicks); Approvals shows the same record
//   - the queue survives an office restart
//
//   npm run build && node scripts/dev-changes-shots.mjs [--project <a Mendix project's git folder>] [--out <shots dir>]
//
// The root is fixed under scratch/test-offices (the start clears what an earlier run left there, its processes
// included, matched by their command line), so it is never on this script's own command line.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.join(REPO, '..', '..', 'scratch', 'test-offices', 'dev-changes-shots');
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'dev-changes-shots')));
const source = arg('--project');
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

async function main() {
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  fs.mkdirSync(out, { recursive: true });
  const made = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/perf/fixture.ts', '--out', root, '--scale', '1', '--seed', '42', '--base', new Date().toISOString()], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (made.status !== 0) throw new Error(`fixture: ${made.stderr || made.stdout}`);
  const home = path.join(root, 'office');
  const floorsFile = path.join(home, '.agent-office', 'floors.json');
  const floors = JSON.parse(fs.readFileSync(floorsFile, 'utf8'));
  const floor = floors[0].id;
  let copy;
  if (source) {
    // A local copy of the realistic project (its own folder: the source is never touched), main = what it serves.
    const dir = path.join(root, 'floors', 'realistic');
    const c = git(['-c', 'core.longpaths=true', 'clone', '--quiet', '--no-hardlinks', source, dir], root);
    if (c.status !== 0) throw new Error(`clone: ${c.stderr}`);
    copy = { id: 'realistic-copy', name: 'Line check app (copy)', dir };
    floors.push({ ...copy, palette: floors.length, addedBy: 'the office', addedAt: Date.now() - 86_400_000 });
    fs.writeFileSync(floorsFile, JSON.stringify(floors));
  }
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  let office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_RATE_MS: '800' } });
  log('test office up at', office.base, 'projects', floors.map((f) => f.id).join(', '));
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    let cookie = await login(office.base);
    const newPage = async (viewport) => {
      const u = new URL(office.base);
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await ctx.addCookies(cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' })));
      await ctx.addInitScript(() => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', 'portal-light');
      });
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || page.errors.push(e.message));
      return page;
    };
    const both = async (page, name, full = false) => {
      // The toasts said their piece already: they'd cover the strip.
      await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
      for (const t of ['portal-light', 'portal-dark']) {
        await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, `${name}-${t.replace('portal-', '')}.png`), fullPage: full });
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    };
    const api = (page, f) => page.evaluate(async (x) => (await fetch(`/api/dev-changes?floor=${encodeURIComponent(x)}`)).json(), f);
    const post = (page, body) => page.evaluate(async (b) => {
      const r = await fetch('/api/change-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() };
    }, body);
    const ask = async (page, text) => {
      await page.click('[data-part="request"] .aw-ask');
      await page.waitForSelector('.aw-reqdlg');
      await page.fill('.aw-reqtext', text);
      await page.click('.aw-reqsend');
      await page.waitForFunction(() => !document.querySelector('.aw-reqdlg') || /\S/.test(document.querySelector('.aw-reqdlg [role="alert"]')?.textContent ?? ''), null, { timeout: 30000 });
      const err = await page.evaluate(() => document.querySelector('.aw-reqdlg [role="alert"]')?.textContent ?? null);
      if (err) await page.keyboard.press('Escape');
      return err;
    };

    // ---- the fixture project: a team at work (fake agents) ----
    const page = await newPage({ width: 1440, height: 900 });
    const base = (f) => `${office.base}/lite?floor=${encodeURIComponent(f)}`;
    await page.goto(`${base(floor)}&ws=app`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.aw:not([hidden]) .dc-strip [data-chip="main"]', { timeout: 30000 });
    const strip0 = await page.textContent('.aw-strip');
    check(/main @[0-9a-f]{7}/.test(strip0) && /preview: not running/.test(strip0), `the strip: ${strip0}`);
    const err1 = await ask(page, 'Show the host’s name on the printed badge, next to the visitor’s name.');
    check(!err1, `Request a change is kept${err1 ? `: ${err1}` : ''}`);
    let v = await api(page, floor);
    const first = v.changes[0];
    check(first?.id === 'DC-1' && ['with-team', 'queued'].includes(first.state), `DC-1: ${first?.words} — ${first?.detail}`);
    if (first?.queue === 'active') check(/^CR-\d+$/.test(first.requestId) && /^tsk_/.test(first.taskId), `handed to ${first.member} as ${first.requestId} (${first.taskId}), branch ${first.branch}`);
    const err2 = await ask(page, 'And print the visit date in the corner of the badge.');
    check(!err2, 'a second request is kept too');
    v = await api(page, floor);
    const second = v.changes.find((c) => c.id === 'DC-2');
    check(second?.state === 'queued', `DC-2 queued behind: ${second?.detail}`);
    await page.waitForTimeout(800);
    await both(page, 'dc-10-app-panel');
    // Idempotent retry.
    const key = 'smoke-key-0001';
    const r1 = await post(page, { floor, text: 'Make the badge print button bigger', key });
    const r2 = await post(page, { floor, text: 'Make the badge print button bigger', key });
    check(r1.body.change?.id && r1.body.change.id === r2.body.change?.id && r2.body.again === true, `same key, same change: ${r1.body.change?.id} / ${r2.body.change?.id}`);
    // Decisions › Requests (a change made outside this page shows on its next event: reload), then Cancel on a queued one (two clicks).
    await page.goto(`${base(floor)}&ws=app&tab=decisions`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dc-list [data-change="DC-3"]', { timeout: 30000 });
    await both(page, 'dc-11-decisions-requests', true);
    await page.click('.dc-list [data-cancel="DC-3"]');
    await page.waitForTimeout(200);
    check(/Click again/.test((await page.textContent('.dc-list [data-cancel="DC-3"]')) ?? ''), 'Cancel asks for a second click');
    await page.click('.dc-list [data-cancel="DC-3"]');
    await page.waitForSelector('.dc-list [data-change="DC-3"][data-state="cancelled"]', { timeout: 30000 });
    check(true, 'DC-3 cancelled from the list');
    const again = await page.evaluate(async (f) => (await fetch('/api/dev-changes/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor: f, id: 'DC-1' }) })).json(), floor);
    check(first?.queue !== 'active' || /started/.test(again.error ?? ''), `a started change can't be cancelled: ${again.error ?? 'cancelled (it was queued)'}`);
    // Approvals: the same record.
    await page.goto(`${base(floor)}&tab=approvals`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dc-pm:not([hidden]) [data-change]', { timeout: 30000 }).catch(() => undefined);
    const pm = await page.$$eval('.dc-pm [data-change]', (els) => els.map((e) => e.getAttribute('data-change')));
    check(pm.includes('DC-2'), `Approvals shows the same changes: ${pm.join(', ')}`);
    await both(page, 'dc-12-approvals', true);
    check(!page.errors.length, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);

    // ---- the realistic copy: no team, runtime stopped ----
    if (copy) {
      await page.goto(`${base(copy.id)}&ws=app`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.aw:not([hidden]) .dc-strip [data-chip="main"]', { timeout: 60000 });
      const main = git(['rev-parse', 'origin/main'], copy.dir).stdout.trim() || git(['rev-parse', 'HEAD'], copy.dir).stdout.trim();
      const s = await page.textContent('.aw-strip');
      check(s.includes(`main @${main.slice(0, 7)}`) && /preview: not running/.test(s), `realistic copy, strip: ${s}`);
      const q1 = await post(page, { floor: copy.id, text: 'Rename the submit button on the check sheet to “Send for approval”.', ref: { docType: 'page', docQn: 'Checksheet.Sheet_NewEdit', label: 'Check sheet' }, key: 'smoke-copy-01' });
      check(q1.status === 200 && q1.body.change.queue === 'queued', `no team: queued, not refused (${q1.status} ${q1.body.change?.id ?? q1.body.error})`);
      check(q1.body.change?.source?.sha === main, `source revision = main’s head (${q1.body.change?.source?.sha?.slice(0, 7)})`);
      const cv = await api(page, copy.id);
      check(/No team lead is at work/.test(cv.changes[0]?.detail ?? ''), `says why: ${cv.changes[0]?.detail}`);
      await page.waitForTimeout(800);
      await both(page, 'dc-20-realistic-queued');
    }

    // ---- restart: the queue is read back ----
    const before = (await api(page, floor)).changes.map((c) => `${c.id}:${c.queue}`).join(' ');
    await browser.contexts().forEach((c) => c.close().catch(() => {}));
    await office.stop();
    office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_RATE_MS: '800' } });
    cookie = await login(office.base);
    const p2 = await newPage({ width: 1440, height: 900 });
    await p2.goto(`${base(floor)}&ws=app`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('.aw:not([hidden]) .dc-strip [data-chip="main"]', { timeout: 30000 });
    const after = (await api(p2, floor)).changes.map((c) => `${c.id}:${c.queue}`).join(' ');
    check(before === after, `after a restart the record reads the same: ${after}`);
    if (copy) check((await api(p2, copy.id)).changes[0]?.queue === 'queued', 'the realistic copy’s queued change is still queued');

    // ---- a phone ----
    const phone = await newPage({ width: 400, height: 860 });
    await phone.goto(`${base(floor)}&ws=app`, { waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('.aw:not([hidden]) .dc-strip [data-chip="main"]', { timeout: 30000 });
    await phone.waitForTimeout(2000);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 400, `phone: no sideways scrolling (${w})`);
    await both(phone, 'dc-30-phone', true);
    await phone.click('.aw-tab[data-section="decisions"]');
    await phone.waitForSelector('.dc-list', { timeout: 30000 });
    await phone.waitForTimeout(600);
    await both(phone, 'dc-31-phone-requests', true);
    check(!phone.errors.length && !p2.errors.length, 'phone and restart pages: no page errors');
  } finally {
    await browser.close().catch(() => {});
    await office.stop().catch((e) => log('stop:', e.message));
    fs.rmSync(ghConfig, { recursive: true, force: true });
  }
  const failed = checks.filter((c) => !c.ok);
  log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
