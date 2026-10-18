// Walkthrough videos end to end, against a fake live app (tests/fixtures/walkthroughs/app.ts) and a fake
// journey in a throwaway git repo: a passing journey makes a video, step screenshots, captions and a
// manifest tied to the commit; a failing step stops the recording and marks it failed; the annotations are
// in the page; nothing but the app's origin is reached; auto-record runs only on ready with the switch on;
// Save to repo opens a pull request through a fake gh (a branch on a local bare "origin", never main); a
// guided tour chains the passing videos. Headless Chromium; skipped where it can't start. Fake voice only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Walkthroughs } from '../src/server/walkthroughs/index.js';
import { findFfmpeg, runTool } from '../src/server/walkthroughs/media.js';
import { launchChromium } from '../src/server/walkthroughs/recorder.js';
import { OVERLAY_HOST, OVERLAY_SCRIPT } from '../src/server/walkthroughs/overlay.js';
import { fakeVoice } from '../src/server/walkthroughs/tts.js';
import type { LiveReadiness } from '../src/shared/liveapp/readiness.js';
import { removeDir } from './support/cleanup.js';
import { DEMO, FAILING, PASSING, fakeApp, type FakeApp } from './fixtures/walkthroughs/app.js';

const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let chromiumOk = true;
const browserCheck = launchChromium().then(
  (b) => b.close(),
  () => (chromiumOk = false),
);

interface Rig {
  root: string;
  repo: string;
  origin: string;
  sha: string;
  app: FakeApp;
  gh: string[][];
  w: Walkthroughs;
  live: { running: boolean; commit?: string; url?: string };
}

async function rig(o: { ffmpeg?: boolean } = {}): Promise<Rig> {
  const root = mkdtempSync(path.join(tmpdir(), 'walk-rec-'));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'project');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(repo, 'init', '-q', '-b', 'main');
  mkdirSync(path.join(repo, 'tests', 'e2e'), { recursive: true });
  writeFileSync(path.join(repo, 'tests', 'e2e', 'new-request.journey.json'), JSON.stringify(PASSING, null, 2));
  writeFileSync(path.join(repo, 'tests', 'e2e', 'approve-request.journey.json'), JSON.stringify(FAILING, null, 2));
  writeFileSync(path.join(repo, 'README.md'), '# Sample app\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'Sample app with two journeys');
  g(repo, 'remote', 'add', 'origin', origin);
  g(repo, 'push', '-q', '-u', 'origin', 'main');
  g(repo, 'fetch', '-q', 'origin');
  const sha = g(repo, 'rev-parse', 'HEAD');
  const app = await fakeApp();
  const gh: string[][] = [];
  const live = { running: true, commit: sha, url: app.url };
  const w = new Walkthroughs({
    dataDir: path.join(root, 'data'),
    floorDir: (id) => (id === 'demo' ? repo : undefined),
    live: () => live,
    gh: async (args) => {
      gh.push(args);
      return 'https://github.com/example/sample-app/pull/7\n';
    },
    tool: o.ffmpeg ? findFfmpeg() : {},
    voice: fakeVoice,
    cardMs: 300,
    stepMs: 300,
  });
  await w.store.setSettings('demo', { autoRecord: true, narrate: false, demoUser: DEMO.user, demoPassword: DEMO.password });
  return { root, repo, origin, sha, app, gh, w, live };
}

async function done(r: Rig) {
  await r.w.idle();
  await r.app.close();
  removeDir(r.root);
}

test('the annotations: caption bar, step counter, chapter card and highlight, in a shadow root the text checks never read', async (t) => {
  await browserCheck;
  if (!chromiumOk) return t.skip('no headless Chromium here');
  const b = await launchChromium();
  try {
    const ctx = await b.newContext({ viewport: { width: 800, height: 600 } });
    await ctx.addInitScript({ content: OVERLAY_SCRIPT });
    const page = (await ctx.newPage()) as unknown as { setContent(h: string): Promise<void>; evaluate<R>(f: string): Promise<R> };
    await page.setContent('<p>Hello</p>');
    const st = await page.evaluate<{ caption: string; counter: string; chapter: string; highlight: boolean; captionShown: boolean }>(`(() => { __wt.chapter('A title', 'sub'); const c = __wt.state(); __wt.step(2, 5, 'Click New request'); __wt.highlight({ x: 10, y: 10, width: 50, height: 20 }); return { ...__wt.state(), chapter: c.chapter }; })()`);
    assert.deepEqual(st, { caption: 'Click New request', counter: 'Step 2 of 5', chapter: 'A title', highlight: true, captionShown: true });
    assert.equal(await page.evaluate<boolean>(`!!document.getElementById('${OVERLAY_HOST}').shadowRoot`), true);
    assert.equal(await page.evaluate<boolean>(`document.body.innerText.includes('Click New request')`), false, 'a journey text check can never be satisfied by our own caption');
  } finally {
    await b.close();
  }
});

