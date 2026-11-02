// Release 83, P2: journeys an agent ran itself (node tests/e2e/J-01.journey.js) were invisible to the merge gate
// except as its own summary check. `office-app journey --all` / `--ids J-01,J-02` (and one id) now run as a batch in
// the office's background, each journey recorded at the instance's commit by its id; the command polls and prints
// each result, so no command time limit cuts it off. Real git in a temp folder, a fake journey runner; no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { batchOf, batchWords, forgetBatches, journeysAt, startBatch } from '../src/server/agent-app/journey-batch.js';
import { runJourney } from '../src/server/agent-app/journey.js';
import { testingStore } from '../src/server/testing/index.js';
import { journeyResults } from '../src/server/liveapp/readiness.js';
import { RUNTIME_RULE } from '../src/server/agent-app/playbook.js';
import { appMain, parseApp } from '../bin/office-app.js';
import type { RunOutcome } from '../src/shared/agent-app.js';

function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'r83-batch-'));
  const repo = path.join(root, 'repo');
  mkdirSync(path.join(repo, 'tests', 'e2e'), { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'tests', 'e2e', 'J-01.journey.json'), JSON.stringify({ id: 'J-01', title: 'Open the list', steps: [{ goto: '/p/list' }] }));
  writeFileSync(path.join(repo, 'tests', 'e2e', 'J-10.journey.js'), "// sequence\nconsole.log('ok')\n");
  writeFileSync(path.join(repo, 'tests', 'e2e', 'J-02.journey.js'), "console.log('ok')\n");
  writeFileSync(path.join(repo, 'tests', 'e2e', 'seed.journey.json'), JSON.stringify({ id: 'seed', steps: [{ goto: '/' }] }));
  g('add', '-A');
  g('commit', '-qm', 'journeys');
  const sha = g('rev-parse', 'HEAD');
  const log = path.join(root, 'runtime.log');
  writeFileSync(log, '');
  const e = { floorId: 'shop', workerId: 'w1', worker: 'Rhea', commit: sha, purpose: 'ag1', workspace: path.join(root, 'ws'), state: 'ready', startedAt: 0, lastUsed: 0, abort: new AbortController(), started: Promise.resolve(), instance: { url: 'http://127.0.0.1:8301/', runtimeLog: log } };
  return { root, repo, sha, e };
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
};

