// The Live app tab's Walkthroughs section on the page (src/client/ui/liveapp/walkthroughs*.ts), in headless
// Chromium with every client stylesheet: one card per workflow with its status and the commit it's evidence
// for, auto-recordings labelled, Save to repo only on a passing one, a running job with Cancel; the player
// opens with the video, its captions track and the steps, and ✕ or Esc gives focus back to ▶ Watch; the
// readiness card's link to a ready milestone's video.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import type { WalkView } from '../src/shared/walkthroughs/types.js';

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
const step = (n: number, status: 'passed' | 'failed' | 'not-run', caption: string) => ({ n, caption, status, ...(status !== 'not-run' ? { startMs: n * 2000, endMs: n * 2000 + 1800, screenshot: `steps/0${n}.png` } : {}) });
const VIEW: WalkView = {
  floor: 'demo',
  settings: { autoRecord: true, narrate: true, demoUser: 'demo_test_user' },
  available: { recorder: true, ffmpeg: true, narration: 'kokoro', notes: [] },
  live: { commit: SHA, running: true },
  journeys: [
    { id: 'new-request', title: 'Submit a new request', file: 'tests/e2e/new-request.journey.json', requirement: ['UC-01'] },
    { id: 'approve-request', title: 'Approve a request', file: 'tests/e2e/approve-request.journey.json', requirement: ['UC-02'] },
  ],
  jobs: [{ id: 'wt_01JCCCCCCCCCCCCCCCCCCCCCCC', floor: 'demo', journey: 'approve-request', kind: 'workflow', trigger: 'manual', status: 'running', line: 'Step 1 of 3: Open the request list', at: 1 }],
  recordings: [
    { id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA1', kind: 'workflow', journey: VIEW_J('new-request', 'Submit a new request', ['UC-01']), milestone: { id: 'phase-1', title: 'Requests' }, trigger: 'auto', by: 'Mx Office (milestone ready)', app: { commit: SHA, origin: 'http://127.0.0.1:9', user: 'demo_test_user' }, startedAt: 3, durationMs: 21000, status: 'passed', steps: [step(1, 'passed', 'Open the request list'), step(2, 'passed', 'Start a new request')], outputs: { video: 'walkthrough.mp4', format: 'mp4', captions: 'captions.vtt', chapters: 'chapters.vtt', narration: 'kokoro', notes: [] } },
    { id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA0', kind: 'workflow', journey: VIEW_J('approve-request', 'Approve a request', ['UC-02']), trigger: 'manual', by: 'Pat', app: { commit: SHA, origin: 'http://127.0.0.1:9' }, startedAt: 2, durationMs: 9000, status: 'failed', failure: { step: 2, why: '.mx-name-btnApprove isn’t on the screen' }, steps: [step(1, 'passed', 'Open the request list'), step(2, 'failed', 'Approve the first request'), step(3, 'not-run', 'See it approved')], outputs: { video: 'walkthrough.mp4', format: 'mp4', captions: 'captions.vtt', chapters: 'chapters.vtt', narration: 'none', notes: [] } },
  ],
  disk: { bytes: 12 * 1024 * 1024, quota: 2 * 1024 ** 3 },
  admin: true,
};
function VIEW_J(id: string, title: string, requirement: string[]) {
  return { id, title, file: `tests/e2e/${id}.journey.json`, requirement };
}

const chrome = findChrome();
test('in a browser: the cards, the job, Save to repo, the player and its focus, the readiness link', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { walkthroughsSection } from './walkthroughs';
        import { readinessCard } from './readiness';
        const w = walkthroughsSection();
        document.getElementById('host').append(w.el);
        window.T = { w, readinessCard };`,
      resolveDir: path.join(root, 'src/client/ui/liveapp'),
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
    const posted: unknown[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://office.test/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><div class="la"><div id="host"></div></div></main><div id="modal-root"></div><div id="toasts"></div></body></html>` });
      if (u.pathname === '/api/walkthroughs') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(VIEW) });
      if (u.pathname === '/api/walkthroughs/action') {
        posted.push(JSON.parse(r.request().postData() ?? '{}'));
        return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://office.test/');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const T = <R>(js: string) => page.evaluate(js) as Promise<R>;
    await T(`T.w.update({ floor: 'demo', status: 'running', sha: '${SHA}', viewPort: 9, log: [], available: true }, true)`);
    await page.waitForSelector('.wt-card');
    const cards = await T<string[]>(`[...document.querySelectorAll('.wt-card')].map((c) => c.querySelector('h4').textContent + ' | ' + c.querySelector('.wt-tags').textContent)`);
    assert.equal(cards.length, 2);
    assert.match(cards[0], /Submit a new request Passed \| Auto · Requests · @abc1234 · 21 s · MP4 · voice/);
    assert.match(cards[1], /Approve a request Failed at step 2 \| By Pat · @abc1234/);
    assert.equal(await T<number>(`[...document.querySelectorAll('.wt-card')][1].querySelectorAll('button').length ? [...[...document.querySelectorAll('.wt-card')][1].querySelectorAll('button')].filter((b) => b.textContent === 'Save to repo').length : -1`), 0, 'a failed run is never offered as evidence');
    assert.match(await T<string>(`document.querySelector('.wt-job').textContent`), /Recording Approve a request · Step 1 of 3/);
    assert.equal(await T<number>(`document.querySelectorAll('.wt-controls select option').length`), 2);

    // Save to repo posts the recording.
    await page.click('.wt-card:first-child >> text=Save to repo');
    await page.waitForTimeout(200);
    assert.deepEqual(posted.at(-1), { action: 'save', floor: 'demo', id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAA1' });

    // The player: video with its captions track, the steps; Esc gives focus back to ▶ Watch.
    await page.click('.wt-card:first-child >> text=▶ Watch');
    await page.waitForSelector('.wt-player');
    const player = await T<{ src: string; track: string; marks: number; close: boolean; ev: string }>(`(() => { const p = document.querySelector('.wt-player'); return { src: p.querySelector('video').getAttribute('src'), track: p.querySelector('track').getAttribute('src'), marks: p.querySelectorAll('.wt-mark').length, close: !!p.querySelector('.close'), ev: p.querySelector('.wt-evidence').textContent }; })()`);
    assert.match(player.src, /\/api\/walkthroughs\/file\?floor=demo&id=wt_01JAAAAAAAAAAAAAAAAAAAAAA1&name=walkthrough\.mp4/);
    assert.match(player.track, /name=captions\.vtt/);
    assert.equal(player.marks, 2);
    assert.ok(player.close, 'a ✕ in the top right');
    assert.match(player.ev, /Evidence for @abc1234 only: 2 of 2 steps passed/);
    await page.keyboard.press('Escape');
    assert.equal(await T<boolean>(`!document.querySelector('.wt-player')`), true);
    assert.equal(await T<string>(`document.activeElement.textContent`), '▶ Watch', 'focus back where it was opened from');
    // ✕ too.
    await page.click('.wt-card:first-child >> text=▶ Watch');
    await page.click('.wt-player .close');
    assert.equal(await T<string>(`document.activeElement.textContent`), '▶ Watch');

    // The readiness card links a ready milestone to its video.
    const link = await T<string>(`(() => { const c = T.readinessCard({ floor: 'demo', status: 'running', log: [], available: true, readiness: { sha: '${SHA}', goal: 'Sample', ready: false, headline: 'h', at: 1, milestones: [{ id: 'phase-1', title: 'Requests', rows: [1], inLive: [1], onMain: [], onBranch: [], missing: [], journeys: [], state: 'ready', line: 'Ready: Requests' }, { id: 'phase-2', title: 'Approval', rows: [2], inLive: [], onMain: [], onBranch: [], missing: [2], journeys: [], state: 'not-built', line: 'x' }] } }, (m) => T.w.linkFor(m, '${SHA}')); return [...c.querySelectorAll('.wt-link')].map((b) => b.textContent).join(','); })()`);
    assert.equal(link, '▶ Walkthrough');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