test('a passing journey: video, step screenshots, captions and a manifest tied to the commit; nothing else reached; Save to repo opens a PR', async (t) => {
  await browserCheck;
  if (!chromiumOk) return t.skip('no headless Chromium here');
  const r = await rig({ ffmpeg: false });
  try {
    const view = await r.w.view('demo', true);
    assert.deepEqual(view.journeys.map((j) => j.id).sort(), ['approve-request', 'new-request']);
    const id = await r.w.record('demo', 'new-request', { by: 'Pat' });
    await r.w.idle();
    const m = (await r.w.store.read('demo', id))!;
    assert.equal(m.status, 'passed', JSON.stringify(m.failure));
    assert.equal(m.app.commit, r.sha);
    assert.equal(m.app.user, DEMO.user);
    assert.deepEqual(m.journey.requirement, ['UC-01', 'build-plan row 2']);
    assert.deepEqual(m.steps.map((s) => s.status), ['passed', 'passed', 'passed', 'passed']);
    assert.ok(m.steps.every((s, k) => s.startMs! < s.endMs! && (k === 0 || s.startMs! >= m.steps[k - 1].endMs! - 5)), 'steps in order on the timeline');
    const dir = r.w.store.recDir('demo', id);
    assert.equal(m.outputs.format, 'webm', 'no ffmpeg: the WebM as recorded');
    assert.ok(m.outputs.notes.some((n) => /ffmpeg/.test(n)));
    assert.ok(readFileSync(path.join(dir, 'walkthrough.webm')).length > 1000);
    for (const s of m.steps) assert.ok(existsSync(path.join(dir, s.screenshot!)), s.screenshot);
    assert.match(readFileSync(path.join(dir, 'captions.vtt'), 'utf8'), /Step 4 of 4 · Submit the request/);
    assert.equal(r.app.otherHits(), 0, 'the recorder only reaches the app’s own origin');

    await r.w.save('demo', id, 'Pat');
    const saved = (await r.w.store.read('demo', id))!.saved!;
    assert.equal(saved.pr, 7);
    assert.equal(saved.path, 'docs/walkthroughs/new-request');
    const create = r.gh.find((a) => a[0] === 'pr' && a[1] === 'create')!;
    assert.equal(create[create.indexOf('--base') + 1], 'main');
    assert.equal(create[create.indexOf('--head') + 1], saved.branch);
    assert.match(create[create.indexOf('--body') + 1], new RegExp(`evidence only for \`${r.sha.slice(0, 12)}\``));
    const files = g(r.origin, 'ls-tree', '-r', '--name-only', saved.branch);
    for (const f of ['docs/walkthroughs/index.md', 'docs/walkthroughs/new-request/manifest.json', 'docs/walkthroughs/new-request/walkthrough.webm', 'docs/walkthroughs/new-request/captions.vtt', 'docs/walkthroughs/new-request/steps/01.png']) assert.ok(files.includes(f), `${f} on the branch`);
    assert.equal(g(r.origin, 'rev-parse', 'main'), r.sha, 'main never moves');
    assert.match(g(r.origin, 'show', `${saved.branch}:docs/walkthroughs/index.md`), /\[Submit a new request\]\(new-request\/walkthrough\.webm\)/);
    assert.equal(g(r.repo, 'worktree', 'list').split('\n').length, 1, 'the temporary worktree is gone');
    await assert.rejects(r.w.save('demo', id, 'Pat'), /already saved/);
  } finally {
    await done(r);
  }
});

test('a failing step stops the recording honestly: marked failed, the rest not run, never saved as evidence', async (t) => {
  await browserCheck;
  if (!chromiumOk) return t.skip('no headless Chromium here');
  const r = await rig();
  try {
    const id = await r.w.record('demo', 'approve-request', { by: 'Pat' });
    await r.w.idle();
    const m = (await r.w.store.read('demo', id))!;
    assert.equal(m.status, 'failed');
    assert.equal(m.failure?.step, 2);
    assert.match(m.failure?.why ?? '', /btnApprove/);
    assert.deepEqual(m.steps.map((s) => s.status), ['passed', 'failed', 'not-run']);
    assert.ok(existsSync(path.join(r.w.store.recDir('demo', id), 'steps', '02.png')), 'the failure is on screen and screenshotted');
    assert.match(readFileSync(path.join(r.w.store.recDir('demo', id), 'captions.vtt'), 'utf8'), /failed: /);
    await assert.rejects(r.w.save('demo', id, 'Pat'), /only a passing walkthrough/);
    assert.equal(r.gh.length, 0);
  } finally {
    await done(r);
  }
});

