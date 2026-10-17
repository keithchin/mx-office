// Store safety in the stores themselves (2026-10-17): the projects list, workers.json, the roster, the
// answer and dispatch stores and a settings ledger, each with a lock that never clears, a corrupt file and
// a torn tail where it applies. The faults are injected (durable/read.ts injectReadFault).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectReadFault } from '../src/server/durable/read.js';
import { resetStoreHealth, storeProblems, StoreUnavailableError } from '../src/server/durable/health.js';
import { Building, type FloorDef } from '../src/server/building.js';
import { restoreWorkers, WorkersSaver } from '../src/server/workers/persist.js';
import { RosterFile } from '../src/server/roster/store.js';
import { AnswerStore } from '../src/server/answers/store.js';
import { DispatchStore } from '../src/server/dispatch/store.js';
import { BudgetStore } from '../src/server/budget/store.js';
import type { DispatchRecord } from '../src/shared/dispatch.js';

const busy = (file: string) => (f: string) => (path.resolve(f) === path.resolve(file) ? Object.assign(new Error(`EBUSY: resource busy or locked, open '${f}'`), { code: 'EBUSY' }) : undefined);

function dir(t: { after(fn: () => void): void }) {
  const d = mkdtempSync(path.join(os.tmpdir(), 'store-safety-s-'));
  t.after(() => {
    injectReadFault(undefined);
    resetStoreHealth();
    rmSync(d, { recursive: true, force: true });
  });
  resetStoreHealth();
  return d;
}

function floors(root: string) {
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir, { recursive: true });
  const defs: FloorDef[] = ['api', 'web'].map((id, palette) => {
    const d = path.join(root, 'acme', id);
    mkdirSync(d, { recursive: true });
    return { id, name: id, repo: `acme/${id}`, dir: d, palette, addedBy: 'Sam', addedAt: 1 };
  });
  const file = path.join(dataDir, 'floors.json');
  writeFileSync(file, JSON.stringify(defs));
  return { dataDir, file };
}

test('floors.json locked: no projects shown, taking one off is refused with why, and the file is untouched', (t) => {
  const root = dir(t);
  const { dataDir, file } = floors(root);
  const before = readFileSync(file, 'utf8');
  injectReadFault(busy(file));
  const b = new Building(dataDir, root);
  assert.deepEqual(b.list(), []);
  const r = b.remove('api');
  assert.equal(typeof r, 'string');
  assert.match(r as string, /couldn't read .*floors\.json \(EBUSY.*won't write to it until it can/);
  assert.equal(readFileSync(file, 'utf8'), before);
  injectReadFault(undefined);
  assert.deepEqual(new Building(dataDir, root).list().map((d) => d.id), ['api', 'web']);
});

test('floors.json corrupt: kept aside, the projects come back from floors.json.bak', (t) => {
  const root = dir(t);
  const { dataDir, file } = floors(root);
  const b = new Building(dataDir, root);
  b.remove('web'); // a save: floors.json.bak holds both
  writeFileSync(file, '[{"id":"api","di');
  assert.deepEqual(new Building(dataDir, root).list().map((d) => d.id), ['api', 'web']);
  assert.ok(readdirSync(dataDir).some((f) => f.startsWith('floors.json.corrupt-')));
  assert.equal(storeProblems().at(-1)!.kind, 'corrupt');
});

test('workers.json locked: nobody restored, and neither the shutdown save nor a background one writes over it', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'workers.json');
  writeFileSync(file, '[{"id":"w1","deskId":"desk-1"}]');
  injectReadFault(busy(file));
  const workers = new Map();
  restoreWorkers(file, workers, 'claude', () => false);
  assert.equal(workers.size, 0);
  const saver = new WorkersSaver(file, () => '[]');
  saver.now();
  saver.soon();
  await new Promise((r) => setTimeout(r, 1400));
  assert.equal(readFileSync(file, 'utf8'), '[{"id":"w1","deskId":"desk-1"}]');
});

