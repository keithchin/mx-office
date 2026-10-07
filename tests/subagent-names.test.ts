// The Leads' subagents' first names: given once and kept (across a reload of the roster file),
// unique on a floor among the Leads and the subagents, given to a roster saved before names the same
// way every time, the strings each view shows, the Playbook's line, and the Project Manager's rename.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { NAME_POOL, ROLES, type RoleId } from '../src/shared/roster/roles.js';
import { assignSubagentNames, helperTag, nameTaken, pickSubagentName, roleLower, roleWord, subagentLabel, subRef, SUBAGENT_NAME_POOL } from '../src/shared/roster/subagent-names.js';
import { subagentCards } from '../src/shared/roster/subagent-cards.js';
import { freshRoster, reviveRoster, RosterFile } from '../src/server/roster/store.js';
import { NAMES_LINE, playbook } from '../src/server/roster/playbooks.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';

const T0 = Date.UTC(2026, 9, 7, 6, 0);
const fixed = () => 0.42;

/** A roster as an office before names saved it: two subagents with records, Leads named. */
function oldRoster() {
  const d = freshRoster(fixed) as unknown as Record<string, unknown>;
  delete d.subagentNames;
  const run = { id: 'r1', at: T0, endedAt: T0 + 1000, model: 'sonnet', outcome: 'accept' };
  d.subagents = {
    'lead-tester/tester': { name: 'tester', lead: 'lead-tester', state: 'active', warnings: [], runs: [run] },
    'lead-tester/Explore': { name: 'Explore', lead: 'lead-tester', state: 'active', warnings: [], runs: [run] },
  };
  return JSON.parse(JSON.stringify(d));
}

// ---- The pool and the picking --------------------------------------------------------------------

test("the pool: people's names, none twice and none a Lead's", () => {
  assert.ok(SUBAGENT_NAME_POOL.length >= 40);
  assert.equal(new Set(SUBAGENT_NAME_POOL).size, SUBAGENT_NAME_POOL.length);
  for (const n of SUBAGENT_NAME_POOL) {
    assert.match(n, /^[A-Z][a-z]+$/);
    assert.equal(NAME_POOL.includes(n), false, `${n} is a Lead's name too`);
  }
});

test('a subagent starts at the same name every time, and moves on past a taken one', () => {
  const a = pickSubagentName('lead-tester/tester', new Set());
  assert.equal(pickSubagentName('lead-tester/tester', new Set()), a);
  const b = pickSubagentName('lead-tester/tester', new Set([a.toLowerCase()]));
  assert.notEqual(b, a);
  // Every name taken: numbered rather than a clash.
  const all = new Set(SUBAGENT_NAME_POOL.map((n) => n.toLowerCase()));
  assert.match(pickSubagentName('lead-tester/tester', all), /^[A-Z][a-z]+ 2$/);
});

test('assigning: unique among the Leads and the subagents, the ones named kept, a clash with a Lead named again', () => {
  const names: Record<string, string> = {};
  const keys = ROLES.flatMap((r) => r.subagents.map((s) => `${r.id}/${s.id}`)).concat(['lead-tester/Explore', 'lead-developer/general-purpose']);
  const leads = ['Hedy', 'Anita', 'Dylan', 'Grace', 'Ada'];
  assert.equal(assignSubagentNames(names, keys, leads), true);
  const given = Object.values(names);
  assert.equal(given.length, keys.length);
  assert.equal(new Set(given.map((n) => n.toLowerCase())).size, given.length, 'no two subagents share a name');
  assert.ok(given.every((n) => !leads.includes(n)), 'nor a Lead');
  // Asked again: nothing changes.
  const before = { ...names };
  assert.equal(assignSubagentNames(names, keys, leads), false);
  assert.deepEqual(names, before);
  // A Lead renamed to a subagent's name (by hand in the file): that subagent is named again, the rest kept.
  const clash = names['lead-tester/tester'];
  assert.equal(assignSubagentNames(names, keys, [...leads, clash]), true);
  assert.notEqual(names['lead-tester/tester'], clash);
  for (const k of keys.filter((k) => k !== 'lead-tester/tester')) assert.equal(names[k], before[k]);
  assert.equal(nameTaken(clash.toUpperCase(), names, [clash]), true, 'case does not matter');
  assert.equal(nameTaken(names['lead-tester/tester'], names, [], 'lead-tester/tester'), false, 'its own name is not taken from it');
});