const ready = (sha: string, result: 'passed' | 'failed'): LiveReadiness => ({ sha, goal: 'Sample app', ready: true, headline: '', at: 1, milestones: [{ id: 'phase-1', title: 'Requests', rows: [2], inLive: [2], onMain: [], onBranch: [], missing: [], journeys: [{ id: 'new-request', result }], state: result === 'passed' ? 'ready' : 'unverified', line: '' }] });

test('auto-record: a milestone ready with its journey passed records it; switched off or failed records nothing; cancel works', async (t) => {
  await browserCheck;
  if (!chromiumOk) return t.skip('no headless Chromium here');
  const r = await rig();
  try {
    const news = { key: 'k', kind: 'ready' as const, milestone: 'phase-1', title: 'Requests', at: 1, sha: r.sha };
    assert.deepEqual(await r.w.onReady('demo', news, ready(r.sha, 'failed')), [], 'not verified: nothing');
    await r.w.setSettings('demo', { autoRecord: false });
    assert.deepEqual(await r.w.onReady('demo', news, ready(r.sha, 'passed')), [], 'switched off: nothing');
    await r.w.setSettings('demo', { autoRecord: true });
    const [id] = await r.w.onReady('demo', news, ready(r.sha, 'passed'));
    assert.ok(id);
    assert.deepEqual(await r.w.onReady('demo', news, ready(r.sha, 'passed')), [], 'queued once');
    await r.w.idle();
    const m = (await r.w.store.read('demo', id))!;
    assert.equal(m.trigger, 'auto');
    assert.deepEqual(m.milestone, { id: 'phase-1', title: 'Requests' });
    assert.equal(m.status, 'passed');
    // Cancel a running one.
    const c = await r.w.record('demo', 'new-request', { by: 'Pat' });
    while (!(await r.w.view('demo', true)).jobs.some((j) => j.id === c && j.status === 'running' && j.line?.startsWith('Step'))) await new Promise((x) => setTimeout(x, 50));
    assert.equal(r.w.cancel('demo', c), true);
    await r.w.idle();
    assert.equal((await r.w.store.read('demo', c))!.status, 'cancelled');
  } finally {
    await done(r);
  }
});

test('with ffmpeg: an MP4 with the (fake) narration voice, then a guided tour with chapters', async (t) => {
  await browserCheck;
  const tool = findFfmpeg();
  if (!chromiumOk || !tool.ffmpeg || !tool.ffprobe) return t.skip('needs headless Chromium and ffmpeg');
  const r = await rig({ ffmpeg: true });
  try {
    const id = await r.w.record('demo', 'new-request', { by: 'Pat', narrate: true });
    await r.w.idle();
    const m = (await r.w.store.read('demo', id))!;
    assert.equal(m.status, 'passed', JSON.stringify(m));
    assert.equal(m.outputs.format, 'mp4');
    assert.equal(m.outputs.narration, 'fake');
    const mp4 = path.join(r.w.store.recDir('demo', id), 'walkthrough.mp4');
    const streams = await runTool(tool.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', mp4]);
    assert.deepEqual(streams.trim().split(/\r?\n/).sort(), ['audio', 'video']);
    const tid = await r.w.tour('demo', 'Pat');
    await r.w.idle();
    const tour = (await r.w.store.read('demo', tid))!;
    assert.equal(tour.status, 'passed', JSON.stringify(tour.failure));
    assert.equal(tour.kind, 'tour');
    assert.deepEqual(tour.parts?.map((p) => p.title), ['Introduction', 'Submit a new request', 'End of the tour']);
    assert.ok(tour.durationMs! > m.durationMs!);
    assert.match(readFileSync(path.join(r.w.store.recDir('demo', tid), 'chapters.vtt'), 'utf8'), /Submit a new request/);
    assert.ok(existsSync(path.join(r.w.store.recDir('demo', tid), 'cards', 'intro.png')));
  } finally {
    await done(r);
  }
});
