// Expert mode, slices 1 and 3 (shared/expert.ts, server/expert/): the project record's mode (absent is Team
// mode; Open existing makes an Expert one), the session worker's mark surviving a save, the asked → visible
// timer's state machine fed with simulated hook and live app events, and the session screen's split rules.
// Fakes only: no claude, no mxcli, no live app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../src/server/building.js';
import { clampSplit, isExpertMode, loopWords, projectMode, readSplit, splitKey, SPLIT_MIN_PX } from '../src/shared/expert.js';
import { isModelChange, LOOP_GIVE_UP_MS, loopStep, loopView, median, newLoop, readLoop } from '../src/server/expert/loop.js';
import { ExpertService } from '../src/server/expert/shell.js';
import { noteWorkerHook } from '../src/server/workers/hook-bus.js';
import { noteLiveState } from '../src/server/liveapp/state-bus.js';
import { workersJson } from '../src/server/workers/persist.js';
import type { LiveAppState } from '../src/shared/protocol.js';

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-expert-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir);
  const dir = path.join(root, 'apps', 'web');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify([{ id: 'web', name: 'web', dir, palette: 0, addedBy: 'Sam', addedAt: 1 }]));
  return { root, dataDir };
}

test('a project without a mode is in Team mode; only expert and team are kept', () => {
  assert.equal(projectMode(undefined), undefined);
  assert.equal(projectMode('expert'), 'expert');
  assert.equal(projectMode('team'), 'team');
  assert.equal(projectMode('solo'), undefined);
  assert.equal(isExpertMode({}), false);
  assert.equal(isExpertMode({ mode: 'team' }), false);
  assert.equal(isExpertMode({ mode: 'expert' }), true);
  assert.equal(isExpertMode(undefined), false);
});

test('Open existing makes a folder an Expert-mode project; existing projects keep no mode, and it survives a restart', (t) => {
  const { root, dataDir } = office(t);
  const b = new Building(dataDir, root);
  assert.equal(b.list()[0].mode, undefined, 'a project from before stays in Team mode');
  const folder = path.join(root, 'apps', 'orders');
  mkdirSync(folder);
  const def = b.openFolder(folder, 'Sam', 'expert') as FloorDef;
  assert.equal(typeof def, 'object');
  assert.equal(def.mode, 'expert');
  assert.equal(def.id, 'orders');
  assert.equal(def.repo, undefined, 'not a GitHub checkout: no repository');
  assert.match(String(b.openFolder(folder, 'Sam', 'expert')), /already a project/);
  const saved = JSON.parse(readFileSync(path.join(dataDir, 'floors.json'), 'utf8')) as FloorDef[];
  assert.deepEqual(saved.map((d) => [d.id, d.mode]), [['web', undefined], ['orders', 'expert']]);
  const again = new Building(dataDir, root).list();
  assert.deepEqual(again.map((d) => d.mode), [undefined, 'expert']);
});

test('the session mark is saved with the worker (the office never types into it after a restart)', () => {
  const info = { id: 'w1', kind: 'agent', provider: 'claude', deskId: 'desk-1', name: 'Session', color: '#000', status: 'idle', acked: true, createdBy: 'Sam', createdAt: 1, cols: 100, rows: 30, viewers: [], viewerIds: [], session: true } as const;
  const json = JSON.parse(workersJson([{ info: { ...info }, tracker: {}, state: undefined, hookToken: 't' } as never], false)) as { session?: boolean }[];
  assert.equal(json[0].session, true);
  const plain = JSON.parse(workersJson([{ info: { ...info, session: undefined }, tracker: {}, state: undefined, hookToken: 't' } as never], false)) as { session?: boolean }[];
  assert.equal(plain[0].session, undefined);
});

test('model-changing commands are told apart from reads', () => {
  for (const c of ['bin/exec.sh mdlsource/15-filters/a.mdl', './bin/exec.sh x.mdl', 'mxcli exec -p App.mpr script.mdl', 'mxcli.exe -p App.mpr exec a.mdl', `mxcli -p App.mpr -c "create page M.P ..."`, 'cd app && bash bin/exec.sh a.mdl']) assert.ok(isModelChange(c), c);
  for (const c of ['mxcli describe page M.P', 'mxcli refs M.E', 'git commit -m exec', 'mxcli -p App.mpr -c "show pages"', 'cat exec.sh.bak | head', 'cat bin/exec.sh', 'ls']) assert.ok(!isModelChange(c), c);
});

