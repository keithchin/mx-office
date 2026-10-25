// Real-build fixes: a new project's team gets its first task (docs/mockups/product-assessment/real-build-test.md
// P1-2). The Discovery task is handed on by default; left unticked, Needs you says the team is waiting for its
// first task, with one button (the Nudge target) that starts Discovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_UNTICKED_TEXT, newProjectDiscovery, SETUP_STEPS, type ProjectPlan, type SetupView } from '../src/shared/wizard.js';
import { firstTaskOf, type FirstTaskLook } from '../src/server/wizard/first-task.js';
import { collectNeeds } from '../src/shared/needsyou.js';

test('a new project hands Discovery to the team by default, and says what happens when unticked', () => {
  assert.deepEqual(newProjectDiscovery(), { issue: true, queue: true, model: 'opus' });
  assert.match(DISCOVERY_UNTICKED_TEXT, /waiting for its first task: Start Discovery/);
});

const plan = { discovery: { issue: true, queue: false, model: 'opus' }, roles: ['pm'], localOnly: true } as unknown as ProjectPlan;
const job = (queue: { status: 'skipped' | 'done'; detail?: string }): FirstTaskLook['job'] => ({
  status: 'done',
  plan,
  discoveryFile: 'docs/discovery-brief.md',
  dir: 'C:/p/o/n',
  steps: { ...Object.fromEntries(SETUP_STEPS.map((s) => [s.id, { status: 'done' as const }])), queue } as never,
});
const lead = { role: 'pm' as const, name: 'Alan', atWork: true, hasTask: false };

test('unticked: the team waits for its first task until the lead has one, and Needs you says so with Start Discovery', () => {
  const ft = firstTaskOf({ job: job({ status: 'skipped', detail: 'not asked for' }), member: lead });
  assert.deepEqual(ft, { role: 'pm', name: 'Alan', task: 'Discovery' });
  // Not when it was handed on, the lead has any task, or isn't at work yet.
  assert.equal(firstTaskOf({ job: job({ status: 'done', detail: 'queued' }), member: lead }), undefined);
  assert.equal(firstTaskOf({ job: job({ status: 'skipped', detail: 'not asked for' }), member: { ...lead, hasTask: true } }), undefined);
  assert.equal(firstTaskOf({ job: job({ status: 'skipped', detail: 'not asked for' }), member: { ...lead, atWork: false } }), undefined);
  const setup = { show: false, stages: [], questions: [], checking: false, firstTask: ft } as SetupView;
  const needs = collectNeeds({ floor: 'f', workers: [], pulls: [], floors: [], setup });
  const item = needs.find((n) => n.key === 'first-task');
  assert.ok(item, 'shown in Needs you');
  assert.match(item!.text, /^The team is waiting for its first task: Start Discovery/);
  assert.equal(item!.action, 'Start Discovery');
  assert.deepEqual(item!.target, { to: 'nudge', role: 'pm' });
});
