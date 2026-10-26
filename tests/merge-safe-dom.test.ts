// Merge-safe on the page (ui/local-merge/), in headless Chromium with a faked office:
//   - each row says what the branch is (its DC and the request's title, its owner), notes-only branches are hidden
//     behind "Show notes branches" and merge as notes; a reviewed older commit with newer ones says so
//   - Approve redraws the row from the server's answer at once (no second look): Merge @sha becomes available
//   - Merge opens the confirm step (commit and subject, DC, files, checks, journeys, data impact, what stays out),
//     with ✕ top-right; Esc gives focus back to Merge; confirming posts exactly the reviewed sha
//   - a Developer change receipt's "Review and merge @C" goes through the same confirm step: approve then merge C
// MS_SHOTS=<dir> saves screenshots (Light, Dark, phone).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const shots = process.env.MS_SHOTS;
const chrome = findChrome();
const R = '3d6ca6b'.padEnd(40, 'a');
const H = '9a5618a'.padEnd(40, 'b');
const C = 'f476b7b'.padEnd(40, 'c');
const N = '4e71000'.padEnd(40, 'd');
const M = 'cc5c24c'.padEnd(40, 'e');
const K = '2878fcb'.padEnd(40, 'f');

const VIEW = {
  floor: 'f1',
  localOnly: true,
  main: 'main',
  mainSha: M,
  level: 2,
  levelName: 'Guided',
  pmDecides: true,
  branches: [
    { branch: 'dev/DC-3', sha: H, ahead: 3, behind: 0, subject: 'DC-3: WIP not reviewed', owner: 'Rhea', dcs: [{ id: 'DC-3', title: 'Rename the button to + New claim' }], kind: 'change', files: { model: 2, code: 0, notes: 1 }, review: { branch: 'dev/DC-3', sha: R, verdict: 'approve', by: 'Pat Morgan', at: 1 }, newer: 2 },
    { branch: 'office/carl-1', sha: C, ahead: 5, behind: 1, subject: 'Phase 4 rows', owner: 'Carl', dcs: [{ id: 'DC-4', title: 'Show the claim total' }], task: 'tk-4', kind: 'change', files: { model: 4, code: 0, notes: 0 } },
    { branch: 'office/barbara-2', sha: N, ahead: 1, behind: 0, subject: 'Journal: relay of DC-3 merge escalation', owner: 'Barbara', kind: 'notes', files: { model: 0, code: 0, notes: 1 } },
  ],
};
const CONFIRM = (sha: string, review: boolean) => ({ floor: 'f1', branch: 'dev/DC-3', main: 'main', sha, subject: 'DC-3: rename the button', head: H, newer: 2, kind: 'change', files: { model: 2, code: 0, notes: 1 }, paths: ['mdlsource/pages.mdl', 'App.mpr', 'docs/dc-3.md'], units: ['page:Claim.Claim_Requests'], dcs: [{ id: 'DC-3', title: 'Rename the button to + New claim' }], checks: [{ name: 'mxcli check', verdict: 'passed' }], journeys: [{ name: 'J-01', verdict: 'passed' }], dataImpact: { status: 'clear', lines: [] }, ...(review ? { review: { branch: 'dev/DC-3', sha, verdict: 'approve', by: 'Pat Morgan', at: 1 } } : {}), levelName: 'Guided', pmDecides: true });

