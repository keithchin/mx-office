// The recorder plays a journey exactly as the toolkit's journey runner does. The same neutral journey is
// played by a re-implementation of the runner's action table (./fixtures/walkthroughs/journey-runner-ref.ts)
// and by the recorder, each on a fresh "database" of the fake app's checks sheet (cells in rows where
// `within` + `hasText` decide which one, an uploader, a language selector, a Downshift combobox, a
// validation dialog), and both must leave the same cells, values, files and language behind. A step that
// fails with the app's error dialog on screen says what the app showed; setFiles never reaches outside the
// commit's files; and the recorder knows every action name the runner's act() switch has (the reference's,
// and any real runner named in WALKTHROUGH_RUNNERS, so a new runner action is flagged). Headless Chromium;
// skipped where it can't start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { RECORDER_ACTIONS, scriptOf } from '../src/shared/walkthroughs/script.js';
import type { WalkScript } from '../src/shared/walkthroughs/types.js';
import { fixturePaths } from '../src/server/walkthroughs/actions.js';
import { launchChromium, record } from '../src/server/walkthroughs/recorder.js';
import { signIn } from '../src/server/walkthroughs/signin.js';
import { DEMO, fakeApp, type FakeApp } from './fixtures/walkthroughs/app.js';
import { runJourney } from './fixtures/walkthroughs/journey-runner-ref.js';
import { browserCheck } from './fixtures/walkthroughs/rig.js';
import { removeDir } from './support/cleanup.js';

const S = { settleMs: 100 };
const PARITY = {
  id: 'checks-parity',
  title: 'Fill in the checks',
  seeds: [{ name: 'reading', value: '12.5' }],
  steps: [
    { name: 'Open the checks', actions: [{ do: 'nav', item: 'Checks', ...S }], ui: { ready: '.mx-name-ctnRow', textPresent: ['Checks'] } },
    { name: 'Pick the shift', actions: [{ do: 'combobox', widget: 'cbShift', match: 'Night', label: 'Shift', ...S }] },
    { name: 'Tick the second check', actions: [{ do: 'click', widget: 'btnOk', label: 'OK', within: 'ctnRow', hasText: 'drain the tank', ...S }], data: { oql: [{ sql: 'SELECT 1', expect: 1 }] } },
    { name: 'Type the reading', actions: [{ do: 'fill', widget: 'tbValue', label: 'Reading', within: 'ctnRow', hasText: 'LINE PRESSURE', value: '{{reading}}', blur: true, ...S }] },
    { name: 'Attach a photo', actions: [{ do: 'setFiles', widget: 'fuPhoto', label: 'Photo', file: 'sample-photo.png', ...S }] },
    { name: 'Switch to Dutch', actions: [{ do: 'pickLanguage', match: 'nederlands', ...S }], ui: { textPresent: ['Controles'] } },
    { name: 'Save', actions: [{ do: 'click', widget: 'btnSave', label: 'Save', ...S }, { do: 'dismissModal', ...S }], ui: { textPresent: ['Checks saved'] } },
  ],
};

/** A reading that isn't a number: Save puts up the app's error dialog, and the next click lands on its underlay. */
const REFUSED = {
  id: 'checks-refused',
  title: 'Save a bad reading',
  steps: [
    { name: 'Open the checks', actions: [{ do: 'nav', item: 'Checks', ...S }], ui: { ready: '.mx-name-ctnRow' } },
    { name: 'Type a bad reading', actions: [{ do: 'fill', widget: 'tbValue', within: 'ctnRow', hasText: 'first check', value: 'twelve', blur: true, ...S }] },
    { name: 'Save', actions: [{ do: 'click', widget: 'btnSave', ...S }] },
    { name: 'Save again', actions: [{ do: 'click', widget: 'btnSave', ...S }] },
  ],
};

/** A commit's files with the runner's fixtures folder: tests/e2e/fixtures/sample-photo.png. */
function workspace(): string {
  const ws = mkdtempSync(path.join(tmpdir(), 'wt-parity-'));
  mkdirSync(path.join(ws, 'tests', 'e2e', 'fixtures'), { recursive: true });
  writeFileSync(path.join(ws, 'tests', 'e2e', 'fixtures', 'sample-photo.png'), Buffer.alloc(321, 7));
  return ws;
}

/** The runner's walk on a signed-in page; what failed (undefined: passed) and what the app's sheet holds after. */
async function viaRunner(app: FakeApp, journey: typeof PARITY | typeof REFUSED, ws: string) {
  const b = await launchChromium();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await signIn(page as never, app.url, DEMO, ctx as never);
    const failed = await runJourney(page as unknown as Page, journey as never, path.join(ws, 'tests', 'e2e', 'fixtures'));
    return { failed, sheet: app.sheet() };
  } finally {
    await b.close();
  }
}

