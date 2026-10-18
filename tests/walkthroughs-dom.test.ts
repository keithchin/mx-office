// The 🎬 Walkthroughs page and its player on the page (src/client/ui/walkthroughs/), in headless Chromium with
// every client stylesheet: one card per workflow with its status, the commit it's evidence for, when, auto or
// manual; the guided tour on top; the batch in progress with Cancel; Save to repo only on a passing one; a
// failed card shows what its journey says it needs; the empty state with Record now. The player is wide (about
// 90% of the window) with the video on the left and the steps on the right, stacks on a narrow screen, seeks
// on a step, shows a failed step in red with its reason and its screenshot, and ✕ or Esc gives focus back to
// ▶ Watch. The Live app tab's links open the page (and a recording's player there). And the page is a tab of
// the Deployment group in the navigation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import type { WalkView } from '../src/shared/walkthroughs/types.js';
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

const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const step = (n: number, status: 'passed' | 'failed' | 'not-run', caption: string, why?: string) => ({ n, caption, status, ...(status !== 'not-run' ? { startMs: n * 2000, endMs: n * 2000 + 1800, screenshot: `steps/0${n}.png` } : {}), ...(why ? { why } : {}) });
const J = (id: string, title: string, requirement: string[], notes?: string[]) => ({ id, title, file: `tests/e2e/${id}.journey.json`, requirement, ...(notes ? { notes } : {}) });
const VIEW: WalkView = {
  floor: 'demo',
  settings: { autoRecord: true, narrate: true, demoUser: 'demo_test_user' },
  available: { recorder: true, ffmpeg: true, narration: 'kokoro', notes: [] },
  main: { commit: SHA },
  journeys: [J('new-request', 'Submit a new request', ['UC-01']), J('approve-request', 'Approve a request', ['UC-02'])],
  identity: { user: 'demo_clerk', from: 'project-config' },
  batches: [{ id: 'wb_01JCCCCCCCCCCCCCCCCCCCCCCC', floor: 'demo', kind: 'workflows', commit: SHA, trigger: 'auto', by: 'Mx Office (build on main passed)', journeys: [{ id: 'new-request', title: 'Submit a new request', rec: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA1' }, { id: 'approve-request', title: 'Approve a request' }], phase: 'recording', n: 2, line: 'Recording 2 of 2: Step 1 of 3: Open the request list', at: 1 }],
  ahead: 0,
  recordings: [
    { id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA1', kind: 'workflow', journey: J('new-request', 'Submit a new request', ['UC-01']), milestone: { id: 'phase-1', title: 'Requests' }, trigger: 'auto', by: 'Mx Office (milestone ready)', app: { commit: SHA, origin: 'http://127.0.0.1:9', user: 'demo_clerk', userFrom: 'project-config', instance: true }, startedAt: Date.now() - 5 * 60_000, durationMs: 21000, status: 'passed', steps: [step(1, 'passed', 'Open the request list'), step(2, 'passed', 'Start a new request')], outputs: { video: 'walkthrough.mp4', format: 'mp4', captions: 'captions.vtt', chapters: 'chapters.vtt', narration: 'kokoro', notes: [] } },
    { id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA0', kind: 'workflow', journey: J('approve-request', 'Approve a request', ['UC-02'], ['START STATE: run directly after new-request.']), trigger: 'manual', by: 'Pat', app: { commit: SHA, origin: 'http://127.0.0.1:9', user: 'demo_approver', userFrom: 'journey', instance: true }, startedAt: Date.now() - 60 * 60_000, durationMs: 9000, status: 'failed', failure: { step: 2, why: '.mx-name-btnApprove isn’t on the screen' }, steps: [step(1, 'passed', 'Open the request list'), step(2, 'failed', 'Approve the first request', '.mx-name-btnApprove isn’t on the screen'), step(3, 'not-run', 'See it approved')], outputs: { video: 'walkthrough.mp4', format: 'mp4', captions: 'captions.vtt', chapters: 'chapters.vtt', narration: 'none', notes: [] } },
    { id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA2', kind: 'tour', journey: { id: 'guided-tour', title: 'Guided tour: Sample app', file: '', requirement: [] }, trigger: 'manual', by: 'Pat', app: { commit: SHA, origin: '' }, startedAt: Date.now() - 2 * 60_000, durationMs: 40000, status: 'passed', steps: [], parts: [{ id: 'x', journey: 'intro', title: 'Introduction', startMs: 0, endMs: 4000 }], outputs: { video: 'tour.mp4', format: 'mp4', chapters: 'chapters.vtt', narration: 'none', notes: [] } },
  ],
  disk: { bytes: 12 * 1024 * 1024, quota: 2 * 1024 ** 3 },
  admin: true,
};
const EMPTY: WalkView = { ...VIEW, batches: [], recordings: [] };

test('the page is a tab of its own, in the Deployment group after Live app, with a tab-row button', () => {
  const t = registeredTab('walkthroughs');
  assert.ok(t);
  assert.equal(t.group, 'deploy');
  assert.equal(t.label, 'Walkthroughs');
  assert.equal(t.tabRow, true, 'the button the Live app tab’s links press');
  assert.deepEqual(navGroups().find((g) => g.id === 'deploy')!.items.map((i) => i.id), ['live', 'walkthroughs']);
  assert.doesNotMatch(read('src/client/lite.ts'), /walkthrough/i, 'nothing of it in lite.ts');
});

const chrome = findChrome();
test('in a browser: the page, the batch, the cards, the empty state; the wide two-column player and its focus; the Live app links', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { walkthroughsPage } from './page';
        import { walkLinks } from './links';
        const page = walkthroughsPage(document.getElementById('host'), () => window.FLOOR);
        const links = walkLinks();
        document.getElementById('live').append(links.el);
        window.T = { page, links };`,
      resolveDir: path.join(root, 'src/client/ui/walkthroughs'),
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    const posted: unknown[] = [];
    let view: WalkView = VIEW;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://office.test/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><div class="lite-tabs"><button id="tab-walkthroughs" type="button">🎬 Walkthroughs</button></div><div id="live"></div><div id="host"></div></main><div id="modal-root"></div><div id="toasts"></div><script>window.FLOOR='demo';document.getElementById('tab-walkthroughs').onclick=()=>{window.OPENED=(window.OPENED||0)+1;window.T.page.show();};</script></body></html>` });
      if (u.pathname === '/api/walkthroughs') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(view) });
      if (u.pathname === '/api/walkthroughs/action') {
        posted.push(JSON.parse(r.request().postData() ?? '{}'));
        return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://office.test/');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const T = <R>(js: string) => page.evaluate(js) as Promise<R>;
    await T(`T.page.show()`);
    await page.waitForSelector('.wt-card');
    // The batch in progress, with Cancel.
    const batch = await T<string>(`document.querySelector('.wt-batch').textContent`);
    assert.match(batch, /Recording 2 of 2: Approve a request · Step 1 of 3: Open the request list · auto/);
    assert.equal(await T<string>(`document.querySelector('.wt-batch progress').getAttribute('value')`), '1');
    await page.click('.wt-batch >> text=Cancel');
    await page.waitForTimeout(150);
    assert.deepEqual(posted.at(-1), { action: 'cancel', floor: 'demo', batch: 'wb_01JCCCCCCCCCCCCCCCCCCCCCCC' });
    // The tour on top, then one card per workflow.
    const cards = await T<string[]>(`[...document.querySelectorAll('.wt-card')].map((c) => c.querySelector('h4').textContent + ' | ' + c.querySelector('.wt-tags').textContent)`);
    assert.equal(cards.length, 3);
    assert.match(cards[0], /^Guided tour: Sample app Passed/);
    assert.match(cards[1], /Submit a new request Passed \| Auto · Requests · @abc1234 · .*ago · 21 s · MP4 · voice/);
    assert.match(cards[2], /Approve a request Failed at step 2 \| Manual · Pat · @abc1234/);
    assert.match(await T<string>(`document.querySelectorAll('.wt-card')[2].textContent`), /START STATE: run directly after new-request/, 'a failed card says what its journey needs');
    assert.equal(await T<number>(`[...document.querySelectorAll('.wt-card')[2].querySelectorAll('button')].filter((b) => b.textContent === 'Save to repo').length`), 0, 'a failed run is never offered as evidence');
    assert.match(await T<string>(`document.querySelector('.wtp').textContent`), /Recordings sign in as demo_clerk \(the journey runner’s default/);
    assert.equal(await T<number>(`document.querySelectorAll('.wt-controls select option').length`), 2);
    await page.click('.wt-controls >> text=⟳ Re-record all');
    await page.waitForTimeout(150);
    assert.deepEqual(posted.at(-1), { action: 'record', floor: 'demo', all: true, narrate: true });
    await page.click('.wt-cards .wt-card:nth-child(1) >> text=Save to repo');
    await page.waitForTimeout(150);
    assert.deepEqual(posted.at(-1), { action: 'save', floor: 'demo', id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA1' });

    // The player: wide, the video left and the steps right, a ✕; Esc gives focus back to ▶ Watch.
    await page.click('.wt-cards .wt-card:nth-child(2) >> text=▶ Watch');
    await page.waitForSelector('.wt-player');
    await page.waitForTimeout(350); // past its opening animation
    const lay = await T<{ w: number; h: number; vx: number; vw: number; sx: number; sw: number; track: string; marks: number; close: boolean; failed: string; preview: boolean; ev: string }>(`(() => {
      const p = document.querySelector('.wt-player'), v = p.querySelector('video').getBoundingClientRect(), s = p.querySelector('.wt-side').getBoundingClientRect(), b = p.getBoundingClientRect();
      return { w: b.width, h: b.height, vx: v.left, vw: v.width, sx: s.left, sw: s.width, track: p.querySelector('track').getAttribute('src'), marks: p.querySelectorAll('.wt-mark').length, close: !!p.querySelector('.close'), failed: p.querySelector('li.failed').textContent, preview: !p.querySelector('.wt-preview').hidden, ev: p.querySelector('.wt-evidence').textContent };
    })()`);
    assert.ok(lay.w >= 1440 * 0.88 && lay.w <= 1600, `about 90% of the window wide (${lay.w})`);
    assert.ok(lay.h >= 900 * 0.8, `tall (${lay.h})`);
    assert.ok(lay.vx < lay.sx && lay.vw > lay.sw * 2, 'the video is on the left and takes most of the width; the steps are a column on the right');
    assert.match(lay.track, /name=captions\.vtt/);
    assert.equal(lay.marks, 3);
    assert.ok(lay.close, 'a ✕ in the top right');
    assert.match(lay.failed, /2\. Approve the first request.*Failed: \.mx-name-btnApprove isn’t on the screen/);
    assert.equal(lay.preview, true, 'the failed step’s screenshot is shown');
    assert.match(lay.ev, /Failed at step 2 against @abc1234 as demo_approver \(named by the journey\)/);
    // A step seeks the video.
    await T(`HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }`);
    await page.click('.wt-player li:nth-child(1) .wt-mark');
    assert.equal(await T<number>(`document.querySelector('.wt-player video').currentTime`), 2);
    await page.keyboard.press('Escape');
    assert.equal(await T<boolean>(`!document.querySelector('.wt-player')`), true);
    assert.equal(await T<string>(`document.activeElement.textContent`), '▶ Watch', 'focus back where it was opened from');
    await page.click('.wt-cards .wt-card:nth-child(1) >> text=▶ Watch');
    await page.click('.wt-player .close');
    assert.equal(await T<string>(`document.activeElement.textContent`), '▶ Watch');

    // A narrow screen: the video on top, the steps under it.
    await page.setViewportSize({ width: 600, height: 900 });
    await page.click('.wt-cards .wt-card:nth-child(1) >> text=▶ Watch');
    await page.waitForTimeout(350);
    const narrow = await T<{ vb: number; st: number }>(`(() => { const p = document.querySelector('.wt-player'); return { vb: p.querySelector('.wt-stage').getBoundingClientRect().bottom, st: p.querySelector('.wt-side').getBoundingClientRect().top }; })()`);
    assert.ok(narrow.st >= narrow.vb - 1, 'stacked');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });

    // The Live app tab's links: the page, and a ready milestone's video on it.
    await T(`T.links.update('demo', '${SHA}', true)`);
    await page.waitForFunction(() => /passing videos|recording now/.test(document.querySelector('.wt-count')?.textContent ?? ''));
    await page.click('#live >> text=🎬 Walkthroughs →');
    assert.equal(await T<number>(`window.OPENED`), 1);
    await T(`document.getElementById('live').append(T.links.linkFor('phase-9', '${SHA}', ['new-request']))`);
    await page.click('#live >> text=▶ Walkthrough');
    await page.waitForSelector('.wt-player');
    assert.equal(await T<string>(`document.querySelector('.wt-player h2').textContent`), 'Submit a new request', 'the page opened that recording’s player');
    await page.keyboard.press('Escape');
    assert.equal(await T<unknown>(`T.links.linkFor('phase-9', 'other')`), null);

    // The empty state, with Record now.
    view = EMPTY;
    await T(`T.page.refresh()`);
    await page.waitForSelector('.wt-empty');
    assert.match(await T<string>(`document.querySelector('.wt-empty').textContent`), /appear here by themselves after the next ready milestone or passing build on main/);
    await page.click('.wt-empty >> text=● Record now');
    await page.waitForTimeout(150);
    assert.deepEqual(posted.at(-1), { action: 'record', floor: 'demo', all: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
