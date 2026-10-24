// The Developer view's first useful release, part 2: the bounded Model preview, Select element and Request a
// change from an element. Two parts, both in a real Chromium (new headless):
//
//   neutral     the explorer's pane (app-workspace/explorer/pane.ts) with the real request dialog, on the neutral
//               fixtures in tests/support/preview-pages.ts (a list, an edit page, a dialog): Portal Light, Dark,
//               a phone; hovering, the chip, the shared-snippet impact, the dialog with the chip
//   --project   a throwaway TEST office (the performance guard's fixture, fake agents, test mode, GH tokens
//               removed and an empty GH_CONFIG_DIR, no Claude) plus a local copy of a realistic Mendix project as
//               a project of its own (no team, its runtime never started). With mxcli (--mxcli, or the
//               AGENT_OFFICE_LIVE_MXCLI the office already reads) the explorer opens real pages in the Model
//               preview; a widget is picked and a change requested: DC-n queued with the element reference,
//               shown in the requests and the strip, with no live app
//
//   npm run build && node scripts/element-pick-shots.mjs [--project <git folder>] [--mxcli <path>] [--out <dir>]
//
// The test office's root is fixed under scratch/test-offices (cleared at the start, its processes included,
// matched by command line), so it is never on this script's own command line.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.join(REPO, '..', '..', 'scratch', 'test-offices', 'element-pick-shots');
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'element-pick-shots')));
const source = arg('--project');
const mxcli = arg('--mxcli', process.env.AGENT_OFFICE_LIVE_MXCLI);
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const REV = '7d3f0b1'.padEnd(40, 'a');

/** The newest preview frame inside `scope` that has marked widgets. */
async function previewFrame(page, scope = '.ax-pane') {
  for (let i = 0; i < 600; i++) {
    const fh = await page.$(`${scope} .pgp-frame`);
    const fr = fh ? await fh.contentFrame() : null;
    if (fr && (await fr.$('[data-mx-el]').catch(() => null))) return fr;
    await page.waitForTimeout(100);
  }
  throw new Error('no preview frame with widgets');
}

async function shoot(page, name, { full = false, themes = ['portal-light', 'portal-dark'] } = {}) {
  await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
  for (const t of themes) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `${name}-${t.replace('portal-', '')}.png`), fullPage: full });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
}

