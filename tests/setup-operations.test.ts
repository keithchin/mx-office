// Operation records for setup's external actions (shared/setup-operations.ts, server/wizard/operations.ts,
// reconcile.ts, flow/critical-write.ts): the intent is saved through an acknowledged critical write before
// gh is asked anything, the outcome after; an outcome nobody confirmed stops the setup until a look
// settles it; a look never makes a record "created by this operation"; "Use this existing repository"
// records adopted, which never lets Cancel & undo delete; Cancel & undo deletes only on a confirmed create
// with the same GitHub id now, and its own deletes are records too. Fakes only: gh is a function or a
// fake, never run; the file faults come from an injected fs. GitHub is never called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_STEPS, type ProjectPlan, type StepId } from '../src/shared/wizard.js';
import { JobBook, newJob, type JobState, type StepImpl, type StepIO } from '../src/server/wizard/job.js';
import { setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';
import type { WizardConfig } from '../src/server/wizard/config.js';
import type { RunOptions, RunResult } from '../src/server/wizard/run.js';
import { writeJsonCritical, type CriticalFs } from '../src/server/flow/critical-write.js';
import { OperationStore, type OperationChange } from '../src/server/wizard/operations.js';
import { adopt, reconcile, type ReconcileDeps } from '../src/server/wizard/reconcile.js';
import { reconcileOnStart } from '../src/server/wizard/operations-office.js';
import { folderAuthority, repoAuthority } from '../src/server/wizard/ownership.js';
import { SetupCancels, snapshotOf, type CancelDeps } from '../src/server/wizard/cancel.js';
import type { RepoLookup } from '../src/server/wizard/repo-lookup.js';
import { effectiveProvenance, legacyOperations, needsAttention, operationNotice, readOperation, repoCreateProof, type OperationRecord } from '../src/shared/setup-operations.js';
import { PROVENANCE_VERSION } from '../src/shared/setup-provenance.js';
import { madeBySetup } from '../src/shared/setup-cancel.js';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { auditOperation } from '../src/server/wizard/operations-office.js';
import { removeDir } from './support/cleanup.js';

const PLAN: ProjectPlan = {
  kind: 'new',
  owner: 'Test-Org',
  name: 'demo-app',
  description: '',
  private: true,
  mendix: '11.12.4',
  entry: 'greenfield',
  tier: 'standard',
  interview: 'steering',
  execApproval: 'auto',
  intake: [],
  clients: [],
  operators: [],
  roles: ['pm'],
  discovery: { issue: true, queue: false, model: 'opus' },
  createdByHand: false,
};
const REPO = 'Test-Org/demo-app';
const NOT_THERE = `GraphQL: Could not resolve to a Repository with the name '${REPO}'. (repository)`;
const io: StepIO = { log: () => undefined };
const FOUND = (id: string, createdAt?: string) => ({ code: 0, stdout: JSON.stringify({ id, nameWithOwner: REPO, ...(createdAt ? { createdAt } : {}) }) });

type Answer = Partial<RunResult> | Error | (() => Promise<Partial<RunResult>>);
/** A fake runCommand: each gh call takes the next answer for its subcommand (`view` or `create`), and is recorded. */
function fakeGh(answers: { view: Answer[]; create?: Answer[] }) {
  const calls: string[][] = [];
  const run = async (cmd: string, args: string[], _opts: RunOptions): Promise<RunResult> => {
    assert.equal(cmd, 'gh');
    calls.push(args);
    const list = args[1] === 'create' ? (answers.create ?? []) : answers.view;
    const a = list.length > 1 ? list.shift()! : list[0];
    if (!a) throw new Error(`unexpected gh ${args.join(' ')}`);
    if (a instanceof Error) throw a;
    const r = typeof a === 'function' ? await a() : a;
    return { code: 0, tail: [], stdout: '', ...r };
  };
  return { run, calls, created: () => calls.filter((c) => c[1] === 'create').length };
}

const tmpRoot = (t: { after(fn: () => void): void }, name = 'ops') => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), `test-office-${name}-`)));
  t.after(() => removeDir(root));
  return root;
};

function stepsFor(root: string, run: SetupDeps['run'], over: Partial<SetupDeps> = {}) {
  const tokenFile = path.join(root, 'admin-token');
  writeFileSync(tokenFile, 'github_pat_FAKEADMIN0123456789\n');
  const projects = path.join(root, 'projects');
  mkdirSync(projects, { recursive: true });
  const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir: root, org: 'Test-Org', adminTokenFile: tokenFile };
  const deps: SetupDeps = { cfg, env: { PATH: process.env.PATH }, run, projectsDir: () => projects, floorOf: () => undefined, addFloor: async () => 'unused', adoptFloor: () => 'unused', queue: () => undefined, hired: () => false, known: () => false, hire: async () => 'unused', ...over };
  return { projects, steps: setupSteps(deps) };
}