test('--all: every journey at the commit (the seed left out), in id order, each recorded at the commit by its id', { timeout: 60_000 }, async () => {
  const r = rig();
  forgetBatches();
  try {
    assert.deepEqual([...(await journeysAt(r.repo, r.sha)).keys()], ['J-01', 'J-02', 'J-10']);
    // The real runJourney, with a fake .journey.js runner and a fake recorder: J-02 fails.
    const js = async (s: { file: string }) => ({ status: /J-02/.test(s.file) ? ('failed' as const) : ('passed' as const), steps: [], exitCode: 0, ms: 5, ...(/J-02/.test(s.file) ? { failure: 'step 2: the list was empty' } : {}) });
    const record = async () => ({ status: 'passed', steps: [{ n: 1, caption: 'Open', status: 'passed' }] });
    const d = { dataDir: r.root, floorDir: r.repo, js: js as never, record: record as never, runnerConfig: async () => undefined, launch: (async () => ({ newContext: async () => ({}), close: async () => undefined })) as never };
    let touched = 0;
    const b = await startBatch(r.e as never, { all: true }, d, { touch: () => touched++ });
    assert.ok(typeof b !== 'string', String(b));
    assert.match(String(await startBatch(r.e as never, { ids: ['J-01'] }, d)), /already running/);
    await until(() => !batchOf('shop', 'w1')!.running);
    const done = batchOf('shop', 'w1')!;
    assert.deepEqual(done.results.map((x) => [x.id, x.status]), [['J-01', 'passed'], ['J-02', 'failed'], ['J-10', 'passed']]);
    assert.ok(touched >= 3, 'the idle clock is touched for each journey');
    assert.match(batchWords(done), /3 of 3 run \(2 passed, 1 failed, 0 did not run\)[\s\S]*recorded on its own at [0-9a-f]{7} by its journey id/);
    // Per journey id at the commit: what the merge gate and the change's Checks read.
    const recs = await testingStore(r.root, 'shop').all();
    assert.equal(recs.length, 3);
    assert.ok(recs.every((x) => x.testedRevision === r.sha && x.source === 'office-journey'));
    assert.deepEqual((await journeyResults(r.root, 'shop', r.sha, ['J-01', 'J-02', 'J-10'])).sort((a, b) => a.journey.localeCompare(b.journey)), [
      { journey: 'J-01', status: 'passed' },
      { journey: 'J-02', status: 'failed' },
      { journey: 'J-10', status: 'passed' },
    ]);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('--ids: just those; a stopped instance ends the batch with the rest not run', { timeout: 30_000 }, async () => {
  const r = rig();
  forgetBatches();
  try {
    const run = async (e: { abort: AbortController }, ask: { journey?: string }): Promise<RunOutcome> => {
      if (ask.journey === 'J-02') e.abort.abort();
      return { suite: `journey ${ask.journey}`, commit: r.sha, status: 'passed', record: `rec-${ask.journey}` };
    };
    const b = await startBatch(r.e as never, { ids: ['J-01', 'J-02', 'J-10'] }, { dataDir: r.root, floorDir: r.repo }, { run: run as never });
    assert.ok(typeof b !== 'string');
    await until(() => !batchOf('shop', 'w1')!.running);
    const done = batchOf('shop', 'w1')!;
    assert.deepEqual(done.results.map((x) => x.id), ['J-01', 'J-02']);
    assert.equal(done.stopped, 'the instance stopped');
    assert.match(batchWords(done), /1 not run \(the instance stopped\)/);
    assert.match(String(await startBatch(r.e as never, {}, { dataDir: r.root, floorDir: r.repo })), /Say which journeys/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
  void runJourney;
});

test('office-app journey: --ids/--all/--status parse; a batch is started, polled and each result printed; exit 0 only when all passed', async () => {
  assert.deepEqual(parseApp(['journey', '--ids', 'J-01,J-02']).ids, ['J-01', 'J-02']);
  assert.equal(parseApp(['journey', '--all']).all, true);
  assert.equal(parseApp(['journey', '--status']).status, true);
  assert.throws(() => parseApp(['journey', 'J-01', '--all']), /one journey/);
  assert.throws(() => parseApp(['smoke', '--all']), /are for office-app journey/);
  const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' };
  const sha = 'b'.repeat(40);
  const posted: unknown[] = [];
  let polls = 0;
  const answer = (b: unknown) => ({ status: 200, text: async () => JSON.stringify(b) });
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    assert.match(url, /\/office\/app\/journeys\?/);
    if (init.method === 'POST') {
      posted.push(JSON.parse(init.body!));
      return answer({ started: sha, ids: ['J-01', 'J-02'], line: 'Journeys started' });
    }
    polls++;
    const results = [{ id: 'J-01', status: 'passed', words: 'journey J-01 @bbbbbbb: PASSED' }, ...(polls > 1 ? [{ id: 'J-02', status: 'failed', words: 'journey J-02 @bbbbbbb: FAILED' }] : [])];
    return answer({ batch: { commit: sha, ids: ['J-01', 'J-02'], results, running: polls < 2 }, line: `Journeys: ${results.length} of 2` });
  };
  const err: string[] = [];
  const out: string[] = [];
  const code = await appMain(['journey', '--ids', 'J-01,J-02'], { env, fetch: fetch as never, out: (s: string) => out.push(s), err: (s: string) => err.push(s), cwd: tmpdir(), pollMs: 5 } as never);
  assert.equal(code, 1, 'J-02 failed');
  assert.deepEqual(posted, [{ ids: ['J-01', 'J-02'] }]);
  assert.ok(err.includes('journey J-01 @bbbbbbb: PASSED') && err.includes('journey J-02 @bbbbbbb: FAILED'), err.join('\n'));
  assert.equal(err.filter((l) => /J-01/.test(l)).length, 1, 'each result printed once');
});

test('the Playbook says how: --ids / --all through the office, recorded per journey id, never node yourself', () => {
  const text = RUNTIME_RULE.join('\n');
  assert.match(text, /office-app journey --ids J-12,J-13/);
  assert.match(text, /office-app journey --all/);
  assert.match(text, /recorded at the commit by its journey id, which is what the merge gate reads/);
  assert.match(text, /never run `node tests\/e2e\/\*\.journey\.js` yourself/);
});
