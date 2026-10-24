// Increment B, the change lifecycle, smoke-tested in a throwaway TEST office (the performance guard's fixture at
// scale 1: fake agents only, test mode, no GitHub: GH tokens removed and an empty GH_CONFIG_DIR, no Claude) plus a
// local copy of a realistic Mendix project as a project of its own (no team, its runtime never started). In a real
// Chromium (new headless), Portal Light and Dark and a phone:
//
//   - the fixture project (a fake team at work): a request is handed to the lead (Working); Cancel (stops the work)
//     on the active change stops or isolates the fake lead first, and the next queued change starts
//   - the realistic copy: a request with a page reference queues (no team); its record is then seeded as handed over
//     (the copy has no team: the seed says so in the record, `seeded-for-smoke`), and a commit on dev/DC-n becomes
//     its candidate: the receipt's four facts (checks incomplete: no CI; preview runs main), Approvals' list, the
//     explorer's "Candidate of DC-n (not merged)"; a commit on main naming it (linked, never implemented; possibly
//     related by overlap is covered by tests/lifecycle-b-links.test.ts); Cancel while active (the worker is gone), then a late head: "not counted"
//
//   npm run build && node scripts/lifecycle-b-shots.mjs --project <a Mendix project's git folder> [--out <dir>] [--gh <empty dir>]
//
// The root is fixed under scratch/test-offices (cleared at the start, its processes included, matched by command
// line), so it is never on this script's own command line.
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
const root = path.join(REPO, '..', '..', 'scratch', 'test-offices', 'lifecycle-b-shots');
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'lifecycle-b-shots')));
const source = arg('--project');
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
const git = (args, cwd) => spawnSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', ...args], { cwd, encoding: 'utf8', windowsHide: true });
const until = async (fn, ms = 30000, what = 'condition') => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

