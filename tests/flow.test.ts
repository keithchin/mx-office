// The workflow engine (server/flow/): edges and gates, checkpoints and carrying on after a restart,
// retries with backoff, cached steps, loop guards and budgets, interrupt and resume, pause and cancel,
// its events, and the wizard's jobs saved before it being taken in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backoffMs, END, FileStore, FlowEngine, flowsOf, interrupt, transientError, type FlowEventName, type StepDef, type WorkflowDef } from '../src/server/flow/index.js';
import { checkWorkflow, nextStep } from '../src/server/flow/graph.js';
import { flowRoutes } from '../src/server/http/routes/flows.js';
import { JobBook, newJob, SETUP_FLOW, type JobState, type StepImpl } from '../src/server/wizard/job.js';
import { SETUP_STEPS, type ProjectPlan, type StepId } from '../src/shared/wizard.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'flow-'));

interface Clock {
  t: number;
  slept: number[];
}

/** An engine on a temp dir with a clock a test moves, waits that only note how long, and no jitter. */
function engineIn(dir: string, clock: Clock = { t: 1_000_000, slept: [] }) {
  return new FlowEngine({
    store: new FileStore(dir),
    now: () => clock.t,
    sleep: async (ms) => {
      clock.slept.push(ms);
      clock.t += ms;
    },
    random: () => 0.5,
  });
}

interface Review {
  drafts: number;
  approved: boolean;
  trail: string[];
}

/** draft → review → (approved? publish : draft): a gate as a conditional edge, approving on the `approveAt`th draft. */
function reviewFlow(approveAt: number, loops?: number): WorkflowDef<Review> {
  return {
    id: 'review',
    version: 1,
    steps: [
      { id: 'draft', run: async ({ state }) => ({ drafts: state.drafts + 1, trail: [...state.trail, 'draft'] }) },
      { id: 'review', run: async ({ state }) => ({ approved: state.drafts >= approveAt, trail: [...state.trail, 'review'] }) },
      { id: 'publish', run: async ({ state }) => ({ trail: [...state.trail, 'publish'] }) },
    ],
    edges: { review: (s) => (s.approved ? 'publish' : 'draft'), publish: END },
    limits: loops === undefined ? undefined : { loops: { 'review->draft': loops } },
  };
}

const fresh = (): Review => ({ drafts: 0, approved: false, trail: [] });