async function harness(): Promise<{ js: string; css: string }> {
  const out = await build({
    stdin: {
      contents: `import '../../lite.css';
        import '../../styles/themes.css';
        import '../../styles/theme-clean.css';
        import '../../styles/theme-portal.css';
        import { store } from '../../state';
        import { localMergePanel } from './panel';
        import { receiptMergeButton } from './receipt';
        store.floor = 'f1';
        store.me = { ...store.me, account: { id: 'u1', name: 'Pat Morgan' }, admin: true };
        const p = localMergePanel();
        document.querySelector('.lite-main').append(p.el);
        window.__panel = p;
        window.__receipt = (c, may) => { const b = receiptMergeButton('f1', c, may); const host = document.querySelector('#receipt'); host.replaceChildren(); if (b) host.append(b); return !!b; };`,
      resolveDir: path.join(root, 'src/client/ui/local-merge'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    loader: { '.css': 'css', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    logLevel: 'silent',
  });
  return { js: out.outputFiles.find((f) => f.path.endsWith('.js'))!.text, css: out.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '' };
}

interface Net {
  gets: string[];
  posts: { url: string; body: Record<string, unknown> }[];
}

async function open(page: Page, h: { js: string; css: string }, theme: string, net: Net) {
  await page.route('**/*', (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const json = (b: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/lite') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>office</title>' });
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
      net.posts.push({ url: u.pathname, body });
      if (u.pathname === '/api/local-merge/review') {
        const row = body.branch === 'office/carl-1' ? { ...VIEW.branches[1], review: { branch: 'office/carl-1', sha: body.sha, verdict: 'approve', by: 'Pat Morgan', at: 2 } } : undefined;
        return json({ ok: true, review: { sha: body.sha }, ...(row ? { branch: row } : {}) });
      }
      if (u.pathname === '/api/local-merge/merge') return json({ ok: true, merge: M, into: 'main', sha: body.sha, newer: 2, words: `Merging @${String(body.sha).slice(0, 7)} (reviewed). The branch has 2 newer commits, not included.`, told: ['Carl'] });
    }
    net.gets.push(u.pathname + u.search);
    if (u.pathname === '/api/local-merge') return json(VIEW);
    if (u.pathname === '/api/local-merge/confirm') return json(CONFIRM(u.searchParams.get('sha')!, u.searchParams.get('sha') === R));
    return json({}, 404);
  });
  await page.goto('http://office.test/lite');
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"></main><div id="receipt" style="padding:16px"></div><div id="modal-root"></div><div id="toasts"></div></body></html>`);
  await page.addScriptTag({ content: h.js });
}

const text = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  // Once the modal's pop animation is over (a condition, not a sleep).
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await page.screenshot({ path: path.join(shots, name) });
};

