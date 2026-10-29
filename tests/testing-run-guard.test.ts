// One office test run per work folder, and no run left holding it (testing/run-guard.ts): the live office's
// microflow run failed with git's "unable to unlink old 'App.mpr': Invalid argument" because an earlier run's
// mxbuild (started by an mxcli its timeout had stopped three hours before) still held App.mpr. Runs on a folder
// queue; a run's whole process tree stops at its timeout and when it ends; a recorded run past its time is stopped
// before the folder is used again (only the office's own processes), one within its time is said in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freeFolder, heldWords, oneAtATime, readOwner, runMxOwned, treeOf, type Proc } from '../src/server/testing/run-guard.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';

const T = Date.UTC(2026, 9, 28, 9);

test("treeOf: the recorded process and what it started after it, orphans too; never an unrelated or reused pid", () => {
  const procs: Proc[] = [
    { pid: 100, ppid: 1, start: T }, // the recorded mxcli
    { pid: 101, ppid: 100, start: T + 500 }, // its mxbuild
    { pid: 102, ppid: 101, start: T + 900 }, // the runtime mxbuild started
    { pid: 200, ppid: 1, start: T + 100 }, // something else
    { pid: 103, ppid: 100, start: T - 60_000 }, // started before the run: not ours
  ];
  assert.deepEqual(treeOf(procs, { pid: 100, startedAt: T }), [100, 101, 102]);
  // mxcli gone (stopped by its timeout), its children orphaned but still naming it as their parent.
  assert.deepEqual(treeOf(procs.slice(1), { pid: 100, startedAt: T }), [101, 102]);
  // The pid was reused by a process that started much later: not the recorded one.
  assert.deepEqual(treeOf([{ pid: 100, ppid: 1, start: T + 3_600_000 }], { pid: 100, startedAt: T }), []);
});

test('freeFolder: a recorded run within its time is said in plain words; past its time its tree is stopped and the folder is free', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'run-guard-'));
  try {
    const dir = path.join(root, 'tests');
    writeFileSync(`${dir}.owner.json`, JSON.stringify({ pid: 100, startedAt: T, deadline: T + 60 * 60_000, program: 'mxcli' }));
    const procs: Proc[] = [{ pid: 100, ppid: 1, start: T }, { pid: 101, ppid: 100, start: T + 500 }];
    const killed: number[] = [];
    const d = (now: number) => ({ now: () => now, list: async () => procs, kill: async (pid: number) => void killed.push(pid) });
    const why = await freeFolder(dir, d(T + 10 * 60_000));
    assert.match(why ?? '', /a previous run still holds the work folder \(mxcli, started at \d\d:\d\d, may run until \d\d:\d\d\)/);
    assert.deepEqual(killed, [], 'nothing stopped within its time');
    assert.equal(await freeFolder(dir, d(T + 3 * 60 * 60_000)), undefined, 'three hours on: free');
    assert.deepEqual(killed, [101, 100], 'its tree stopped, children first');
    assert.equal(await readOwner(dir), undefined, 'the record goes');
    // Nothing of it running any more: the record just goes.
    writeFileSync(`${dir}.owner.json`, JSON.stringify({ pid: 100, startedAt: T, deadline: T + 1, program: 'mxcli' }));
    assert.equal(await freeFolder(dir, { now: () => T, list: async () => [], kill: async () => assert.fail('nothing to stop') }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("oneAtATime: runs on one folder never overlap; another folder's don't wait", async () => {
  const log: string[] = [];
  const slow = (name: string, ms: number) => async () => {
    log.push(`${name} start`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`${name} end`);
    return name;
  };
  const a = oneAtATime('/w/p1/tests', slow('a', 60));
  const b = oneAtATime('/w/p1/tests', slow('b', 10));
  const c = oneAtATime('/w/p2/tests', slow('c', 10));
  const failed = oneAtATime('/w/p1/tests', async () => {
    throw new Error('boom');
  });
  const d = oneAtATime('/w/p1/tests', slow('d', 1));
  assert.deepEqual(await Promise.all([a, b, c]), ['a', 'b', 'c']);
  await assert.rejects(failed, /boom/);
  assert.equal(await d, 'd', 'a failed run doesn’t block the next');
  assert.ok(log.indexOf('a end') < log.indexOf('b start'), log.join(', '));
  assert.ok(log.indexOf('c start') < log.indexOf('a end'), 'the other project ran meanwhile');
});

test("heldWords: git's 'unable to unlink' becomes 'a previous run still holds the work folder'", () => {
  assert.match(heldWords("git checkout-index failed: error: unable to unlink old 'App.mpr': Invalid argument"), /^a previous run still holds the work folder/);
  assert.equal(heldWords('no commit abc in the project'), 'no commit abc in the project');
});

test('runMxOwned: at its timeout the whole tree stops (the child it started too), and the record goes', { timeout: 90_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'run-guard-real-'));
  try {
    const dir = path.join(root, 'tests');
    const pidFile = path.join(root, 'child.pid');
    // A stand-in for mxcli: starts a long-lived child (an mxbuild) and waits.
    const script = path.join(root, 'fake-mxcli.js');
    writeFileSync(script, `const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => {}, 120000);`);
    const out = await runMxOwned(dir, process.execPath, [script], root, 3_000);
    assert.equal(out.killed, true);
    const { readFileSync } = await import('node:fs');
    const child = Number(readFileSync(pidFile, 'utf8'));
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(child, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, 'the child it started was stopped with it');
    assert.equal(await readOwner(dir), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.after(() => stopExecWorker());
