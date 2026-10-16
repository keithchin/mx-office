// Design systems, Increment 1: the service with a fake mxcli. A new project applies the chosen version once
// (retry and restart never apply twice; `skipped` is a failure); a project with styling of its own, or any
// existing app, gets a ✋ card and no file changes until Adopt (then on a branch of its own); no design system
// → the setup's app step is exactly as before; browsing the gallery and recording a selection call no model
// and start no runtime; the ledger's rows carry the task kind, the design pointer and four token categories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignService, type DesignDeps } from '../src/server/design/service.js';
import type { Run } from '../src/server/design/apply.js';
import { DEFAULT_INPUT } from '../src/shared/design/tokens.js';
import { cleanPlanDesign, withDesign, type DesignSetup } from '../src/server/wizard/design-step.js';
import { SETUP_STEPS, type StepId } from '../src/shared/wizard.js';
import type { StepImpl } from '../src/server/wizard/job.js';
import { designCandidates } from '../src/shared/decisions/design.js';
import { splitTokens } from '../src/server/budget/tokens.js';
import { book, emptyLedger } from '../src/server/budget/ledger.js';
import { BudgetService, localDay } from '../src/server/budget/service.js';
import { addUsage, zeroUsage } from '../src/server/usage.js';
import type { Usage, UsageState, WorkerInfo } from '../src/shared/protocol.js';

const CLIENT = 'pfl_01JA0000000000000000000000';
const STOCK_CV = '$brand-logo: false;\n:root {\n  --brand-primary: #264ae5;\n}\n$use-css-variables: true;\n';
const STOCK_MAIN = '@import "custom-variables";\n@import "theme-dark";\n@import "theme-neutral";\n';

function appDir(root: string, opts: { custom?: boolean } = {}) {
  const d = mkdtempSync(path.join(root, 'app-'));
  mkdirSync(path.join(d, 'theme', 'web'), { recursive: true });
  mkdirSync(path.join(d, 'themesource', 'atlas_core', 'web'), { recursive: true });
  writeFileSync(path.join(d, 'App.mpr'), 'mpr-bytes');
  writeFileSync(path.join(d, 'theme', 'web', 'custom-variables.scss'), STOCK_CV);
  writeFileSync(path.join(d, 'theme', 'web', 'main.scss'), opts.custom ? `${STOCK_MAIN}.legacy { color: red; }\n` : STOCK_MAIN);
  writeFileSync(path.join(d, 'themesource', 'atlas_core', 'web', 'main.scss'), '/* atlas */\n');
  return d;
}

/** A fake mxcli: `theme apply` writes fenced blocks (or says unchanged); `refuse` makes it say skipped (exit 0, as mxcli does). */
function fakeMxcli(opts: { refuse?: boolean } = {}) {
  const calls: string[][] = [];
  const run: Run = async (_cmd, args, o) => {
    calls.push(args);
    const say = (l: string) => o.onLine?.(l);
    if (args[0] === '--version') return { code: 0, tail: [], stdout: 'mxcli version nightly-test (2026-10-03)\n' };
    if (args[1] === 'create') {
      say(`Theme '${args[2]}' scaffolded from 'signal'`);
      return { code: 0, tail: [], stdout: '' };
    }
    const name = args[2];
    for (const f of ['custom-variables.scss', 'main.scss']) {
      const file = path.join(o.cwd, 'theme', 'web', f);
      const text = readFileSync(file, 'utf8');
      if (opts.refuse) say(`  skipped   theme/web/${f}`);
      else if (text.includes(`mxcli:theme:begin ${name}`)) say(`  unchanged theme/web/${f}`);
      else {
        writeFileSync(file, `${text.replace(/\/\/ mxcli:theme:begin[\s\S]*?\/\/ mxcli:theme:end \S+ [0-9a-f]+\n/g, '')}// mxcli:theme:begin ${name} v1 — generated\n:root { --mxt-brand: #7f2bd8; }\n// mxcli:theme:end ${name} 0123456789abcdef\n`);
        say(`  added     theme/web/${f}`);
      }
    }
    return { code: 0, tail: [], stdout: '' };
  };
  return { run, calls, applies: () => calls.filter((a) => a[1] === 'apply').length };
}