test('merge-safe in a browser: rows with DCs, notes hidden, Approve at once, the confirm step, the receipt path', { skip: chrome ? false : 'no Chromium here', timeout: 180_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome!, args: ['--headless=new'] });
  try {
    for (const [theme, width] of [['portal-light', 1280], ['portal-dark', 1280], ['portal-light', 390]] as const) {
      const tag = `${theme.replace('portal-', '')}${width < 500 ? '-phone' : ''}`;
      const page = await browser.newPage({ viewport: { width, height: 860 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const net: Net = { gets: [], posts: [] };
      await open(page, h, theme, net);
      await page.evaluate(() => (window as unknown as { __panel: { refresh(): void } }).__panel.refresh());
      await page.waitForSelector('.lm-row[data-branch="dev/DC-3"]');

      // What a branch is; notes hidden by default.
      assert.equal(await page.locator('.lm-row').count(), 2, 'the notes branch is hidden');
      assert.match((await text(page, '.lm-row[data-branch="dev/DC-3"]')) ?? '', /DC-3 · Rename the button to \+ New claim[\s\S]*Rhea's branch · dev\/DC-3[\s\S]*approved @3d6ca6b by Pat Morgan: ready to merge @3d6ca6b · 2 newer commits not reviewed/);
      assert.match((await text(page, '.lm-row[data-branch="office/carl-1"]')) ?? '', /DC-4 · Show the claim total[\s\S]*task tk-4[\s\S]*4 model files[\s\S]*not reviewed/);
      assert.equal(await page.getAttribute('.lm-row[data-branch="dev/DC-3"] [data-act="merge"]', 'data-sha'), R, 'Merge names the reviewed commit, not the head');
      assert.match((await text(page, '.lm-row[data-branch="dev/DC-3"] [data-act="merge"]')) ?? '', /Merge @3d6ca6b into main/);
      assert.match((await text(page, '.lm-row[data-branch="dev/DC-3"] [data-act="approve"]')) ?? '', /Approve at @9a5618a/, 'the newer head can be reviewed apart');
      if (theme === 'portal-light' && width > 500) await shot(page, '01-panel-rows-light.png');
      await page.check('[data-act="show-notes"]');
      await page.waitForSelector('.lm-row[data-branch="office/barbara-2"]');
      assert.match((await text(page, '.lm-row[data-branch="office/barbara-2"]')) ?? '', /notes only[\s\S]*Merge notes @4e71000/);
      await shot(page, `02-panel-notes-shown-${tag}.png`);

      // Approve: the row redraws from the server's answer at once, with no second look.
      const before = net.gets.filter((g) => g.startsWith('/api/local-merge?')).length;
      await page.click('.lm-row[data-branch="office/carl-1"] [data-act="approve"]');
      await page.waitForFunction(() => !(document.querySelector('.lm-row[data-branch="office/carl-1"] [data-act="merge"]') as HTMLButtonElement | null)?.disabled);
      assert.match((await text(page, '.lm-row[data-branch="office/carl-1"]')) ?? '', /approved @f476b7b by Pat Morgan: ready to merge @f476b7b/);
      assert.equal(net.gets.filter((g) => g.startsWith('/api/local-merge?')).length, before, 'no refresh needed');
      assert.deepEqual(net.posts.at(-1), { url: '/api/local-merge/review', body: { floor: 'f1', branch: 'office/carl-1', sha: C, verdict: 'approve' } });

      // Merge: the confirm step; Esc closes it and gives focus back to Merge.
      await page.click('.lm-row[data-branch="dev/DC-3"] [data-act="merge"]');
      await page.waitForSelector('.lmc-dlg');
      const dlg = (await text(page, '.lmc-dlg')) ?? '';
      assert.match(dlg, /Merging @3d6ca6b \(reviewed\)\. The branch has 2 newer commits, not included\./);
      assert.match(dlg, /@3d6ca6b “DC-3: rename the button” on dev\/DC-3/);
      assert.match(dlg, /DC-3 · Rename the button to \+ New claim/);
      assert.match(dlg, /2 model files, 1 notes file/);
      assert.match(dlg, /Claim\.Claim_Requests/);
      assert.match(dlg, /✓ mxcli check \(passed\)/);
      assert.match(dlg, /✓ J-01 \(passed\)/);
      assert.match(dlg, /Clear: no stored data at risk/);
      assert.match(dlg, /Approved @3d6ca6b by Pat Morgan/);
      assert.equal(await page.locator('.lmc-dlg .close').count(), 1, '✕ top-right');
      await shot(page, `03-confirm-${tag}.png`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.lmc-dlg', { state: 'detached' });
      assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.act), 'merge', 'focus back on Merge');
      // Again, and confirm: the reviewed sha is posted, never the head.
      await page.click('.lm-row[data-branch="dev/DC-3"] [data-act="merge"]');
      await page.waitForSelector('.lmc-dlg [data-act="confirm-merge"]');
      await page.click('.lmc-dlg [data-act="confirm-merge"]');
      await page.waitForSelector('.lmc-dlg', { state: 'detached' });
      assert.deepEqual(net.posts.at(-1), { url: '/api/local-merge/merge', body: { floor: 'f1', branch: 'dev/DC-3', sha: R } });
      await page.waitForFunction(() => /main is now @cc5c24c\. Told Carl/.test(document.querySelector('#toasts')?.textContent ?? ''));

      // The receipt: Review and merge @K, through the same confirm step (approve, then merge exactly K).
      const cand = { id: 'DC-1', state: 'candidate', candidates: [{ sha: K, via: 'branch', branch: 'dev/DC-1', seenAt: 1 }] };
      assert.equal(await page.evaluate((c) => (window as unknown as { __receipt(c: unknown, m: boolean): boolean }).__receipt(c, false), cand), false, 'not for someone who may not merge');
      assert.equal(await page.evaluate((c) => (window as unknown as { __receipt(c: unknown, m: boolean): boolean }).__receipt({ ...c, state: 'working' }, true), cand), false, 'only on a candidate');
      assert.equal(await page.evaluate((c) => (window as unknown as { __receipt(c: unknown, m: boolean): boolean }).__receipt(c, true), cand), true);
      assert.match((await text(page, '#receipt')) ?? '', /Review and merge @2878fcb/);
      await page.click('#receipt [data-act="review-merge"]');
      await page.waitForSelector('.lmc-dlg [data-act="confirm-merge"]');
      assert.match((await text(page, '.lmc-dlg [data-act="confirm-merge"]')) ?? '', /Approve @2878fcb and merge/);
      assert.match((await text(page, '.lmc-dlg')) ?? '', /merging records your approval of exactly @2878fcb first/);
      if (width > 500 && theme === 'portal-light') await shot(page, '04-receipt-confirm-light.png');
      const n = net.posts.length;
      await page.click('.lmc-dlg [data-act="confirm-merge"]');
      await page.waitForSelector('.lmc-dlg', { state: 'detached' });
      assert.deepEqual(net.posts.slice(n).map((p) => [p.url, p.body.sha]), [['/api/local-merge/review', K], ['/api/local-merge/merge', K]]);
      assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.act), 'review-merge', 'focus back on the receipt’s button');
      if (width < 500) {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(over <= 1, `no horizontal scroll at phone width (${over})`);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
