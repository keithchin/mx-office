// Walkthrough videos end to end, against a fake app (tests/fixtures/walkthroughs/app.ts) standing in for the
// office's own recording copy (the boot dep; app-instance.test.ts covers the real one), and fake journeys in
// a throwaway git repo (./fixtures/walkthroughs/rig.ts): a passing journey makes a video, step screenshots,
// captions and a manifest tied to the commit, recorded in a batch that boots the app once and stops it after;
// a failing step stops the recording and marks it failed; the annotations are in the page; nothing but the
// app's origin is reached; Save to repo opens a pull request through a fake gh (a branch on a local bare
// "origin", never main); a guided tour chains the passing videos. Headless Chromium; skipped where it can't
// start. Fake voice only. Auto-record and the sign-in are walkthroughs-auto.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findFfmpeg, runTool } from '../src/server/walkthroughs/media.js';
import { launchChromium } from '../src/server/walkthroughs/recorder.js';
import { OVERLAY_HOST, OVERLAY_SCRIPT } from '../src/server/walkthroughs/overlay.js';
import { DEMO } from './fixtures/walkthroughs/app.js';
import { browserCheck, done, g, only, rig } from './fixtures/walkthroughs/rig.js';

test('the annotations: caption bar, step counter, chapter card and highlight, in a shadow root the text checks never read', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
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
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ ffmpeg: false });
  try {
    const view = await r.w.view('demo', true);
    assert.deepEqual(view.journeys.map((j) => j.id).sort(), ['approve-request', 'new-request']);
    assert.equal(view.main?.commit, r.sha, 'Record records main’s newest commit');
    await r.w.record('demo', { by: 'Pat', journeys: ['new-request'] });
    await r.w.idle();
    const id = await only(r, 'new-request');
    const m = (await r.w.store.read('demo', id))!;
    assert.deepEqual([r.boots, r.stops], [[r.sha], 1], 'one recording app for the batch, stopped after');
    assert.equal(m.app.instance, true);
    assert.equal(m.app.userFrom, 'setting', 'no journey-runner config in this project: the setting');
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
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig();
  try {
    await r.w.record('demo', { by: 'Pat', journeys: ['approve-request'] });
    await r.w.idle();
    const id = await only(r, 'approve-request');
    const m = (await r.w.store.read('demo', id))!;
    assert.equal(m.status, 'failed');
    assert.equal(m.failure?.step, 2);
    assert.deepEqual(m.journey.notes, ['START STATE: run directly after new-request (its request is the one approved).'], 'what the journey says it needs comes along to the card');
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

test('with ffmpeg: an MP4 with the (fake) narration voice, then a guided tour with chapters', async (t) => {
  const tool = findFfmpeg();
  if (!(await browserCheck) || !tool.ffmpeg || !tool.ffprobe) return t.skip('needs headless Chromium and ffmpeg');
  const r = await rig({ ffmpeg: true });
  try {
    await r.w.record('demo', { by: 'Pat', journeys: ['new-request'], narrate: true });
    await r.w.idle();
    const id = await only(r, 'new-request');
    const m = (await r.w.store.read('demo', id))!;
    assert.equal(m.status, 'passed', JSON.stringify(m));
    assert.equal(m.outputs.format, 'mp4');
    assert.equal(m.outputs.narration, 'fake');
    const mp4 = path.join(r.w.store.recDir('demo', id), 'walkthrough.mp4');
    const streams = await runTool(tool.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', mp4]);
    assert.deepEqual(streams.trim().split(/\r?\n/).sort(), ['audio', 'video']);
    await r.w.tour('demo', 'Pat');
    await r.w.idle();
    const tour = (await r.w.store.list('demo')).find((x) => x.kind === 'tour')!;
    assert.equal(tour.status, 'passed', JSON.stringify(tour.failure));
    assert.equal(tour.kind, 'tour');
    assert.deepEqual(tour.parts?.map((p) => p.title), ['Introduction', 'Submit a new request', 'End of the tour']);
    assert.ok(tour.durationMs! > m.durationMs!);
    assert.match(readFileSync(path.join(r.w.store.recDir('demo', tour.id), 'chapters.vtt'), 'utf8'), /Submit a new request/);
    assert.ok(existsSync(path.join(r.w.store.recDir('demo', tour.id), 'cards', 'intro.png')));
  } finally {
    await done(r);
  }
});
