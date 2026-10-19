// How a walkthrough batch starts its recording app (src/server/walkthroughs/batch.ts with the rig's fake app,
// ./fixtures/walkthroughs/rig.ts): while it starts, the page gets its boot phase and how long that phase and
// the whole start have taken; what the start took (phase by phase, the bundle, a retry) goes in every
// recording's manifest, a retry with a note on the card; a start that fails says, on every card, which phase
// and why, in full. The words the page shows are shared/app-instance.ts bootProgress; what it waits for is
// walkthroughs/busy.ts (a live app building).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootProgress, type BootTiming } from '../src/shared/app-instance.js';
import type { LiveAppStatus } from '../src/shared/protocol.js';
import { liveAppBuilding } from '../src/server/walkthroughs/busy.js';
import { browserCheck, done, rig } from './fixtures/walkthroughs/rig.js';

test('the page’s words for a start: its phase, the time it has taken, the live app it waits for, a retry', () => {
  assert.equal(bootProgress({ phase: 'bundling', phaseMs: 72_000, ms: 160_000 }), 'Bundling the web client · 1 min 12 s (2 min 40 s in all)');
  assert.equal(bootProgress({ phase: 'workspace', phaseMs: 3_000, ms: 3_000 }), 'Updating the recording workspace · 3 s (3 s in all)');
  assert.equal(bootProgress({ phase: 'waiting', phaseMs: 65_000, ms: 65_000 }, 'Waiting for the project’s live app to finish building: two builds at once slow each other past mxcli’s limits…'), 'Waiting for the project’s live app to finish building · 1 min 5 s (1 min 5 s in all)');
  assert.equal(bootProgress({ phase: 'building', phaseMs: 1_000, ms: 400_000 }, 'It failed to start once (bundling the web client timed out after 5m0s); trying once more…'), 'Building the app · 1 s (6 min 40 s in all) · It failed to start once (bundling the web client timed out after 5m0s); trying once more…');
});

test('what the recording app waits for: the project’s own live app building first, then any other project’s; a running or stopped one never', () => {
  const floors = [
    { id: 'demo', def: { name: 'Sample app' } },
    { id: 'other', def: { name: 'Second sample' } },
  ];
  const at = (s: Record<string, LiveAppStatus>) => (id: string) => s[id];
  assert.equal(liveAppBuilding(floors, at({ demo: 'starting', other: 'updating' }), 'demo'), 'the project’s live app');
  assert.equal(liveAppBuilding(floors, at({ demo: 'updating' }), 'demo'), 'the project’s live app');
  assert.equal(liveAppBuilding(floors, at({ demo: 'running', other: 'starting' }), 'demo'), 'the live app of “Second sample”');
  assert.equal(liveAppBuilding(floors, at({ demo: 'running', other: 'failed' }), 'demo'), undefined);
  assert.equal(liveAppBuilding(floors, at({}), 'demo'), undefined);
});

test('a start that fails: every card says which phase and why, in full', async () => {
  const r = await rig();
  try {
    const why = `bundling the web client failed after 5 min: bundling the web client timed out after 5m0s. It had failed once before (bundling the web client timed out after 5m0s) and was tried again. The machine was too busy to bundle the web client in time (often another app building at the same moment): record again; the next start reuses the warm workspace and is much faster.`;
    r.bootError = why;
    await r.w.record('demo', { by: 'Pat' });
    await r.w.idle();
    const all = await r.w.store.list('demo');
    assert.equal(all.length, 2);
    for (const m of all) {
      assert.equal(m.status, 'error');
      assert.equal(m.failure?.why, `the recording app didn’t start: ${why}`, 'the whole reason, phase and what to do, not cut short');
    }
  } finally {
    await done(r);
  }
});

test('while the app starts the page sees its phase and elapsed time; the manifest keeps what the start took and the card notes a retry', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const timing: BootTiming = { ms: 98_000, workspace: 'reused', phases: { workspace: 1_000, database: 2_000, building: 40_000, bundling: 15_000, runtime: 40_000 }, bundleMs: 14_972, retried: 'bundling the web client timed out after 5m0s' };
  const r = await rig({ journeys: { 'new-request': (await import('./fixtures/walkthroughs/app.js')).PASSING }, boot: { phases: ['workspace', 'database', 'building', 'bundling'], gate, timing } });
  try {
    const id = await r.w.record('demo', { by: 'Pat' });
    let b = (await r.w.view('demo', true)).batches.find((x) => x.id === id);
    for (let i = 0; i < 200 && b?.boot?.phase !== 'bundling'; i++) {
      await new Promise((x) => setTimeout(x, 20));
      b = (await r.w.view('demo', true)).batches.find((x) => x.id === id);
    }
    assert.equal(b?.phase, 'booting');
    assert.equal(b?.boot?.phase, 'bundling', 'the phase the start is in');
    await new Promise((x) => setTimeout(x, 60));
    b = (await r.w.view('demo', true)).batches.find((x) => x.id === id);
    assert.ok((b?.boot?.phaseMs ?? 0) >= 50 && (b?.boot?.ms ?? 0) >= (b?.boot?.phaseMs ?? 0), `elapsed: ${JSON.stringify(b?.boot)}`);
    assert.ok(!('booting' in (b as object)), 'the page gets the elapsed times, not the office’s timestamps');
    open();
    await r.w.idle();
    const [m] = await r.w.store.list('demo');
    assert.equal(m.status, 'passed', JSON.stringify(m.failure));
    assert.deepEqual(m.start?.boot, timing, 'what the start took, phase by phase');
    assert.ok(m.outputs.notes.includes('The recording app failed to start once (bundling the web client timed out after 5m0s); retried.'));
    assert.equal((await r.w.view('demo', true)).batches.length, 0);
  } finally {
    await done(r);
  }
});