// ---- The roster file ------------------------------------------------------------------------------

test('a roster saved before names: every subagent named on load, the same names each time, and saved', () => {
  const raw = oldRoster();
  const a = reviveRoster(raw, fixed).subagentNames;
  const b = reviveRoster(raw, fixed).subagentNames;
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(a['lead-tester/tester'] && a['lead-tester/Explore'], 'records named');
  assert.ok(a['lead-developer/developer'] && a['chief-analyst/data-analyst'], 'defined subagents with no record yet named too');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'subnames-'));
  writeFileSync(path.join(dir, 'f1.json'), JSON.stringify(raw));
  const f = new RosterFile(dir, 'f1');
  f.flush();
  const saved = JSON.parse(readFileSync(path.join(dir, 'f1.json'), 'utf8'));
  assert.deepEqual(saved.subagentNames, f.data.subagentNames, 'the names were written back');
  // Loaded again: the very same names.
  assert.deepEqual(new RosterFile(dir, 'f1').data.subagentNames, f.data.subagentNames);
});

test('a name once given stays across reloads, even when the pick would now land elsewhere', () => {
  const raw = oldRoster();
  raw.subagentNames = { 'lead-tester/tester': 'Nia' };
  const d = reviveRoster(raw, fixed);
  assert.equal(d.subagentNames['lead-tester/tester'], 'Nia');
  // A bad saved name is dropped and named again.
  raw.subagentNames = { 'lead-tester/tester': '   ', 'nobody/x': 'Zed' };
  const e = reviveRoster(raw, fixed);
  assert.ok(e.subagentNames['lead-tester/tester'].trim());
  assert.equal(e.subagentNames['nobody/x'], undefined);
});

// ---- What each view shows ------------------------------------------------------------------------

test('the strings: full label, 2D tag, the short reference, the role words', () => {
  assert.equal(subagentLabel('Nia', 'tester', 'Hedy'), "Nia · Tester (Hedy's subagent)");
  assert.equal(helperTag('Nia', 'tester', 'Hedy'), "Nia (Hedy's tester)");
  assert.equal(subRef('Nia', 'tester'), 'Nia (tester)');
  assert.equal(subRef(undefined, 'tester'), 'tester');
  assert.equal(roleWord('ui-ux-designer'), 'UI/UX Designer');
  assert.equal(roleLower('ui-ux-designer'), 'UI/UX designer');
  assert.equal(roleWord('general-purpose'), 'General-purpose');
  assert.equal(roleWord('Explore'), 'Explore');
});

class FakeFloor implements TeamFloor {
  id = 'f1';
  name = 'Probe';
  dir = mkdtempSync(path.join(os.tmpdir(), 'subnames-floor-'));
  map = new Map<string, WorkerInfo>();
  feed: string[] = [];
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  hire = async () => 'no hiring here';
  async stop() {}
  prompt = () => undefined;
  wake = () => undefined;
  rename() {}
  cwdOf = () => this.dir;
  openPulls = () => [];
  toast() {}
  changed = () => undefined;
  transcript = () => undefined;
  activity = (s: string) => void this.feed.push(s);
}

