// One Needs-you count everywhere (shared/needs-count.ts), in headless Chromium on the page's own parts: the
// Needs-you strip's Overview tab badge, the Portal navigation's Overview item and its closed groups, the top bar's
// bell, the team phone's badge, the Overview's Needs you card, the lead panel's banner and the Approvals tab badge.
// At the same moment they all say the same number; a member's number counts only what they can act on, and the
// rest is said as waiting on the Project Manager. Another project's waiting agents are never added to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const chrome = findChrome();
const lite = fs.readFileSync(path.join(root, 'src/client/lite.html'), 'utf8');
const header = /<header class="lite-bar">[\s\S]*?<\/header>/.exec(lite)![0];
const mainPart = /<main class="lite-main">[\s\S]*?<\/main>/.exec(lite)![0];
const now = Date.now();

/** The project's team as the server answers it for an admin or a member: two escalations, one approval, a lead at work. */
function roster(admin: boolean) {
  const M = (role: string, o: object = {}) => ({ role, title: role === 'pm' ? 'Project Coordinator' : 'Lead Developer', team: 'management', icon: '🧭', name: role === 'pm' ? 'Ada' : 'Bo', model: 'sonnet', status: 'idle', workerId: `w-${role}`, ...o });
  const esc = (id: string, title: string, urgency: string) => ({ id, at: now - 600_000, workerId: 'w-lead-developer', by: 'Bo', role: 'lead-developer', urgency, trigger: 'scope', fyi: false, level: 2, title, details: '', options: ['Yes', 'No'], status: 'open', refs: {} });
  return {
    floor: 'f1',
    shape: 'enterprise',
    coverage: { management: 'pm', analysis: 'pm' },
    admin,
    members: [M('pm'), M('lead-developer')],
    escalations: [esc('e1', 'Should a withdrawn request notify the approver?', 'urgent'), esc('e2', 'Keep the old export format?', 'important')],
    approvals: [{ id: 'p-1', kind: 'proposal', title: 'Add a cost-centre field', detail: 'Bo (Lead Developer)', at: now - 300_000 }],
    proposals: [],
    standups: [],
    settings: { autonomy: 2 },
  };
}

