// The tell limit's window survives a restart (server/hooks/tell-limit.ts): kept in <data>/tell-limit.json,
// so two agents that used up their tells don't get a fresh allowance when the office restarts. Old entries
// are dropped on reading, and a broken file starts empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TELL_LIMIT_FILE, TELL_MAX, TELL_WINDOW_MS, TellLimit, tellLimitOf } from '../src/server/hooks/tell-limit.js';

const a = { id: 'a', name: 'Anita' };
const b = { id: 'b', name: 'Hedy' };

test('used-up tells stay used up across a restart, and the window still moves on', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tell-limit-'));
  try {
    const file = path.join(dir, TELL_LIMIT_FILE);
    const clock = { now: 1_000_000 };
    const first = new TellLimit(() => clock.now, TELL_MAX, TELL_WINDOW_MS, file);
    for (let i = 0; i < TELL_MAX; i++) assert.equal(first.take(a, b), undefined);
    first.flush();
    assert.equal(JSON.parse(readFileSync(file, 'utf8'))['a>b'].length, TELL_MAX);
    clock.now += 60_000;
    const again = new TellLimit(() => clock.now, TELL_MAX, TELL_WINDOW_MS, file);
    assert.match(String(again.take(a, b)), /told Hedy 5 times/, 'the restart kept the count');
    assert.equal(again.take(b, a), undefined, 'the other pair is its own');
    clock.now += TELL_WINDOW_MS;
    assert.equal(new TellLimit(() => clock.now, TELL_MAX, TELL_WINDOW_MS, file).take(a, b), undefined, 'entries older than the window are dropped on reading');
    writeFileSync(file, 'not json');
    assert.equal(new TellLimit(() => clock.now, TELL_MAX, TELL_WINDOW_MS, file).take(a, b), undefined, 'a broken file starts empty');
    const cfg = { dataDir: dir };
    tellLimitOf(cfg).take(a, b);
    tellLimitOf(cfg).flush();
    assert.ok(JSON.parse(readFileSync(file, 'utf8'))['a>b'], 'the office’s limit keeps its file in the data folder');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
