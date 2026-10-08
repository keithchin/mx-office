// What the stall pass (2026-10-08) changed so periodic work never holds the event loop for long: the
// analyzer reads a session's transcript once and then only what's appended, a slice at a time
// (analysis/transcript.ts readSessionLive); per-worker timers take one worker per turn of the loop
// (offloop/apart.ts); and the office's background `claude` and Studio-mode programs start from the
// process-starter thread (offloop/exec.ts), since starting the claude binary alone held the loop for
// 0.6 s and more on Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSession, readSessionLive, SessionReader } from '../src/server/analysis/transcript.js';
import { newTracker, scanTracker, scanTrackerStep, trackerUsage } from '../src/server/usage.js';
import { eachApart } from '../src/server/offloop/apart.js';

const at = (min: number) => new Date(Date.UTC(2026, 9, 8, 9, min)).toISOString();
const assistant = (n: number, text = 'x'.repeat(2000)) => ({ type: 'assistant', timestamp: at(n % 60), message: { id: `m${n}`, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: `t${n}` }, { type: 'text', text }] } });
const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

test('a session read live: the same answer as a whole read, only what was appended read again, a slice at a time', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-guard-'));
  try {
    const file = path.join(dir, 'sess.jsonl');
    const sub = path.join(dir, 'sess', 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(file, jsonl([{ type: 'user', timestamp: at(0), message: { content: 'Build it' } }, ...Array.from({ length: 300 }, (_, i) => assistant(i + 1))]));
    writeFileSync(path.join(sub, 'agent-a1.jsonl'), jsonl(Array.from({ length: 200 }, (_, i) => assistant(1000 + i))));
    // The event loop turns while a big first read goes on.
    let turns = 0;
    const ticker = setInterval(() => turns++, 0);
    const live = await readSessionLive(file, 64 * 1024);
    clearInterval(ticker);
    assert.ok(turns >= 3, `the loop ran ${turns} times during the read`);
    assert.deepEqual(live, readSession(file));
    assert.equal(live.apiCalls, 500);
    assert.equal(live.toolCalls, 300, "the subagent's tool calls aren't the session's");
    // More is appended: the next live read takes only that, and still agrees with a whole read.
    appendFileSync(file, jsonl([assistant(301, 'PR opened.'), { type: 'pr-link', prNumber: 7, timestamp: at(59) }]));
    const again = await readSessionLive(file);
    assert.deepEqual(again, readSession(file));
    assert.equal(again.apiCalls, 501);
    assert.equal(again.prLinked, 7);
    assert.equal(again.lastText, 'PR opened.');
    // A file that got shorter is read again from the start.
    writeFileSync(file, jsonl([assistant(1)]));
    assert.equal((await readSessionLive(file)).toolCalls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tracker scanned in slices adds up to the same as one scan', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stall-guard-'));
  try {
    const file = path.join(dir, 's.jsonl');
    writeFileSync(file, jsonl(Array.from({ length: 400 }, (_, i) => assistant(i))));
    const whole = newTracker();
    whole.transcript = file;
    scanTracker(whole);
    const sliced = newTracker();
    sliced.transcript = file;
    let steps = 0;
    while (!scanTrackerStep(sliced, { maxBytes: 100 * 1024 }).done) steps++;
    assert.ok(steps >= 5, `${steps} slices`);
    assert.deepEqual(trackerUsage(sliced), trackerUsage(whole));
    const r = new SessionReader(file);
    assert.equal(r.step(1), false, 'a tiny budget leaves more for later');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('eachApart takes one item per turn of the event loop', async () => {
  const order: string[] = [];
  const done = eachApart([1, 2, 3], (n) => order.push(`item ${n}`));
  setImmediate(() => order.push('other work'));
  await done;
  assert.equal(order[0], 'item 1', 'the first at once');
  assert.equal(order.length, 4);
  assert.ok(order.indexOf('other work') < order.indexOf('item 3'), `other work got in between: ${order.join(', ')}`);
});

test("the office's background claude calls and Studio mode's programs start off the event loop", () => {
  const src = (f: string) => readFileSync(new URL(`../src/server/${f}`, import.meta.url), 'utf8');
  for (const f of ['analysis/llm.ts', 'tasks.ts', 'firm/runner.ts']) {
    const s = src(f);
    assert.match(s, /spawnOff\(/, `${f} starts claude with spawnOff`);
    assert.doesNotMatch(s, /\bspawn\((this\.)?claude\b/, `${f} must not start claude on the event loop`);
  }
  for (const f of ['studio/detect.ts', 'studio/watch.ts']) assert.doesNotMatch(src(f), /from 'node:child_process'/, `${f} starts its programs with execFileOff`);
  assert.doesNotMatch(src('analysis/collect.ts'), /readSession\(/, 'the analyzer reads sessions live, never whole');
});
