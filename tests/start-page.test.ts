// Home (/start): the office's landing page. Its rules (shared/start.ts), where the wordmark, the 🏠, a bare /
// and the left navigation's Home item go, its server side's milestones (server/start/), and its sections
// drawn from a fixture office on a stand-in for the DOM (tests/support/fakedom.ts): Needs you across
// everything with each item's client and project, the active projects with their red flag, the clients'
// spend, the milestones, the quiet health strip, and the "Create your first project" panel for an empty office.
// Neutral example data only (Acme Logistics, Globex Retail).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installFakeDom, fakeDocument, FakeEl } from './support/fakedom.js';

installFakeDom();
// The progress bar's mini version asks the office; here nothing answers (it draws nothing, as with no answer yet).
(globalThis as { fetch?: unknown }).fetch = async () => ({ ok: false, json: async () => ({}) });

const { HOME_PAGE, topNeeds, needsByProject, clientIndex, redFlag, liveWord, teamWords, clientSpend, healthItems, latestActivity } = await import('../src/shared/start.js');
const { legacyOfficeUrl, isReturnPage } = await import('../src/shared/home.js');
const { usd } = await import('../src/shared/budget/money.js');
const sections = await import('../src/client/start/sections.js');
const { OFFICE_NAV } = await import('../src/client/start/nav.js');

const root = path.join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const text = (el: { textContent: string }) => el.textContent.replace(/\s+/g, ' ');

const need = (id: string, floor: string, project: string, level: 'block' | 'warn', summary = `Item ${id}`) => ({ id, floor, project, who: 'The team', summary, urgency: level === 'block' ? 'Blocking' : 'Needs a look', level, path: `lite?floor=${floor}` });
const NEEDS = [need('a', 'acme-portal', 'Acme Portal', 'warn'), need('b', 'globex-shop', 'Globex Shop', 'block'), need('c', 'acme-portal', 'Acme Portal', 'warn'), need('d', 'acme-portal', 'Acme Portal', 'block'), need('e', 'globex-shop', 'Globex Shop', 'warn'), need('f', 'acme-portal', 'Acme Portal', 'warn')];
const PORTFOLIOS = [
  { id: 'pfl_A', label: 'Acme Logistics', projectIds: ['acme-portal', 'acme-ops'], projects: [], brain: { path: 'C:/Clients/acme-brain', connectedAt: 1, by: 'Ada' }, read: { status: 'ok' } },
  { id: 'pfl_G', label: 'Globex Retail', projectIds: ['globex-shop'], projects: [] },
];
const floor = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, dir: `C:/p/${id}`, palette: 1, addedBy: 'Ada', addedAt: 1, workers: 4, busy: 2, waiting: 1, people: 0, wing: 0, ...over });

// ---- The rules ---------------------------------------------------------------------------------------