test('the shape is checked, and the next step is the edge, a gate, or the next in the list', () => {
  const steps: StepDef<{ n: number }>[] = ['a', 'b', 'c'].map((id) => ({ id, run: async () => undefined }));
  assert.equal(checkWorkflow({ id: 'x', version: 1, steps }), undefined);
  assert.match(checkWorkflow({ id: 'x', version: 1, steps: [...steps, steps[0]] }) ?? '', /two steps/);
  assert.match(checkWorkflow({ id: 'x', version: 1, steps, edges: { a: 'nope' } }) ?? '', /isn't one of its steps/);
  assert.match(checkWorkflow({ id: 'x', version: 1, steps, start: 'z' }) ?? '', /starts at z/);
  assert.match(checkWorkflow({ id: 'x', version: 1, steps, limits: { loops: { 'a-b': 1 } } }) ?? '', /from->to/);
  assert.match(checkWorkflow({ id: 'bad id', version: 1, steps }) ?? '', /letters/);
  const wf: WorkflowDef<{ n: number }> = { id: 'x', version: 1, steps, edges: { b: (s) => (s.n > 1 ? END : 'a') } };
  assert.equal(nextStep(wf, 'a', { n: 0 }), 'b');
  assert.equal(nextStep(wf, 'b', { n: 0 }), 'a');
  assert.equal(nextStep(wf, 'b', { n: 2 }), END);
  assert.equal(nextStep(wf, 'c', { n: 0 }), END, 'the last step ends the run');
  assert.throws(() => nextStep({ ...wf, edges: { a: () => 'zz' } }, 'a', { n: 0 }), /zz/);
});

test('a gate loops back until it passes; the history and the file say where the run went', async () => {
  const dir = tmp();
  try {
    const engine = engineIn(dir);
    engine.register(reviewFlow(3));
    const run = engine.create('review', fresh(), { runId: 'r1', floor: 'f1', by: 'Ada' });
    assert.equal(run.status, 'pending');
    const done = await engine.start('r1');
    assert.equal(done.status, 'done');
    assert.deepEqual(done.state.trail, ['draft', 'review', 'draft', 'review', 'draft', 'review', 'publish']);
    assert.equal(done.loops['review->draft'], 2);
    assert.deepEqual(
      done.history.map((h) => `${h.step}>${h.next}`),
      ['draft>review', 'review>draft', 'draft>review', 'review>draft', 'draft>review', 'review>publish', `publish>${END}`],
    );
    const saved = JSON.parse(readFileSync(path.join(dir, 'review', 'r1.json'), 'utf8'));
    assert.equal(saved.status, 'done');
    assert.equal(saved.state.drafts, 3);
    assert.deepEqual(engine.summaries({ floor: 'f1' }).map((s) => [s.runId, s.status]), [['r1', 'done']]);
    assert.deepEqual(engine.summaries({ floor: 'other' }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('after a restart a run that was mid-step is interrupted, and resumes from its last checkpoint, skipping what is done', async () => {
  const dir = tmp();
  try {
    interface S {
      did: string[];
      fetched?: boolean;
    }
    const calls: string[] = [];
    const flow = (hang: boolean): WorkflowDef<S> => ({
      id: 'pipe',
      version: 1,
      steps: [
        { id: 'fetch', done: (s) => !!s.fetched, run: async () => (calls.push('fetch'), { fetched: true }) },
        { id: 'build', run: async ({ state }) => (calls.push('build'), hang ? new Promise<never>(() => undefined) : { did: [...state.did, 'build'] }) },
        { id: 'ship', run: async ({ state }) => (calls.push('ship'), { did: [...state.did, 'ship'] }) },
      ],
    });
    const first = engineIn(dir);
    first.register(flow(true));
    first.create('pipe', { did: [] } as S, { runId: 'p1' });
    void first.start('p1'); // build never ends: the office "stops" there
    // The engine lets the event loop turn between steps.
    for (let i = 0; i < 10 && calls.length < 2; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls, ['fetch', 'build']);

    // A new office reads the file.
    const second = engineIn(dir);
    const back = second.get<S>('p1')!;
    assert.equal(back.status, 'interrupted');
    assert.equal(back.step, 'build');
    assert.match(back.error ?? '', /stopped while build/);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'pipe', 'p1.json'), 'utf8')).status, 'interrupted');
    second.register(flow(false));
    calls.length = 0;
    const done = await second.resume('p1');
    assert.equal(done.status, 'done');
    assert.deepEqual(calls, ['build', 'ship'], 'carried on at build');
    // Run again from the top: fetch says it's done, so it's skipped.
    calls.length = 0;
    await second.start('p1', { from: 'fetch' });
    assert.deepEqual(calls, ['build', 'ship']);
    assert.equal(done.history.find((h) => h.step === 'fetch' && h.status === 'skipped')?.step, 'fetch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retries: exponential backoff with jitter, only for the errors retryOn picks, and a failure after the last try', async () => {
  assert.equal(backoffMs({ maxAttempts: 5, baseMs: 1000, jitter: 0 }, 1), 1000);
  assert.equal(backoffMs({ maxAttempts: 5, baseMs: 1000, jitter: 0 }, 3), 4000);
  assert.equal(backoffMs({ maxAttempts: 9, baseMs: 1000, maxMs: 5000, jitter: 0 }, 8), 5000, 'capped');
  assert.equal(backoffMs({ maxAttempts: 5, baseMs: 1000, jitter: 0.2 }, 1, () => 0), 800);
  assert.equal(backoffMs({ maxAttempts: 5, baseMs: 1000, jitter: 0.2 }, 1, () => 1), 1200);
  assert.ok(transientError(new Error('fatal: unable to access https://github.com/x: Could not resolve host')));
  assert.ok(transientError(new Error('gh: HTTP 502 Bad Gateway')));
  assert.ok(transientError(new Error('read ECONNRESET')));
  assert.ok(!transientError(new Error('git clone took longer than 600s and was stopped')));
  assert.ok(!transientError(new Error('repository not found')));

  const dir = tmp();
  try {
    const clock: Clock = { t: 0, slept: [] };
    const engine = engineIn(dir, clock);
    let tries = 0;
    let flaky = 2;
    const failed: { attempt: number; willRetry: boolean }[] = [];
    engine.on('step-failed', (e) => failed.push({ attempt: e.attempt, willRetry: e.willRetry }));
    engine.register<{ ok?: boolean }>({
      id: 'net',
      version: 1,
      steps: [
        {
          id: 'push',
          retry: { maxAttempts: 4, baseMs: 100, jitter: 0, retryOn: transientError },
          run: async ({ attempt }) => {
            tries++;
            if (flaky-- > 0) throw new Error(`ECONNRESET on try ${attempt}`);
            return { ok: true };
          },
        },
      ],
    });
    engine.create('net', {}, { runId: 'n1' });
    const r = await engine.start('n1');
    assert.equal(r.status, 'done');
    assert.equal(tries, 3);
    assert.deepEqual(clock.slept, [100, 200]);
    assert.deepEqual(failed, [
      { attempt: 1, willRetry: true },
      { attempt: 2, willRetry: true },
    ]);
    assert.deepEqual(r.history.map((h) => h.status), ['retrying', 'retrying', 'done']);

    // Not a transient error: no retry, the run fails at that step, and a resume gets fresh tries.
    let fatal = true;
    engine.register<{ ok?: boolean }>({ id: 'net', version: 2, steps: [{ id: 'push', retry: { maxAttempts: 4, retryOn: transientError }, run: async () => (fatal ? Promise.reject(new Error('permission denied')) : { ok: true }) }] });
    engine.create('net', {}, { runId: 'n2' });
    const bad = await engine.start('n2');
    assert.equal(bad.status, 'failed');
    assert.equal(bad.step, 'push');
    assert.equal(bad.error, 'permission denied');
    assert.equal(bad.attempts.push, 1);
    fatal = false;
    const fixed = await engine.resume('n2');
    assert.equal(fixed.status, 'done');
    assert.equal(fixed.version, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a cached step reuses its result for the same key within the TTL, and runs again after it or for another key', async () => {
  const dir = tmp();
  try {
    const clock: Clock = { t: 0, slept: [] };
    const engine = engineIn(dir, clock);
    let runs = 0;
    engine.register<{ version: string; report?: string }>({
      id: 'doctor',
      version: 1,
      steps: [{ id: 'check', cache: { key: (s) => s.version, ttlMs: 60_000 }, run: async ({ state }) => ({ report: `ok ${state.version} #${++runs}` }) }],
    });
    const go = async (id: string, version: string) => {
      engine.create('doctor', { version }, { runId: id });
      return engine.start(id);
    };
    assert.equal((await go('d1', '11.6')).state.report, 'ok 11.6 #1');
    const hit = await go('d2', '11.6');
    assert.equal(hit.state.report, 'ok 11.6 #1', 'a hit');
    assert.equal(hit.history[0].status, 'cached');
    assert.equal((await go('d3', '11.12')).state.report, 'ok 11.12 #2', 'another key misses');
    clock.t += 60_001;
    assert.equal((await go('d4', '11.6')).state.report, 'ok 11.6 #3', 'past the TTL it runs again');
    assert.ok(existsSync(path.join(dir, '_cache', 'doctor', 'check')));
    assert.deepEqual(new FileStore(dir).loadAll().map((r) => r.runId).sort(), ['d1', 'd2', 'd3', 'd4'], 'the cache is not taken for runs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loop guards: a review loop stops at its limit, needs attention, and a resume grants it another round', async () => {
  const dir = tmp();
  try {
    const engine = engineIn(dir);
    const paused: string[] = [];
    engine.on('run-paused', (e) => paused.push(`${e.reason.kind}:${e.reason.edge ?? ''}`));
    engine.register(reviewFlow(4, 2));
    engine.create('review', fresh(), { runId: 'l1' });
    const r = await engine.start('l1');
    assert.equal(r.status, 'needs-attention');
    assert.equal(r.reason?.kind, 'loop');
    assert.equal(r.reason?.edge, 'review->draft');
    assert.equal(r.step, 'draft', 'it stops before going round again');
    assert.equal(r.state.drafts, 3);
    assert.deepEqual(paused, ['loop:review->draft']);
    const on = await engine.resume('l1');
    assert.equal(on.status, 'done');
    assert.equal(on.state.drafts, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the recursion limit stops a run that never ends, and a budget stops one that spends too much', async () => {
  const dir = tmp();
  try {
    const engine = engineIn(dir);
    engine.register<{ n: number }>({ id: 'spin', version: 1, steps: [{ id: 'again', run: async ({ state }) => ({ n: state.n + 1 }) }], edges: { again: 'again' }, limits: { maxSteps: 5 } });
    engine.create('spin', { n: 0 }, { runId: 's1' });
    const r = await engine.start('s1');
    assert.equal(r.status, 'needs-attention');
    assert.equal(r.reason?.kind, 'max-steps');
    assert.equal(r.state.n, 5);
    const more = await engine.resume('s1');
    assert.equal(more.state.n, 10, 'each resume gets the limit again');

    engine.register<{ n: number }>({
      id: 'spend',
      version: 1,
      steps: ['a', 'b', 'c'].map((id) => ({ id, run: async ({ state, report }) => (report({ cost: 4 }), { n: state.n + 1 }) })),
      limits: { budget: { cost: 7 } },
    });
    engine.create('spend', { n: 0 }, { runId: 'b1' });
    const b = await engine.start('b1');
    assert.equal(b.status, 'needs-attention');
    assert.equal(b.reason?.kind, 'budget');
    assert.equal(b.usage.cost, 8);
    assert.equal(b.step, 'c', 'b finished; c waits');
    assert.match(b.reason?.message ?? '', /8 of a budget of 7/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('interrupt: a step stops the run waiting with a payload, and resume delivers the answer to that step, even after a restart', async () => {
  const dir = tmp();
  try {
    interface S {
      answer?: string;
      shipped?: boolean;
    }
    const flow: WorkflowDef<S> = {
      id: 'ask',
      version: 1,
      steps: [
        { id: 'approve', run: async (ctx) => (ctx.resume === undefined ? interrupt({ question: 'Ship it?', options: ['yes', 'no'] }) : { answer: String(ctx.resume) }) },
        { id: 'ship', run: async ({ state }) => ({ shipped: state.answer === 'yes' }) },
      ],
    };
    const engine = engineIn(dir);
    engine.register(flow);
    engine.create('ask', {} as S, { runId: 'q1' });
    const w = await engine.start('q1');
    assert.equal(w.status, 'waiting');
    assert.deepEqual(w.waiting?.payload, { question: 'Ship it?', options: ['yes', 'no'] });
    assert.equal(w.reason?.kind, 'interrupt');

    const later = engineIn(dir);
    later.register(flow);
    assert.equal(later.get('q1')?.status, 'waiting', 'waiting survives a restart as it is');
    const done = await later.resume('q1', 'yes');
    assert.equal(done.status, 'done');
    assert.equal(done.state.shipped, true);
    assert.equal(done.waiting, undefined);
    await assert.rejects(later.resume('q1'), /nothing to resume/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pause stops after the step that is running; cancel aborts it and throws its result away; events come in order', async () => {
  const dir = tmp();
  try {
    const engine = engineIn(dir);
    const seen: string[] = [];
    for (const name of ['run-started', 'step-started', 'step-finished', 'step-failed', 'run-paused', 'run-finished'] as FlowEventName[]) engine.on(name, (e: { step?: string }) => seen.push(`${name}${e.step ? `:${e.step}` : ''}`));
    let release!: () => void;
    let aborted = false;
    engine.register<{ n: number }>({
      id: 'slow',
      version: 1,
      steps: [
        { id: 'one', run: ({ state }) => new Promise((r) => (release = () => r({ n: state.n + 1 }))) },
        {
          id: 'two',
          run: ({ signal }) =>
            new Promise((_r, reject) =>
              signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('stopped'));
              }),
            ),
        },
      ],
    });
    engine.create('slow', { n: 0 }, { runId: 'c1' });
    const p = engine.start('c1');
    assert.equal(engine.isActive('c1'), true);
    assert.equal(engine.start('c1'), p, 'not started twice');
    assert.equal(engine.pause('c1'), true);
    release();
    const paused = await p;
    assert.equal(paused.status, 'paused');
    assert.equal(paused.step, 'two');
    assert.equal(paused.state.n, 1);

    const p2 = engine.resume('c1');
    await new Promise((r) => setImmediate(r));
    assert.equal(engine.cancel('c1'), true);
    const cancelled = await p2;
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(aborted, "the step's signal aborted");
    assert.equal(engine.cancel('c1'), false, 'over already');
    assert.deepEqual(seen, ['run-started', 'step-started:one', 'step-finished:one', 'run-paused', 'run-started', 'step-started:two', 'run-finished']);

    // A stopped run is just marked.
    engine.create('slow', { n: 0 }, { runId: 'c2' });
    assert.equal(engine.cancel('c2'), true);
    assert.equal(engine.get('c2')?.status, 'cancelled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const plan = (): ProjectPlan => ({
  kind: 'new',
  owner: 'Test-Org',
  name: 'old-app',
  description: 'Saved before the engine',
  private: true,
  mendix: '11.6.4',
  entry: 'greenfield',
  tier: 'small',
  interview: 'attended' as ProjectPlan['interview'],
  execApproval: 'auto',
  intake: [],
  clients: [],
  operators: [],
  roles: [],
  discovery: { issue: false, queue: false, model: 'opus' },
  createdByHand: false,
});

test("the wizard's jobs saved before the engine are taken in: a mid-step one is marked for a Retry, which carries on from there", async () => {
  const dir = tmp();
  try {
    const old: JobState = newJob(plan(), 'Probe');
    for (const s of SETUP_STEPS.slice(0, 6)) old.steps[s.id] = { status: 'done' };
    old.steps.intake = { status: 'running' };
    old.status = 'running';
    old.floor = 'old-app';
    old.log = ['▶ Write the intake answers'];
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${old.id}.json`), JSON.stringify(old));
    const book = new JobBook(dir);
    const job = book.get(old.id)!;
    assert.ok(job, 'the old job loads');
    assert.equal(job.status, 'failed');
    assert.equal(job.steps.intake.status, 'failed');
    assert.match(job.steps.intake.detail ?? '', /restarted/);
    assert.equal(job.plan.interview, 'steering', 'old answers in today’s words');
    assert.equal(book.byFloor('old-app'), job);
    assert.ok(existsSync(path.join(dir, `${old.id}.json.migrated`)), 'the old file is kept, renamed');
    assert.ok(existsSync(path.join(dir, SETUP_FLOW, `${old.id}.json`)));
    const run = book.engine.get(old.id)!;
    assert.equal(run.status, 'interrupted');
    assert.equal(run.step, 'intake');

    const calls: StepId[] = [];
    const impls = Object.fromEntries(SETUP_STEPS.map((s) => [s.id, (async () => (calls.push(s.id), { status: 'done' as const })) satisfies StepImpl])) as Record<StepId, StepImpl>;
    await book.run(job, impls);
    assert.deepEqual(calls, SETUP_STEPS.slice(6).map((s) => s.id));
    assert.equal(job.status, 'done');

    // And a new office finds it, done, in the engine's own file.
    const again = new JobBook(dir);
    assert.equal(again.get(old.id)?.status, 'done');
    assert.equal(again.engine.get(old.id)?.status, 'done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the wizard's network steps try again on a dropped connection, and say so in the log", async () => {
  const dir = tmp();
  try {
    const clock: Clock = { t: 0, slept: [] };
    const book = new JobBook(dir, (l) => l, engineIn(dir, clock));
    const job = newJob({ ...plan(), name: 'flaky-app' }, 'Probe');
    let drops = 1;
    const impls = Object.fromEntries(
      SETUP_STEPS.map((s) => [
        s.id,
        (async () => {
          if (s.id === 'clone' && drops-- > 0) throw new Error('fatal: unable to access https://github.com/x/y.git: Could not resolve host: github.com');
          return { status: 'done' as const };
        }) satisfies StepImpl,
      ]),
    ) as Record<StepId, StepImpl>;
    await book.run(job, impls);
    assert.equal(job.status, 'done', job.log.join('\n'));
    assert.equal(clock.slept.length, 1);
    assert.ok(job.log.some((l) => l.startsWith('↻ Clone it as a floor failed (try 1 of 3)')));
    assert.ok(job.log.some((l) => l.includes('(try 2 of 3)')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/flows lists the office engine’s runs by floor, without their state', async () => {
  const dir = tmp();
  try {
    const ctx = { cfg: { dataDir: dir } };
    const engine = flowsOf(ctx as never);
    assert.equal(flowsOf(ctx as never), engine, 'one per office');
    engine.register(reviewFlow(1));
    engine.create('review', fresh(), { runId: 'a1', floor: 'f1' });
    engine.create('review', fresh(), { runId: 'b1', floor: 'f2' });
    await engine.start('a1');
    const call = (q: string) => {
      let status = 0;
      let body: { runs: Record<string, unknown>[] } = { runs: [] };
      const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)) };
      (flowRoutes.list.handle as (c: unknown, r: unknown) => unknown)(ctx, { req: {}, res, url: new URL(`http://office.test/api/flows${q}`), path: '/api/flows', session: {} });
      return { status, body };
    };
    const all = call('');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.runs.map((r) => r.runId).sort(), ['a1', 'b1']);
    const one = call('?floor=f1');
    assert.deepEqual(one.body.runs.map((r) => [r.runId, r.status, r.workflow]), [['a1', 'done', 'review']]);
    assert.ok(!('state' in one.body.runs[0]), 'no state');
    // Written in the background (the office's store): there a moment later.
    for (let i = 0; i < 100 && !existsSync(path.join(dir, 'flows', 'review', 'a1.json')); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(existsSync(path.join(dir, 'flows', 'review', 'a1.json')), 'kept in <data>/flows');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