test('asked → visible: prompt, then a model change, then the first served reload after it', () => {
  const s = newLoop();
  assert.equal(loopStep(s, { kind: 'prompt', at: 1000, session: 'a' }), undefined);
  // A reload before any model change doesn't count.
  assert.equal(loopStep(s, { kind: 'served', at: 5000 }), undefined);
  assert.equal(loopView(s, 5000).pending?.changed, false);
  // A follow-up prompt keeps the first ask's time.
  loopStep(s, { kind: 'prompt', at: 8000, session: 'a' });
  loopStep(s, { kind: 'change', at: 20_000 });
  loopStep(s, { kind: 'change', at: 25_000 });
  // A served state from before the change (the old build saying it again) doesn't stop it either.
  assert.equal(loopStep(s, { kind: 'served', at: 19_000 }), undefined);
  const done = loopStep(s, { kind: 'served', at: 42_000 });
  assert.deepEqual(done, { askedAt: 1000, changedAt: 20_000, visibleAt: 42_000, ms: 41_000 });
  assert.equal(loopStep(s, { kind: 'served', at: 50_000 }), undefined, 'only the first reload counts');
  loopStep(s, { kind: 'prompt', at: 100_000, session: 'a' });
  loopStep(s, { kind: 'change', at: 110_000 });
  loopStep(s, { kind: 'served', at: 163_000 });
  loopStep(s, { kind: 'prompt', at: 200_000, session: 'a' });
  loopStep(s, { kind: 'change', at: 210_000 });
  loopStep(s, { kind: 'served', at: 270_000 });
  const v = loopView(s, 300_000);
  assert.equal(v.count, 3);
  assert.equal(v.lastMs, 70_000);
  assert.equal(v.medianMs, 63_000);
  assert.deepEqual(v.recent, [41_000, 63_000, 70_000]);
  assert.equal(v.pending, undefined);
  assert.equal(`${loopWords(v.lastMs)} · median ${loopWords(v.medianMs)}`, '70 s · median 63 s');
});

test('a new session starts its median over; a timing that never shows is dropped', () => {
  const s = newLoop();
  loopStep(s, { kind: 'prompt', at: 0, session: 'a' });
  loopStep(s, { kind: 'change', at: 1 });
  loopStep(s, { kind: 'served', at: 10_000 });
  assert.equal(loopView(s).count, 1);
  loopStep(s, { kind: 'prompt', at: 20_000, session: 'b' });
  assert.equal(loopView(s, 20_000).count, 0, 'a /clear or a fresh session: its own median');
  assert.equal(loopView(s, 20_000).session, 'b');
  loopStep(s, { kind: 'change', at: 21_000 });
  // Nothing served for longer than the give-up time: dropped, never counted.
  assert.equal(loopStep(s, { kind: 'served', at: 20_000 + LOOP_GIVE_UP_MS + 1 }), undefined);
  assert.equal(loopView(s).count, 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), undefined);
  const back = readLoop(JSON.parse(JSON.stringify({ session: 'b', samples: [{ askedAt: 1, changedAt: 2, visibleAt: 3, ms: 2 }, { bad: true }], pending: { askedAt: 1 } })));
  assert.equal(back.samples.length, 1);
  assert.equal(back.pending, undefined, 'a timing in flight is not carried over a restart');
});

