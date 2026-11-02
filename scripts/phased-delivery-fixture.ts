// Seeds a TEST office (the performance guard's fixture, scripts/perf/fixture.ts) with a phased project for
// scripts/phased-delivery-shots.mjs: a neutral room-booking build plan and journeys committed on the project's
// main, row commits for the done rows, journey results and an mx check recorded on main, Build spend in the
// budget ledger, and a phase plan (two done, one active with its next phase's design started early, five
// planned) with its change history and one open team proposal. `--proposed` seeds the Build Plan gate instead
// (phases proposed, not approved). Neutral example data only; never a real office.
//
//   node --import tsx scripts/phased-delivery-fixture.ts --home <office> --floor <id> --dir <project dir> [--proposed]

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { testingStore } from '../src/server/testing/index.js';
import { phasesOfDrafts } from '../src/shared/phases/plan.js';
import type { PhaseDraft, PhasePlan } from '../src/shared/phases/types.js';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const home = arg('--home')!;
const floor = arg('--floor')!;
const dir = arg('--dir')!;
const proposed = process.argv.includes('--proposed');
if (!/test-offices/.test(home) || !/test-offices/.test(dir)) throw new Error('Only a test office under scratch/test-offices');
const data = path.join(home, '.agent-office');
const DAY = 86_400_000;
const now = Date.now();
const day0 = Math.floor(now / DAY) * DAY + 9 * 3_600_000;
const at = (d: number) => day0 + d * DAY;
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...a], { cwd: dir, encoding: 'utf8' }).trim();

const AREAS: { name: string; goal: string; foundation?: boolean; steps: string[]; journeys: [string, string][]; est: [number, number]; days: number; checkpoint?: boolean }[] = [
  { name: 'Look and feel', goal: 'Design tokens, page layouts and the building blocks every page uses', foundation: true, steps: ['Design tokens', 'Page layouts', 'Navigation', 'Building blocks', 'Empty states', 'Theme check'], journeys: [['J-00', 'Every page uses the layouts']], est: [25, 40], days: 3 },
  { name: 'Data and access', goal: 'Entities, roles and access rules; sign-in works end to end', foundation: true, steps: ['Domain model', 'Roles', 'Access rules', 'Sign-in', 'Seed data', 'Audit fields', 'Validation', 'Indexes'], journeys: [['J-01', 'Sign in as each role']], est: [35, 50], days: 4 },
  { name: 'Bookings', goal: 'People find a room, book it and see their bookings; desk staff manage them', steps: ['Room list with search', 'Filters: site, size, equipment', 'Room detail', 'Book and cancel', 'My bookings', 'Calendar file', 'Desk staff: edit a booking', 'Recurring bookings', 'Waitlist', 'Check-in code', 'Room photos', 'Reminders'], journeys: [['J-02', 'Browse rooms'], ['J-03', 'Filter by site and date'], ['J-04', 'Open a room'], ['J-05', 'Book a room'], ['J-06', 'Cancel a booking'], ['J-07', 'Add to my calendar'], ['J-08', 'Desk staff edits a booking'], ['J-09', 'Check in with a code']], est: [90, 130], days: 7 },
  { name: 'Requests', goal: 'People ask for catering and equipment with a booking; facilities handle them', steps: ['Request form', 'Catering menu', 'Equipment list', 'Facilities queue', 'Status updates', 'Comments', 'Request history', 'Costs per request', 'Approvals', 'Request report'], journeys: [['J-10', 'Order catering'], ['J-11', 'Ask for a projector'], ['J-12', 'Facilities closes a request']], est: [90, 130], days: 7 },
  { name: 'Usage and reports', goal: 'Managers see how rooms are used and where to save', steps: ['Usage dashboard', 'No-show report', 'Exports', 'Site comparison', 'Monthly mail', 'Saved filters', 'Trends', 'Peak hours', 'Room ranking'], journeys: [['J-13', 'Open the usage dashboard'], ['J-14', 'Export a month']], est: [60, 90], days: 5 },
  { name: 'Administration', goal: 'Admins manage sites, rooms and settings', steps: ['Sites', 'Rooms', 'Equipment types', 'Opening hours', 'Holidays', 'Settings', 'User admin', 'Imports', 'Moderation'], journeys: [['J-15', 'Add a room'], ['J-16', 'Close a site for a holiday']], est: [50, 80], days: 4, checkpoint: false },
  { name: 'Extras', goal: 'Sharing, floor maps and live occupancy', steps: ['Share a booking', 'Floor maps', 'Occupancy sensor feed', 'Kiosk mode', 'Favourites', 'Quick book', 'Feedback'], journeys: [['J-17', 'Share a booking']], est: [40, 70], days: 4, checkpoint: false },
  { name: 'Polish', goal: 'Accessibility pass, performance and the last fixes', steps: ['Accessibility pass', 'Performance pass', 'Error pages', 'Help texts', 'Fixes from review', 'Translations', 'Print views', 'Final check', 'Handover notes'], journeys: [['J-18', 'Keyboard-only booking'], ['J-19', 'Booking on a phone']], est: [60, 100], days: 5 },
];

