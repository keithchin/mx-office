import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newTracker, scanTracker, trackerUsage } from '../src/server/usage.js';
import { scanApart, scanTrackerAsync } from '../src/server/usage-async.js';

const assistant = (n: number, model = 'claude-opus-5-5', more: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 9, 1, 12, 0, n)).toISOString(), ...more, message: { id: `msg_${n}`, model, content: [{ type: 'text', text: 'x'.repeat(2000) }], usage: { input_tokens: 10, output_tokens: 5 } } });

const lines = (from: number, to: number, model?: string) => Array.from({ length: to - from }, (_, i) => assistant(from + i, model)).join('\n') + '\n';

test('the async scan books what the synchronous one would, a slice at a time, with subagents', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-usage-async-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session.jsonl');
  const subagents = path.join(dir, 'session', 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(transcript, lines(0, 400));
  writeFileSync(path.join(subagents, 'agent-1.jsonl'), lines(1000, 1050, 'claude-haiku-4-5'));
  writeFileSync(path.join(subagents, 'agent-1.meta.json'), JSON.stringify({ agentType: 'Explore' }));

  const sync = newTracker();
  sync.transcript = transcript;
  scanTracker(sync);
  const off = newTracker();
  off.transcript = transcript;
  // Small slices: the 800 KB session takes many turns of the event loop.
  let turns = 0;
  const tick = setInterval(() => turns++, 0);
  assert.equal(await scanTrackerAsync(off, 16 * 1024), true);
  clearInterval(tick);
  assert.deepEqual(trackerUsage(off), trackerUsage(sync));
  assert.equal(trackerUsage(off).calls, 450);
  assert.ok(off.parts?.['Explore|claude-haiku-4-5'], 'the subagent is booked under its type');
  assert.ok(turns > 0, 'the event loop ran while it read');

  // Nothing new: nothing changes (and the files aren't even opened). Then only what was appended is read.
  assert.equal(await scanTrackerAsync(off), false);
  appendFileSync(transcript, lines(400, 410));
  appendFileSync(transcript, assistant(999).slice(0, 50)); // half a line, still being written
  assert.equal(await scanTrackerAsync(off), true);
  assert.equal(trackerUsage(off).calls, 460);
});

test('a slice read by someone else meanwhile (the synchronous scan at shutdown) is not booked twice', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-usage-async-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session.jsonl');
  writeFileSync(transcript, lines(0, 200));
  const tr = newTracker();
  tr.transcript = transcript;
  const out = scanTrackerAsync(tr, 8 * 1024);
  scanTracker(tr); // runs while the async read is out
  await out;
  assert.equal(trackerUsage(tr).calls, 200);
});

test('scanApart runs one scan per worker at a time, and one more when asked meanwhile', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-usage-async-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session.jsonl');
  writeFileSync(transcript, lines(0, 50));
  const w = { tracker: newTracker() } as { tracker: ReturnType<typeof newTracker>; scanning?: boolean; rescan?: boolean };
  w.tracker.transcript = transcript;
  let booked = 0;
  scanApart(w, () => booked++);
  assert.equal(w.scanning, true);
  appendFileSync(transcript, lines(50, 60));
  scanApart(w, () => booked++);
  assert.equal(w.rescan, true);
  while (w.scanning) await new Promise((r) => setTimeout(r, 5));
  assert.equal(trackerUsage(w.tracker).calls, 60);
  assert.ok(booked >= 1 && booked <= 2);
});
