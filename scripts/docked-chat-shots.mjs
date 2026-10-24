// The Developer view's docked coordinator chat, smoke-tested on a throwaway TEST office (the performance guard's
// fixture, fake agents, test mode, GH tokens removed and an empty GH_CONFIG_DIR, no Claude) plus a local copy of
// a realistic Mendix project as a project of its own (no team, its runtime never started). In a real Chromium (new
// headless):
//
//   - the Developer view opens on the Model preview of the app's first page, with the team-lead panel docked on
//     the right (its header, the chip of the page) and no live app
//   - a widget picked with Select element becomes the chip; Request a change sends it through the one intake:
//     DC-n queued (no lead at work) with the element reference, the revision viewed and via chat; its receipt in
//     the conversation; Cancel from the receipt
//   - Ask is off with no lead; Live preview says not running; the retired sections' links land on Project
//     Management's pages; a fixture project with a team shows the same panel docked; a phone gets a bottom sheet
//
//   npm run build && node scripts/docked-chat-shots.mjs --project <git folder> [--mxcli <path>] [--out <dir>] [--gh <empty dir>]
//
// The test office's root is fixed under scratch/test-offices (cleared at the start, its processes included,
// matched by command line), so it is never on this script's own command line.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.join(REPO, '..', '..', 'scratch', 'test-offices', 'docked-chat-shots');
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'docked-chat-shots')));
const source = arg('--project');
const mxcli = arg('--mxcli', process.env.AGENT_OFFICE_LIVE_MXCLI);
const ghEmpty = path.resolve(arg('--gh', path.join(REPO, '..', '..', 'scratch', 'empty-gh')));
assertTestDir(root);
if (!source) throw new Error('--project <git folder> is required');
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

async function previewFrame(page) {
  for (let i = 0; i < 900; i++) {
    const fh = await page.$('.ax-pane:not([hidden]) .pgp-frame');
    const fr = fh ? await fh.contentFrame() : null;
    if (fr && (await fr.$('[data-mx-el]').catch(() => null))) return fr;
    await page.waitForTimeout(100);
  }
  throw new Error('no preview frame with widgets');
}