test('the service times an Expert session from its own hooks and the live app, and ignores Team projects and other workers', async (t) => {
  const { root } = office(t);
  const mk = (id: string, mode: 'expert' | undefined, workers: { id: string; session?: true }[]) => {
    const dir = path.join(root, id);
    mkdirSync(dir, { recursive: true });
    return { id, dir, def: { id, name: id, dir, palette: 0, addedBy: 'Sam', addedAt: 1, ...(mode ? { mode } : {}) }, workers: { get: (w: string) => workers.find((x) => x.id === w), list: () => workers } };
  };
  const exp = mk('shop', 'expert', [{ id: 's1', session: true }, { id: 'other' }]);
  const team = mk('crm', undefined, [{ id: 't1', session: true }]);
  const floors = new Map<string, unknown>([
    ['shop', exp],
    ['crm', team],
  ]);
  let now = 1_000_000;
  const svc = new ExpertService({ cfg: { dataDir: root } as never, floors: floors as never, workerFloor: (w: string) => (w === 't1' ? team : exp) as never }, () => now);
  t.after(() => svc.stop());
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const live = (floor: string, sha: string, builtAt: number, update?: number): LiveAppState => ({ floor, status: 'running', log: [], available: true, served: { sha, builtAt }, ...(update ? { lastUpdate: { mode: 'hot', reason: 'x', ok: true, at: update, totalMs: 1, phases: [] } } : {}) }) as unknown as LiveAppState;

  noteLiveState(live('shop', 'aaa', now - 60_000));
  noteWorkerHook('s1', 'UserPromptSubmit', { session_id: 'sess-1', prompt: 'Add a filter' });
  noteWorkerHook('other', 'UserPromptSubmit', { session_id: 'x' });
  noteWorkerHook('t1', 'UserPromptSubmit', { session_id: 'y' });
  await tick();
  now += 15_000;
  noteWorkerHook('s1', 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'mxcli describe page Shop.Orders' } });
  await tick();
  assert.equal((await svc.loop(exp as never)).pending?.changedAt, undefined, 'a read is no model change');
  noteWorkerHook('s1', 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'bin/exec.sh mdlsource/orders.mdl' } });
  await tick();
  now += 26_000;
  // The same served state again is no reload; a hot reload confirmed now is.
  noteLiveState(live('shop', 'aaa', 1_000_000 - 60_000));
  await tick();
  assert.equal((await svc.loop(exp as never)).samples.length, 0);
  noteLiveState(live('shop', 'aaa', 1_000_000 - 60_000, now));
  await tick();
  const v = (await svc.view(exp as never)).loop;
  assert.equal(v.count, 1);
  assert.equal(v.lastMs, 41_000);
  assert.equal(v.session, 'sess-1');
  assert.equal((await svc.loop(team as never)).samples.length, 0, 'a Team-mode project is not timed');
  assert.equal((await svc.loop(team as never)).pending, undefined);
  // Saved per project (a second later, off the hot path).
  await new Promise((r) => setTimeout(r, 1200));
  const saved = JSON.parse(readFileSync(path.join(exp.dir, '.agent-office', 'expert-loop.json'), 'utf8'));
  assert.equal(saved.samples[0].ms, 41_000);
});

test('the split keeps both sides at least 320 px, resets to 50/50 and moves by keys the way the arrow points', () => {
  assert.equal(clampSplit(10, 1200), Math.round(((SPLIT_MIN_PX / 1200) * 100) * 10) / 10);
  assert.equal(clampSplit(90, 1200), Math.round((100 - (SPLIT_MIN_PX / 1200) * 100) * 10) / 10);
  assert.equal(clampSplit(35, 1200), 35);
  assert.equal(clampSplit(35, 600), 50, 'too narrow for both: half each');
  assert.equal(splitKey(50, 'ArrowLeft', false, 1400), 48);
  assert.equal(splitKey(50, 'ArrowRight', true, 1400), 60);
  assert.equal(splitKey(50, 'ArrowRight', false, 1400, 'right'), 48, 'swapped: the preview is on the right and shrinks as the divider moves right');
  assert.equal(splitKey(30, 'Enter', false, 1400), 50);
  assert.equal(splitKey(50, 'Home', false, 1000), clampSplit(0, 1000));
  assert.equal(splitKey(50, 'a', false, 1000), undefined);
  assert.deepEqual(readSplit({ pct: 35, focus: 'chat', swapped: true }), { pct: 35, focus: 'chat', swapped: true });
  assert.deepEqual(readSplit({ pct: 'x', focus: 'nope' }), { pct: 50, focus: 'both', swapped: false });
  assert.deepEqual(readSplit(null), { pct: 50, focus: 'both', swapped: false });
});

test('a feature can leave built-in tabs out of the navigation (Expert mode hides the team pages), ?tab= still reaching them', async () => {
  const { hideTabsWhen, tabShown } = await import('../src/client/tabs/registry.js');
  let expert = false;
  const team = new Set(['org', 'teams', 'board', 'approvals', 'standup']);
  hideTabsWhen((id) => expert && team.has(id));
  assert.equal(tabShown('org'), true, 'a Team project lists Team');
  expert = true;
  for (const id of team) assert.equal(tabShown(id), false, `${id} hidden on an Expert project`);
  for (const id of ['command', 'roadmap', 'documents', 'budget', 'workers', 'settings']) assert.equal(tabShown(id), true, `${id} kept`);
});