async function viaRecorder(app: FakeApp, journey: typeof PARITY | typeof REFUSED, ws: string, film: boolean) {
  const out = mkdtempSync(path.join(tmpdir(), 'wt-parity-out-'));
  try {
    const script = scriptOf(`tests/e2e/${journey.id}.journey.json`, JSON.stringify(journey)) as WalkScript;
    const res = await record({ url: app.url, script, outDir: out, login: DEMO, signal: new AbortController().signal, film, cardMs: 0, stepMs: 0, workspace: ws, launch: launchChromium });
    return { res, sheet: app.sheet() };
  } finally {
    removeDir(out);
  }
}

test('the runner and the recorder play the same journey to the same end: cells by within + hasText, the reading, the file, the language, the shift', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const app = await fakeApp();
  const ws = workspace();
  try {
    const runner = await viaRunner(app, PARITY, ws);
    assert.equal(runner.failed, undefined, 'the runner passes the journey');
    assert.deepEqual(runner.sheet, { shift: 'Night', 'r2:1': 'ok', 'r3:v': '12.5', files: 'sample-photo.png (321 bytes)', lang: 'Nederlands', saved: 'yes' }, 'the second row’s first cell, the third row’s reading: not the first ones on the page');
    app.reset();
    const hits = app.otherHits();
    const rec = await viaRecorder(app, PARITY, ws, true);
    assert.equal(rec.res.status, 'passed', JSON.stringify(rec.res.failure));
    assert.deepEqual(rec.sheet, runner.sheet, 'the recorder leaves exactly what the runner leaves');
    assert.deepEqual(rec.res.steps[2].notes, ['data (OQL) checks not run in recordings'], 'a step’s data checks are said as not run');
    assert.equal(rec.res.steps[0].notes, undefined);
    assert.equal(app.otherHits(), hits, 'the recorder reaches only the app’s origin');
  } finally {
    await app.close();
    removeDir(ws);
  }
});