/** Only the repo step for real; every later step records that it ran. */
function onlyRepo(steps: Record<StepId, StepImpl>, ran: StepId[]) {
  return Object.fromEntries(SETUP_STEPS.map((s) => [s.id, s.id === 'repo' ? steps.repo : async () => (ran.push(s.id), { status: 'skipped' as const })])) as Record<StepId, StepImpl>;
}

/**
 * node:fs/promises with faults: `fail(op, n)` says whether the n-th call of that kind (1-based) fails, and
 * with which code. Opens count the record's temporary file only (one per write), not the folder's best-effort sync.
 */
function faultyFs(fail: (op: 'open' | 'write' | 'sync' | 'rename', n: number, file: string) => string | undefined) {
  const count = { open: 0, write: 0, sync: 0, rename: 0 };
  const boom = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });
  const fs: CriticalFs = {
    async open(file, flags, mode) {
      const c = file.endsWith('.tmp') ? fail('open', ++count.open, file) : undefined;
      if (c) throw boom(c);
      const h = await fsp.open(file, flags, mode);
      return {
        writeFile: async (d: string) => {
          const w = fail('write', ++count.write, file);
          if (w) throw boom(w);
          await h.writeFile(d);
        },
        sync: async () => {
          const s = fail('sync', ++count.sync, file);
          if (s) throw boom(s);
          await h.sync();
        },
        close: () => h.close(),
      };
    },
    async rename(a, b) {
      const c = fail('rename', ++count.rename, b);
      if (c) throw boom(c);
      await fsp.rename(a, b);
    },
    mkdir: (d, o) => fsp.mkdir(d, o),
    rm: (f, o) => fsp.rm(f, o),
  };
  return { fs, count };
}

const lookupOf = (answers: RepoLookup[]): ReconcileDeps & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, lookup: async (r) => (asked.push(r), answers.length > 1 ? answers.shift()! : answers[0]) };
};

test('the critical write tells its caller when it fails (EACCES, ENOSPC at open, write, fsync or rename) and leaves the old file whole', async (t) => {
  const root = tmpRoot(t, 'critical');
  const file = path.join(root, 'sub', 'record.json');
  await writeJsonCritical(file, { v: 1 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 1 });
  for (const [op, code] of [
    ['open', 'EACCES'],
    ['write', 'ENOSPC'],
    ['sync', 'EIO'],
    ['rename', 'ENOSPC'],
  ] as const) {
    const { fs } = faultyFs((o) => (o === op ? code : undefined));
    await assert.rejects(writeJsonCritical(file, { v: 2 }, fs), (err: NodeJS.ErrnoException) => err.code === code, `${op} ${code} rejects`);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 1 }, `${op}: the old content is still there`);
    assert.deepEqual(readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), [], `${op}: no temporary file left`);
  }
  // A rename Windows refuses for a moment is tried again.
  const { fs } = faultyFs((o, n) => (o === 'rename' && n === 1 ? 'EBUSY' : undefined));
  await writeJsonCritical(file, { v: 3 }, fs);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 3 });
});

test('O5: the intent can\'t be saved, so nothing is sent: the fake gh receives no call at all, and the step says why', async (t) => {
  const root = tmpRoot(t);
  const gh = fakeGh({ view: [{ code: 1, tail: [NOT_THERE] }], create: [{ code: 0 }] });
  const { steps } = stepsFor(root, gh.run);
  const { fs } = faultyFs((o) => (o === 'open' ? 'EACCES' : undefined));
  const book = new JobBook(path.join(root, 'jobs'), undefined, undefined, { ops: new OperationStore(path.join(root, 'jobs', 'operations'), { fs }) });
  const job = newJob(PLAN, 'Probe');
  book.add(job);
  const ran: StepId[] = [];
  await book.run(job, onlyRepo(steps, ran));
  assert.equal(job.steps.repo.status, 'failed');
  assert.match(job.steps.repo.detail ?? '', /couldn't save its record of creating the repository before doing it \(EACCES: .*\), so it didn't start/);
  assert.deepEqual(gh.calls, [], 'gh was asked nothing');
  assert.deepEqual(ran, [], 'no later step ran');
  assert.deepEqual(book.opsOf(job), []);
});

