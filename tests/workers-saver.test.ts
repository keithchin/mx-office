// workers.json is written in the background (workers/persist.ts WorkersSaver): every booked usage asked
// for a save and each wrote the file on the event loop, 509 ms once on Windows (busy-office check,
// 2026-10-08). Changes close together are written once; a shutdown save wins over a background one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAVE_SOON_MS, WorkersSaver } from '../src/server/workers/persist.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('changes close together are written once, in the background, and not on the loop', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'saver-'));
  const file = path.join(dir, 'workers.json');
  let builds = 0;
  let value = 'a';
  const saver = new WorkersSaver(file, () => (builds++, JSON.stringify(value)));
  for (const v of ['b', 'c', 'd']) (value = v), saver.soon();
  assert.equal(existsSync(file), false, 'nothing written synchronously');
  await wait(SAVE_SOON_MS + 300);
  assert.equal(readFileSync(file, 'utf8'), '"d"');
  assert.equal(builds, 1);
  assert.equal(existsSync(`${file}.tmp`), false);
  rmSync(dir, { recursive: true, force: true });
});

test('now() writes at once and cancels the pending background write', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'saver-'));
  const file = path.join(dir, 'workers.json');
  let value = 'early';
  const saver = new WorkersSaver(file, () => JSON.stringify(value));
  saver.soon();
  value = 'final';
  saver.now();
  assert.equal(readFileSync(file, 'utf8'), '"final"');
  value = 'stale';
  await wait(SAVE_SOON_MS + 300);
  assert.equal(readFileSync(file, 'utf8'), '"final"', 'no background write after the shutdown save');
  rmSync(dir, { recursive: true, force: true });
});