function service(t: { after(fn: () => void): void }, over: Partial<DesignDeps> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-design-svc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const floors: { id: string; name: string; dir: string }[] = [];
  const audits: string[] = [];
  const mx = fakeMxcli();
  const live = { calls: 0 };
  const deps: DesignDeps = {
    dataDir: path.join(root, 'data'),
    floors: () => floors,
    clientOf: () => ({ id: CLIENT, label: 'Acme' }),
    clientLabel: () => 'Acme',
    mxcli: () => 'mxcli',
    live: () => (live.calls++, { running: false, status: 'stopped' }),
    audit: (e) => void audits.push(e.action),
    now: () => 1_000,
    run: mx.run,
    shooter: async () => {
      throw new Error('no screenshot in this test');
    },
    ...over,
  };
  return { s: new DesignService(deps), deps, root, floors, audits, mx, live };
}

async function published(s: DesignService, kind: 'branded' | 'atlas' = 'branded') {
  assert.equal(await s.saveDraft({ client: CLIENT }, kind, { ...DEFAULT_INPUT, name: 'Acme Design System' }, 'Ada'), undefined);
  const id = s.store.ofOwner({ client: CLIENT })!.id;
  const r = await s.publish(id, 'Ada');
  assert.ok(typeof r !== 'string');
  await s.approve(id, 1, 'Ada');
  return { id, n: 1, digest: r.digest };
}

test('a new project: the chosen version is applied once, checked and bound; Retry and a restart never apply twice', async (t) => {
  const { s, deps, root, floors, mx, audits } = service(t);
  const v = await published(s);
  const dir = appDir(root);
  floors.push({ id: 'f1', name: 'visitor-registration', dir });
  const mpr = readFileSync(path.join(dir, 'App.mpr'), 'utf8');
  const r = await s.setupNew('f1', dir, v.id, v.n, 'Ada');
  assert.equal(r.ok, true, r.detail);
  assert.equal(mx.applies(), 1);
  const b = s.projects.binding('f1')!;
  assert.deepEqual([b.n, b.digest, b.start, b.approval.kind, b.applied?.mxcli], [1, v.digest, 'atlas', 'wizard', 'nightly-test']);
  assert.equal(b.applied!.fences['theme/web/main.scss'], '0123456789abcdef');
  assert.equal(readFileSync(path.join(dir, 'App.mpr'), 'utf8'), mpr, '.mpr unchanged');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8')).design.version, 1, 'committed with the project');
  assert.ok(audits.includes('design.apply'));
  // Retry: done already, mxcli isn't run again.
  assert.equal((await s.setupNew('f1', dir, v.id, v.n, 'Ada')).ok, true);
  assert.equal(mx.applies(), 1, 'no second apply');
  // A restart in the middle (the record said started): a new service runs mxcli's idempotent apply, which says unchanged.
  await s.projects.setApply('f1', { key: `f1|${v.digest}`, state: 'started', at: 1 });
  const again = new DesignService(deps);
  const r2 = await again.setupNew('f1', dir, v.id, v.n, 'Ada');
  assert.equal(r2.ok, true, r2.detail);
  assert.match(r2.detail, /already applied \(mxcli: unchanged\)/);
  assert.equal(readFileSync(path.join(dir, 'theme', 'web', 'main.scss'), 'utf8').split('mxcli:theme:begin').length - 1, 1, 'one block, not two');
  assert.equal(again.projects.apply('f1')!.state, 'done');
});

test('`skipped` from mxcli (exit 0) is a failure: no binding, the record says failed, and the wizard turns it into a ✋ card', async (t) => {
  const refusing = fakeMxcli({ refuse: true });
  const { s, root, floors } = service(t, { run: refusing.run });
  const v = await published(s);
  const dir = appDir(root);
  floors.push({ id: 'f1', name: 'p', dir });
  const r = await s.setupNew('f1', dir, v.id, v.n, 'Ada');
  assert.equal(r.ok, false);
  assert.match(r.detail, /left 2 blocks alone/);
  assert.equal(s.projects.binding('f1'), undefined);
  assert.equal(s.projects.apply('f1')!.state, 'failed');
  // Through the setup step: the project is still created, the step says so, and a card is waiting.
  const steps = withDesign(s, fakeSteps());
  const job = fakeJob({ kind: 'new', design: { choice: 'use', systemId: v.id, n: 1 } }, dir);
  const out = await steps.app(job, { log: () => undefined });
  assert.equal(out.status, 'done');
  assert.match(out.detail!, /design system not applied/);
  assert.ok(s.needView('f1', true).proposal, 'a ✋ card');
});

