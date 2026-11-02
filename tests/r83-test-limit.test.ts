// Release 83, P2: single-file microflow test runs got the minimum limit and three were stopped at it while another
// project's runtimes loaded the machine. The limit is sized to the tests a run selects, a loaded machine adds
// headroom, a wait for the office's one test runtime is shown and never counted (here and by office-app test), and
// GET /api/testing/runner reads the project's limit. Fakes only: no mxcli, no process list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { headroomNow, mxcliTestsIn } from '../src/server/testing/machine-load.js';
import { serialTestRuntime, testRuntimeNow } from '../src/server/testing/test-db.js';
import { runnerView, setTestLimit } from '../src/server/testing/runner-settings.js';
import { stoppedWords } from '../src/server/testing/mxcli-run.js';
import { newProgress } from '../src/shared/testing/run-progress.js';
import { appMain } from '../bin/office-app.js';

test('headroom: none on a quiet machine, x1.5 for one other runtime, at most x2', async () => {
  assert.equal(await headroomNow({ runtimes: () => 0, otherTests: async () => 0 }), undefined);
  const one = await headroomNow({ runtimes: () => 1, otherTests: async () => 0 });
  assert.equal(one?.factor, 1.5);
  assert.match(one!.why, /1 app runtime running/);
  const many = await headroomNow({ runtimes: () => 2, otherTests: async () => 3 });
  assert.equal(many?.factor, 2);
  assert.match(many!.why, /2 app runtimes running and 3 other mxcli test runs/);
  assert.equal((await headroomNow({ runtimes: () => 0, otherTests: async () => Promise.reject(new Error('no list')) })), undefined);
});

test('the process list: only mxcli test command lines count', () => {
  const list = ['"C:\\tools\\mxcli.exe" test tests/a.test.mdl -p App.mpr --local', 'C:\\tools\\mxcli.exe watch -p App.mpr', '/usr/bin/mxcli test x.test.mdl', 'node server.js test', ''].join('\n');
  assert.equal(mxcliTestsIn(list), 2);
});

test("the office's test runtime: who holds it and how many wait", async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const a = serialTestRuntime(() => gate, { floorId: 'p1', label: "Ann's on abc1234" });
  const b = serialTestRuntime(async () => testRuntimeNow(), { floorId: 'p2', label: "Bo's" });
  await new Promise((r) => setTimeout(r, 10));
  const now = testRuntimeNow();
  assert.equal(now.holder?.label, "Ann's on abc1234");
  assert.equal(now.holder?.floorId, 'p1');
  assert.equal(now.waiting, 1);
  open();
  await a;
  const seenByB = await b;
  assert.equal(seenByB.holder?.label, "Bo's");
  assert.deepEqual(testRuntimeNow(), { waiting: 0 });
});

test('the stopped words say the limit was sized to the tests the run selected, and the headroom', () => {
  const w = stoppedWords(newProgress(0, 2), { minutes: 30, auto: true, tests: 2, headroom: 'x2 while 2 app runtimes running' }, 1000, 'x');
  assert.match(w, /^Stopped at the time limit \(30 min, sized to the 2 tests it ran, with headroom: x2 while 2 app runtimes running\)/);
  assert.ok(!/sized to the suite/.test(w));
});

test('GET /api/testing/runner reads the limit (null: sized), who set it, and the runtime now', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r83-runner-'));
  try {
    const v0 = await runnerView(dir, 'p1');
    assert.equal(v0.limitMinutes, null);
    assert.equal(v0.auto.minMinutes, 15);
    assert.equal(v0.runtime.busy, false);
    assert.equal(await setTestLimit(dir, 'p1', 40, { name: 'Pat Morgan' }), 40);
    const v1 = await runnerView(dir, 'p1');
    assert.equal(v1.limitMinutes, 40);
    assert.equal(v1.by, 'Pat Morgan');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('office-app test keeps waiting while the run waits for another project, and times its limit from the start', async () => {
  const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' };
  let polls = 0;
  const sha = 'a'.repeat(40);
  const answer = (b: unknown) => ({ status: 200, text: async () => JSON.stringify(b) });
  const fetch = async (url: string, init: { method: string }) => {
    if (init.method === 'POST') return answer({ started: sha, line: 'started' });
    polls++;
    // Limit 1 min: three polls waiting, then running, then done. Without the wait rule the client would give up on a 1-min limit only if that long passed; here it must never give up while waiting.
    if (polls <= 3) return answer({ run: { running: true, waiting: "Waiting for another project's test run", progress: "Waiting for another project's test run", limitMinutes: 1 } });
    if (polls === 4) return answer({ run: { running: true, progress: 'Running the tests', limitMinutes: 1 } });
    return answer({ run: { running: false, commit: sha, last: '1 passed' }, record: { id: 'r1', commit: sha, results: [{ name: 't', status: 'passed' }] } });
  };
  const out: string[] = [];
  const err: string[] = [];
  const code = await appMain(['test', '--commit', sha], { env, fetch: fetch as never, out: (s: string) => out.push(s), err: (s: string) => err.push(s), cwd: os.tmpdir(), pollMs: 5 } as never);
  assert.equal(code, 0, [...out, ...err].join('\n'));
  assert.ok(err.some((l) => /Waiting for another project's test run/.test(l)));
});
