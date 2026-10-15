// Portfolios Phase 1 (server/portfolios/, shared/portfolios.ts), the parts that need no toolkit script:
// P01 (standalone projects byte-identical), P02 (a portfolio without a brain), S03 (no cross-portfolio
// moves), the prime-prompt line (≤ 300 characters, action-first, never content), ROUTING.md parsing,
// admin-only changes, and a hire through the roster writing exactly one manifest. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { primePrompt } from '../src/server/roster/prompts.js';
import { playbook } from '../src/server/roster/playbooks.js';
import { ROLES } from '../src/shared/roster/roles.js';
import { BRAIN_UNAVAILABLE_LINE, changeWords, diffRouted, parseRouting, primeLine, PRIME_LINE_MAX, windowsForm, isPortfolioId, NOT_ACCESS_CONTROL } from '../src/shared/portfolios.js';
import { PortfolioStore } from '../src/server/portfolios/store.js';
import { portfolioRoutes } from '../src/server/http/routes/portfolios.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { World, acmeAndBeta } from './portfolio-world.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'portfolios');
const snap = (f: string) => readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, '\n');

test('P01: a project in no portfolio gets the same prime prompt and Playbook, byte for byte, as before portfolios (snapshot taken at release 49)', () => {
  const a = primePrompt('lead-developer', 'Ada', 3, undefined, 'Build the login page', [], undefined);
  const b = primePrompt('pm', 'Pia', 2, { at: Date.UTC(2026, 9, 1, 9, 30), text: '## Handoff\nAll good.' }, undefined, ['- ESC-1: approved'], 'On this solo team you cover all.');
  assert.equal(`${a}\n=====\n${b}\n`, snap('prime-standalone.txt'));
  // No brain line given is the same as the old signature: nothing added, not even a blank line.
  assert.equal(primePrompt('lead-developer', 'Ada', 3, undefined, 'x', [], undefined, undefined), primePrompt('lead-developer', 'Ada', 3, undefined, 'x', [], undefined));
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.id.toUpperCase()])) as never;
  assert.equal(playbook('lead-developer', { project: 'standalone-app', name: 'Linus', level: 2, lessons: 'L.md', names, toolkit: { dir: 'C:/tk/pin', sha: 'abcdef1234567' } }).replace(/\r\n/g, '\n'), snap('playbook-standalone.txt'));
});

test('P01 / rollback: with no portfolios.json nothing is written and a hire gets no brain line', async () => {
  const w = new World();
  const f = w.project('solo');
  const s = w.service();
  assert.equal(await s.hireContext(f.id), undefined);
  await s.tick();
  const v = await s.view(true);
  assert.deepEqual(v.portfolios, []);
  assert.deepEqual(v.ungrouped, [{ id: 'solo', name: 'solo' }]);
  assert.equal(existsSync(path.join(w.data, 'portfolios.json')), false, 'reading never creates portfolios.json');
  assert.equal(existsSync(path.join(w.data, 'context-manifests')), false);
});

test('P02: a portfolio exists without a brain; hires on its projects get no line until one is connected', async () => {
  const w = new World();
  const f = w.project('a1');
  const s = w.service();
  const p = await s.create('Acme', 'Keith');
  assert.ok(typeof p !== 'string' && isPortfolioId(p.id));
  if (typeof p === 'string') return;
  assert.deepEqual(await s.addProject(p.id, f.id, 'Keith'), {});
  const v = await s.view(true);
  assert.equal(v.portfolios[0].brain, undefined);
  assert.equal(v.portfolios[0].read, undefined);
  assert.deepEqual(v.portfolios[0].projects.map((x) => x.id), ['a1']);
  assert.equal(await s.hireContext(f.id), undefined);
  assert.match(readFileSync(path.join(w.data, 'portfolios.json'), 'utf8'), /"label": ?"Acme"/);
  assert.equal(readFileSync(path.join(f.dir, 'CLAUDE.md'), 'utf8'), '# a1\n\nRead AGENTS.md.\n', 'no brain: nothing wired');
});

test('S03: one project in at most one portfolio; a cross-portfolio move is refused with a clear message', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pfl-store-'));
  const st = new PortfolioStore(dir);
  const a = await st.create('Acme', 'k');
  const b = await st.create('Beta', 'k');
  assert.ok(typeof a !== 'string' && typeof b !== 'string');
  if (typeof a === 'string' || typeof b === 'string') return;
  assert.equal(await st.create('acme', 'k'), 'There is already a client called acme');
  assert.equal(await st.addProject(a.id, 'p1'), undefined);
  assert.equal(await st.addProject(a.id, 'p1'), undefined, 'again: a no-op');
  assert.match((await st.addProject(b.id, 'p1')) ?? '', /already belongs to the client Acme, and a project can belong to one client\. Moving a project between clients isn't available/);
  // Read back by another store: still only in Acme, even after a hand edit put it in both.
  const raw = JSON.parse(readFileSync(st.file, 'utf8'));
  raw.portfolios[1].projectIds.push('p1');
  writeFileSync(st.file, JSON.stringify(raw));
  const again = new PortfolioStore(dir);
  await again.load();
  assert.equal(again.ofFloor('p1')?.label, 'Acme');
  assert.deepEqual(again.get(b.id)?.projectIds, []);
});