test('styling of its own, or an existing app: a ✋ card, no file changed, until Adopt (then on a branch of its own)', async (t) => {
  const { s, root, floors, mx } = service(t);
  const v = await published(s);
  const dir = appDir(root, { custom: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'app'], { cwd: dir });
  floors.push({ id: 'f2', name: 'old-app', dir });
  const before = readFileSync(path.join(dir, 'theme', 'web', 'main.scss'), 'utf8');
  const r = await s.setupNew('f2', dir, v.id, v.n, 'Ada');
  assert.equal(r.ok, true);
  assert.match(r.detail, /not applied; the Project Manager decides/);
  assert.equal(mx.applies(), 0, 'never applied by the wizard');
  assert.equal(readFileSync(path.join(dir, 'theme', 'web', 'main.scss'), 'utf8'), before);
  const need = s.needView('f2', true);
  assert.equal(need.proposal!.scan.start, 'custom');
  const cards = designCandidates(need, 'f2');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].need.text, 'Adopt Acme Design System v1 in this project?');
  assert.deepEqual([cards[0].need.target, cards[0].need.alt?.target], [{ to: 'design', floor: 'f2', act: 'adopt' }, { to: 'design', floor: 'f2', act: 'keep' }]);
  assert.equal(designCandidates({ ...need, admin: false }, 'f2')[0].need.target.to, 'design');
  // Change an existing app in the wizard: propose only, never setupNew.
  const spy: DesignSetup = { setupNew: async () => assert.fail('an existing app is never applied by the wizard'), propose: async () => undefined };
  const out = await withDesign(spy, fakeSteps()).app(fakeJob({ kind: 'change', design: { choice: 'use', systemId: v.id, n: 1 } }, dir), { log: () => undefined });
  assert.match(out.detail!, /waiting for your decision on the ✋ card/);
  // Adopt: applied in a temporary worktree on its own branch; the project folder is untouched.
  assert.equal(await s.adopt('f2', 'Ada'), undefined);
  assert.equal(readFileSync(path.join(dir, 'theme', 'web', 'main.scss'), 'utf8'), before, 'the folder people work in is unchanged');
  // A candidate until it's merged (design-adoption.test.ts): the binding doesn't change yet.
  assert.equal(s.projects.binding('f2'), undefined, 'not bound before the merge');
  const a = s.projects.adoption('f2')!;
  assert.equal(a.status, 'candidate');
  const b = a.binding!;
  assert.equal(b.approval.kind, 'decision');
  assert.match(b.applied!.branch!, /^agent-office\/design-acme-design-system-[0-9a-f]{8}$/);
  const onBranch = execFileSync('git', ['show', `${b.applied!.branch}:main.scss`.replace('main.scss', 'theme/web/main.scss')], { cwd: dir, encoding: 'utf8' });
  assert.match(onBranch, /mxcli:theme:begin acme-design-system-/);
  assert.match(onBranch, /\.legacy \{ color: red; \}/, 'its own rules kept');
  assert.ok(s.needView('f2', true).proposal, 'the card stays until it is merged');
  // Merged into main (no remote: the local main): the binding is the project's, and the card goes.
  execFileSync('git', ['merge', '-q', '--ff-only', b.applied!.branch!], { cwd: dir });
  assert.equal(await s.adopt('f2', 'Ada'), undefined, 'Adopt again only looks');
  assert.equal(s.projects.binding('f2')!.digest, v.digest);
  assert.equal(s.needView('f2', true).proposal, undefined, 'the card is gone');
  assert.equal(execFileSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').length, 1, 'no worktree left behind');
});