test('Home is /start: a bare / goes there, sign-in comes back to it, old 3D links still open the 1D view', () => {
  assert.equal(HOME_PAGE, '/start');
  assert.equal(legacyOfficeUrl(''), '/start');
  assert.equal(legacyOfficeUrl('?view=3d'), '/lite');
  assert.equal(legacyOfficeUrl('?floor=acme-portal'), '/lite?floor=acme-portal');
  assert.ok(isReturnPage('/start'));
  // The page, its route and its build entry.
  assert.match(read('src/server/http/routes/start.ts'), /path: \['\/start', '\/start\.html'\]/);
  assert.match(read('src/server/http/routes/index.ts'), /startRoutes\.page,\n {2}pageRoutes\.home,/);
  assert.match(read('vite.config.ts'), /start: resolve\(import\.meta\.dirname, 'src\/client\/start\.html'\)/);
  // The Projects and Clients pages are where they were.
  assert.match(read('src/server/http/routes/pages.ts'), /home: \{ path: \['\/home', '\/home\.html'\]/);
  assert.match(read('src/server/http/routes/pages.ts'), /clients: \{ path: \['\/clients', '\/clients\.html'\]/);
});

test('the Mx Office wordmark and every page’s 🏠 open Home, not the Projects page', () => {
  const bar = read('src/client/ui/portal/topbar.ts');
  assert.match(bar, /h\('a\.pt-brand\.pt-only', \{ href: HOME_PAGE,/);
  assert.match(bar, /if \(opts\.onHome && location\.pathname === HOME_PAGE\)/, 'only Home keeps the wordmark on the page');
  assert.match(bar, /label: 'Home', hint: [^\n]*href: HOME_PAGE/, 'the launcher lists Home');
  assert.match(bar, /label: 'Projects', hint: [^\n]*href: '\/home'/, 'and still the Projects page');
  for (const f of ['lite.html', 'pixel.html', 'home.html', 'clients.html', 'firm.html', 'setup.html']) assert.match(read(`src/client/${f}`), /<a id="to-home" class="btn" href="\/start"/, f);
  assert.match(read('src/client/start.html'), /<a id="to-home" class="btn on" href="\/start" aria-current="page"/);
  assert.match(read('src/client/home.html'), /<title>Projects · Mx Office<\/title>/);
});

test('the left navigation has Home on top: above the project card on a project, picked on Home', () => {
  const nav = read('src/client/ui/portal/nav.ts');
  assert.match(nav, /h\('a\.pt-item\.pt-home-item', \{ href: HOME_PAGE,/);
  assert.match(nav, /h\('div\.pt-nav-in', \{\}, h\('div\.pt-nav-top', \{\}, home, fold\), card, groupsList/, 'Home (with the fold control) comes before the project card and the groups');
  assert.equal(OFFICE_NAV[0].id, 'home');
  assert.equal(OFFICE_NAV[0].href, '/start');
  assert.deepEqual(OFFICE_NAV.map((i) => i.href), ['/start', '/home', '/clients', '/firm', '/docs']);
  assert.match(read('src/client/start/nav.ts'), /'aria-current': 'page'/);
});

test('Needs you: blocking items first, five at most, and See all by project', () => {
  const top = topNeeds(NEEDS);
  assert.deepEqual(top.map((n) => n.id), ['b', 'd', 'a', 'c', 'e']);
  assert.deepEqual(needsByProject(NEEDS), [
    { floor: 'acme-portal', project: 'Acme Portal', count: 4 },
    { floor: 'globex-shop', project: 'Globex Shop', count: 2 },
  ]);
});

test('a project row’s facts: red only for stuck or failing work, the live app unknown when never opened', () => {
  assert.equal(redFlag({ stuck: 0, failing: 0 }), undefined);
  assert.equal(redFlag(undefined), undefined);
  assert.equal(redFlag({ stuck: 2, failing: 1 }), '2 stuck · 1 failing PR');
  assert.deepEqual(liveWord(undefined), { text: 'Live app: unknown', ready: false, tone: 'mute' });
  assert.equal(liveWord({ status: 'running', viewPort: 8099 }).ready, true);
  assert.equal(liveWord({ status: 'running' }).ready, false, 'no port to open: not ready');
  assert.equal(liveWord({ status: 'failed' }).tone, 'bad');
  assert.equal(liveWord({ status: 'stopped' }).text, 'Live app not started');
  assert.equal(teamWords({ workers: 4, busy: 2, waiting: 1 }), '2 working · 1 asking · 1 idle');
  assert.equal(teamWords({ workers: 0, busy: 0, waiting: 0 }), 'No agents');
  assert.equal(clientIndex(PORTFOLIOS).get('globex-shop')?.label, 'Globex Retail');
});

test('a client’s spend: its projects added up, a budget only when every one has one', () => {
  const floors = [
    { id: 'acme-portal', spent: 120, budget: 500 },
    { id: 'acme-ops', spent: 30, budget: 200 },
    { id: 'globex-shop', spent: 10 },
  ];
  assert.deepEqual(clientSpend(['acme-portal', 'acme-ops'], floors), { spent: 150, budget: 700, unbudgeted: 0 });
  assert.deepEqual(clientSpend(['globex-shop'], floors), { spent: 10, unbudgeted: 1 });
  assert.equal(clientSpend(['x'], undefined), undefined, 'no budget read yet: unknown');
});

test('the health strip is quiet when all is well and says what is not', () => {
  const ok = healthItems({ working: 3, today: 4.2, claude: 'ok' }, usd);
  assert.ok(ok.every((i) => i.ok));
  assert.deepEqual(ok.map((i) => i.text), ['3 agents working', '$4.20 spent today', 'Credentials OK']);
  const bad = healthItems({ working: 1, today: 60, dailyBudget: 50, claude: 'failing', update: { sha: 'abc1234', release: 61 } }, usd);
  assert.deepEqual(bad.filter((i) => !i.ok).map((i) => i.id), ['spend', 'claude', 'update']);
  assert.match(bad.find((i) => i.id === 'update')!.text, /release 61/);
  // Nothing read yet: no spend or credentials claimed.
  assert.deepEqual(healthItems({ working: 0 }, usd).map((i) => i.id), ['agents']);
  assert.deepEqual(latestActivity([{ at: 1, floor: 'a', kind: 'pr-merged', text: 'x' }, { at: 3, floor: 'a', kind: 'accepted', text: 'y' }], 1).map((a) => a.at), [3]);
});

// ---- The server's milestones ---------------------------------------------------------------------------

test('recent activity comes only from what the office recorded: merged PRs with a merge time, accepted deliveries', async () => {
  const { floorActivity } = await import('../src/server/start/index.js');
  const dataDir = mkdtempSync(path.join(tmpdir(), 'start-activity-'));
  try {
    const pulls = [
      { number: 7, title: 'Add shipment list', state: 'MERGED', mergedAt: '2026-10-10T10:00:00Z' },
      { number: 8, title: 'Draft only', state: 'OPEN' },
      { number: 9, title: 'Merged, no time recorded', state: 'MERGED' },
    ];
    const ctx = { cfg: { dataDir } } as never;
    const fl = { id: 'acme-portal', github: { pulls: { items: pulls } } } as never;
    const items = floorActivity(ctx, fl);
    assert.deepEqual(items.map((a) => [a.kind, a.text]), [['pr-merged', 'PR #7 merged: Add shipment list']]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---- The sections, drawn from a fixture office ---------------------------------------------------------

test('Needs you draws each item with its client and project, its Open at the bottom right, and See all', () => {
  const clients = clientIndex(PORTFOLIOS);
  const els = sections.needsBody({ needs: NEEDS, clientOf: (f) => clients.get(f), nameOf: (f) => f });
  const box = new FakeEl('div');
  box.append(...(els as unknown as FakeEl[]));
  const items = box.querySelectorAll('li.st-need');
  assert.equal(items.length, 5);
  const first = items[0];
  assert.equal(first.attrs.get('data-level'), 'block');
  assert.equal(first.querySelector('.st-tag-client')?.textContent, 'Globex Retail');
  assert.equal(first.querySelector('.st-tag-project')?.textContent, 'Globex Shop');
  const open = first.querySelector('.st-need-foot .st-acts a');
  assert.equal(open?.textContent, 'Open');
  assert.equal(open?.attrs.get('href'), '/lite?floor=globex-shop');
  assert.match(text(box.querySelector('.st-seeall')!), /See all 6: Acme Portal \(4\) · Globex Shop \(2\)/);
  // Nothing waiting, and not read yet: said so, never an empty box.
  const calm = sections.needsBody({ needs: [], clientOf: () => undefined, nameOf: (f) => f });
  assert.match(text(calm[0] as unknown as FakeEl), /Nothing needs you right now/);
  assert.match(text(sections.needsBody({ clientOf: () => undefined, nameOf: (f) => f })[0] as unknown as FakeEl), /Reading every project/);
});

test('an active project’s row: its client, team, live app and a red flag for stuck or failing work', () => {
  const row = sections.projectRow({ f: floor('acme-portal', 'Acme Portal') as never, client: { id: 'pfl_A', label: 'Acme Logistics' }, facts: { floor: 'acme-portal', needs: 2, stuck: 1, failing: 0, live: { status: 'running', viewPort: 8099 } }, open: () => {} }) as unknown as FakeEl;
  assert.ok(row.classList.contains('red'));
  assert.equal(row.querySelector('.st-row-client')?.textContent, 'Acme Logistics');
  assert.match(text(row), /2 working · 1 asking · 1 idle/);
  assert.match(text(row), /Live app running/, 'running, never "ready": the work’s readiness is the business status');
  assert.match(text(row), /1 stuck/);
  const calm = sections.projectRow({ f: floor('globex-shop', 'Globex Shop') as never, facts: { floor: 'globex-shop', needs: 0, stuck: 0, failing: 0 }, open: () => {} }) as unknown as FakeEl;
  assert.ok(!calm.classList.contains('red'));
  assert.match(text(calm), /No client/);
  assert.match(text(calm), /Live app: unknown/);
});

test('clients as small cards: project count, spend against budget, brain connected or not', () => {
  const budget = { floors: [{ id: 'acme-portal', spent: 120, budget: 500 }, { id: 'acme-ops', spent: 30, budget: 200 }, { id: 'globex-shop', spent: 10 }] } as never;
  const box = new FakeEl('div');
  box.append(...(sections.clientsBody(PORTFOLIOS as never, budget) as unknown as FakeEl[]));
  const cards = box.querySelectorAll('li.st-client');
  assert.equal(cards.length, 2);
  const parts = (c: FakeEl) => c.querySelectorAll('.st-client-n, .st-client-l').map((e) => e.textContent);
  assert.deepEqual(parts(cards[0]), ['Acme Logistics', '2 projects', '$150 of $700', 'Brain connected']);
  assert.deepEqual(parts(cards[1]), ['Globex Retail', '1 project', '$10 spent · no budget set', 'No brain connected']);
  assert.equal(cards[0].querySelector('a')?.attrs.get('href'), '/clients?client=pfl_A');
});

test('recent activity and the health strip', () => {
  const box = new FakeEl('div');
  box.append(...(sections.activityBody([{ at: Date.now() - 60_000, floor: 'acme-portal', kind: 'accepted', text: 'Delivery v1 accepted by Ada' }], () => 'Acme Portal') as unknown as FakeEl[]));
  assert.equal(box.querySelector('.st-act-k')?.textContent, 'Accepted');
  assert.equal(box.querySelector('.st-act-t')?.textContent, 'Acme Portal · Delivery v1 accepted by Ada');
  assert.equal(box.querySelector('.st-act-at')?.textContent, '1m ago');
  const empty = sections.activityBody([], () => '');
  assert.match(text(empty[0] as unknown as FakeEl), /No milestones recorded yet/);
  const strip = new FakeEl('div');
  strip.append(...(sections.healthStrip(healthItems({ working: 2, today: 1, claude: 'ok' }, usd)) as unknown as FakeEl[]));
  assert.match(text(strip), /^All OK/);
});

test('an empty office shows "Create your first project" instead of empty sections', async () => {
  const { store } = await import('../src/client/state/index.js');
  const { startView } = await import('../src/client/start/view.js');
  const root = new FakeEl('section');
  fakeDocument.body.append(root);
  let asked = 0;
  store.floors = [];
  const v = startView(root as unknown as HTMLElement, { open: () => {}, newProject: () => asked++, addProject: () => {}, newClient: () => {} });
  const empty = root.querySelector('.st-empty')!;
  const grid = root.querySelector('.st-grid')!;
  assert.ok(empty.hidden, 'before the office has said, nothing is claimed');
  v.welcomed();
  assert.ok(!empty.hidden);
  assert.ok(grid.hidden);
  assert.match(text(empty), /Create your first project/);
  (empty.querySelector('button.primary') as FakeEl).click();
  assert.equal(asked, 1, 'its New project opens the wizard');
  // With projects, the sections are back.
  store.floors = [floor('acme-portal', 'Acme Portal') as never];
  v.welcomed();
  assert.ok(empty.hidden);
  assert.ok(!grid.hidden);
  assert.equal(root.querySelectorAll('li.st-row').length, 1);
  assert.match(text(root.querySelector('.st-head')!), /Home/);
});