function setup() {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'subnames-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => T0 }, 0);
  const d = roster.data(floor.id);
  floor.map.set('w-hedy', { id: 'w-hedy', kind: 'agent', provider: 'claude', deskId: 'desk-1', name: 'Hedy', color: '#fff', status: 'idle', acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo);
  d.members['lead-tester'] = { ...d.members['lead-tester'], name: 'Hedy', phase: 'active', workerId: 'w-hedy' };
  return { floor, roster, d };
}

test('cards, the roster view and the activity lines use the name; a subagent first seen at work is named then', () => {
  const { floor, roster, d } = setup();
  roster.subagents.onEvent(floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'general-purpose', task: 'Look around', background: false });
  const v = roster.view(floor, true);
  const first = v.subagentNames?.['lead-tester/general-purpose'];
  assert.ok(first, 'named the moment the office saw it');
  const card = subagentCards(v).find((c) => c.key === 'lead-tester/general-purpose')!;
  assert.deepEqual([card.firstName, card.role, card.label, card.tag], [first, 'General-purpose', `${first} · General-purpose (Hedy's subagent)`, `${first} (Hedy's general-purpose)`]);
  const tester = d.subagentNames['lead-tester/tester'];
  assert.equal(v.subagents.find((s) => s.name === 'tester')!.firstName, tester);
  // The Project Manager benches it: the activity line names it.
  assert.equal(roster.subagents.run(floor, 'lead-tester', 'bench', 'tester', { reason: 'flaky' }, 'Keith', 'pm'), undefined);
  assert.match(floor.feed.at(-1)!, new RegExp(`benched Hedy's subagent ${tester} \\(tester, Sonnet\\): flaky`));
  assert.match(roster.subagents.list(floor, 'lead-tester'), new RegExp(`^${tester} \\(tester, `, 'm'));
});

test("rename: a new first name (the type stays), kept unique, and the Lead's Playbook names it", () => {
  const { floor, roster, d } = setup();
  const was = d.subagentNames['lead-tester/tester'];
  const got = roster.subagents.rename(floor, 'lead-tester', 'tester', '  Ines  ', 'Keith');
  assert.deepEqual(got, { was, now: 'Ines' });
  assert.equal(d.subagentNames['lead-tester/tester'], 'Ines');
  assert.match(floor.feed.at(-1)!, new RegExp(`Keith renamed Hedy's tester ${was} to Ines`));
  // Taken by a Lead, or by another subagent: refused.
  assert.match(String(roster.subagents.rename(floor, 'lead-tester', 'tester', 'hedy', 'Keith')), /already on the team/);
  const dev = d.subagentNames['lead-developer/developer'];
  assert.match(String(roster.subagents.rename(floor, 'lead-tester', 'tester', dev, 'Keith')), /already on the team/);
  assert.match(String(roster.subagents.rename(floor, 'lead-tester', 'nobody-here', 'Zed', 'Keith')), /No subagent called nobody-here/);
  assert.match(String(roster.subagents.rename(floor, 'lead-tester', 'tester', '', 'Keith')), /Give it a name/);
  // Nor can a Lead take a subagent's name.
  assert.match(String(roster.members.rename(floor, 'lead-developer', 'Ines')), /subagent's name/);
  // Its Lead's Playbook was written again with the name.
  const skill = readFileSync(path.join(floor.dir, '.ai-context/skills/team-lead-tester/SKILL.md'), 'utf8');
  assert.match(skill, /- \*\*Ines, your Tester\*\* — the `tester` subagent/);
});

// ---- The Playbook ----------------------------------------------------------------------------------

test("the Playbook: one line per subagent with its name, and one line on how to use the names", () => {
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.title])) as Record<RoleId, string>;
  const base = { project: 'Probe', name: 'Mae', level: 2 as const, lessons: 'x.md', names };
  const plain = playbook('chief-analyst', base);
  const named = playbook('chief-analyst', { ...base, subagentNames: { 'business-analyst': 'Nia', 'data-analyst': 'Otis' } });
  assert.match(named, /^- \*\*Nia, your Business Analyst\*\* — the `business-analyst` subagent/m);
  assert.match(named, /^- \*\*Otis, your Data Analyst\*\* — the `data-analyst` subagent \(`\.claude\/agents\/data-analyst\.md`\)/m);
  assert.ok(named.includes(NAMES_LINE));
  // The same lines plus that one: the names cost a few words, not a section.
  assert.equal(named.split('\n').length, plain.split('\n').length + 1);
  assert.ok(!plain.includes(NAMES_LINE));
  // A benched one is named in the standing too, and still dispatched by its type.
  const benched = playbook('chief-analyst', { ...base, subagentNames: { 'data-analyst': 'Otis' }, subagents: [{ name: 'data-analyst', lead: 'chief-analyst', state: 'benched', warnings: [], runs: [], benchReason: 'wrong charts' }] });
  assert.match(benched, /🪑 \*\*Otis \(data-analyst\) is benched\*\* \(wrong charts\): don't dispatch data-analyst/);
});