test('a step that fails under the app’s error dialog says what the app showed, apart from what the recorder couldn’t do', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const app = await fakeApp();
  const ws = workspace();
  try {
    const runner = await viaRunner(app, REFUSED, ws);
    assert.match(runner.failed ?? '', /^Save again: actions: .*covered by .(mx-underlay|modal-dialog)/, 'the runner fails there too');
    app.reset();
    const { res } = await viaRecorder(app, REFUSED, ws, true);
    assert.equal(res.status, 'failed', JSON.stringify(res.failure));
    assert.equal(res.failure?.step, 4, JSON.stringify(res.failure));
    assert.equal(res.failure?.step, 4, 'the same step as the runner');
    assert.equal(res.failure?.said, 'Error — Value has an issue: Row r1: the value does not fit this row (a number or a dash)');
    assert.match(res.failure?.why ?? '', /^the app showed an error: “Error — Value has an issue: Row r1: .*” \(then: couldn't click \.mx-name-btnSave: it is covered by .(mx-underlay|modal-dialog)/);
    assert.equal(res.steps[3].said, res.failure?.said);
    assert.ok(res.steps[3].screenshot, 'the dialog is in the failed step’s screenshot');
    assert.deepEqual(res.steps.map((s) => s.status), ['passed', 'passed', 'passed', 'failed']);

    // Closing it with dismissModal is said beside the step, with the app's words.
    app.reset();
    const closed = await viaRecorder(app, { ...REFUSED, steps: [...REFUSED.steps.slice(0, 2), { name: 'Save', actions: [{ do: 'click', widget: 'btnSave', ...S }, { do: 'dismissModal', ...S }] }] } as typeof REFUSED, ws, false);
    assert.equal(closed.res.status, 'passed', JSON.stringify(closed.res.failure));
    assert.deepEqual(closed.res.steps[2].notes, ['closed the app\'s error: “Error — Value has an issue: Row r1: the value does not fit this row (a number or a dash)”']);

    // A widget that isn't there is the recorder not finding it, with the container it looked in.
    app.reset();
    const lost = await viaRecorder(app, { ...REFUSED, steps: [REFUSED.steps[0], { name: 'Tick', actions: [{ do: 'click', widget: 'btnOk', within: 'ctnRow', hasText: 'no such row', ...S }] }] } as typeof REFUSED, ws, false);
    assert.equal(lost.res.failure?.why, 'couldn\'t find a .mx-name-ctnRow that says “no such row”');
    assert.equal(lost.res.failure?.said, undefined);
  } finally {
    await app.close();
    removeDir(ws);
  }
});

test('setFiles takes files from the recorded commit’s tests/e2e/fixtures only', async () => {
  const ws = workspace();
  try {
    assert.deepEqual(await fixturePaths(ws, ['sample-photo.png']), [path.join(await import('node:fs/promises').then((f) => f.realpath(ws)), 'tests', 'e2e', 'fixtures', 'sample-photo.png')]);
    await assert.rejects(fixturePaths(ws, ['../../../../outside.txt']), /outside the recorded commit’s files/);
    await assert.rejects(fixturePaths(ws, ['../../../']), /outside the recorded commit’s files/);
    await assert.rejects(fixturePaths(ws, ['missing.png']), /couldn't find tests\/e2e\/fixtures\/missing\.png in the recorded commit/);
    await assert.rejects(fixturePaths(undefined, ['sample-photo.png']), /no copy of the commit’s files/);
    // A link inside the fixtures that leads out of the commit is refused too.
    const outside = mkdtempSync(path.join(tmpdir(), 'wt-outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'x');
    let linked = true;
    try {
      symlinkSync(path.join(outside, 'secret.txt'), path.join(ws, 'tests', 'e2e', 'fixtures', 'link.txt'), 'file');
    } catch {
      linked = false; // Windows without the right to make links.
    }
    if (linked) await assert.rejects(fixturePaths(ws, ['link.txt']), /leads outside the recorded commit’s files/);
    removeDir(outside);
  } finally {
    removeDir(ws);
  }
});

test('a journey’s runner actions as recorder actions: targeting, settle, blur, files, language; malformed and unknown ones said apart', () => {
  const s = scriptOf('tests/e2e/checks.journey.json', JSON.stringify(PARITY)) as WalkScript;
  assert.deepEqual(s.steps[2].actions, [{ do: 'click', selector: '.mx-name-btnOk', caption: 'Click OK', within: '.mx-name-ctnRow', hasText: 'drain the tank', settleMs: 100 }]);
  assert.deepEqual(s.steps[3].actions[0], { do: 'fill', selector: '.mx-name-tbValue', value: '12.5', caption: 'Type “12.5” into Reading', blur: true, within: '.mx-name-ctnRow', hasText: 'LINE PRESSURE', settleMs: 100 });
  assert.deepEqual(s.steps[4].actions, [{ do: 'setFiles', selector: '.mx-name-fuPhoto', files: ['sample-photo.png'], caption: 'Attach sample-photo.png to Photo', settleMs: 100 }]);
  assert.deepEqual(s.steps[5].actions, [{ do: 'pickLanguage', match: 'nederlands', caption: 'Pick the language nederlands', settleMs: 100 }]);
  assert.equal(s.steps[2].unchecked, 'data (OQL) checks not run in recordings');
  assert.ok(s.steps.every((x) => !x.blocked));
  const odd = scriptOf('tests/e2e/odd.journey.json', JSON.stringify({ steps: [{ name: 'a', actions: [{ do: 'setFiles', widget: 'fuPhoto' }] }, { name: 'b', actions: [{ do: 'teleport' }] }, { name: 'c', spans: { ordered: ['X'] } }] })) as WalkScript;
  assert.match(odd.steps[0].blocked ?? '', /“setFiles” action is missing what it acts on/);
  assert.equal(odd.steps[1].blocked, 'the recorder can\'t do “teleport” yet');
  assert.equal(odd.steps[2].unchecked, 'trace (spans) checks not run in recordings');
});

/** The action names of a journey runner's act() switch. */
function runnerActions(text: string): string[] {
  const start = text.search(/(?:export\s+)?async function act\s*\(/);
  assert.ok(start >= 0, 'the runner has an act() function');
  const end = text.indexOf('\n}', start);
  const body = text.slice(start, end > start ? end : undefined);
  return [...new Set([...body.matchAll(/\bcase\s+'([A-Za-z]+)'\s*:/g)].map((m) => m[1]))].sort();
}

test('the recorder knows every action the journey runner’s act() switch defines', () => {
  const mine = [...RECORDER_ACTIONS].sort();
  const ref = runnerActions(readFileSync(path.join(import.meta.dirname, 'fixtures', 'walkthroughs', 'journey-runner-ref.ts'), 'utf8'));
  assert.deepEqual(mine, ref, 'the recorder plays exactly the reference runner’s actions (a runner action added there must be played here)');
  // Real runners (a project's tests/e2e/journey-runner.js, a toolkit pin's), when named: none may know an action the recorder doesn't.
  for (const file of (process.env.WALKTHROUGH_RUNNERS ?? '').split(path.delimiter).filter(Boolean)) {
    const theirs = runnerActions(readFileSync(file, 'utf8'));
    assert.deepEqual(theirs.filter((a) => !mine.includes(a)), [], `${file} has actions the recorder can't play`);
  }
});