test('Keep existing design drops the card and changes nothing', async (t) => {
  const { s, root, floors, audits } = service(t);
  const v = await published(s);
  const dir = appDir(root, { custom: true });
  floors.push({ id: 'f3', name: 'p', dir });
  assert.equal(await s.propose('f3', v.id, v.n, 'Ada'), undefined);
  assert.equal(await s.keep('f3', 'Ada'), undefined);
  assert.equal(s.needView('f3', true).proposal, undefined);
  assert.equal(s.projects.binding('f3'), undefined);
  assert.ok(audits.includes('design.keep'));
});

test('no design system: the plan has none, the app step runs exactly as before, and the steps list is unchanged', async () => {
  assert.equal(cleanPlanDesign(undefined), undefined);
  assert.deepEqual(cleanPlanDesign({ choice: 'use', systemId: 'dsg_01JA0000000000000000000000', n: 2 }), { choice: 'use', systemId: 'dsg_01JA0000000000000000000000', n: 2 });
  assert.equal(cleanPlanDesign({ choice: 'use', systemId: 'nope', n: 1 }), undefined, 'never "the latest": an exact version or nothing');
  assert.deepEqual(SETUP_STEPS.map((x) => x.id), ['repo', 'clone', 'env', 'app', 'init', 'hooks', 'intake', 'decisions', 'settings', 'gates', 'commit', 'issue', 'team', 'queue']);
  const spy: DesignSetup = { setupNew: async () => assert.fail('no design, no call'), propose: async () => assert.fail('no design, no call') };
  const base = fakeSteps();
  const wrapped = withDesign(spy, base);
  for (const plan of [{ kind: 'new' as const }, { kind: 'new' as const, design: { choice: 'keep' as const } }]) {
    const job = fakeJob(plan, '/x');
    assert.deepEqual(await wrapped.app(job, { log: () => undefined }), await base.app(job, { log: () => undefined }));
  }
  assert.equal(withDesign(undefined, base).init, base.init, 'the other steps are the same functions');
});

test('the gallery: browsing, choices and Use for… call no model and start no runtime; a capture needs a running app', async (t) => {
  let shots = 0;
  const { s, root, floors, mx, live } = service(t, { shooter: async () => (shots++, Buffer.from('png')) });
  const v = await published(s);
  const dir = appDir(root);
  floors.push({ id: 'f1', name: 'p', dir });
  await s.setupNew('f1', dir, v.id, v.n, 'Ada');
  const runsBefore = mx.calls.length;
  const view = (await s.projectView('f1', true))!;
  assert.equal(view.binding!.n, 1);
  assert.equal(view.live.running, false);
  assert.equal((await s.choices(CLIENT)).choices[0].n, 1);
  assert.equal(await s.select('f1', 'forms.validated', { issue: 7 }, 'Ada', true), undefined);
  assert.equal((await s.projectView('f1', true))!.selections[0].onBehalfOfClient, true);
  assert.equal(mx.calls.length, runsBefore, 'no mxcli, no model: nothing is run to browse or select');
  assert.ok(live.calls > 0, 'it only asks whether the live app is running');
  assert.match(String(await s.capture('f1', 'Ada')), /isn’t running/);
  assert.equal(shots, 0, 'a capture never starts a runtime');
  assert.equal(await s.select('f9', 'forms.validated', { project: true }, 'Ada', false), 'Adopt a design system on this project first');
});

