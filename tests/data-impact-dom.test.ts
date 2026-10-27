// The data-impact card on the Live app tab and its Approve dialog (src/client/ui/data-impact/), in headless
// Chromium with every client stylesheet: the hold as its own fact (merged on main, not applied to the live
// preview), each finding with its unit, element, risk and rows, the uncertainty, the alternatives, who holds
// the permission; Approve… only for those who do, members told who can; the dialog with ✕ top right, Esc
// giving focus back to Approve…, Approve off until a recovery step and a reason, the dump button recording a
// dump, the approval posted with the binding it saw; "data impact unknown"; hidden when nothing is held; and
// phone width without a horizontal scroll. DATA_IMPACT_SHOTS=<folder> saves screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { ALTERNATIVES, UNCERTAINTY, type DataImpactView, type DumpRecord } from '../src/shared/data-impact.js';

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

const BASE = '1234567890abcdef1234567890abcdef12345678';
const CAND = 'abcdef1234567890abcdef1234567890abcdef12';
const now = Date.now();
const HELD: DataImpactView = {
  floor: 'demo',
  permission: 'data-impact approval',
  held: { env: 'live-preview', base: BASE, target: CAND, status: 'impact', reason: 'Update held: possible data impact at abcdef1; needs data-impact approval', at: now },
  assessment: {
    base: BASE,
    target: CAND,
    status: 'impact',
    findings: [
      { kind: 'attribute-removed', unit: 'Sales domain model', element: 'Sales.Order.Notes', risk: 'may drop data in Sales.Order.Notes', rows: 42 },
      { kind: 'enum-value-removed', unit: 'enumeration Sales.Status', element: 'Sales.Status.Closed', risk: 'may drop or convert data in Sales.Order.Status (value Closed removed from Sales.Status)' },
    ],
    warnings: [],
    uncertainty: UNCERTAINTY,
    at: now,
  },
  approvals: [],
  dumps: [],
  canApprove: true,
  approvers: 'office admins (Ada)',
  alternatives: ALTERNATIVES,
  uncertainty: UNCERTAINTY,
};
const MEMBER: DataImpactView = { ...HELD, canApprove: false };
const UNKNOWN: DataImpactView = { ...HELD, held: { ...HELD.held!, status: 'unknown' }, assessment: { ...HELD.assessment!, status: 'unknown', findings: [], error: "the model couldn't be read: 1 changed unit unreadable" } };
const DUMP: DumpRecord = { id: 'd1', env: 'live-preview', base: BASE, target: CAND, database: 'demo_live', path: 'C:\\office\\data-impact\\dumps\\demo\\d1.dump', size: 48_213, sha256: 'f'.repeat(64), verified: 'pg_restore --list read 214 entries', by: { name: 'Ada' }, at: now };
const state = (held: boolean) => ({ floor: 'demo', status: 'running', phase: 'running', log: [], available: true, branch: 'main', served: { sha: BASE, builtAt: now }, ...(held ? { failure: { kind: 'held', at: now, why: HELD.held!.reason, lines: [], sha: CAND } } : {}) });

