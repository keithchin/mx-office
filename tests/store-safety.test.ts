// Store safety (2026-10-17): a lock, a crash or a corrupt file never wipes the office's data. Only a
// missing file is empty; a locked one is retried, then left unwritten (writes refused, an incident raised);
// a corrupt one is moved aside and the store starts from its backup; a torn JSONL tail keeps every whole
// line before it; a crash between a write and its rename is recovered from the leftover. Faults are
// injected with injectReadFault (durable/read.ts), so no real lock is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectReadFault, readJsonStore, readJsonStoreSync, parseStoreSync } from '../src/server/durable/read.js';
import { readJsonlStore } from '../src/server/durable/jsonl.js';
import { writeJsonDurableSync, writeJsonDurable } from '../src/server/durable/write.js';
import { resetStoreHealth, storeProblems, StoreUnavailableError, writeBlocked } from '../src/server/durable/health.js';
import { writeJsonAtomic } from '../src/server/flow/store.js';
import { writeJsonCritical } from '../src/server/flow/critical-write.js';
import { BackgroundFile } from '../src/server/offloop/save.js';
import { storeDetection, raiseStoreProblems } from '../src/server/incidents/store-health.js';

const busy = (file: string) => (f: string) => (path.resolve(f) === path.resolve(file) ? Object.assign(new Error(`EBUSY: resource busy or locked, open '${f}'`), { code: 'EBUSY' }) : undefined);

function dir(t: { after(fn: () => void): void }) {
  const d = mkdtempSync(path.join(os.tmpdir(), 'store-safety-'));
  t.after(() => {
    injectReadFault(undefined);
    resetStoreHealth();
    rmSync(d, { recursive: true, force: true });
  });
  resetStoreHealth();
  return d;
}

test('a missing file is empty, and nothing is reported', async (t) => {
  const d = dir(t);
  assert.deepEqual(readJsonStoreSync(path.join(d, 'x.json')), { state: 'missing' });
  assert.deepEqual(await readJsonStore(path.join(d, 'x.json')), { state: 'missing' });
  assert.deepEqual(await readJsonlStore(path.join(d, 'x.jsonl')), { lines: [], missing: true, dropped: 0 });
  assert.equal(storeProblems().length, 0);
});

test('a lock that never clears: no empty start, every writer refuses, and it is reported', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'floors.json');
  writeFileSync(file, '[{"id":"api"}]');
  injectReadFault(busy(file));
  assert.throws(() => readJsonStoreSync(file), StoreUnavailableError);
  await assert.rejects(readJsonStore(file), StoreUnavailableError);
  assert.ok(writeBlocked(file));
  assert.throws(() => writeJsonDurableSync(file, []), StoreUnavailableError);
  assert.throws(() => writeJsonAtomic(file, []), StoreUnavailableError);
  await assert.rejects(writeJsonCritical(file, []), StoreUnavailableError);
  await assert.rejects(writeJsonDurable(file, []), StoreUnavailableError);
  const errors: unknown[] = [];
  const bg = new BackgroundFile(file, { onError: (e) => errors.push(e) });
  await bg.write('[]');
  bg.flush('[]');
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e instanceof StoreUnavailableError));
  assert.equal(readFileSync(file, 'utf8'), '[{"id":"api"}]', 'never written over');
  const p = storeProblems().find((x) => x.kind === 'locked');
  assert.match(p!.error, /EBUSY/);
  const det = storeDetection(p!);
  assert.equal(det.severity, 'sev2');
  assert.match(det.summary, /couldn't read .*floors\.json \(EBUSY.*won't write to it until it can/);
  // Readable again: writes go ahead.
  injectReadFault(undefined);
  assert.equal(readJsonStoreSync(file).state, 'ok');
  assert.equal(writeBlocked(file), undefined);
  writeJsonDurableSync(file, []);
  assert.equal(readFileSync(file, 'utf8'), '[]');
});

test('a lock that clears within the retries is just read', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'a.json');
  writeFileSync(file, '{"a":1}');
  let n = 0;
  injectReadFault((f) => (f === file && n++ < 2 ? Object.assign(new Error('EPERM'), { code: 'EPERM' }) : undefined));
  assert.deepEqual(readJsonStoreSync(file), { state: 'ok', value: { a: 1 } });
  n = 0;
  assert.deepEqual(await readJsonStore(file), { state: 'ok', value: { a: 1 } });
  assert.equal(storeProblems().length, 0);
});

