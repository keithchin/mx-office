// Start from another app on the page, in headless Chromium with every client stylesheet: ＋ New project on a client's
// page (admins only) opens ✨ New project made for that client (the client chip shown, Advanced › Client preset), and
// its ✕ and Esc give focus back to the button; the plan's Start from another app card: the client's apps, what each
// offers (design system with its version, status, compatibility and preview; the brain; the toolkit pin; role
// skills), the summary, the empty client, other clients' apps for admins; Advanced › Design keeps the adopted
// version; and Settings › Client's record. Neutral synthetic data; every call answered by the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import type { AdoptSourcesView } from '../src/shared/adopt-from.js';

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

const ACME = 'pfl_01JA0000000000000000000001';
const GLOBEX = 'pfl_01JA0000000000000000000002';
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const PORTFOLIOS = {
  admin: true,
  ungrouped: [],
  portfolios: [
    { id: ACME, label: 'Acme Logistics', projectIds: ['fleet-tracker', 'depot-checks'], createdAt: 1, by: 'Ada', brain: { path: 'C:/brains/acme', connectedAt: 1, by: 'Ada' }, read: { status: 'ok', snapshot: 'a1b2c3d4e5', routed: [], excluded: [], warnings: [] }, projects: [{ id: 'fleet-tracker', name: 'Fleet Tracker' }, { id: 'depot-checks', name: 'Depot Checks' }] },
    { id: GLOBEX, label: 'Globex Retail', projectIds: [], createdAt: 1, by: 'Ada', projects: [] },
  ],
};
const SOURCES: AdoptSourcesView = {
  client: ACME,
  admin: true,
  all: false,
  clientBrain: { client: 'Acme Logistics', connected: true },
  sources: [
    { floor: 'depot-checks', name: 'Depot Checks', client: { id: ACME, label: 'Acme Logistics' }, crossClient: false, brain: { client: 'Acme Logistics', connected: true }, roleSkills: [] },
    { floor: 'fleet-tracker', name: 'Fleet Tracker', client: { id: ACME, label: 'Acme Logistics' }, crossClient: false, brain: { client: 'Acme Logistics', connected: true }, design: { systemId: 'ds_acme', name: 'Acme Design System', n: 2, digest: 'f'.repeat(64), kind: 'branded', status: 'approved', compat: { studioPro: '11.12.4', mxcli: 'nightly-test' }, gaps: ['logo'], swatch: ['#264ae5', '#ffffff', '#111418'], verified: true }, toolkit: { sha: SHA }, roleSkills: [{ role: 'lead-developer', title: 'Lead Developer', changes: 2 }] },
  ],
};
const ALL: AdoptSourcesView = { ...SOURCES, all: true, sources: [...SOURCES.sources, { floor: 'store-audit', name: 'Store Audit', client: { id: GLOBEX, label: 'Globex Retail' }, crossClient: true, brain: { client: 'Globex Retail', connected: false }, roleSkills: [] }] };
const EMPTY: AdoptSourcesView = { client: GLOBEX, admin: true, all: false, clientBrain: { client: 'Globex Retail', connected: false }, sources: [] };
const INFO = { admin: true, org: 'acme', adminToken: { configured: true, file: '~/x', source: 'connections' }, mendixToken: false, offline: true, mendixVersions: ['11.12.4'], defaultMendix: '11.12.4', questions: [], problems: [], toolkitDir: 'C:/toolkit', jobs: [] };
const STATUS = { available: true, fake: true, model: 'test', capUsd: 1, estimateUsd: 0.1, perMbUsd: 0, limits: { maxFiles: 5, maxBytes: 1, types: [] } };
const RECORD = { floor: 'yard-planner', source: { floor: 'fleet-tracker', name: 'Fleet Tracker', client: 'Acme Logistics' }, at: Date.UTC(2026, 9, 20, 10), by: 'Ada', items: [{ kind: 'design', status: 'available', text: 'Acme Design System v2 (from Fleet Tracker): bound at setup; its guidance is available to agents' }, { kind: 'toolkit', status: 'failed', text: 'Toolkit not on Fleet Tracker’s pin abcdef1' }] };

test('the pieces are modules of their own, plugged in; nothing in lite.ts', () => {
  assert.doesNotMatch(read('src/client/lite.ts'), /adopt/i);
  assert.match(read('src/client/ui/wizard/new/plan.ts'), /adoptCard\(flow\)/);
  assert.match(read('src/client/clients/view.ts'), /newProjectButton/);
  assert.match(read('src/client/ui/settings/portfolio.ts'), /adoptedPart/);
});