test('the ledger: the four token categories per row, observed / estimated / missing (never 0), with the kind and the design pointer', (t) => {
  const u = (cost: number, calls: number, x: Partial<Usage> = {}): Usage => ({ ...zeroUsage(), cost, calls, ...x });
  const one = [{ sub: '', model: 'opus', cost: 1, calls: 2 }];
  assert.deepEqual(splitTokens(undefined, true, u(1, 2, { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }), one), [{ tokens: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }, usage: 'observed' }]);
  assert.deepEqual(splitTokens(undefined, false, u(1, 2, { input: 10 }), one), [{ usage: 'missing' }], 'no baseline: missing, not 0');
  assert.deepEqual(splitTokens({ input: 50, output: 0, cacheRead: 0, cacheWrite: 0 }, false, u(1, 2, { input: 10 }), one), [{ usage: 'missing' }], 'a category went down (the end-of-session tally): missing');
  const two = splitTokens(undefined, true, u(3, 6, { input: 90, output: 30, cacheRead: 0, cacheWrite: 0 }), [{ sub: '', model: 'opus', cost: 2, calls: 4 }, { sub: 'developer', model: 'haiku', cost: 1, calls: 2 }]);
  assert.deepEqual(two.map((x) => x.usage), ['estimated', 'estimated']);
  assert.equal(two[0].tokens!.input + two[1].tokens!.input, 90, 'shared out, adding up');
  // Merging rows: tokens add, the less sure flag wins, and kind/design keep rows apart.
  const d = emptyLedger(0);
  const agent = { key: 'w1', name: 'Dee', role: 'Lead Designer', kind: 'worker' as const };
  const row = { day: '2026-10-16', agent: 'w1', model: 'opus', stage: '3' as const, cost: 1, calls: 1, kind: 'design' as const, design: 'dsg_x@v1#aaaaaaa' };
  book(d, { ...row, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, usage: 'observed' }, agent);
  book(d, { ...row, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, usage: 'estimated' }, agent);
  book(d, { ...row, kind: 'other' }, agent);
  assert.equal(d.rows.length, 2);
  assert.deepEqual([d.rows[0].tokens, d.rows[0].usage], [{ input: 2, output: 4, cacheRead: 6, cacheWrite: 8 }, 'estimated']);
  // Through the Budget service: a worker's row has the kind, the pointer and its tokens.
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-design-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const NOW = Date.parse('2026-10-16T10:00:00');
  let total = zeroUsage();
  const w = { id: 'dee', name: 'Dee', kind: 'agent', provider: 'claude', status: 'working', deskId: 'd', color: '#fff', createdAt: NOW + 1, model: 'opus' } as WorkerInfo;
  const b = new BudgetService({
    dataDir: dir,
    now: () => NOW,
    floors: () => [{ id: 'f1', name: 'p', dir }],
    workers: () => [w],
    floorOfWorker: () => 'f1',
    roleOf: () => 'Lead Designer',
    taskIssue: () => undefined,
    workOf: () => ({ role: 'lead-designer', text: 'Wireframes for the visitor form', design: 'dsg_x@v1#aaaaaaa' }),
    stageOf: () => '3',
    officeLedger: { add: (x) => void (total = addUsage(total, x)), state: () => ({ total, today: total, day: localDay(NOW), pauseHiring: false }) as UsageState },
    runs: () => [],
  });
  // The ledger opens with the worker at zero (as a fresh hire is), then books its first spend.
  w.usage = u(0, 0);
  b.onWorker('f1', w);
  w.usage = u(2, 3, { input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 });
  b.onWorker('f1', w);
  const r = b.file({ id: 'f1', name: 'p', dir }).ledger.rows[0];
  assert.deepEqual([r.kind, r.design, r.usage, r.tokens], ['design', 'dsg_x@v1#aaaaaaa', 'observed', { input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 }]);
});

test('the Design gallery is its own lazy chunk: the tab module only imports the page dynamically', () => {
  const tab = readFileSync(path.join(import.meta.dirname, '..', 'src', 'client', 'ui', 'design', 'tab.ts'), 'utf8');
  assert.match(tab, /import\('\.\/page'\)/);
  assert.doesNotMatch(tab.replace(/import type[^\n]*\n/g, ''), /from '\.\/page'/);
  const page = readFileSync(path.join(import.meta.dirname, '..', 'src', 'client', 'ui', 'design', 'page.ts'), 'utf8');
  assert.doesNotMatch(page, /setInterval|setTimeout/, 'no timers: nothing runs while it is hidden');
  assert.ok(existsSync(path.join(import.meta.dirname, '..', 'src', 'client', 'ui', 'design', 'design.css')));
});

// ---- Fakes for the setup step --------------------------------------------------------------------

function fakeSteps(): Record<StepId, StepImpl> {
  const done: StepImpl = async () => ({ status: 'done', detail: 'did it' });
  return Object.fromEntries(SETUP_STEPS.map((s) => [s.id, s.id === 'app' ? async () => ({ status: 'done', detail: 'created the app' }) : done])) as Record<StepId, StepImpl>;
}

function fakeJob(plan: Record<string, unknown>, dir: string) {
  return { plan: { ...plan }, floor: plan.kind === 'change' ? 'f2' : 'f1', dir, by: 'Ada' } as unknown as Parameters<StepImpl>[0];
}