test('a corrupt file is moved aside (never deleted), the backup is used, and the incident names the aside file', (t) => {
  const d = dir(t);
  const file = path.join(d, 'floors.json');
  writeJsonDurableSync(file, ['v1']);
  writeJsonDurableSync(file, ['v2'], { bak: true });
  assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, 'utf8')), ['v1']);
  writeFileSync(file, '["v3", tor');
  const r = readJsonStoreSync(file);
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.state === 'ok' && r.value, ['v1']);
  const aside = readdirSync(d).find((f) => f.startsWith('floors.json.corrupt-'))!;
  assert.equal(readFileSync(path.join(d, aside), 'utf8'), '["v3", tor');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), ['v1'], 'the backup is put back as the file');
  const p = storeProblems().find((x) => x.kind === 'corrupt')!;
  assert.equal(p.aside, path.join(d, aside));
  assert.match(p.lost!, /Started from floors\.json\.bak/);
  assert.match(storeDetection(p).summary, /kept as .*corrupt-/);
});

test('a corrupt file with nothing beside it starts empty, and the next save does not touch the aside file', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'portfolios.json');
  writeFileSync(file, '');
  const r = await readJsonStore(file);
  assert.equal(r.state, 'missing');
  assert.ok(r.state === 'missing' && r.aside && existsSync(r.aside));
  await writeJsonDurable(file, []);
  assert.equal(readFileSync(r.state === 'missing' ? r.aside! : '', 'utf8'), '');
  assert.match(storeProblems()[0].lost!, /started empty/);
  assert.equal(parseStoreSync(file).length, 0);
});

test('a crash between a write and its rename (file gone, temporary file left) is recovered', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'workers.json');
  writeFileSync(`${file}.1234.7.tmp`, '[{"id":"w1"}]');
  const r = readJsonStoreSync(file);
  assert.deepEqual(r.state === 'ok' && r.value, [{ id: 'w1' }]);
  assert.equal(readFileSync(file, 'utf8'), '[{"id":"w1"}]');
  assert.equal(existsSync(`${file}.1234.7.tmp`), false);
  assert.equal(storeProblems()[0].kind, 'recovered');
  assert.equal(storeDetection(storeProblems()[0]).severity, 'sev3');
  // A half-written temporary file is not taken; the backup is.
  const f2 = path.join(d, 'roster.json');
  writeFileSync(`${f2}.tmp-bg`, '{"half');
  writeFileSync(`${f2}.bak`, '{"whole":true}');
  const r2 = await readJsonStore(f2);
  assert.deepEqual(r2.state === 'ok' && r2.value, { whole: true });
});

test('a torn JSONL tail: every whole line is kept, the torn bytes are kept aside, and the next append reads', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'answers.jsonl');
  writeFileSync(file, '{"rev":1}\n{"rev":2}\n{"rev":3,"te');
  const r = await readJsonlStore(file);
  assert.deepEqual(r.lines, ['{"rev":1}', '{"rev":2}']);
  assert.equal(r.dropped, 1);
  assert.match(readFileSync(r.aside!, 'utf8'), /\{"rev":3,"te$/);
  assert.equal(readFileSync(file, 'utf8'), '{"rev":1}\n{"rev":2}\n');
  const p = storeProblems()[0];
  assert.match(p.error, /last line was cut off/);
  assert.match(p.lost!, /Kept 2 whole lines; 1 dropped/);
  // A whole last line only missing its newline gets one, so an append starts on its own line.
  const f2 = path.join(d, 'tasks.jsonl');
  writeFileSync(f2, '{"a":1}');
  assert.deepEqual((await readJsonlStore(f2)).lines, ['{"a":1}']);
  assert.equal(readFileSync(f2, 'utf8'), '{"a":1}\n');
});

test('a locked JSONL store rejects and is read again next time', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'x.jsonl');
  writeFileSync(file, '{"a":1}\n');
  injectReadFault(busy(file));
  await assert.rejects(readJsonlStore(file), StoreUnavailableError);
  injectReadFault(undefined);
  assert.deepEqual((await readJsonlStore(file)).lines, ['{"a":1}']);
});

test('problems noted before anyone listened are raised once the incidents are installed', (t) => {
  const d = dir(t);
  const file = path.join(d, 'q.json');
  writeFileSync(file, '{');
  readJsonStoreSync(file);
  const raised: string[] = [];
  const stop = raiseStoreProblems((det) => raised.push(`${det.rule}:${det.place}:${det.severity}`));
  writeFileSync(file, '{');
  readJsonStoreSync(file);
  stop();
  assert.deepEqual(raised, ['storeUnreadable:q.json:sev2', 'storeUnreadable:q.json:sev2']);
});