async function shoot(page, name, { themes = ['portal-light', 'portal-dark'] } = {}) {
  await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
  for (const t of themes) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${name}-${t.replace('portal-', '')}.png`) });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(ghEmpty, { recursive: true });
  if (fs.readdirSync(ghEmpty).length) throw new Error(`${ghEmpty} must be empty`);
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  const made = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/perf/fixture.ts', '--out', root, '--scale', '1', '--seed', '42', '--base', new Date().toISOString()], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (made.status !== 0) throw new Error(`fixture: ${made.stderr || made.stdout}`);
  const home = path.join(root, 'office');
  const floorsFile = path.join(home, '.agent-office', 'floors.json');
  const floors = JSON.parse(fs.readFileSync(floorsFile, 'utf8'));
  const teamFloor = floors[0];
  const dir = path.join(root, 'floors', 'realistic');
  const c = git(['-c', 'core.longpaths=true', 'clone', '--quiet', '--no-hardlinks', source, dir], root);
  if (c.status !== 0) throw new Error(`clone: ${c.stderr}`);
  const copy = { id: 'realistic-copy', name: 'Line check app (copy)', dir };
  floors.push({ ...copy, palette: floors.length, addedBy: 'the office', addedAt: Date.now() - 86_400_000 });
  fs.writeFileSync(floorsFile, JSON.stringify(floors));
  const office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghEmpty, FAKE_RATE_MS: '800', ...(mxcli ? { AGENT_OFFICE_LIVE_MXCLI: mxcli } : {}) } });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--headless=new'] });
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
    const base = `${office.base}/lite?floor=${encodeURIComponent(copy.id)}&ws=dev`;
    const page = await newPage({ width: 1440, height: 900 });
    const t0 = Date.now();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lead-panel:not([hidden]) .dk-head', { timeout: 60000 });
    check(true, 'the team-lead panel docks in the Developer view, with its header');
    const fr0 = await previewFrame(page).catch(async (e) => {
      await page.screenshot({ path: path.join(out, 'fail-first-page.png') });
      throw e;
    });
    void fr0;
    const title = await page.textContent('.ax-pane:not([hidden]) .ax-pane-title');
    check(true, `the default canvas is the Model preview of the first page in ${Date.now() - t0} ms: ${title}`);
    const lp = await page.evaluate(() => document.querySelector('#lead-panel').getBoundingClientRect().toJSON());
    const main = await page.evaluate(() => document.querySelector('.aw-main').getBoundingClientRect().toJSON());
    check(Math.abs(lp.right - 1440) < 2 && main.right <= lp.left + 1, `explorer | canvas | chat (canvas ends ${Math.round(main.right)}, chat ${Math.round(lp.left)}–${Math.round(lp.right)})`);
    const chip0 = await page.textContent('#lead-panel .lp-ctx-chip .lp-ctx-t').catch(() => null);
    check(!!chip0, `the first page is the composer's chip: ${chip0}`);
    check(/not running/.test((await page.textContent('.aw-tab[data-view="live"]')) ?? ''), 'Live preview says not running');
    check(await page.isDisabled('#lead-panel .lp-mode[data-mode="ask"]'), 'Ask is off with no lead; Request a change still works');
    check(/No one leads the team yet: a change you request is kept/.test((await page.textContent('#lead-panel .lp-hint')) ?? ''), 'the no-lead hint');
    await page.waitForTimeout(1200);
    await shoot(page, 'c-01-model-preview-docked');

    // My check sheets: pick the New button; its chip; Request a change from the composer.
    await page.fill('.ax-search', 'My check sheets');
    const row = page.locator('.ax-tree [role="treeitem"]', { has: page.locator('.ax-label:text-is("My check sheets")') }).first();
    await row.waitFor({ timeout: 60000 });
    await row.click();
    await page.waitForFunction(() => /My check sheets/.test(document.querySelector('.ax-pane:not([hidden]) .ax-pane-title')?.textContent ?? ''), null, { timeout: 60000 });
    await page.click('.ax-pane:not([hidden]) .pgp-pick');
    const fr = await previewFrame(page);
    await fr.click('[data-mx-w="btnNew"]');
    await page.waitForFunction(() => /›/.test(document.querySelector('#lead-panel .lp-ctx-chip')?.textContent ?? ''), null, { timeout: 20000 });
    const chip = await page.textContent('#lead-panel .lp-ctx-chip .lp-ctx-t');
    check(/^My check sheets › /.test(chip ?? ''), `the widget's chip: ${chip}`);
    await page.click('.ax-pane:not([hidden]) .ax-pick-ask');
    check(!(await page.$('.aw-reqdlg')) && (await page.evaluate(() => document.activeElement?.classList.contains('lp-box'))), '"Request a change to this" focuses the composer, no dialog');
    await page.fill('#lead-panel .lp-box', 'Rename this button to “Start a check sheet”.');
    await shoot(page, 'c-02-chip-composer', { themes: ['portal-light'] });
    await page.press('#lead-panel .lp-box', 'Enter');
    await page.waitForSelector('#lead-panel .dk-asked', { timeout: 30000 });
    const v = await page.evaluate(async (f) => (await fetch(`/api/dev-changes?floor=${encodeURIComponent(f)}`)).json(), copy.id);
    const dc = v.changes?.[0];
    check(dc && /^DC-\d+$/.test(dc.id) && dc.queue === 'queued' && dc.ref?.widgetName === 'btnNew' && dc.via === 'chat', `${dc?.id}: ${dc?.words}, via ${dc?.via}, ref ${JSON.stringify(dc?.ref)}`);
    check(dc?.source?.kind === 'viewed' && /^[0-9a-f]{40}$/.test(dc?.source?.sha ?? ''), `source = the revision viewed (${dc?.source?.sha?.slice(0, 7)})`);
    check(!!dc?.key, 'an idempotency key was sent');
    const receipt = await page.textContent(`#lead-panel .dk-asked[data-change="${dc?.id}"] .dk-receipt`).catch(() => '');
    check(new RegExp(`→ ${dc?.id} · Queued[\\s\\S]*No team lead is at work`).test(receipt ?? ''), `the receipt: ${receipt?.replace(/\s+/g, ' ').slice(0, 140)}`);
    check(/1 change this session[\s\S]*1 queued/.test((await page.textContent('#lead-panel .dk-head')) ?? ''), 'the header counts it');
    await page.waitForTimeout(600);
    await shoot(page, 'c-03-receipt');
    // Cancel from the receipt.
    await page.click(`#lead-panel [data-cancel="${dc?.id}"]`);
    await page.click(`#lead-panel [data-cancel="${dc?.id}"]`);
    await page.waitForFunction((id) => /Cancelled/.test(document.querySelector(`#lead-panel .dk-asked[data-change="${id}"] .dk-receipt`)?.textContent ?? ''), dc?.id, { timeout: 20000 }).catch(() => undefined);
    check(/Cancelled/.test((await page.textContent(`#lead-panel .dk-asked[data-change="${dc?.id}"] .dk-receipt`)) ?? ''), 'cancelled from its receipt');
    check(!page.liveHits.length, `nothing reached a live app (${page.liveHits.length})`);
    check(!page.errors.length, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);

    // The retired sections' links land on Project Management's pages.
    for (const [sec, to] of [['decisions', 'approvals'], ['review', 'testing'], ['requirements', 'documents'], ['release', 'command']]) {
      const p = await newPage({ width: 1280, height: 800 });
      await p.goto(`${office.base}/lite?floor=${encodeURIComponent(copy.id)}&ws=dev&tab=${sec}`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2500);
      const tab = new URL(p.url()).searchParams.get('tab');
      const devOn = await p.evaluate(() => document.body.classList.contains('aw-on'));
      check(tab === to && !devOn, `?ws=dev&tab=${sec} → ${tab} (Developer view ${devOn ? 'on' : 'off'})`);
      await p.context().close();
    }

    // A fixture project with a team: the same panel, docked.
    const tp = await newPage({ width: 1440, height: 900 });
    await tp.goto(`${office.base}/lite?floor=${encodeURIComponent(teamFloor.id)}&ws=dev`, { waitUntil: 'domcontentloaded' });
    await tp.waitForSelector('#lead-panel:not([hidden]) .dk-head', { timeout: 60000 });
    await tp.waitForTimeout(3000);
    const who = (await tp.textContent('#lead-panel .lp-name').catch(() => '')) ?? '';
    check(!!who, `a project with a team: the panel docked, lead ${who.trim()}`);
    await shoot(tp, 'c-04-team-project');
    await tp.goto(`${office.base}/lite?floor=${encodeURIComponent(teamFloor.id)}&tab=command`, { waitUntil: 'domcontentloaded' });
    await tp.waitForTimeout(2500);
    check(!(await tp.$('#lead-panel .dk-head')) || (await tp.isHidden('#lead-panel .dk-head')), 'on Project Management the panel is as it was (no header, no chips)');
    await tp.context().close();

    // A phone: the chat is a bottom sheet.
    const phone = await newPage({ width: 390, height: 844 });
    await phone.goto(base, { waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('.lp-fab', { state: 'visible', timeout: 60000 });
    await phone.waitForTimeout(2500);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 391, `phone: no sideways scrolling (${w})`);
    await shoot(phone, 'c-05-phone-canvas', { themes: ['portal-light'] });
    await phone.click('.lp-fab');
    await phone.waitForTimeout(600);
    check(await phone.evaluate(() => document.body.classList.contains('lp-sheet')), 'phone: the chat opens as a bottom sheet');
    await shoot(phone, 'c-06-phone-chat');
  } finally {
    await browser.close().catch(() => {});
    await office.stop().catch((e) => log('stop:', e.message));
  }
  const failed = checks.filter((x) => !x.ok);
  log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