test('the card is mounted by the Live app tab, nothing of it in lite.ts', () => {
  assert.match(read('src/client/ui/liveapp.ts'), /impactCard\(/);
  assert.doesNotMatch(read('src/client/lite.ts'), /data-impact/);
});

const chrome = findChrome();
test('in a browser: findings, who may approve, the approve dialog (✕, Esc, focus), unknown, members, phone width', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: { contents: `import { impactCard } from './card'; window.T = { card: impactCard(() => 'demo') }; document.getElementById('host').append(window.T.card.el);`, resolveDir: path.join(root, 'src/client/ui/data-impact'), loader: 'ts' },
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
  const shots = process.env.DATA_IMPACT_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    const posted: Record<string, unknown>[] = [];
    let view: DataImpactView = HELD;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://office.test/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><div id="host"></div></main><div id="modal-root"></div><div id="toasts"></div></body></html>` });
      if (u.pathname === '/api/data-impact' && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(view) });
      if (u.pathname === '/api/data-impact') {
        const b = JSON.parse(r.request().postData() ?? '{}');
        posted.push(b);
        if (b.action === 'dump') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ dump: DUMP }) });
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ approval: { id: 'a1' } }) });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://office.test/');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const T = <R>(js: string) => page.evaluate(js) as Promise<R>;
    // Nothing held: hidden.
    await T(`T.card.update(${JSON.stringify(state(false))})`);
    assert.equal(await T<boolean>(`T.card.el.hidden`), true);
    // Held.
    await T(`T.card.update(${JSON.stringify(state(true))})`);
    await page.waitForSelector('.di-card:not([hidden]) .di-finding');
    const text = await T<string>(`document.querySelector('.di-card').innerText`);
    assert.match(text, /Update held: possible data impact/);
    assert.match(text, /Merged on main at abcdef1; not applied to the live preview: data-impact hold\. The live preview keeps running 1234567/);
    assert.match(text, /Sales domain model\s+Sales\.Order\.Notes\s+may drop data in Sales\.Order\.Notes\s+42 rows with data here in the live preview/);
    assert.match(text, /enumeration Sales\.Status\s+Sales\.Status\.Closed/);
    assert.match(text, /Detected from the model diff; migration logic and Java are not analysed\./);
    assert.match(text, /You hold the data-impact approval permission\. Who holds it: office admins \(Ada\)\./);
    assert.doesNotMatch(text, /\bfloor\b/i);
    await page.click('.di-alt summary');
    assert.match(await T<string>(`document.querySelector('.di-alt').innerText`), /Keep the attribute .* deprecated[\s\S]*Migrate the data first[\s\S]*maintenance window/);
    if (shots) await (await page.$('.di-card'))!.screenshot({ path: path.join(shots, 'data-impact-card.png') });
    // The dialog: ✕ top right, Esc returns focus to Approve….
    await page.click('.di-approve');
    await page.waitForSelector('.di-modal');
    assert.ok(await T<boolean>(`!!document.querySelector('.di-modal .close')`), 'a ✕');
    const dlg = await T<string>(`document.querySelector('.di-modal').innerText`);
    assert.match(dlg, /This approval is for the live preview running 1234567, taking abcdef1, with the recovery step below\. If any of these change, it no longer counts/);
    assert.equal(await T<boolean>(`document.querySelector('.di-modal footer .btn.primary').disabled`), true, 'off until a recovery step and a reason');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.di-modal', { state: 'detached' });
    assert.equal(await T<string>(`document.activeElement?.className`), 'btn primary di-approve', 'focus back on Approve…');
    // ✕ too.
    await page.click('.di-approve');
    await page.click('.di-modal .close');
    await page.waitForSelector('.di-modal', { state: 'detached' });
    assert.equal(await T<string>(`document.activeElement?.className`), 'btn primary di-approve');
    // Take a dump, give a reason, approve: posts the binding it saw and the dump.
    await page.click('.di-approve');
    await page.click('.di-take');
    await page.waitForSelector('.di-dump');
    assert.match(await T<string>(`document.querySelector('.di-dumps').innerText`), /d1\.dump · 47 KB · sha256 ffffffffffff… · pg_restore --list read 214 entries · Ada/);
    await page.fill('.di-reason', 'notes copied to Comment first');
    if (shots) await (await page.$('.di-modal'))!.screenshot({ path: path.join(shots, 'data-impact-dialog.png') });
    await page.click('.di-modal footer .btn.primary');
    await page.waitForSelector('.di-modal', { state: 'detached' });
    assert.deepEqual(posted, [
      { floor: 'demo', action: 'dump' },
      { floor: 'demo', action: 'approve', base: BASE, target: CAND, reason: 'notes copied to Comment first', dump: 'd1' },
    ]);
    // "No data to keep" needs its statement ticked.
    await page.click('.di-approve');
    await page.click('input[name="di-recovery"][value="none"]');
    await page.fill('.di-reason', 'demo data only');
    assert.equal(await T<boolean>(`document.querySelector('.di-modal footer .btn.primary').disabled`), true);
    await page.click('.di-none-check');
    await page.click('.di-modal footer .btn.primary');
    await page.waitForSelector('.di-modal', { state: 'detached' });
    assert.deepEqual(posted.at(-1), { floor: 'demo', action: 'approve', base: BASE, target: CAND, reason: 'demo data only', noData: true });
    // A member: who can, no Approve….
    view = MEMBER;
    await T(`T.card.refresh()`);
    await page.waitForFunction(`!document.querySelector('.di-approve')`);
    assert.match(await T<string>(`document.querySelector('.di-card').innerText`), /You don't hold the data-impact approval permission\. Who can approve: office admins \(Ada\)\./);
    // Unknown.
    view = UNKNOWN;
    await T(`T.card.refresh()`);
    await page.waitForFunction(`document.querySelector('.di-card').innerText.includes('data impact unknown')`);
    assert.match(await T<string>(`document.querySelector('.di-card').innerText`), /The office couldn't tell what this change does to stored data: the model couldn't be read: 1 changed unit unreadable\. It holds rather than guess\./);
    // A stale candidate hold: "Release stale hold" with a reason, chosen first; a dump can be taken for it too (env posted).
    view = { ...HELD, env: 'candidate:DC-8', held: { ...HELD.held!, env: 'candidate:DC-8' }, stale: 'the live preview already runs @1234567, which has @abcdef1: its data was migrated then', dumpable: true };
    await T(`T.card.refresh()`);
    await page.waitForSelector('.di-approve');
    await page.click('.di-approve');
    await page.waitForSelector('.di-modal');
    assert.match(await T<string>(`document.querySelector('.di-modal').innerText`), /This hold looks stale: the live preview already runs @1234567/);
    assert.equal(await T<boolean>(`document.querySelector('input[name="di-recovery"][value="stale"]').checked`), true, 'the stale release is the chosen step');
    assert.equal(await T<boolean>(`document.querySelector('.di-take').hidden`), false, 'a dump can be taken for a candidate’s hold');
    await page.click('.di-take');
    await page.waitForSelector('.di-dump');
    assert.deepEqual(posted.at(-1), { floor: 'demo', action: 'dump', env: 'candidate:DC-8' });
    await page.click('input[name="di-recovery"][value="stale"]');
    await page.fill('.di-reason', 'DC-8 has run on the live preview since yesterday');
    assert.match(await T<string>(`document.querySelector('.di-modal footer .btn.primary').textContent`), /Release stale hold/);
    if (shots) await (await page.$('.di-modal'))!.screenshot({ path: path.join(shots, 'data-impact-stale.png') });
    await page.click('.di-modal footer .btn.primary');
    await page.waitForSelector('.di-modal', { state: 'detached' });
    assert.deepEqual(posted.at(-1), { floor: 'demo', action: 'release', env: 'candidate:DC-8', base: BASE, target: CAND, reason: 'DC-8 has run on the live preview since yesterday' });
    // Phone width: no horizontal scroll, with the dialog open too.
    view = HELD;
    await page.setViewportSize({ width: 390, height: 800 });
    await T(`T.card.refresh()`);
    await page.waitForSelector('.di-approve');
    assert.ok(await T<boolean>(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal scroll at phone width');
    if (shots) await (await page.$('.di-card'))!.screenshot({ path: path.join(shots, 'data-impact-card-phone.png') });
    await page.click('.di-approve');
    await page.waitForSelector('.di-modal');
    assert.ok(await T<boolean>(`document.querySelector('.di-modal').getBoundingClientRect().right <= window.innerWidth + 1`), 'the dialog fits a phone');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