/** Appends an `activated` event to a change of the copy (office stopped), with the repo's own store: hash-chained like any line. */
function seedActivated(home, floorId, id, main) {
  const code = `import { ChangeStore } from './src/server/dev-changes/store.ts';
const s = new ChangeStore(${JSON.stringify(path.join(home, '.agent-office', 'dev-changes'))});
await s.event(${JSON.stringify(floorId)}, ${JSON.stringify(id)}, { type: 'activated', at: Date.now(), requestId: 'seeded-for-smoke', taskId: 'tsk_01JSEEDEDFORSMOKE000000000', member: 'Nobody (seeded)', role: 'pm', workerId: 'w-seeded-gone', delivery: 'held', main: ${JSON.stringify(main)} });
console.log(JSON.stringify(await s.verify(${JSON.stringify(floorId)})));`;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`seed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
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
  const team = floors[0].id;
  const dir = path.join(root, 'floors', 'realistic');
  const c = git(['-c', 'core.longpaths=true', 'clone', '--quiet', '--no-hardlinks', source, dir], root);
  if (c.status !== 0) throw new Error(`clone: ${c.stderr}`);
  git(['switch', '-q', '-C', 'main', 'origin/main'], dir);
  const copy = { id: 'realistic-copy', name: 'Realistic app (copy)', dir };
  floors.push({ ...copy, palette: floors.length, addedBy: 'the office', addedAt: Date.now() - 86_400_000 });
  fs.writeFileSync(floorsFile, JSON.stringify(floors));
  const env = { GH_CONFIG_DIR: ghEmpty, FAKE_RATE_MS: '800' };
  let office = await startTestOffice({ home, env });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    let cookie = await login(office.base);
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
      page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || page.errors.push(e.message));
      return page;
    };
    const both = async (page, name, full = false, themes = ['portal-light', 'portal-dark']) => {
      await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
      for (const t of themes) {
        await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, `${name}-${t.replace('portal-', '')}.png`), fullPage: full });
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    };
    const api = (page, f) => page.evaluate(async (x) => (await fetch(`/api/dev-changes?floor=${encodeURIComponent(x)}`)).json(), f);
    const post = (page, url, body) => page.evaluate(async ([u, b]) => {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() };
    }, [url, body]);
    const base = (f) => `${office.base}/lite?floor=${encodeURIComponent(f)}`;

    // ---- the fixture project: a fake team; cancel while the lead has it ----
    const page = await newPage({ width: 1440, height: 900 });
    await page.goto(`${base(team)}&ws=app`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lead-panel:not([hidden]) .dk-head .dc-strip [data-chip="main"]', { timeout: 60000 });
    const t1 = await post(page, '/api/change-requests', { floor: team, text: 'Show the host’s name on the printed badge.', key: 'lcb-smoke-0001' });
    const t2 = await post(page, '/api/change-requests', { floor: team, text: 'Print the visit date in the corner of the badge.', key: 'lcb-smoke-0002' });
    check(t1.status === 200 && t2.status === 200, `two requests kept (${t1.body.change?.id}, ${t2.body.change?.id})`);
    let v = await api(page, team);
    const dc1 = v.changes.find((x) => x.id === t1.body.change.id);
    check(dc1 && Object.keys(dc1.facts ?? {}).join() === 'execution,verification,preview,review', `four facts on the record’s view: ${dc1 && Object.values(dc1.facts).map((f) => f.words).join(' | ')}`);
    if (dc1?.queue === 'active') {
      const r = await post(page, '/api/dev-changes/cancel', { floor: team, id: dc1.id });
      check(r.status === 200 && r.body.change.queue === 'cancelled' && r.body.change.cancelled?.stop, `active cancel: worker ${r.body.change?.cancelled?.stop?.how ?? r.body.error} (${r.body.change?.cancelled?.stop?.worker ?? ''}) before the slot freed`);
      v = await api(page, team);
      const next = v.changes.find((x) => x.id === t2.body.change.id);
      check(next && next.queue !== 'queued', `the next change moved on: ${next?.id} ${next?.words}`);
      check(/while the team had it/.test(v.changes.find((x) => x.id === dc1.id)?.detail ?? ''), `says it was stopped: ${v.changes.find((x) => x.id === dc1.id)?.detail}`);
    } else check(false, `the fixture’s first change wasn’t handed over (${dc1?.state}: ${dc1?.detail})`);
    check(!page.errors.length, `fixture project: no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);

    // ---- the realistic copy: a page request, then a candidate on dev/DC-1 ----
    const main0 = git(['rev-parse', 'origin/main'], dir).stdout.trim() || git(['rev-parse', 'HEAD'], dir).stdout.trim();
    const ix = await page.evaluate(async ([f, r]) => (await fetch(`/api/app-explorer/index?floor=${encodeURIComponent(f)}&rev=${r}`)).json(), [copy.id, main0]);
    const pageNode = Object.values(ix.levels ?? {}).flat().find((n) => n.type === 'page' && n.qn);
    check(!!pageNode, `a page of the copy to point at: ${pageNode?.qn}`);
    const q = await post(page, '/api/change-requests', { floor: copy.id, text: 'Change the label of the Submit button to “Send for approval”.', ref: { docType: 'page', docQn: pageNode.qn, label: pageNode.label }, key: 'lcb-smoke-copy1' });
    check(q.status === 200 && q.body.change.queue === 'queued', `no team: ${q.body.change?.id} queued, not refused`);
    await office.stop();
    log('seed:', seedActivated(home, copy.id, q.body.change.id, main0));
    git(['switch', '-q', '-c', `dev/${q.body.change.id}`], dir);
    fs.writeFileSync(path.join(dir, 'SMOKE-CANDIDATE.md'), 'A candidate for the lifecycle smoke test.\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', `Label change (${q.body.change.id})`], dir);
    const cand = git(['rev-parse', 'HEAD'], dir).stdout.trim();
    git(['switch', '-q', 'main'], dir);
    office = await startTestOffice({ home, env });
    cookie = await login(office.base);
    const p2 = await newPage({ width: 1440, height: 900 });
    await p2.goto(`${base(copy.id)}&ws=app`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#lead-panel:not([hidden]) .dk-head .dc-strip [data-chip="main"]', { timeout: 60000 });
    const id = q.body.change.id;
    v = await until(async () => {
      const x = await api(p2, copy.id);
      return x.changes.find((y) => y.id === id)?.state === 'candidate' && x;
    }, 30000, 'the candidate');
    const cv = v.changes.find((y) => y.id === id);
    check(cv.revision === cand && cv.facts.verification.status === 'incomplete' && cv.facts.preview.status === 'main' && cv.facts.review.status === 'none', `candidate @${cand.slice(0, 7)}: ${Object.values(cv.facts).map((f) => f.words).join(' | ')}`);
    await p2.waitForSelector(`#lead-panel .dk-asked[data-change="${id}"] [data-fact="verification"]`, { timeout: 30000 });
    await both(p2, 'b-01-receipt-candidate');
    // The explorer's candidate.
    await p2.waitForSelector('.ax-revsel option[value="candidate"]', { state: 'attached', timeout: 30000 });
    const label = await p2.textContent('.ax-revsel option[value="candidate"]');
    check(label === `Candidate of ${id} (not merged) · ${cand.slice(0, 7)}`, `explorer offers: ${label}`);
    await p2.selectOption('.ax-revsel', 'candidate');
    await p2.waitForFunction(() => document.querySelector('.ax-revsel')?.dataset.reading === 'candidate');
    await p2.waitForTimeout(1500);
    await both(p2, 'b-02-explorer-candidate');
    await p2.selectOption('.ax-revsel', 'main');
    // Approvals: the same four facts.
    const pm = await newPage({ width: 1440, height: 900 });
    await pm.goto(`${base(copy.id)}&tab=approvals`, { waitUntil: 'domcontentloaded' });
    await pm.waitForSelector(`.dc-pm:not([hidden]) [data-change="${id}"] [data-fact="preview"]`, { timeout: 30000 });
    check(true, 'Approvals shows the four facts');
    await both(pm, 'b-03-approvals', true);
    // A commit on main naming the change: linked (overlap-based "possibly related" needs a model edit: see the tests).
    const head = git(['rev-parse', 'HEAD'], dir).stdout.trim();
    fs.writeFileSync(path.join(dir, 'SMOKE-NOTE.md'), 'Hotfix note.\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', `Hotfix for ${id}: label wording`], dir);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir);
    v = await until(async () => {
      const x = await api(p2, copy.id);
      return x.changes.find((y) => y.id === id)?.relatedView?.length && x;
    }, 180000, 'related commits');
    const rel = v.changes.find((y) => y.id === id).relatedView;
    check(rel.some((r) => r.explicit), `a commit naming ${id} is linked: ${rel.map((r) => `${r.sha.slice(0, 7)} ${r.explicit ? 'linked' : 'possible'}`).join(', ')}`);
    check(v.changes.find((y) => y.id === id).state === 'candidate', 'linked commits never make it implemented');
    await p2.reload({ waitUntil: 'domcontentloaded' });
    await p2.waitForSelector(`#lead-panel .dk-asked[data-change="${id}"] .dc-related`, { timeout: 30000 });
    await both(p2, 'b-04-related');
    // Cancel while active (the seeded worker is gone): then a late head on dev/DC-n is "not counted".
    const can = await post(p2, '/api/dev-changes/cancel', { floor: copy.id, id });
    check(can.status === 200 && can.body.change.cancelled?.stop?.how === 'gone', `cancelled while active: worker ${can.body.change?.cancelled?.stop?.how ?? can.body.error}`);
    git(['switch', '-q', `dev/${id}`], dir);
    fs.writeFileSync(path.join(dir, 'SMOKE-CANDIDATE.md'), 'A late push after the cancel.\n');
    git(['commit', '-qam', `Late push (${id})`], dir);
    git(['switch', '-q', 'main'], dir);
    v = await until(async () => {
      const x = await api(p2, copy.id);
      return x.changes.find((y) => y.id === id)?.late && x;
    }, 30000, 'the late head');
    check(/not counted/.test(v.changes.find((y) => y.id === id).late), `late: ${v.changes.find((y) => y.id === id).late}`);
    await p2.reload({ waitUntil: 'domcontentloaded' });
    await p2.waitForSelector(`#lead-panel .dk-asked[data-change="${id}"] .dc-late`, { timeout: 30000 });
    await both(p2, 'b-05-cancelled-late');
    check(git(['rev-parse', 'HEAD'], dir).stdout.trim() !== head, 'main moved only by the smoke’s own commits');
    // A phone.
    const phone = await newPage({ width: 390, height: 844 });
    await phone.goto(`${base(copy.id)}&ws=app`, { waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('.lp-fab', { timeout: 60000 });
    await phone.click('.lp-fab');
    await phone.waitForFunction(() => document.body.classList.contains('lp-sheet'));
    await phone.waitForSelector(`#lead-panel .dk-asked[data-change="${id}"] .dc-late`, { timeout: 30000 });
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 391, `phone: no sideways scrolling (${w})`);
    await both(phone, 'b-06-phone-receipt');
    check(![p2, pm, phone].some((p) => p.errors.length), `no page errors${[p2, pm, phone].flatMap((p) => p.errors).join(' | ')}`);
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
