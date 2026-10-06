// The Budget's insights (shared/budget/insights.ts): the cost drivers and the suggestions, each rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentInfo, SpendRow, StageId } from '../src/shared/budget/types.js';
import { insights } from '../src/shared/budget/insights.js';

const agents: Record<string, AgentInfo> = {
  dylan: { key: 'dylan', name: 'Dylan', role: 'Lead Developer', kind: 'worker' },
  sophie: { key: 'sophie', name: 'Sophie', role: 'Lead Tester', kind: 'worker' },
  'sophie/tester': { key: 'sophie/tester', name: 'Tester', role: 'tester', kind: 'subagent', lead: 'sophie' },
  ada: { key: 'ada', name: 'Ada', role: 'Project Coordinator', kind: 'worker' },
  'bg:jeff': { key: 'bg:jeff', name: 'Jeff (the Router)', role: 'Office background', kind: 'background' },
  codex: { key: 'codex', name: 'Pixel', role: 'Worker', kind: 'worker', provider: 'codex' },
};
const row = (day: string, agent: string, model: string, cost: number, calls = 1, stage: StageId = '5'): SpendRow => ({ day, agent, model, stage, cost, calls });
const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];

test('drivers: Opus Leads, the Lead Tester\'s review loop, the Coordinator\'s relays, the office\'s own calls', () => {
  const rows = days.flatMap((d) => [row(d, 'dylan', 'claude-opus-5-5', 20, 30), row(d, 'sophie', 'claude-opus-5-5', 6, 20), row(d, 'sophie/tester', 'claude-sonnet-5', 4, 10), row(d, 'ada', 'claude-sonnet-5', 2, 45), row(d, 'bg:jeff', 'claude-haiku-4-5', 2.5, 9)]);
  rows.push({ ...row('2026-10-06', 'codex', 'gpt-5', 0, 12), unmetered: true });
  const out = insights({ rows, agents, today: '2026-10-06', stage: '5' });
  const text = out.filter((i) => i.kind === 'driver').map((i) => i.text);
  assert.ok(text.some((t) => /^Opus Leads are 75 % of spend/.test(t)), text.join('\n'));
  assert.ok(text.some((t) => /^Lead Tester's review loop cost \$60 this week \(29 %/.test(t)), text.join('\n'));
  assert.ok(text.some((t) => /^Coordinator relays 45 turns\/day \(\$2\.00\/day\)/.test(t)), text.join('\n'));
  assert.ok(text.some((t) => /^The office's own calls .* are 7 % of spend/.test(t)), text.join('\n'));
  assert.equal(out[0].kind, 'driver', 'drivers first');
});

test('suggestions: swap a model, delegate to a subagent, with the ranking\'s token efficiency', () => {
  const rows = days.flatMap((d) => [row(d, 'dylan', 'claude-opus-5-5', 20), row(d, 'sophie', 'claude-sonnet-5', 3), row(d, 'sophie/tester', 'claude-sonnet-5', 3)]);
  const out = insights({ rows, agents, today: '2026-10-06', stage: '5', efficiency: { dylan: 42 } });
  const swap = out.find((i) => i.id === 'swap-dylan')!;
  assert.match(swap.text, /^Move Dylan \(Lead Developer\) from Opus to Sonnet: about \$60 a week less; token efficiency 42\/100/);
  assert.equal(swap.saves, 60);
  assert.equal(swap.action?.to, 'org');
  const del = out.find((i) => i.id === 'delegate-dylan')!;
  assert.match(del.text, /^Dylan does 100 % of its work itself on Opus/);
  assert.equal(out.find((i) => i.id === 'delegate-sophie'), undefined, 'Sophie hands half to her Tester already');
  assert.equal(out.find((i) => i.id === 'swap-sophie'), undefined, 'not on Opus');
});

test('suggestions from the team settings: idle benching, Jeff\'s real-ask mode, early drafts only while early', () => {
  const rows = days.flatMap((d) => [row(d, 'dylan', 'claude-sonnet-5', 5, 1, '1'), row(d, 'ada', 'claude-sonnet-5', 5, 1, '1')]);
  const team = { idleMinutes: 0, jeffWaiting: 'shadow' as const, earlyDrafts: true };
  const out = insights({ rows, agents, today: '2026-10-06', stage: '1', team });
  assert.deepEqual(out.filter((i) => i.kind === 'suggestion').map((i) => i.id).sort(), ['early-drafts', 'idle-benching', 'jeff-real-ask']);
  assert.match(out.find((i) => i.id === 'early-drafts')!.text, /^Early drafts have cost \$30 so far/);
  assert.match(out.find((i) => i.id === 'jeff-real-ask')!.text, /\(now shadow\)/);
  // Past the build plan, early drafts are history; with benching on and Jeff on, nothing to suggest.
  const later = insights({ rows, agents, today: '2026-10-06', stage: '5', team: { idleMinutes: 30, jeffWaiting: 'on', earlyDrafts: true } });
  assert.equal(later.filter((i) => i.kind === 'suggestion').length, 0);
  // Nothing spent: nothing to say.
  assert.deepEqual(insights({ rows: [], agents, today: '2026-10-06', stage: '5', team }), []);
});