test('O5: gh created it but the outcome can\'t be saved: later steps stop, the intent stays in flight, Retry won\'t create again, and a restart reconciles it', async (t) => {
  const root = tmpRoot(t);
  const dir = path.join(root, 'jobs');
  const t0 = new Date().toISOString();
  const gh = fakeGh({ view: [{ code: 1, tail: [NOT_THERE] }, FOUND('R_kgDOnew', t0)], create: [{ code: 0 }] });
  const { steps } = stepsFor(root, gh.run);
  // Writes: 1 prepared, 2 in flight, 3 the outcome (fails).
  const { fs } = faultyFs((o, n) => (o === 'open' && n === 3 ? 'ENOSPC' : undefined));
  const book = new JobBook(dir, undefined, undefined, { ops: new OperationStore(path.join(dir, 'operations'), { fs }) });
  const job = newJob(PLAN, 'Probe');
  book.add(job);
  const ran: StepId[] = [];
  await book.run(job, onlyRepo(steps, ran));
  assert.equal(gh.created(), 1);
  assert.equal(job.steps.repo.status, 'failed');
  assert.match(job.steps.repo.detail ?? '', /finished creating the repository but couldn't save the result \(ENOSPC/);
  assert.deepEqual(ran, [], 'no dependent step ran');
  const onDisk = JSON.parse(readFileSync(path.join(dir, 'operations', `${job.id}.json`), 'utf8')) as { ops: OperationRecord[] };
  assert.equal(onDisk.ops.length, 1);
  assert.equal(onDisk.ops[0].state, 'in-flight', 'the durable intent is kept');
  assert.ok(book.pendingOps(job).length, 'the setup needs reconciliation');
  assert.equal(book.view(job).operation?.title, 'Repository creation may have completed');
  // A Retry without a look: the gate stops it before any step, nothing is created again.
  await book.run(job, onlyRepo(steps, ran));
  assert.equal(gh.created(), 1, 'no second create');
  assert.match(job.steps.repo.detail ?? '', /^Repository creation may have completed\. GitHub stopped responding before Office could confirm the result\. Setup is paused so it doesn't create or remove the wrong thing\./);

  // The office restarts: the record is read back and reconciled once.
  const book2 = new JobBook(dir);
  const job2 = book2.get(job.id)!;
  const look = lookupOf([{ state: 'found', githubId: 'R_kgDOnew', nameWithOwner: REPO, createdAt: t0 }]);
  await reconcileOnStart(book2, look);
  assert.deepEqual(look.asked, [REPO]);
  const [op] = book2.opsOf(job2);
  assert.equal(op.state, 'succeeded', 'GitHub made it after the intent: the evidence fits');
  assert.equal(op.evidence, 'created-after-intent');
  assert.equal(op.provenance, 'unverified', 'but a look never proves the setup made it');
  assert.equal(op.identity?.githubId, 'R_kgDOnew');
  assert.equal(book2.view(job2).operation?.adopt, 'Use this existing repository');
  assert.equal(repoCreateProof(book2.opsOf(job2), job2.provenance, REPO, false).proof, 'unverified', 'no deletion authority');
  assert.equal(gh.created(), 1);
});

test('O1: the office stops after gh repo create went out and before its outcome was saved: on restart a look, no second create, and no ownership invented', async (t) => {
  const root = tmpRoot(t);
  const dir = path.join(root, 'jobs');
  let release!: () => void;
  const sent = new Promise<void>((r) => (release = r));
  // The create goes out, and the office "stops" while it runs (its answer never comes back to this book).
  const gh = fakeGh({ view: [{ code: 1, tail: [NOT_THERE] }], create: [() => (release(), new Promise<Partial<RunResult>>(() => undefined))] });
  const { steps } = stepsFor(root, gh.run);
  const book = new JobBook(dir);
  const job = newJob(PLAN, 'Probe');
  book.add(job);
  void book.run(job, onlyRepo(steps, []));
  await sent;
  assert.equal(gh.created(), 1);

  // The office comes back: the checkpoint says the repo step was running, the record says in flight.
  const book2 = new JobBook(dir);
  const job2 = book2.get(job.id)!;
  assert.equal(job2.steps.repo.status, 'failed');
  assert.equal(book2.opsOf(job2)[0].state, 'in-flight');
  const look = lookupOf([{ state: 'found', githubId: 'R_kgDOmaybe', nameWithOwner: REPO }]);
  await reconcileOnStart(book2, look);
  const op = book2.opsOf(job2)[0];
  assert.equal(op.state, 'resolved', 'no creation time from GitHub: no evidence it was this operation');
  assert.equal(op.provenance, 'unverified');
  assert.equal(op.evidence, 'no-evidence');
  assert.equal(effectiveProvenance(book2.opsOf(job2), job2.provenance)?.repo, undefined, 'nothing is the setup\'s while unverified');
  assert.equal(madeBySetup(snapshotOf(job2, root, book2.opsOf(job2)).steps, snapshotOf(job2, root, book2.opsOf(job2)).provenance).repo, false);

  // Retry while it waits: the gate stops it; nothing is created.
  const gh2 = fakeGh({ view: [FOUND('R_kgDOmaybe')], create: [{ code: 0 }] });
  const ran: StepId[] = [];
  await book2.run(job2, onlyRepo(stepsFor(root, gh2.run).steps, ran));
  assert.equal(gh2.calls.length, 0);
  assert.deepEqual(ran, []);
  // Adopting it lets setup carry on: the repo step finds it, and it's never the setup's to delete.
  const adopted = await adopt(book2.ops, job2, op.id, { name: 'Keith' });
  assert.equal(typeof adopted === 'object' && adopted.provenance, 'adopted');
  await book2.run(job2, onlyRepo(stepsFor(root, gh2.run).steps, ran));
  assert.equal(job2.steps.repo.status, 'skipped', job2.steps.repo.detail);
  assert.equal(gh2.created(), 0, 'no duplicate create');
  assert.equal(gh.created() + gh2.created(), 1);
  assert.ok(ran.length > 0, 'the later steps ran once it was settled');
  const proof = repoCreateProof(book2.opsOf(job2), job2.provenance, REPO, false);
  assert.equal(proof.proof, 'adopted');
  const auth = await repoAuthority(async () => JSON.stringify({ id: 'R_kgDOmaybe', nameWithOwner: REPO }), effectiveProvenance(book2.opsOf(job2), job2.provenance), REPO, false, book2.opsOf(job2));
  assert.equal(auth.ok, false);
});

test('O1: on restart a look that finds nothing confirms the create didn\'t happen, and a Retry may create it then', async (t) => {
  const root = tmpRoot(t);
  const store = new OperationStore(path.join(root, 'ops'));
  const job = newJob(PLAN, 'Probe');
  const h = store.handle(job);
  await h.dispatch(await h.prepare('repo-create', REPO, { before: 'absent' }));
  const left = await reconcile(store, job, lookupOf([{ state: 'not-found' }]));
  assert.deepEqual(left, []);
  assert.equal(store.of(job.id, job.startedAt)[0].state, 'failed-confirmed');
  // A prepared record that was never marked in flight was never sent: settled without a look.
  const p = await h.prepare('repo-create', REPO);
  const look = lookupOf([{ state: 'unknown', reason: 'HTTP 401' }]);
  await reconcile(store, job, look);
  assert.equal(store.of(job.id, job.startedAt).find((o) => o.id === p.id)?.state, 'failed-confirmed');
  assert.deepEqual(look.asked, []);
});

test('O3: a timeout, a login that fails or a 403 while reconciling leaves the outcome unknown, blocks the steps and never creates', async (t) => {
  for (const reason of ['gh repo took longer than 60s and was stopped', 'HTTP 401: Bad credentials', 'HTTP 403: Must have admin rights to Repository.']) {
    const root = tmpRoot(t);
    const dir = path.join(root, 'jobs');
    const book = new JobBook(dir);
    const job = newJob(PLAN, 'Probe');
    book.add(job);
    const h = book.ops.handle(job);
    await h.dispatch(await h.prepare('repo-create', REPO, { before: 'absent' }));
    const left = await reconcile(book.ops, job, lookupOf([{ state: 'unknown', reason }]));
    assert.equal(left.length, 1, reason);
    const op = book.opsOf(job)[0];
    assert.equal(op.state, 'outcome-unknown');
    assert.ok(op.history.some((x) => x.state === 'reconciling'));
    const n = operationNotice(book.opsOf(job))!;
    assert.equal(n.check, 'Check GitHub again');
    assert.equal(n.adopt, undefined, 'nothing to adopt before a look found it');
    assert.match(n.text, /GitHub still couldn't say/);
    assert.equal(typeof (await adopt(book.ops, job, op.id, { name: 'Keith' })), 'string', 'adoption refused while unknown');
    const gh = fakeGh({ view: [{ code: 1, tail: [NOT_THERE] }], create: [{ code: 0 }] });
    const ran: StepId[] = [];
    await book.run(job, onlyRepo(stepsFor(root, gh.run).steps, ran));
    assert.equal(gh.calls.length, 0, `${reason}: never asked, never created`);
    assert.deepEqual(ran, []);
    assert.equal(repoCreateProof(book.opsOf(job), undefined, REPO, false).proof, 'unresolved');
  }
});

test('a gh repo create that times out or gets a 5xx is outcome-unknown (never failed-confirmed); a plain 422 is failed-confirmed', async (t) => {
  for (const [answer, state] of [
    [new Error('gh repo took longer than 120s and was stopped'), 'outcome-unknown'],
    [{ code: 1, tail: ['HTTP 502: Bad Gateway'] }, 'outcome-unknown'],
    [new Error('gh exit 1: GraphQL: Name already exists on this account (createRepository)'), 'failed-confirmed'],
  ] as const) {
    const root = tmpRoot(t);
    const failing = answer instanceof Error ? answer : new Error(`gh exit 1: ${answer.tail.join(' ')}`);
    const gh = fakeGh({ view: [{ code: 1, tail: [NOT_THERE] }], create: [failing] });
    const book = new JobBook(path.join(root, 'jobs'));
    const job = newJob(PLAN, 'Probe');
    book.add(job);
    await book.run(job, onlyRepo(stepsFor(root, gh.run).steps, []));
    assert.equal(gh.created(), 1, 'tried once: an uncertain create is never retried by itself');
    const ops = book.opsOf(job);
    assert.equal(ops.at(-1)?.state, state, String(failing.message));
    assert.equal(needsAttention(ops.at(-1)!), state === 'outcome-unknown');
  }
});

test('O2: a repository already on GitHub at the name is never the setup\'s: the create is "not needed", and adoption keeps it adopted', async (t) => {
  const root = tmpRoot(t);
  const gh = fakeGh({ view: [FOUND('R_kgDOold')] });
  const book = new JobBook(path.join(root, 'jobs'));
  const job = newJob(PLAN, 'Probe');
  book.add(job);
  await book.run(job, onlyRepo(stepsFor(root, gh.run).steps, []));
  assert.equal(gh.created(), 0);
  const [op] = book.opsOf(job);
  assert.equal(op.state, 'failed-confirmed');
  assert.match(op.detail ?? '', /^not needed/);
  assert.equal(repoCreateProof(book.opsOf(job), job.provenance, REPO, false).proof, 'pre-existing');
  // An in-flight create later found there by a look stays unverified until adopted; adopted is never "created".
  const store = new OperationStore(path.join(root, 'ops2'));
  const j2 = newJob(PLAN, 'Probe');
  const h = store.handle(j2);
  const o = await h.dispatch(await h.prepare('repo-create', REPO, { before: 'absent' }));
  await reconcile(store, j2, lookupOf([{ state: 'found', githubId: 'R_kgDOold', createdAt: '2020-01-01T00:00:00Z' }]));
  assert.equal(store.of(j2.id, j2.startedAt)[0].evidence, 'no-evidence', 'made years before the intent');
  await adopt(store, j2, o.id, { name: 'Keith' });
  const after = store.of(j2.id, j2.startedAt);
  assert.equal(after[0].provenance, 'adopted');
  assert.equal(after[0].state, 'resolved');
  assert.equal(effectiveProvenance(after, undefined)?.repo?.createdBySetup, false);
  assert.equal(repoCreateProof(after, undefined, REPO, false).proof, 'adopted');
});

/** Cancel & undo for a setup that never made a floor, on an operation store, with a fake gh. */
function cancelWorld(t: { after(fn: () => void): void }, ghId: { now: string }, opts: { storeFs?: CriticalFs; deleteFails?: Error } = {}) {
  const root = tmpRoot(t, 'cancel');
  const data = path.join(root, 'data');
  const home = path.join(root, 'projects');
  mkdirSync(home, { recursive: true });
  const book = new JobBook(path.join(data, 'wizard'));
  const changes: string[] = [];
  const onChange: OperationChange = (op, from) => void changes.push(`${op.kind}:${from ?? '-'}>${op.state}`);
  const store = new OperationStore(path.join(data, 'wizard', 'operations'), { fs: opts.storeFs, onChange });
  const job = newJob({ ...PLAN, owner: 'acme', name: 'shop' }, 'Keith');
  job.status = 'failed';
  book.add(job);
  const calls: string[][] = [];
  let view: 'found' | 'gone' = 'found';
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[1] === 'view') {
      if (view === 'gone') throw new Error("GraphQL: Could not resolve to a Repository with the name 'acme/shop'. (repository)");
      return JSON.stringify({ id: ghId.now, nameWithOwner: 'acme/shop' });
    }
    if (args[0] === 'api' && args[1] === '-i') return 'HTTP/2.0 200 OK\nX-Oauth-Scopes: repo, delete_repo\n\n{}';
    if (args.includes('DELETE')) {
      if (opts.deleteFails) {
        const e = opts.deleteFails;
        opts.deleteFails = undefined;
        throw e;
      }
      view = 'gone';
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const deps: CancelDeps = {
    dataDir: data,
    projectsHome: () => home,
    setup: (id) => book.get(id),
    running: () => false,
    removeSetup: (id) => book.remove(id),
    defaultDir: (o, n) => path.join(home, o, n),
    hasFloor: () => false,
    busyAgents: () => [],
    blocked: () => undefined,
    studioOpen: () => false,
    deletes: { plan: async () => 'none', start: async () => 'none', settled: async () => undefined, job: async () => undefined },
    gh,
    operations: store,
    testMode: () => false,
    ghIsFake: () => true,
    audit: () => undefined,
    now: () => Date.now(),
  };
  return { root, book, job, store, svc: new SetupCancels(deps), calls, changes, deleted: () => calls.filter((a) => a.includes('DELETE')).length, goneNow: () => void (view = 'gone') };
}

/** A confirmed create of acme/shop by this setup (with GitHub's id). */
async function created(store: OperationStore, job: JobState, githubId = 'R_kgDOshop') {
  const h = store.handle(job);
  const op = await h.dispatch(await h.prepare('repo-create', 'acme/shop', { before: 'absent' }));
  return h.settle(op, 'succeeded', { provenance: 'created-by-this-operation', identity: { githubId, nameWithOwner: 'acme/shop' } });
}

test('Cancel & undo deletes only on a confirmed create with the same GitHub id now, and the delete is an operation record of its own (audited)', async (t) => {
  const w = cancelWorld(t, { now: 'R_kgDOshop' });
  const made = await created(w.store, w.job);
  const plan = await w.svc.plan(w.job.id);
  assert.ok(typeof plan === 'object' && plan.repoDelete.possible && plan.repoDelete.createdBySetup, JSON.stringify(typeof plan === 'object' && plan.repoDelete));
  const r = await w.svc.start(w.job.id, { confirm: 'acme/shop', deleteFolder: false, deleteRepo: true }, { name: 'Keith' });
  assert.equal(typeof r, 'object');
  await w.svc.settled(w.job.id);
  assert.equal(w.deleted(), 1);
  // The setup's records were retired with it (kept beside, never read again).
  const retired = readdirSync(w.store.root).find((f) => f.endsWith('.retired'))!;
  assert.ok(retired, 'the records are kept beside');
  assert.deepEqual(w.store.all(w.job.id), [], 'and never read again');
  const del = (JSON.parse(readFileSync(path.join(w.store.root, retired), 'utf8')) as { ops: OperationRecord[] }).ops.find((o) => o.kind === 'repo-delete')!;
  assert.equal(del.state, 'succeeded');
  assert.equal(del.authorisedBy, made.id);
  assert.deepEqual(del.history.map((x) => x.state), ['prepared', 'in-flight', 'succeeded']);
  assert.deepEqual(w.changes.filter((c) => c.startsWith('repo-delete')), ['repo-delete:->prepared', 'repo-delete:prepared>in-flight', 'repo-delete:in-flight>succeeded']);
});

test('O4: the same name now points to another repository id, so Cancel & undo refuses (and sends no delete)', async (t) => {
  const ghId = { now: 'R_kgDOshop' };
  const w = cancelWorld(t, ghId);
  await created(w.store, w.job);
  ghId.now = 'R_kgDOsomeoneelse';
  const plan = await w.svc.plan(w.job.id);
  assert.ok(typeof plan === 'object' && !plan.repoDelete.possible && plan.repoDelete.proof === 'mismatch', JSON.stringify(typeof plan === 'object' && plan.repoDelete));
  // Swapped in after the plan: the server checks again right before deleting.
  ghId.now = 'R_kgDOshop';
  const r = await w.svc.start(w.job.id, { confirm: 'acme/shop', deleteFolder: false, deleteRepo: true }, { name: 'Keith' });
  assert.equal(typeof r, 'object');
  ghId.now = 'R_kgDOsomeoneelse';
  await w.svc.settled(w.job.id);
  assert.equal(w.deleted(), 0);
  assert.equal(w.store.all(w.job.id).filter((o) => o.kind === 'repo-delete').length, 0, 'no delete intent either');
});

test('Cancel & undo: a delete whose intent can\'t be saved is never sent; one whose answer is lost is settled by a look, never sent twice', async (t) => {
  // Writes: 1-3 the create's, 4 the delete's intent (fails).
  const { fs } = faultyFs((o, n) => (o === 'open' && n === 4 ? 'EACCES' : undefined));
  const w = cancelWorld(t, { now: 'R_kgDOshop' }, { storeFs: fs });
  await created(w.store, w.job);
  await w.svc.start(w.job.id, { confirm: 'acme/shop', deleteFolder: false, deleteRepo: true }, { name: 'Keith' });
  await w.svc.settled(w.job.id);
  assert.equal(w.deleted(), 0, 'no DELETE without its saved intent');
  const stopped = await w.svc.job(w.job.id);
  assert.match(stopped?.error ?? '', /couldn't save its record of deleting the repository before doing it/);

  const w2 = cancelWorld(t, { now: 'R_kgDOshop' }, { deleteFails: new Error('gh api took longer than 60s and was stopped') });
  await created(w2.store, w2.job);
  await w2.svc.start(w2.job.id, { confirm: 'acme/shop', deleteFolder: false, deleteRepo: true }, { name: 'Keith' });
  await w2.svc.settled(w2.job.id);
  assert.equal(w2.store.all(w2.job.id).find((o) => o.kind === 'repo-delete')?.state, 'outcome-unknown', 'a timeout is never failed-confirmed');
  // It did go through on GitHub's side: carrying on looks first and sends nothing again.
  assert.equal(w2.deleted(), 1);
  w2.goneNow();
  await w2.svc.start(w2.job.id, { confirm: 'acme/shop', deleteFolder: false, deleteRepo: true }, { name: 'Keith' });
  await w2.svc.settled(w2.job.id);
  assert.equal(w2.deleted(), 1, 'no second DELETE');
  assert.ok(w2.changes.includes('repo-delete:reconciling>succeeded'), w2.changes.join(', '));
  assert.equal((await w2.svc.job(w2.job.id))?.status, 'done');
});

test('Cancel & undo never deletes while a create\'s outcome is unknown, or after adoption', async (t) => {
  const w = cancelWorld(t, { now: 'R_kgDOshop' });
  const h = w.store.handle(w.job);
  const op = await h.dispatch(await h.prepare('repo-create', 'acme/shop', { before: 'absent' }));
  let plan = await w.svc.plan(w.job.id);
  assert.ok(typeof plan === 'object' && !plan.repoDelete.possible && plan.repoDelete.proof === 'unresolved', JSON.stringify(typeof plan === 'object' && plan.repoDelete));
  await reconcile(w.store, w.job, lookupOf([{ state: 'found', githubId: 'R_kgDOshop', createdAt: new Date().toISOString() }]));
  await adopt(w.store, w.job, op.id, { name: 'Keith' });
  plan = await w.svc.plan(w.job.id);
  assert.ok(typeof plan === 'object' && !plan.repoDelete.possible && plan.repoDelete.proof === 'adopted');
  const r = await w.svc.start(w.job.id, { confirm: 'acme/shop', deleteFolder: false, deleteRepo: true }, { name: 'Keith' });
  assert.match(String(r), /can’t be deleted/);
  assert.equal(w.deleted(), 0);
});

test('O6 and migration: step 1\'s provenance reads as the equivalent record, log wording and other runs\' records never give authority, odd records are no records', async () => {
  const legacy = { v: PROVENANCE_VERSION, repo: { createdBySetup: true, nameWithOwner: REPO, githubId: 'R_kgDOlegacy', at: 1 }, folder: { createdBySetup: false, preExisting: true as const, path: 'C:\\p\\x', at: 1 } };
  const eq = legacyOperations(legacy, 'test-org__demo-app', 5);
  assert.deepEqual(eq.map((o) => [o.kind, o.state, o.provenance, o.identity?.githubId]), [
    ['repo-create', 'succeeded', 'created-by-this-operation', 'R_kgDOlegacy'],
    ['folder-create', 'resolved', 'pre-existing', undefined],
  ]);
  // A setup with no records: step 1's rules exactly (recorded with the id; log lines only a hint).
  assert.deepEqual(repoCreateProof([], legacy, REPO, false), { proof: 'recorded', githubId: 'R_kgDOlegacy' });
  for (const wording of [true, false]) assert.notEqual(repoCreateProof([], undefined, REPO, wording).proof, 'recorded');
  assert.equal(repoCreateProof([], { ...legacy, v: 2 }, REPO, true).proof, 'legacy', 'another version is no proof');
  // Records of another run of the same setup id are never read.
  const store = new OperationStore('', { memory: true });
  const old = newJob(PLAN, 'Probe');
  await created(store, old, 'R_kgDOold');
  const later = { ...newJob(PLAN, 'Probe'), startedAt: old.startedAt + 1 };
  assert.deepEqual(store.of(later.id, later.startedAt), []);
  // Odd or tampered records are no records.
  const good = store.of(old.id, old.startedAt)[0];
  assert.ok(readOperation(JSON.parse(JSON.stringify(good))));
  for (const bad of [{ ...good, v: 2 }, { ...good, state: 'done' }, { ...good, provenance: 'mine' }, { ...good, kind: 'repo-rename' }, null, 'x']) assert.equal(readOperation(bad), undefined);
});

test('O6: a junction escaping the projects folder is refused even with a confirmed folder create; ../ traversal resolves to where it really is', async (t) => {
  const root = tmpRoot(t, 'junction');
  const home = path.join(root, 'projects');
  const outside = path.join(root, 'elsewhere');
  mkdirSync(path.join(home, 'acme'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'precious.txt'), 'keep');
  const link = path.join(home, 'acme', 'shop');
  symlinkSync(outside, link, 'junction');
  const store = new OperationStore('', { memory: true });
  const job = newJob({ ...PLAN, owner: 'acme', name: 'shop' }, 'Keith');
  const h = store.handle(job);
  const op = await h.dispatch(await h.prepare('folder-create', link, { before: 'absent' }));
  await h.settle(op, 'succeeded', { provenance: 'created-by-this-operation', identity: { realpath: link } });
  const rules = { home, dataDir: path.join(root, 'data'), local: false, testMode: false };
  const a = await folderAuthority(link, undefined, false, rules, undefined, store.of(job.id, job.startedAt));
  assert.equal(a.ok, false);
  assert.equal(!a.ok && a.proof, 'link');
  const sneaky = path.join(home, 'acme', '..', '..', 'elsewhere');
  const b = await folderAuthority(sneaky, undefined, false, rules, undefined, store.of(job.id, job.startedAt));
  assert.equal(b.ok, false, 'outside the projects folder');
  assert.ok(existsSync(path.join(outside, 'precious.txt')));
});

test('operation changes go to the audit log, redacted', async (t) => {
  const root = tmpRoot(t, 'audit');
  const log = new AuditLog(path.join(root, 'audit'));
  useAudit(log);
  t.after(() => useAudit(undefined));
  const store = new OperationStore(path.join(root, 'ops'), { onChange: auditOperation });
  const job = newJob(PLAN, 'Probe');
  const h = store.handle(job);
  const op = await h.dispatch(await h.prepare('repo-create', REPO, { before: 'absent' }));
  await h.settle(op, 'outcome-unknown', { detail: 'gh failed with token github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ' });
  const events = readAudit({}, log).events.filter((e) => e.action === 'project.setup-operation');
  assert.deepEqual(events.map((e) => e.details?.state).reverse(), ['prepared', 'in-flight', 'outcome-unknown']);
  const text = JSON.stringify(events);
  assert.doesNotMatch(text, /github_pat_11ABCDEFG/);
  assert.match(text, /redacted/);
});

test('the clone is an operation record too: cloned now is the setup\'s; a clone that fails leaving a folder is uncertain, one that leaves nothing failed for sure', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const run = async (fail?: 'after' | 'before') => {
    const root = tmpRoot(t, 'clone');
    const store = new OperationStore(path.join(root, 'ops'));
    let projects = '';
    const { steps, projects: p } = stepsFor(root, undefined, {
      addFloor: async () => {
        const dir = path.join(projects, 'Test-Org', 'demo-app');
        if (fail === 'before') return 'gh repo clone failed: HTTP 401';
        mkdirSync(dir, { recursive: true });
        execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
        if (fail === 'after') throw new Error('the clone was cut off');
        return { id: 'demo-app', dir };
      },
    });
    projects = p;
    const job = newJob(PLAN, 'Probe');
    const r = steps.clone(job, { log: () => undefined, ops: store.handle(job) });
    return { r, ops: () => store.of(job.id, job.startedAt), projects };
  };
  const ok = await run();
  assert.equal((await ok.r).status, 'done');
  const [made] = ok.ops();
  assert.deepEqual([made.kind, made.state, made.provenance, made.before], ['folder-create', 'succeeded', 'created-by-this-operation', 'absent']);
  assert.equal(made.identity?.realpath, realpathSync(path.join(ok.projects, 'Test-Org', 'demo-app')));
  const after = await run('after');
  await assert.rejects(after.r, /Cloning the project folder may have completed/);
  assert.equal(after.ops()[0].state, 'outcome-unknown');
  const before = await run('before');
  await assert.rejects(before.r, /HTTP 401/);
  assert.equal(before.ops()[0].state, 'failed-confirmed');
});