async function harness(): Promise<{ js: string; css: string }> {
  const out = await build({
    stdin: {
      contents: `import '../lite.css';
        import '../styles/themes.css';
        import '../styles/theme-clean.css';
        import '../styles/theme-portal.css';
        import './portal/layout.css';
        import { store } from '../state';
        import { setRoster } from './teams/world';
        import { installPhone } from './phone';
        import { portalBar } from './portal/topbar';
        import { portalNav } from './portal/nav';
        import { needsYouStrip } from './needsyou';
        import { needsCard } from './portal/needs-card';
        import { leadPanel } from './lead-panel';
        import { teamTab } from './roster';
        import { currentNeeds } from './needsyou/feed';
        window.__start = (admin, rosterView) => {
          store.floor = 'f1';
          store.me = { ...store.me, account: { id: admin ? 'u-admin' : 'u-member', name: admin ? 'Pat' : 'Sam' }, admin };
          store.floors = [
            { id: 'f1', name: 'Visitor desk', palette: 1, workers: 3, busy: 1, waiting: 1, people: 1, wing: 0 },
            { id: 'f2', name: 'Fleet', palette: 2, workers: 2, busy: 0, waiting: 2, people: 0, wing: 0 },
          ];
          store.workers.set('w-pm', { id: 'w-pm', name: 'Ada', kind: 'agent', status: 'idle', color: '#0f766e', cols: 80, rows: 24, floor: 'f1', createdAt: 1 });
          store.workers.set('w-k', { id: 'w-k', name: 'Kim', kind: 'agent', status: 'needs_input', activity: 'Allow Bash?', waitingSince: ${now - 120_000}, color: '#0f766e', cols: 80, rows: 24, floor: 'f1', createdAt: 2 });
          setRoster(rosterView);
          const net = { send() {}, onMessage() {} };
          const notifier = { notice() {}, flushDigest() {}, setDigest() {}, settings() { return {}; } };
          const go = () => {};
          installPhone({ net, notifier, openWorker() {}, openPull() {}, go });
          portalBar({ settings() {}, search: () => [] });
          portalNav({ show() {}, run() {} });
          const strip = needsYouStrip(document.getElementById('needs-you'), document.querySelector('#tab-command .ny-tab-n'), { go, setup: () => undefined, live: () => null });
          const card = needsCard({ show() {} });
          document.querySelector('.lite-main').append(card.el);
          leadPanel({ net, openWorker() {}, show() {} });
          teamTab(document.getElementById('team-view'), document.querySelector('#tab-approvals .ro-tab-n'), () => false, () => {}).render('f1');
          strip.refresh();
          window.__count = () => currentNeeds()?.count;
        };`,
      resolveDir: path.join(root, 'src/client/ui'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    loader: { '.css': 'css', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.mp3': 'empty', '.wav': 'empty' },
    logLevel: 'silent',
  });
  return { js: out.outputFiles.find((f) => f.path.endsWith('.js'))!.text, css: out.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '' };
}

async function open(page: Page, h: { js: string; css: string }, admin: boolean) {
  const r = roster(admin);
  const html = `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite">${header}${mainPart}<div id="modal-root"></div><div id="toasts"></div></body></html>`;
  await page.route('**/*', (rt) => {
    const u = rt.request().url();
    if (u === 'http://office.test/lite') return rt.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (u.includes('/api/roster')) return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
    return rt.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://office.test/lite');
  await page.addScriptTag({ content: h.js });
  const err = await page.evaluate(([a, rv]) => { try { (window as unknown as { __start(a: boolean, r: unknown): void }).__start(a as boolean, rv); return ""; } catch (e) { return String((e as Error).stack); } }, [admin, r] as const);
  assert.equal(err, "", "the page parts start");
}

interface Seen {
  count: { forYou: number; forPm: number; elsewhere: number } | undefined;
  tab: string;
  navItem: string;
  navGroup: string;
  bell: string;
  bellLabel: string;
  phone: string;
  overview: string;
  overviewCounts: string;
  banner: string;
  approvals: string;
}

/** Every surface's number (and words), read at one moment. */
const seen = (page: Page): Promise<Seen> =>
  // A string, not a function: the test runner's transpile would wrap named helpers in __name, which the page hasn't got.
  page.evaluate(`(() => {
    const t = (s) => (document.querySelector(s)?.textContent ?? '').trim();
    return {
      count: window.__count(),
      tab: t('#tab-command .ny-tab-n'),
      navItem: t('.pt-item[data-nav="command"] .pt-nbadge'),
      navGroup: (document.querySelector('.pt-item[data-nav="command"]')?.closest('.pt-group')?.querySelector('.pt-group-h .pt-nbadge')?.textContent ?? '').trim(),
      bell: t('.pt-bell .pt-count'),
      bellLabel: document.querySelector('.pt-bell')?.getAttribute('aria-label') ?? '',
      phone: t('.tp-launch .tp-badge'),
      overview: t('.pt-needs .pt-badge'),
      overviewCounts: t('.pt-needs .pt-needs-counts'),
      banner: t('.lp-wait'),
      approvals: t('#tab-approvals .ro-tab-n'),
    };
  })()`) as Promise<Seen>;

async function settled(page: Page): Promise<Seen> {
  let s = await seen(page);
  for (let i = 0; i < 40 && (!s.count || !s.overview || s.phone !== s.tab); i++) {
    await page.waitForTimeout(100);
    s = await seen(page);
  }
  await page.waitForTimeout(400);
  return seen(page);
}

test('in a browser: every Needs-you surface says the one count at the same moment, for an admin and for a member', { skip: chrome ? false : 'no Chromium here', timeout: 120_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    // ---- The Project Manager (an admin): two escalations, an approval and an agent asking are all theirs.
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, h, true);
    const a = await settled(page);
    assert.ok(a.count, `the strip published a count: ${JSON.stringify(a)}`);
    const n = String(a.count!.forYou);
    assert.equal(a.count!.forYou, 4, `2 escalations, 1 approval, 1 agent asking: ${JSON.stringify(a)}`);
    assert.equal(a.count!.forPm, 0);
    assert.equal(a.count!.elsewhere, 2, 'the other project’s 2 waiting agents are known…');
    assert.deepEqual(
      { tab: a.tab, navItem: a.navItem, bell: a.bell, phone: a.phone, overview: a.overview },
      { tab: n, navItem: n, bell: n, phone: n, overview: `${n} for you` },
      `…but never added: every surface says ${n}: ${JSON.stringify(a)}`,
    );
    assert.match(a.bellLabel, new RegExp(`${n} for you in this project · 2 agents waiting in another project`), 'the bell says both scopes apart');
    assert.match(a.banner, new RegExp(`^⚑?\\s*${n} waiting on you`), `the lead panel's banner: ${a.banner}`);
    assert.equal(a.approvals, '1', 'Approvals counts its own part (1 to approve), labelled as part of what needs you');
    assert.deepEqual(errors, []);
    await page.close();

    // ---- A member: only the agent asking is theirs; the escalations and the approval wait on the Project Manager.
    const m = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    m.on('pageerror', (e) => errors.push(e.message));
    await open(m, h, false);
    const b = await settled(m);
    assert.deepEqual([b.count?.forYou, b.count?.forPm], [1, 3], JSON.stringify(b));
    assert.deepEqual({ tab: b.tab, navItem: b.navItem, bell: b.bell, phone: b.phone, overview: b.overview }, { tab: '1', navItem: '1', bell: '1', phone: '1', overview: '1 for you' }, JSON.stringify(b));
    assert.match(b.overviewCounts, /1 for you in this project · 3 waiting on the Project Manager/, 'the rest is said apart, not counted as theirs');
    assert.match(b.banner, /1 waiting on you/);
    assert.equal(b.approvals, '', 'a member isn’t counted approvals they can’t give');
    assert.deepEqual(errors, []);
    await m.close();
  } finally {
    await browser.close();
  }
});
