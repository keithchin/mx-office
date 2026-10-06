// Autonomy by pipeline stage (roster/stage-autonomy.ts) against a fake floor: off by default and for
// an older roster; on a toolkit project the level is `early` until the build plan's gate passes and
// `build` from then on, changed through the same path as a level picked by hand (the Leads at work
// told); a project with no pipeline keeps its level; a level picked by hand gives way to the stage's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { PipelineStage } from '../src/shared/roster/types.js';
import { Roster } from '../src/server/roster/index.js';
import { BY_STAGE, stageLevel } from '../src/server/roster/stage-autonomy.js';
import { cleanSettings, defaultSettings, reviveRoster } from '../src/server/roster/store.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'p';
  dir = mkdtempSync(path.join(os.tmpdir(), 'stage-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string }[] = [];
  feed: string[] = [];
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', name: ask.name, status: 'idle', acked: true, createdAt: 0, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop() {}
  prompt = (id: string, text: string) => void this.prompts.push({ id, text });
  wake = () => undefined;
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = (text: string) => void this.feed.push(text);
}

function setup(stage: { now: PipelineStage | undefined }) {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'stage-data-')), floors: () => [floor], makeIssue: async () => ({}), analysis: () => '', now: () => Date.UTC(2026, 9, 4), pipelineStage: () => stage.now }, 0);
  roster.data(floor.id).settings.schedule.enabled = false;
  return { floor, roster, d: () => roster.data(floor.id) };
}

test('autonomy by stage is off by default and for a roster saved before it, its levels kept clean', () => {
  assert.deepEqual(defaultSettings().autonomyByStage, { enabled: false, early: 2, build: 3 });
  assert.deepEqual(reviveRoster({ settings: { autonomy: 3 } }).settings.autonomyByStage, { enabled: false, early: 2, build: 3 });
  assert.deepEqual(cleanSettings({ autonomyByStage: { enabled: true, early: 1, build: 9 } }).autonomyByStage, { enabled: true, early: 1, build: 3 });
  const s = defaultSettings();
  assert.equal(stageLevel(s, 'early'), undefined, 'off');
  s.autonomyByStage.enabled = true;
  assert.equal(stageLevel(s, 'early'), 2);
  assert.equal(stageLevel(s, 'build'), 3);
  assert.equal(stageLevel(s, undefined), undefined, 'no pipeline');
});

test('on a toolkit project the level follows the build plan’s gate, through the usual level change', async () => {
  const stage = { now: 'early' as PipelineStage | undefined };
  const t = setup(stage);
  assert.equal(await t.roster.members.hire(t.floor, 'lead-developer', 'Keith'), undefined);
  const dev = t.d().members['lead-developer'].workerId!;
  t.d().settings.autonomy = 4;
  // Turned on before Stage 4 passed: the early level at once, and the Lead at work told.
  assert.equal(t.roster.members.settings(t.floor, { autonomyByStage: { enabled: true, early: 2, build: 3 } }), undefined);
  assert.equal(t.d().settings.autonomy, 2);
  assert.match(t.floor.prompts.at(-1)!.text, /changed this floor's autonomy level/);
  assert.equal(t.roster.view(t.floor, true).byStage, 'early');
  // Nothing changes while the stage doesn't.
  const told = t.floor.prompts.length;
  t.roster.tick();
  assert.equal(t.floor.prompts.length, told);
  // The gate passes: the next look moves it to the build level.
  stage.now = 'build';
  t.roster.tick();
  assert.equal(t.d().settings.autonomy, 3);
  assert.equal(t.floor.prompts.length, told + 1);
  assert.equal(t.floor.prompts.at(-1)!.id, dev);
  assert.match(t.floor.feed.at(-1)!, /Autonomy 2 → 3: the build plan \(Stage 4\) has passed/);
  assert.equal(t.roster.view(t.floor, true).byStage, 'build');
  // A level picked by hand meanwhile gives way to the stage's.
  t.roster.members.settings(t.floor, { autonomy: 1 }, 'Keith');
  assert.equal(t.d().settings.autonomy, 3);
  // Off again: the level is the Project Manager's to pick.
  t.roster.members.settings(t.floor, { autonomy: 1, autonomyByStage: { enabled: false, early: 2, build: 3 } }, 'Keith');
  assert.equal(t.d().settings.autonomy, 1);
  assert.equal(t.roster.view(t.floor, true).byStage, undefined);
  assert.ok(BY_STAGE.includes('by stage'));
});

test('a project with no pipeline keeps the level picked by hand', () => {
  const t = setup({ now: undefined });
  t.roster.members.settings(t.floor, { autonomy: 4, autonomyByStage: { enabled: true, early: 1, build: 2 } });
  t.roster.tick();
  assert.equal(t.d().settings.autonomy, 4);
  assert.equal(t.roster.view(t.floor, true).byStage, undefined);
});