// ---- neutral ---------------------------------------------------------------------------------------------
async function harness() {
  const res = await build({
    stdin: {
      contents: `
        import '../../lite.css';
        import '../../styles/themes.css';
        import '../../styles/theme-clean.css';
        import '../../styles/theme-portal.css';
        import './app-workspace.css';
        import './explorer/explorer.css';
        import { docPane } from './explorer/pane';
        import { openRequestDialog } from './requests';
        import { DOCS, THEME } from '../../../../tests/support/preview-pages';
        const REV = ${JSON.stringify(REV)};
        window.asked = [];
        const facts = async (qn) => ({ rev: REV, qn, widgets: { [qn]: {}, 'Desk.SNIP_Header': { btnHelp: ['Forms$ActionButton', 'id-help'] } }, usedOn: { 'Desk.SNIP_Header': ['Desk.Visit_Cancel', 'Desk.Visit_NewEdit', 'Desk.Visit_Overview'] }, theme: { css: THEME, from: ['themesource/desk/web/main.scss'] } });
        const pane = docPane({
          floor: () => 'desk', rev: () => REV, back: () => undefined, file: async () => ({ kind: 'text', text: '' }),
          api: { doc: async (f, rev, type, qn) => ({ sha: rev, doc: { kind: 'text', type, name: qn, mdl: DOCS[type + ':' + qn] ?? '' } }) },
          facts,
          request: (r) => openRequestDialog({ project: 'Visitor desk', about: 'Page: ' + r.node.label, element: r.element, source: r.rev, sourceWords: 'main @' + r.rev.slice(0, 7) },
            async (a) => (window.asked.push(a), { ok: true, change: { id: 'DC-4', queue: 'queued' }, again: false }), (c) => (window.done = c.id)),
        });
        const aw = document.createElement('section');
        aw.className = 'aw';
        aw.style.cssText = 'display:block;height:calc(100vh - 24px);padding:12px;box-sizing:border-box';
        aw.append(pane.el);
        document.querySelector('main').append(aw);
        window.open = (qn, title) => pane.show({ id: 'page:' + qn, label: title, kind: 'page', type: 'page', qn }, title + ' · Model preview');`,
      resolveDir: path.join(REPO, 'src/client/ui/app-workspace'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
    logLevel: 'silent',
    minify: true,
  });
  return { js: res.outputFiles.find((f) => f.path.endsWith('.js')).text, css: res.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '' };
}

async function neutral(browser) {
  const h = await harness();
  const mk = async (viewport) => {
    const page = await browser.newPage({ viewport });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.setContent(`<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite"><main class="lite-main" style="max-width:none;padding:0"></main><div id="modal-root"></div><div id="toasts"></div></body></html>`);
    await page.addScriptTag({ content: h.js });
    return page;
  };
  const page = await mk({ width: 1440, height: 900 });
  for (const [qn, title, name] of [['Desk.Visit_Overview', 'Today’s visitors', 'n-01-list'], ['Desk.Visit_NewEdit', 'Register visitor', 'n-02-edit'], ['Desk.Visit_Cancel', 'Cancel visit', 'n-03-dialog']]) {
    await page.evaluate(([q, t]) => window.open(q, t), [qn, title]);
    const fr = await previewFrame(page);
    await page.waitForTimeout(400);
    check(((await fr.evaluate(() => document.body.innerText)) ?? '').length > 40, `neutral ${title}: drawn`);
    if (name === 'n-02-edit') {
      const report = await page.textContent('.pgp-report');
      check(/signaturepad/.test(report ?? ''), `the edit page lists what it can’t draw: ${report}`);
    }
    await shoot(page, name);
  }
  // Picking on the list: hover, select, the chip; a snippet widget says it's shared.
  await page.evaluate(() => window.open('Desk.Visit_Overview', 'Today’s visitors'));
  let fr = await previewFrame(page);
  await page.waitForTimeout(400);
  const tops = await fr.$$eval('.counter', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  check(tops.length === 4 && tops.every((t) => t === tops[0]), `tiles side by side (${tops.join(', ')})`);
  await page.click('.ax-pane .pgp-pick');
  fr = await previewFrame(page);
  await fr.hover('[data-mx-w="btnCheckIn"]');
  await fr.waitForSelector('.mx-hover');
  await shoot(page, 'n-04-hover');
  await fr.click('[data-mx-w="btnCheckIn"]');
  await page.waitForSelector('.ax-chip');
  check((await page.textContent('.ax-chip-text')) === 'Today’s visitors › Check in button', `chip: ${await page.textContent('.ax-chip-text')}`);
  await shoot(page, 'n-05-selected');
  await fr.click('[data-mx-w="btnHelp"]');
  await page.waitForSelector('.ax-impact');
  check(/snippet SNIP_Header, used on 3 pages/.test((await page.textContent('.ax-impact')) ?? ''), `shared: ${await page.textContent('.ax-impact')}`);
  await shoot(page, 'n-06-shared');
  await fr.click('[data-mx-w="btnCheckIn"]');
  await page.click('.ax-pick-ask');
  await page.waitForSelector('.aw-reqdlg .aw-chip');
  await page.fill('.aw-reqtext', 'Ask for the visitor’s car registration when checking in.');
  await shoot(page, 'n-07-request');
  await page.click('.aw-reqsend');
  await page.waitForFunction(() => window.done === 'DC-4');
  const asked = await page.evaluate(() => window.asked[0]);
  check(asked.ref?.widgetName === 'btnCheckIn' && asked.ref.docQn === 'Desk.Visit_Overview' && asked.source === REV, `the request carries the element: ${JSON.stringify(asked.ref)} @${asked.source.slice(0, 7)}`);
  check(!page.errors.length, `neutral: no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
  // A phone.
  const phone = await mk({ width: 400, height: 860 });
  await phone.evaluate(() => window.open('Desk.Visit_Overview', 'Today’s visitors'));
  await previewFrame(phone);
  await phone.click('.pgp-bar button:has-text("Phone")');
  const pfr = await previewFrame(phone);
  await phone.waitForTimeout(400);
  const w = await phone.evaluate(() => document.documentElement.scrollWidth);
  const fw = await pfr.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check(w <= 400 && fw[0] <= fw[1] + 1, `neutral phone: no sideways scroll (page ${w}, frame ${fw})`);
  await phone.click('.ax-pane .pgp-pick');
  await (await previewFrame(phone)).click('[data-mx-w="btnOpen"]');
  await phone.waitForSelector('.ax-chip');
  await shoot(phone, 'n-08-phone');
}

// ---- the realistic copy in a test office ---------------------------------------------------------------------
async function realistic(browser) {
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  const made = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/perf/fixture.ts', '--out', root, '--scale', '1', '--seed', '42', '--base', new Date().toISOString()], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (made.status !== 0) throw new Error(`fixture: ${made.stderr || made.stdout}`);
  const home = path.join(root, 'office');
  const floorsFile = path.join(home, '.agent-office', 'floors.json');
  const floors = JSON.parse(fs.readFileSync(floorsFile, 'utf8'));
  const dir = path.join(root, 'floors', 'realistic');
  const c = git(['-c', 'core.longpaths=true', 'clone', '--quiet', '--no-hardlinks', source, dir], root);
  if (c.status !== 0) throw new Error(`clone: ${c.stderr}`);
  const copy = { id: 'realistic-copy', name: 'Line check app (copy)', dir };
  floors.push({ ...copy, palette: floors.length, addedBy: 'the office', addedAt: Date.now() - 86_400_000 });
  fs.writeFileSync(floorsFile, JSON.stringify(floors));
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  const office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_RATE_MS: '800', ...(mxcli ? { AGENT_OFFICE_LIVE_MXCLI: mxcli } : {}) } });
  log('test office up at', office.base);
  try {
    const cookie = await login(office.base);
    const newPage = async (viewport) => {
      const u = new URL(office.base);
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await ctx.addCookies(cookie.split('; ').map((x) => ({ name: x.slice(0, x.indexOf('=')), value: x.slice(x.indexOf('=') + 1), domain: u.hostname, path: '/' })));
      await ctx.addInitScript(() => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', 'portal-light');
      });
      const page = await ctx.newPage();
      page.errors = [];
      page.liveHits = [];
      page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || page.errors.push(e.message));
      page.on('request', (r) => /^http:\/\/(127\.0\.0\.1|localhost):(8\d{3})\//.test(r.url()) && page.liveHits.push(r.url()));
      return page;
    };
    const base = `${office.base}/lite?floor=${encodeURIComponent(copy.id)}&ws=app`;
    const page = await newPage({ width: 1440, height: 900 });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.aw:not([hidden]) .ax-tree [role="treeitem"]', { timeout: 60000 });
    const openPage = async (p, title) => {
      await p.fill('.ax-search', title);
      const r = p.locator('.ax-tree [role="treeitem"]', { has: p.locator(`.ax-label:text-is("${title}")`) }).first();
      await r.waitFor({ timeout: 60000 });
      await r.click();
      const t0 = Date.now();
      const fr = await previewFrame(p).catch(async (e) => {
        await p.screenshot({ path: path.join(out, `r-fail-${title.replace(/[^A-Za-z0-9]+/g, '-')}.png`) });
        throw new Error(`${title}: ${e.message}. The pane says: ${(await p.textContent('.ax-pane').catch(() => ''))?.slice(0, 300)}`);
      });
      await p.waitForTimeout(1200);
      return { fr: await previewFrame(p), ms: Date.now() - t0 };
    };
    for (const [title, name] of [['My check sheets', 'r-01-list'], ['Line 7 check sheet', 'r-02-edit'], ['Reject sheet', 'r-03-dialog'], ['Approvals', 'r-04-queue']]) {
      const { fr, ms } = await openPage(page, title);
      const hgt = await fr.evaluate(() => document.documentElement.scrollHeight);
      check(hgt < 20000, `${title}: the Model preview in ${ms} ms, ${hgt}px tall; ${(await page.textContent('.ax-pane .pgp-report').catch(() => '')) || 'nothing left out'}`);
      await shoot(page, name);
    }
    // Pick on the list page: a widget of the page, then one in the header snippet (shared), then request.
    let { fr } = await openPage(page, 'My check sheets');
    await page.click('.ax-pane .pgp-pick');
    fr = await previewFrame(page);
    await fr.hover('[data-mx-w="btnNew"]');
    await fr.waitForSelector('.mx-hover');
    await shoot(page, 'r-05-hover');
    await fr.click('[data-mx-w="btnNew"]');
    await page.waitForSelector('.ax-chip');
    const chip = await page.textContent('.ax-chip-text');
    check(/^My check sheets › .*button$/.test(chip ?? ''), `chip: ${chip}`);
    await shoot(page, 'r-06-selected');
    const snippetWidget = await fr.$('[data-mx-doc^="Checksheet.SNIP_"]');
    if (snippetWidget) {
      await snippetWidget.click();
      await page.waitForTimeout(600);
      const impact = await page.textContent('.ax-impact').catch(() => null);
      check(!!impact, `a header snippet widget: ${impact ?? 'no impact line'}`);
      await shoot(page, 'r-07-shared');
      await fr.click('[data-mx-w="btnNew"]');
      await page.waitForTimeout(300);
    }
    await page.click('.ax-pick-ask');
    await page.waitForSelector('.aw-reqdlg .aw-chip');
    await page.fill('.aw-reqtext', 'Rename this button to “Start a check sheet”.');
    await shoot(page, 'r-08-request');
    await page.click('.aw-reqsend');
    await page.waitForFunction(() => !document.querySelector('.aw-reqdlg'), null, { timeout: 30000 });
    const v = await page.evaluate(async (f) => (await fetch(`/api/dev-changes?floor=${encodeURIComponent(f)}`)).json(), copy.id);
    const dc = v.changes?.[0];
    check(dc && /^DC-\d+$/.test(dc.id) && dc.queue === 'queued' && dc.ref?.widgetName === 'btnNew' && dc.ref?.docQn === 'Checksheet.Sheet_Overview', `${dc?.id}: ${dc?.words} — ref ${JSON.stringify(dc?.ref)}`);
    check(dc?.source?.kind === 'viewed' && /^[0-9a-f]{40}$/.test(dc?.source?.sha ?? ''), `source = the revision viewed (${dc?.source?.sha?.slice(0, 7)})`);
    check(/^[\w-]+$/.test(dc?.ref?.id ?? ''), `$ID hint from the units: ${dc?.ref?.id}`);
    check(!dc?.revision, 'no running version (the app is stopped)');
    await page.waitForTimeout(800);
    await shoot(page, 'r-09-after');
    await page.goto(`${base}&tab=decisions`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`.dc-list [data-change="${dc?.id}"]`, { timeout: 30000 }).catch(() => undefined);
    check(!!(await page.$(`.dc-list [data-change="${dc?.id}"]`)), `${dc?.id} in the requests list`);
    await shoot(page, 'r-10-requests', { full: true });
    check(!page.liveHits.length, `nothing reached a live app (${page.liveHits.length})`);
    check(!page.errors.length, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
    // A phone.
    const phone = await newPage({ width: 400, height: 860 });
    await phone.goto(base, { waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('.ax-drawer-btn', { timeout: 60000 });
    await phone.click('.ax-drawer-btn');
    const { fr: pfr } = await openPage(phone, 'My check sheets');
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 400, `phone: no sideways scrolling (${w})`);
    await phone.click('.ax-pane .pgp-pick');
    await (await previewFrame(phone)).click('[data-mx-w="btnNew"]').catch(() => undefined);
    await phone.waitForTimeout(400);
    await shoot(phone, 'r-11-phone', { full: true });
    void pfr;
  } finally {
    await office.stop().catch((e) => log('stop:', e.message));
    fs.rmSync(ghConfig, { recursive: true, force: true });
  }
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--headless=new'] });
  try {
    await neutral(browser);
    if (source) await realistic(browser);
  } finally {
    await browser.close().catch(() => {});
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