const chrome = findChrome();
test('in a browser: ＋ New project on a client opens New project for it (✕ and Esc give focus back); the adoption card, its summary and empty states; the record', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { clientsView } from './view';
        import { store } from '../state';
        import { openWizard } from '../ui/wizard/open';
        import { adoptCard } from '../ui/wizard/new/adopt-card';
        import { designField } from '../ui/wizard/new/design-field';
        import { recordView } from '../ui/adopt-from/record';
        store.me = { admin: window.ADMIN };
        const net = { send() {}, on() { return () => {}; } };
        const view = clientsView(document.getElementById('host'), { last: null, open: () => {}, newProject: (client) => void openWizard({ net, go: () => {}, client }) });
        window.T = { store, view, adoptCard, designField, recordView };`,
      resolveDir: path.join(root, 'src/client/clients'),
      loader: 'ts',
    },
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
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    let sources = SOURCES;
    page.on('pageerror', (e) => errors.push(e.message));
    const html = (admin: boolean) => `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><style>${css}</style></head><body class="clients-page"><main class="home-main"><div id="host"></div><div id="card"></div></main><div id="modal-root"></div><div id="toasts"></div><script>window.ADMIN=${admin}</script></body></html>`;
    let admin = true;
    await page.route('http://office.test/**', async (r) => {
      const u = new URL(r.request().url());
      const json = (v: unknown) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html(admin) });
      if (u.pathname === '/api/portfolios') return json({ ...PORTFOLIOS, admin });
      if (u.pathname === '/api/design') return json({ client: u.searchParams.get('client'), label: 'Acme Logistics', versions: [], admin });
      if (u.pathname === '/api/wizard/info') return json(INFO);
      if (u.pathname === '/api/wizard/unfinished') return json({ admin: true, setups: [] });
      if (u.pathname === '/api/brief/status') return json(STATUS);
      if (u.pathname === '/api/brief/latest') return json({ draft: null });
      if (u.pathname === '/api/adopt-from/sources') return json(u.searchParams.get('client') === GLOBEX ? EMPTY : u.searchParams.get('all') === '1' ? ALL : sources);
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    const T = <R>(js: string) => page.evaluate(js) as Promise<R>;

    // Not an admin (can't create projects): no button.
    admin = false;
    await page.goto(`http://office.test/?client=${ACME}`);
    await page.addScriptTag({ content: out.outputFiles[0].text });
    await page.waitForSelector('.cl-title');
    assert.equal(await T<number>(`document.querySelectorAll('.cl-newproj').length`), 0, 'only whoever can create projects sees it');

    // An admin: ＋ New project on the client's page opens New project made for the client.
    admin = true;
    await page.goto(`http://office.test/?client=${ACME}`);
    await page.addScriptTag({ content: out.outputFiles[0].text });
    await page.waitForSelector('.cl-newproj');
    assert.equal(await T<string>(`document.querySelector('.cl-newproj').textContent`), '＋ New project');
    await page.click('.cl-newproj');
    await page.waitForSelector('.nw-client-chip');
    assert.equal(await T<string>(`document.querySelector('.nw-client-chip').textContent`), 'Client: Acme Logistics');
    // ✕ top right closes it, focus back on the button.
    assert.equal(await T<boolean>(`!!document.querySelector('.nw-bar .nw-close')`), true);
    await page.click('.nw-bar .nw-close');
    await page.waitForFunction(() => !document.querySelector('.nw'));
    assert.equal(await T<string>(`document.activeElement.className`), 'btn primary cl-newproj', '✕: focus back where it was opened from');
    await page.click('.cl-newproj');
    await page.waitForSelector('.nw-client-chip');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.nw'));
    assert.equal(await T<string>(`document.activeElement.className`), 'btn primary cl-newproj', 'Esc: focus back');
    // The card's ⋯ menu has it too (the overview).
    await T(`T.view.open(undefined)`);
    await page.waitForSelector(`[data-client="${ACME}"] .ph-more`);
    await page.click(`[data-client="${ACME}"] .ph-more`);
    assert.match(await T<string>(`document.body.textContent`), /New project…/);
    await page.keyboard.press('Escape');

    // The plan's card, on a fake flow whose scope is approved, for the client.
    await T(`(() => {
      const layer = document.createElement('div'); layer.className = 'nw'; document.getElementById('modal-root').append(layer);
      const plan = { kind: 'new', portfolio: '${ACME}', design: undefined };
      const flow = { plan, layer, draft: { approved: { by: 'Ada', at: 'x' }, domainsStatus: 'ready' }, say() {} };
      const card = T.adoptCard(flow);
      layer.append(card.el);
      window.F = { flow, card, plan };
      card.update();
    })()`);
    await page.waitForSelector('#nw-adopt-src');
    assert.deepEqual(await T<string[]>(`[...document.querySelectorAll('#nw-adopt-src option')].map((o) => o.textContent)`), ['Don’t start from another app', 'Depot Checks', 'Fleet Tracker']);
    assert.match(await T<string>(`document.querySelector('.nw-adopt-sum').textContent`), /This project will start with: Acme Logistics brain connected/);
    await page.selectOption('#nw-adopt-src', 'fleet-tracker');
    const card = await T<string>(`document.querySelector('.nw-adopt').textContent`);
    assert.match(card, /Design system: Acme Design System v2APPROVED/);
    assert.match(card, /Made with Studio Pro 11\.12\.4 · mxcli nightly-test\. ✓ Its files match its digest #fffffff\./);
    assert.match(card, /Company brain: Acme Logistics brain connected/);
    assert.match(card, /Same toolkit version as Fleet Tracker \(abcdef1\)/);
    assert.match(card, /Role skills: the selections from Fleet Tracker/);
    assert.match(card, /Copy approved company skills only/);
    assert.match(card, /never copied\. To share a lesson, propose it to the company brain’s inbox/);
    assert.equal(await T<number>(`document.querySelectorAll('.nw-adopt-sw i').length`), 3, 'a preview of its colours');
    assert.match(await T<string>(`document.querySelector('.nw-adopt-sum').textContent`), /This project will start with: Design system Acme Design System v2 \(from Fleet Tracker\) · Acme Logistics brain connected · Toolkit pin same as Fleet Tracker · Role skills from Fleet Tracker/);
    assert.match(await T<string>(`document.querySelector('.nw-adopt-sum').textContent`), /available to agents; adopting it doesn’t prove they use it/);
    assert.deepEqual(await T<unknown>(`F.plan.adopt`), { source: 'fleet-tracker', design: true, toolkit: true, roleSkills: true });
    assert.deepEqual(await T<unknown>(`F.plan.design`), { choice: 'use', systemId: 'ds_acme', n: 2 }, 'the plan binds the same exact version');
    // Advanced › Design keeps it (never reset to the client's own list).
    assert.match(await T<string>(`T.designField(F.plan, () => {}).textContent`), /v2 of the design system of the app this project starts from/);
    // Choices off: the newest toolkit, no design, no role skills.
    await page.click('#nw-adopt-design');
    await page.click('text=Newest toolkit (default)');
    await page.click('#nw-adopt-skills');
    assert.deepEqual(await T<unknown>(`F.plan.adopt`), { source: 'fleet-tracker' });
    assert.equal(await T<unknown>(`F.plan.design ?? null`), null, 'the adopted design goes with it');
    assert.match(await T<string>(`document.querySelector('.nw-adopt-sum').textContent`), /start with: Acme Logistics brain connected · Newest toolkit \(default\)$|start with: Acme Logistics brain connected · Newest toolkit \(default\)Adopted/);
    // An app with nothing to give says so.
    await page.selectOption('#nw-adopt-src', 'depot-checks');
    const depot = await T<string>(`document.querySelector('.nw-adopt').textContent`);
    assert.match(depot, /Design system: Depot Checks has none/);
    assert.match(depot, /Depot Checks isn’t pinned to a toolkit commit/);
    assert.match(depot, /Depot Checks uses the defaults/);
    // Admins: other clients' apps too.
    await page.click('#nw-adopt-all');
    await page.waitForFunction(() => document.querySelectorAll('#nw-adopt-src option').length === 4);
    assert.match(await T<string>(`document.querySelectorAll('#nw-adopt-src option')[3].textContent`), /Store Audit — Globex Retail/);
    // An empty client: nothing to adopt yet, nothing asked.
    await T(`F.plan.portfolio = '${GLOBEX}'; F.card.update()`);
    await page.waitForSelector('.nw-adopt-empty');
    assert.match(await T<string>(`document.querySelector('.nw-adopt-empty').textContent`), /Nothing to adopt yet: Globex Retail has no other apps in the office/);
    assert.equal(await T<number>(`document.querySelectorAll('#nw-adopt-src').length`), 0);
    assert.equal(await T<unknown>(`F.plan.adopt ?? null`), null);
    // No client: no card.
    await T(`delete F.plan.portfolio; F.card.update()`);
    assert.equal(await T<boolean>(`F.card.el.hidden`), true);

    // Settings › Client's record: what was adopted, from which app, on which day; available to agents or not.
    await T(`document.getElementById('card').append(T.recordView(${JSON.stringify(RECORD)}))`);
    const rec = await T<string>(`document.querySelector('.ad-rec').textContent`);
    assert.match(rec, /Adopted from Fleet Tracker \(Acme Logistics\) on .*2026 by Ada/);
    assert.match(rec, /✓ Design systemAcme Design System v2 \(from Fleet Tracker\): bound at setup; its guidance is available to agents/);
    assert.match(rec, /⚠️ ToolkitToolkit not on Fleet Tracker’s pin abcdef1/);
    assert.match(rec, /doesn’t prove they use it/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