test('S03: an ungrouped project that already consumed another portfolio\'s brain cannot join a different portfolio', async () => {
  const w = new World();
  const { acme } = acmeAndBeta(w);
  const f = w.project('old');
  const s = w.service();
  const a = (await s.create('Acme', 'k')) as { id: string };
  const b = (await s.create('Beta', 'k')) as { id: string };
  await s.store.setBrain(a.id, { path: windowsForm(acme), connectedAt: 1, by: 'k' });
  await s.manifests.append({ projectId: 'prj_old', floor: 'old', role: 'pm', agentInstanceId: 'w1', preparedAt: 1, portfolioId: a.id, brain: { path: windowsForm(acme), snapshot: null, dirty: false, routed: [], excluded: [], status: 'unversioned' } });
  const r = await s.addProject(b.id, f.id, 'k');
  assert.match(r.error ?? '', /already used another client's company brain/);
  const ctx = await s.existingContext(f.id);
  assert.equal(ctx?.manifests, 1);
  assert.deepEqual(ctx?.surfaces, ['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md']);
});

test('the prime line: action-first, Windows-form path, ≤ 300 characters whatever the label, never content; the unavailable line', () => {
  const line = primeLine('Acme', { status: 'ok', snapshot: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', path: '/c/Users/x/acme-brain' });
  assert.equal(line, "Company brain Acme @a1b2c3d: before answering terminology or convention questions, read C:/Users/x/acme-brain/ROUTING.md. Don't search other company folders.");
  assert.match(primeLine('Beta', { status: 'unversioned', snapshot: null, path: 'C:\\b\\beta' }), /^Company brain Beta @unversioned: .* read C:\/b\/beta\/ROUTING\.md\./);
  const long = primeLine('A'.repeat(400) + '\n`x`', { status: 'ok', snapshot: 'f'.repeat(40), path: 'C:/' + 'd/'.repeat(40) + 'brain' });
  assert.ok(long.length <= PRIME_LINE_MAX, `${long.length}`);
  assert.match(long, /ROUTING\.md\. Don't search other company folders\.$/);
  assert.doesNotMatch(long, /\n|`/);
  assert.equal(primeLine('Acme', { status: 'ok', snapshot: 'f'.repeat(40), path: 'C:/' + 'x'.repeat(400) }), BRAIN_UNAVAILABLE_LINE, 'a path too long to fit is never cut');
  assert.equal(primeLine('Acme', { status: 'unavailable', snapshot: null, path: 'C:/gone' }), "Company brain unavailable this session: don't assume its conventions.");
  assert.ok(BRAIN_UNAVAILABLE_LINE.length <= PRIME_LINE_MAX);
  assert.equal(NOT_ACCESS_CONTROL, 'Clients organise knowledge; they aren’t access control');
});

test('ROUTING.md: table rows name the routed files; the header, separator, absolute paths and .. are not routed', () => {
  const md = '# R\n\n| When (trigger) | Read this |\n|---|---|\n| Terms | `skills/a.md` (example) |\n| SSO | `skills/b.md` and `skills/a.md` |\n| Onward | `README.md` → "Onward" |\n| Bad | `C:/etc/x.md` `../up.md` `/abs.md` |\n| Folder | `examples/mdl/` |\nNot a row `skills/c.md`\n';
  assert.deepEqual(parseRouting(md), { paths: ['skills/a.md', 'skills/b.md', 'README.md'], rows: 5 });
  const d = diffRouted(
    [{ path: 'a', sha256: '1', bytes: 1 }, { path: 'b', sha256: '2', bytes: 1 }],
    [{ path: 'a', sha256: '9', bytes: 1 }, { path: 'c', sha256: '3', bytes: 1 }],
  );
  assert.deepEqual(d, { corrected: ['a'], withdrawn: ['b'], added: ['c'] });
  assert.equal(changeWords({ corrected: ['a'], withdrawn: ['b'], added: [] }, 'Ada'), "Company brain changed: 1 corrected, 1 withdrawn since Ada's session was prepared");
});

test('perms: every portfolio change and card button is refused on the server unless you are an admin', async () => {
  for (const [route, body] of [[portfolioRoutes.act, { action: 'create', label: 'X' }], [portfolioRoutes.card, { floor: 'f', act: 'dismiss' }]] as const) {
    let status = 0;
    let out = '';
    const res = { writeHead: (s: number) => (status = s), end: (b: string) => (out = b) } as never;
    const req = { headers: { 'content-type': 'application/json' }, body } as never;
    const ctx = { cfg: {}, meOf: () => ({ admin: false }), floors: new Map() } as never;
    await route.handle(ctx, { req, res, session: { account: { id: 'u1', name: 'Guest' } } } as never);
    assert.equal(status, 403);
    assert.match(out, /Only (an admin|the Project Manager \(an admin\))/);
  }
});

// ---- A hire through the roster (X01: one manifest per hire, the line ≤ 300 characters) ----------------

class Floor implements TeamFloor {
  name = 'proj';
  hires: HireAsk[] = [];
  map = new Map<string, WorkerInfo>();
  n = 0;
  constructor(public id: string, public dir: string, private now: () => number) {}
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo | string> {
    this.hires.push(ask);
    const w = { id: `${this.id}-w${++this.n}`, kind: 'agent', provider: 'claude', name: ask.name, status: 'starting', createdAt: this.now(), viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(w.id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  stop = async () => undefined;
  prompt = () => undefined;
  wake = () => undefined;
  rename = () => undefined;
  cwdOf = (w: WorkerInfo) => path.join(this.dir, '.wt', w.id);
  openPulls = () => [];
  toast = () => undefined;
  changed = () => undefined;
}

test('X01: a hire on a portfolio project carries the one brain line and writes exactly one manifest; a standalone hire is unchanged', async () => {
  const w = new World();
  const { acme } = acmeAndBeta(w);
  const a1 = w.project('a1');
  const solo = w.project('solo');
  const s = w.service();
  const p = (await s.create('Acme', 'k')) as { id: string };
  await s.addProject(p.id, a1.id, 'k');
  await s.store.setBrain(p.id, { path: windowsForm(acme), connectedAt: 1, by: 'k' });
  const floors = [new Floor('a1', a1.dir, () => w.clock), new Floor('solo', solo.dir, () => w.clock)];
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'pfl-roster-')), floors: () => floors, makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => w.clock, hireContext: (id) => s.hireContext(id) }, 0);
  assert.equal(await roster.members.hire(floors[0], 'lead-developer', 'Keith'), undefined);
  assert.equal(await roster.members.hire(floors[1], 'lead-developer', 'Keith'), undefined);
  const prompt = floors[0].hires[0].prompt!;
  const line = prompt.split('\n').find((l) => l.startsWith('Company brain '))!;
  assert.ok(line && line.length <= PRIME_LINE_MAX, line);
  assert.equal(prompt.split('\n').filter((l) => l.startsWith('Company brain ')).length, 1);
  assert.doesNotMatch(prompt, /MARKER-/, 'never the brain content');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await s.manifests.all('a1')).length, 1, 'one manifest per hire');
  assert.equal((await s.manifests.all('solo')).length, 0);
  // The standalone hire's prompt is primePrompt as it always was.
  const d = roster.data('solo');
  assert.equal(floors[1].hires[0].prompt, primePrompt('lead-developer', d.members['lead-developer'].name, d.settings.autonomy, undefined, undefined, [], undefined));
  assert.doesNotMatch(floors[1].hires[0].prompt!, /Company brain/);
});

test('the wizard: a plan with a portfolio joins it after init and the pin instructions; a plan without one runs init exactly as before (P01)', async () => {
  const { withPortfolio } = await import('../src/server/wizard/portfolio-step.js');
  const { cleanPlan } = await import('../src/server/wizard/plan.js');
  const calls: string[] = [];
  const init = async () => (calls.push('init (scaffold + pin instructions)'), { status: 'done' as const, detail: 'scaffolded' });
  const steps = withPortfolio({ joinPortfolio: async (f: string, p: string) => (calls.push(`join ${f} ${p}`), 'joined Acme') } as never, { init } as never);
  const job = (portfolio?: string) => ({ plan: { portfolio }, floor: 'f1', by: 'Keith' }) as never;
  const io = { log: () => undefined } as never;
  assert.deepEqual(await steps.init(job(), io), { status: 'done', detail: 'scaffolded' });
  assert.deepEqual(calls, ['init (scaffold + pin instructions)']);
  const pid = 'pfl_01K7ZZZZZZZZZZZZZZZZZZZZZZ';
  assert.deepEqual(await steps.init(job(pid), io), { status: 'done', detail: 'scaffolded · joined Acme' });
  assert.deepEqual(calls.slice(1), ['init (scaffold + pin instructions)', `join f1 ${pid}`]);
  const plan = (x: unknown) => cleanPlan({ name: 'app', entry: 'greenfield', mendix: '11.6.4', portfolio: x }, ['11.6.4'], 'org');
  assert.equal((plan(pid) as { portfolio?: string }).portfolio, pid);
  assert.equal((plan('../etc') as { portfolio?: string }).portfolio, undefined);
  assert.equal('portfolio' in (plan(undefined) as object), false, 'no portfolio: the plan is as before');
});