// The build plan and journeys on main.
let n = 0;
const drafts: PhaseDraft[] = [];
const plan = ['# Build plan — Room booking (sample)', ''];
for (const [i, a] of AREAS.entries()) {
  plan.push(`### Phase ${i + 1} — ${a.name}`, '', '| # | Kind | Step | State |', '|---|---|---|---|');
  const rows: number[] = [];
  for (const s of a.steps) {
    n++;
    rows.push(n);
    plan.push(`| ${n} | BUILD | ${s} | |`);
  }
  plan.push('');
  drafts.push({ name: a.name, goal: a.goal, foundation: !!a.foundation, rows, journeys: a.journeys.map(([id]) => id), estimate: { min: a.est[0], max: a.est[1] }, days: a.days, checkpoint: a.checkpoint !== false, publish: true });
}
mkdirSync(path.join(dir, 'architecture'), { recursive: true });
mkdirSync(path.join(dir, 'tests', 'e2e'), { recursive: true });
writeFileSync(path.join(dir, 'architecture', 'build-plan.md'), plan.join('\n'));
for (const a of AREAS) for (const [id, title] of a.journeys) writeFileSync(path.join(dir, 'tests', 'e2e', `${id}.journey.json`), JSON.stringify({ id, title, requirement: [] }, null, 1));
git('add', 'architecture/build-plan.md', 'tests/e2e');
git('commit', '-q', '-m', 'Build plan and journeys (sample)');
// Rows done: phases 1 and 2, and half of phase 3 (commits named "Rows a-b: …", as the team writes them).
const done = proposed ? [] : [...drafts[0].rows, ...drafts[1].rows, ...drafts[2].rows.slice(0, 6)];
const chunks = proposed ? [] : [drafts[0].rows, drafts[1].rows, drafts[2].rows.slice(0, 2), drafts[2].rows.slice(2, 4), drafts[2].rows.slice(4, 6)];
const titles = ['Look and feel', 'Data and access', 'Room list and filters', 'Room detail and booking', 'My bookings and calendar'];
for (const [i, c] of chunks.entries()) {
  writeFileSync(path.join(dir, 'docs', `row-${c[0]}.md`), `rows ${c.join(', ')}\n`);
  git('add', '-A', 'docs');
  git('commit', '-q', '-m', `Rows ${c[0]}-${c[c.length - 1]}: ${titles[i]} built`);
}
const main = git('rev-parse', 'HEAD');

// Journey results and an mx check on main.
const pass = proposed ? [] : ['J-00', 'J-01', 'J-02', 'J-03', 'J-04', 'J-08'];
const fail = proposed ? [] : ['J-05'];
const store = testingStore(data, floor);
await store.ingest(
  [...pass.map((j) => [j, 'passed'] as const), ...fail.map((j) => [j, 'failed'] as const)].map(([j, status]) => ({
    source: 'office-journey' as const,
    sourceKey: `fixture:${j}`,
    suite: `journey ${j}`,
    testedRevision: main,
    definitionRevision: main,
    evidence: { kind: 'office' as const, revision: main, locator: `office:fixture:${j}` },
    results: [{ name: j, status, links: [] }],
    links: [],
    actor: { kind: 'office' as const, name: 'Fixture' },
    importer: 'fixture',
  })),
);
mkdirSync(path.join(data, 'security'), { recursive: true });
if (!proposed) writeFileSync(path.join(data, 'security', `${floor}.json`), JSON.stringify({ reads: [], checks: [{ commit: main, at: now, status: 'pass', errors: 0, warnings: 3, ms: 41000, by: 'Fixture' }] }));

// Build spend in the ledger, by day, on the phases' days.
const bfile = path.join(data, 'budget', `${floor}.json`);
const budget = JSON.parse(readFileSync(bfile, 'utf8'));
const ledger = budget.ledger;
const agents = Object.entries(ledger.agents as Record<string, { role: string; kind: string }>);
const dev = agents.find(([, a]) => a.kind === 'worker' && /Developer/.test(a.role))?.[0] ?? agents[0][0];
const des = agents.find(([, a]) => a.kind === 'worker' && /Designer/.test(a.role))?.[0] ?? dev;
const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// The fixture's own spend over the phases' days goes, so the example reads like a real phased build.
if (!proposed) {
  const from = dayOf(at(-12));
  for (const r of ledger.rows as { day: string; stage: string; cost: number }[]) {
    if (r.day < from) continue;
    const roll = ledger.days[r.day];
    if (roll) {
      roll.cost -= r.cost;
      roll.stage[r.stage] = (roll.stage[r.stage] ?? 0) - r.cost;
    }
  }
  ledger.rows = (ledger.rows as { day: string }[]).filter((r) => r.day < from);
}
const spend: [number, string, number][] = proposed ? [] : [[-11, dev, 11], [-10, dev, 10], [-9, dev, 10], [-8, dev, 14], [-7, dev, 15], [-6, dev, 13], [-5, dev, 13], [-4, dev, 16], [-3, dev, 15], [-2, dev, 17], [-1, dev, 9], [0, dev, 8], [-1, des, 6], [0, des, 6], [-3, 'bg:standup', 4]];
ledger.agents['bg:standup'] = { key: 'bg:standup', name: 'Standups', role: 'Office background', kind: 'background' };
for (const [d, agent, cost] of spend) {
  const row = { day: dayOf(at(d)), agent, model: 'claude-opus-5-5', stage: '5', cost, calls: Math.round(cost * 8) };
  ledger.rows.push(row);
  const roll = (ledger.days[row.day] ??= { cost: 0, calls: 0, est: 0, unmetered: 0, stage: {}, role: {}, model: {}, agent: {}, work: {} });
  roll.cost += cost;
  roll.stage['5'] = (roll.stage['5'] ?? 0) + cost;
}
budget.settings = { ...budget.settings, total: 1500, autoPause: true };
writeFileSync(bfile, JSON.stringify(budget));