test('roster locked: the team is not saved over the file; corrupt: kept aside', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'f1.json');
  writeFileSync(file, '{"members":{}}');
  injectReadFault(busy(file));
  const r = new RosterFile(d, 'f1');
  r.flush();
  await r.flushSoon();
  await assert.rejects(r.flushCritical(), StoreUnavailableError);
  assert.equal(readFileSync(file, 'utf8'), '{"members":{}}');
  injectReadFault(undefined);
  resetStoreHealth();
  writeFileSync(file, '{"members":');
  const r2 = new RosterFile(d, 'f1');
  r2.flush();
  assert.ok(readdirSync(d).some((f) => f.startsWith('f1.json.corrupt-')));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).members !== undefined, true);
});

test('answers: a torn tail keeps the revisions before it and the next answer reads back; a lock refuses the append', async (t) => {
  const d = dir(t);
  const s = new AnswerStore(d);
  await s.append('f1', { decision: 'esc:1', kind: 'answer', text: 'Yes', by: 'Pat', at: 1 });
  writeFileSync(s.file('f1'), `${readFileSync(s.file('f1'), 'utf8')}{"decision":"esc:1","rev":2,"te`);
  const fresh = new AnswerStore(d);
  assert.equal((await fresh.all('f1')).length, 1);
  const l = await fresh.append('f1', { decision: 'esc:1', kind: 'answer', text: 'No', by: 'Pat', at: 2 });
  assert.equal(l.rev, 2);
  assert.deepEqual((await new AnswerStore(d).all('f1')).map((x) => x.text), ['Yes', 'No']);
  assert.ok((await new AnswerStore(d).verify('f1')).ok);
  assert.ok(readdirSync(d).some((f) => f.startsWith('f1.jsonl.corrupt-')));
  const before = readFileSync(s.file('f1'), 'utf8');
  injectReadFault(busy(s.file('f1')));
  const locked = new AnswerStore(d);
  await assert.rejects(locked.append('f1', { decision: 'esc:1', kind: 'answer', text: 'Maybe', by: 'Pat', at: 3 }), StoreUnavailableError);
  assert.equal(readFileSync(s.file('f1'), 'utf8'), before);
  injectReadFault(undefined);
  assert.equal((await locked.append('f1', { decision: 'esc:1', kind: 'answer', text: 'Maybe', by: 'Pat', at: 3 })).rev, 3, 'read again once it can be');
});

const rec = (n: number): DispatchRecord => ({ id: `dsp_${String(n).padStart(26, '0')}`, decision: `esc:${n}`, answerRev: 1, payload: 'p', marker: 'm', channel: 'type', state: 'submitted', history: [] }) as unknown as DispatchRecord;

test('dispatch locked: a put is refused and the history stays; once readable, it is kept and added to', async (t) => {
  const d = dir(t);
  const s = new DispatchStore(d);
  await s.put('f1', rec(1));
  const before = readFileSync(s.file('f1'), 'utf8');
  injectReadFault(busy(s.file('f1')));
  const locked = new DispatchStore(d);
  await assert.rejects(locked.put('f1', rec(2)), StoreUnavailableError);
  assert.equal(readFileSync(s.file('f1'), 'utf8'), before, 'not wiped down to the new record');
  injectReadFault(undefined);
  await locked.put('f1', rec(2));
  assert.deepEqual(locked.list('f1').map((r) => r.decision), ['esc:1', 'esc:2']);
});

test('budget ledger locked: defaults in memory, the file is never written over', async (t) => {
  const d = dir(t);
  const file = path.join(d, 'budget', 'f1.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{"settings":{"autoPause":false},"alerts":[]}');
  injectReadFault(busy(file));
  const b = new BudgetStore(d);
  assert.equal(b.floor('f1').settings.autoPause, true);
  b.changed('f1');
  await b.flushSoon();
  b.flush();
  assert.equal(readFileSync(file, 'utf8'), '{"settings":{"autoPause":false},"alerts":[]}');
});