// The phase plan.
const phases = phasesOfDrafts(drafts);
const lead = { kind: 'agent' as const, name: 'Robin', role: 'Project Coordinator' };
const pm = { kind: 'pm' as const, name: 'Alex Lee' };
const p: PhasePlan = { version: 1, delivery: 'phases', prefs: { publishAtPhaseEnd: true, checkpointAtPhaseEnd: true, envelope: 'team-estimate' }, state: proposed ? 'proposed' : 'approved', phases, cutover: { min: 20, max: 35, days: 4 }, changes: [], proposals: [] };
const lite = () => p.phases.map((x) => ({ id: x.id, name: x.name, rows: [...x.rows], status: x.status, checkpoint: x.checkpoint, publish: x.publish }));
p.proposals.push({ id: 'P-1', kind: 'plan', by: lead, at: at(-12), summary: '8 phases from the build plan', reason: 'Foundation first, then one business area a phase so each can be tried on the sandbox', phases: drafts, base: 0, status: proposed ? 'open' : 'accepted', ...(proposed ? {} : { decidedAt: at(-12), decidedBy: pm }) });
if (!proposed) {
  p.approvedAt = at(-12);
  p.changes.push({ id: 'C-1', kind: 'approve', summary: '8 phases approved at the Build Plan gate', reason: 'Foundation first, then one business area a phase', proposedBy: lead, decidedBy: pm, decision: 'accepted', proposal: 'P-1', at: at(-12), diff: { before: [], after: lite() } });
  p.changes.push({ id: 'C-2', kind: 'toggle', summary: 'Checkpoint turned off for 6 Administration and 7 Extras', reason: 'Internal-only phases: review them with Polish', proposedBy: pm, decidedBy: pm, decision: 'accepted', at: at(-8), diff: { before: lite(), after: lite() } });
  Object.assign(phases[0], { status: 'done', startedAt: at(-11), endedAt: at(-9) });
  Object.assign(phases[1], { status: 'done', startedAt: at(-8), endedAt: at(-5) });
  Object.assign(phases[2], { status: 'active', startedAt: at(-4), overlapsWith: ['ph-4'] });
  Object.assign(phases[3], { overlapsWith: ['ph-3'], early: { since: at(-1), teams: ['design'], what: 'design' } });
  p.changes.push({ id: 'C-3', kind: 'overlap', summary: '4 Requests starts early (design), overlapping the phase in progress', reason: 'The request forms need wireframes before the build; design is free now', proposedBy: { kind: 'agent', name: 'Sam', role: 'Lead Designer' }, decidedBy: pm, decision: 'accepted', proposal: 'P-2', at: at(-1), diff: { before: lite(), after: lite() } });
  p.proposals.push({ id: 'P-2', kind: 'change', by: { kind: 'agent', name: 'Sam', role: 'Lead Designer' }, at: at(-1), summary: '4 Requests starts early (design)', reason: 'Wireframes first', ops: [{ op: 'overlap', phase: 'ph-4', teams: ['design'], what: 'design' }], base: 2, status: 'accepted', decidedAt: at(-1), decidedBy: pm });
  const r12 = drafts[2].rows[11];
  p.proposals.push({ id: 'P-3', kind: 'change', by: { kind: 'agent', name: 'Jordan', role: 'Lead Developer' }, at: at(0), summary: `Moved row ${r12} from 3 Bookings to 6 Administration`, reason: 'Reminders need the notification settings phase 6 sets up; Bookings would close 2 days sooner. Estimate: Bookings −$12, Administration +$12.', ops: [{ op: 'move-rows', rows: [r12], to: 'ph-6' }], base: 3, status: 'open' });
}
mkdirSync(path.join(data, 'phases'), { recursive: true });
writeFileSync(path.join(data, 'phases', `${floor}.json`), JSON.stringify(p, null, 1));
console.log(JSON.stringify({ main, done: done.length, phases: phases.length, state: p.state }));
