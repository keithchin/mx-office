// The docs screenshots' demo office (scripts/docs-shots.mjs): a small, believable test office with two
// Mendix projects, written in one go and the same every time. Unlike the performance guard's big-data
// fixture (scripts/perf/fixture.ts), everything a page shows here reads like a real project: names,
// tasks, chat, issues, pull requests, a stage-3 progress bar and budget numbers that add up. It reuses
// that fixture's building blocks (its seeded generator for ids, the real reviveRoster and ledger) so
// what's written is what the office itself would save.
//
//   node --import tsx scripts/docs/demo.ts --out <dir> --at <ms>
//
// It writes, under <out>:
//   office/.agent-office/   the office's data: floors.json, roster/, budget/, project-run.json…
//   office/projects/<id>/   each project: a git repo (a few commits, fixed dates) holding the toolkit's
//                           PROJECT.md, intake.md and gate-check dashboard, plus .agent-office/
//                           (workers.json, queue.json, transcripts/)
//   github/                 what the docs' stand-in gh answers (issues and pull requests, docs/gh.mjs)
//   demo-agents.json        what each live agent is doing (docs/agent.mjs reads it)
// and prints a JSON summary. --at is the moment the screenshots are taken at (the data ends just before).
// Only into a test office's folder (a test-office… folder): the office it's for runs in test mode.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Gen, DAY, HOUR, MIN } from '../perf/fixture/gen.js';
import { makeEscalation, type Escalation } from '../../src/shared/roster/escalation.js';
import { ROLE_BY_ID, ROLES, type RoleId } from '../../src/shared/roster/roles.js';
import type { Proposal, Standup } from '../../src/shared/roster/types.js';
import { defaultSettings, reviveRoster, type MemberRecord, type RosterData } from '../../src/server/roster/store.js';
import { emptyOutbox } from '../../src/server/roster/relays.js';
import { defaultCoverage } from '../../src/shared/roster/coverage.js';
import type { TeamShape } from '../../src/shared/roster/coverage.js';
import type { AgentInfo, BudgetPlan, StageId } from '../../src/shared/budget/types.js';
import { book, emptyLedger, prune } from '../../src/server/budget/ledger.js';
import type { FloorFile, OfficeFile } from '../../src/server/budget/store.js';
import { DEFAULT_FX } from '../../src/server/budget/fx.js';
import type { QueueTask } from '../../src/shared/protocol.js';

/** The demo GitHub owner: made up, nobody's account. */
export const OWNER = 'example-co';
/** The person using the demo office (the browser's profile). */
export const PERSON = 'Alex';
const PM_NAME = 'Alex (Project Manager)';

const MODEL_ID: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5' };
const COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#e0b400', '#c3423f', '#b388eb', '#00a6a6', '#f28fad'];

// ---- What the two projects are -------------------------------------------------------------------

type Say = { user: string } | { say: string } | { tool: string; input: Record<string, unknown>; result?: string };

interface DemoWorker {
  name: string;
  model: 'opus' | 'sonnet' | 'haiku';
  role?: RoleId;
  /** At work when the shot is taken (the docs agent keeps it busy on `doing`). */
  live?: { tool: string; input: Record<string, unknown> };
  activity: string;
  task: { name: string; summary: string };
  issue?: number;
  pr?: number;
  cost: number;
  hoursAgo: number;
  talk: Say[];
}

interface DemoIssue {
  number: number;
  title: string;
  labels: string[];
  body: string;
  closed?: boolean;
}

interface DemoPull {
  number: number;
  title: string;
  branch: string;
  state: 'OPEN' | 'MERGED';
  checks: 'pass' | 'pending';
  by: string;
  additions: number;
  deletions: number;
  closes?: number;
}

interface DemoProject {
  id: string;
  name: string;
  about: string;
  shape: TeamShape;
  entry: string;
  /** PROJECT.md's current stage, as the toolkit writes it. */
  stage: string;
  /** gate-check's verdicts, P up: PASS, then the current stage's own. */
  verdicts: [id: string, title: string, status: string, detail: string][];
  decisions: [stage: string, decision: string, status: string][];
  workers: DemoWorker[];
  issues: DemoIssue[];
  pulls: DemoPull[];
  commits: [daysAgo: number, subject: string][];
  /** The ledger: dollars a day, newest last, and the stage each day was booked to. */
  days: [usd: number, stage: StageId][];
  total: number;
  /** Paused by the person (the Projects page shows it so). */
  paused?: boolean;
  escalation?: { by: RoleId; title: string; details: string; options: string[]; recommendation: string; minutesAgo: number };
  proposals: { by: RoleId; kind: Proposal['kind']; title: string; detail: string; status: Proposal['status'] }[];
  standup?: { done: Partial<Record<RoleId, string[]>>; next: Partial<Record<RoleId, string[]>> };
}

const TRAVEL: DemoProject = {
  id: 'travel-approval',
  name: 'Travel Approval',
  about: 'A Mendix app where employees request business travel, managers approve it and finance books it.',
  shape: 'enterprise',
  entry: 'requirements-driven',
  stage: 'Stage 3 — Architecture & Design',
  verdicts: [
    ['P', 'Kickoff', 'PASS', 'every intake question has an answer'],
    ['0', 'Triage', 'PASS', 'scope confirmed by Alex on 2026-09-24'],
    ['1', 'Analysis', 'PASS', 'process map and glossary on main'],
    ['2', 'Requirements', 'PASS', '14 user stories with acceptance criteria'],
    ['3', 'Architecture & Design', 'PENDING', 'domain model and wireframes in review'],
    ['4', 'Build Plan', 'PENDING', ''],
    ['5', 'Build', 'PENDING', ''],
    ['6', 'Test', 'PENDING', ''],
  ],
  decisions: [
    ['P', 'Requirements-driven build from the travel policy', 'CONFIRMED'],
    ['0', 'Scope: request, approve, book; expenses out of scope', 'CONFIRMED'],
    ['0', 'Mendix 11.12.4', 'CONFIRMED'],
    ['2', 'Two approval levels above 2,500 EUR', 'CONFIRMED'],
    ['3', 'Approvals as a workflow, not microflows', 'ASSUMED'],
  ],
  workers: [
    {
      name: 'Ada',
      role: 'pm',
      model: 'opus',
      live: { tool: 'Read', input: { file_path: 'design/wireframes/approval-inbox.html' } },
      activity: 'Read design/wireframes/approval-inbox.html',
      task: { name: 'Coordinate Stage 3 sign-off', summary: 'Gather the domain model and wireframes for the Stage 3 review.' },
      cost: 186.4,
      hoursAgo: 0.2,
      talk: [
        { user: 'Where are we with Stage 3? I want to review the design before Friday.' },
        { tool: 'Bash', input: { command: 'gh pr list --state open' }, result: '#41 Domain model: TravelRequest, Approval, Booking\n#43 Wireframes: request form and approval inbox' },
        { tool: 'Read', input: { file_path: 'architecture/domain-model.md' }, result: '# Domain model' },
        { say: 'Stage 3 is close. Linus has the domain model up for review in #41 (TravelRequest, Approval, Booking, with the two-level approval above 2,500 EUR), and Hedy has the request form and approval inbox wireframes in #43.' },
        { tool: 'Read', input: { file_path: 'design/wireframes/request-form.html' }, result: '<!doctype html>' },
        { say: 'One decision is waiting on you: whether approvals run as a Mendix workflow or as microflows. Linus recommends the workflow; I have put it in your Needs you list. Once that is settled and Grace has checked the test plan, the stage can be signed off.' },
        { user: 'Thanks. Ask Grace to start the test plan for the approval inbox.' },
        { tool: 'Bash', input: { command: 'gh issue view 38' }, result: 'Test plan: approval inbox' },
        { say: 'Done: Grace has issue #38 and will start the test plan for the approval inbox this afternoon. I am reading the wireframes now so the Stage 3 summary is ready for your review.' },
      ],
    },
    {
      name: 'Linus',
      role: 'lead-developer',
      model: 'opus',
      live: { tool: 'Edit', input: { file_path: 'architecture/domain-model.md' } },
      activity: 'Edit architecture/domain-model.md',
      task: { name: 'Domain model for travel requests', summary: 'Entities, associations and access rules for requests, approvals and bookings.' },
      issue: 36,
      pr: 41,
      cost: 142.75,
      hoursAgo: 0.3,
      talk: [
        { user: 'Draft the domain model for travel requests, approvals and bookings.' },
        { tool: 'Read', input: { file_path: 'requirements/user-stories.md' }, result: '# User stories' },
        { say: 'Drafting the domain model: TravelRequest (destination, dates, purpose, estimated cost), Approval (level, decision, comment) and Booking (carrier, reference, price).' },
      ],
    },
    {
      name: 'Hedy',
      role: 'lead-designer',
      model: 'sonnet',
      activity: 'Finished its turn',
      task: { name: 'Wireframes for the request flow', summary: 'Request form, approval inbox and the traveller dashboard.' },
      issue: 37,
      pr: 43,
      cost: 61.2,
      hoursAgo: 1.5,
      talk: [
        { user: 'Wireframe the request form and the approval inbox in the Atlas style.' },
        { say: 'The request form and the approval inbox are wireframed in design/wireframes/, and the PR is up as #43.' },
      ],
    },
    {
      name: 'Grace',
      role: 'lead-tester',
      model: 'sonnet',
      live: { tool: 'Write', input: { file_path: 'tests/test-plan.md' } },
      activity: 'Write tests/test-plan.md',
      task: { name: 'Test plan: approval inbox', summary: 'Journeys and edge cases for approving and rejecting requests.' },
      issue: 38,
      cost: 38.9,
      hoursAgo: 0.1,
      talk: [
        { user: 'Start the test plan for the approval inbox (issue #38).' },
        { say: 'Starting on the test plan: approve, reject with a comment, the second approval above 2,500 EUR, and delegation while a manager is away.' },
      ],
    },
    {
      name: 'Radia',
      role: 'chief-analyst',
      model: 'sonnet',
      activity: 'Finished its turn',
      task: { name: 'Travel policy rules', summary: 'Turn the travel policy into acceptance criteria.' },
      cost: 74.3,
      hoursAgo: 5,
      talk: [
        { user: 'Turn the travel policy into acceptance criteria.' },
        { say: 'The 14 user stories now carry acceptance criteria taken from the travel policy, including the per-diem limits and the two approval levels.' },
      ],
    },
    {
      name: 'Juniper',
      model: 'sonnet',
      activity: 'Finished its turn',
      task: { name: 'Seed data for destinations', summary: 'Countries, cities and per-diem rates for the demo environment.' },
      issue: 34,
      pr: 40,
      cost: 12.6,
      hoursAgo: 20,
      talk: [
        { user: 'Work on GitHub issue #34 in this repo: read it with `gh issue view 34` and follow it exactly.' },
        { say: 'Seed data for destinations and per-diem rates is in #40, merged after review.' },
      ],
    },
  ],
  issues: [
    { number: 34, title: 'Seed data for destinations and per-diem rates', labels: ['stage-2'], body: 'Countries, cities and per-diem rates for the demo environment.', closed: true },
    { number: 36, title: 'Domain model: TravelRequest, Approval, Booking', labels: ['stage-3', 'architecture'], body: 'Entities, associations and access rules.' },
    { number: 37, title: 'Wireframes: request form and approval inbox', labels: ['stage-3', 'design'], body: 'Atlas wireframes for the two main screens.' },
    { number: 38, title: 'Test plan: approval inbox', labels: ['stage-3', 'testing'], body: 'Journeys and edge cases for approving and rejecting requests.' },
    { number: 39, title: 'Decide: approvals as a workflow or microflows', labels: ['decision'], body: 'Linus recommends a Mendix workflow.' },
    { number: 42, title: 'Traveller dashboard: my requests and their status', labels: ['stage-3', 'design'], body: 'A dashboard for travellers.' },
  ],
  pulls: [
    { number: 40, title: 'Seed data for destinations and per-diem rates', branch: 'feature/issue-34', state: 'MERGED', checks: 'pass', by: 'Juniper', additions: 212, deletions: 4, closes: 34 },
    { number: 41, title: 'Domain model: TravelRequest, Approval, Booking', branch: 'feature/issue-36', state: 'OPEN', checks: 'pass', by: 'Linus', additions: 184, deletions: 12, closes: 36 },
    { number: 43, title: 'Wireframes: request form and approval inbox', branch: 'feature/issue-37', state: 'OPEN', checks: 'pending', by: 'Hedy', additions: 640, deletions: 0, closes: 37 },
  ],
  commits: [
    [21, 'Kickoff: intake answered, requirements-driven'],
    [16, 'Stage 0: scope and triage signed off'],
    [12, 'Stage 1: process map and glossary'],
    [7, 'Stage 2: user stories with acceptance criteria'],
    [1, 'Seed data for destinations and per-diem rates (#40)'],
  ],
  days: [
    [22, 'P'], [31, 'P'], [18, '0'], [44, '0'], [39, '0'], [52, '1'], [61, '1'], [47, '1'], [58, '1'], [36, '2'], [71, '2'], [66, '2'],
    [49, '2'], [58, '2'], [27, '2'], [63, '3'], [74, '3'], [55, '3'], [81, '3'], [69, '3'], [92, '3'], [48, '3'],
  ],
  total: 2400,
  escalation: {
    by: 'lead-developer',
    title: 'Approvals as a Mendix workflow or as microflows?',
    details: 'The two-level approval above 2,500 EUR, delegation and reminders fit a workflow well. Microflows are simpler to start with but would need our own task list and escalation timers.',
    options: ['Use a Mendix workflow (recommended)', 'Use microflows and a custom task list'],
    recommendation: 'Use a Mendix workflow: delegation, reminders and the audit trail come with it.',
    minutesAgo: 42,
  },
  proposals: [
    { by: 'lead-designer', kind: 'design', title: 'Use the Atlas data grid for the approval inbox', detail: 'Sorting and filtering by traveller, cost and date come for free.', status: 'pending' },
    { by: 'lead-tester', kind: 'task', title: 'Add an end-to-end journey for a rejected request', detail: 'Covers the comment, the notification and resubmitting.', status: 'pending' },
    { by: 'chief-analyst', kind: 'scope', title: 'Keep expense claims for a later release', detail: 'Agreed at triage; recorded so it stays out of the build plan.', status: 'approved' },
  ],
  standup: {
    done: { 'lead-developer': ['Domain model drafted and up for review in #41'], 'lead-designer': ['Request form and approval inbox wireframed (#43)'], 'chief-analyst': ['Acceptance criteria for all 14 stories'], 'lead-tester': ['Read the stories and the wireframes'] },
    next: { 'lead-developer': ['Access rules for managers and finance'], 'lead-designer': ['Traveller dashboard'], 'chief-analyst': ['Glossary review with finance'], 'lead-tester': ['Test plan for the approval inbox'] },
  },
};

const LOANS: DemoProject = {
  id: 'equipment-loan-desk',
  name: 'Equipment Loan Desk',
  about: 'A Mendix app for borrowing laptops, cameras and other equipment from the IT desk, with reminders and returns.',
  shape: 'solo',
  entry: 'greenfield',
  stage: 'Stage 5 — Build',
  verdicts: [
    ['P', 'Kickoff', 'PASS', 'every intake question has an answer'],
    ['0', 'Triage', 'PASS', 'scope confirmed on 2026-09-30'],
    ['5', 'Build', 'PENDING', 'loan and return flows built; reminders in progress'],
    ['6', 'Test', 'PENDING', ''],
  ],
  decisions: [
    ['P', 'Greenfield build for the IT desk', 'CONFIRMED'],
    ['0', 'Mendix 11.12.4', 'CONFIRMED'],
  ],
  workers: [
    {
      name: 'Niklaus',
      role: 'solo-lead',
      model: 'opus',
      live: { tool: 'Bash', input: { command: 'mxcli check modules/Loans/reminders.mdl' } },
      activity: 'Bash: mxcli check modules/Loans/reminders.mdl',
      task: { name: 'Overdue reminders', summary: 'Daily reminder e-mails for loans past their return date.' },
      issue: 12,
      cost: 96.1,
      hoursAgo: 0.1,
      talk: [
        { user: 'Build the overdue reminders next.' },
        { say: 'Building the overdue reminders: a scheduled event finds loans past their return date and e-mails the borrower and the IT desk.' },
      ],
    },
  ],
  issues: [
    { number: 9, title: 'Loan and return flow', labels: ['build'], body: 'Borrow, extend and return equipment.', closed: true },
    { number: 12, title: 'Overdue reminders by e-mail', labels: ['build'], body: 'Daily reminders for overdue loans.' },
    { number: 13, title: 'Equipment catalogue with photos', labels: ['build'], body: 'Browse what can be borrowed.' },
  ],
  pulls: [{ number: 11, title: 'Loan and return flow', branch: 'feature/issue-9', state: 'MERGED', checks: 'pass', by: 'Niklaus', additions: 420, deletions: 18, closes: 9 }],
  commits: [
    [10, 'Kickoff: greenfield build for the IT desk'],
    [8, 'Domain model: Equipment, Loan, Borrower'],
    [3, 'Loan and return flow (#11)'],
  ],
  days: [[14, 'P'], [21, '0'], [33, '5'], [41, '5'], [28, '5'], [37, '5'], [45, '5'], [39, '5'], [52, '5'], [31, '5']],
  total: 900,
  proposals: [],
};

const VISITORS: DemoProject = {
  id: 'visitor-registration',
  name: 'Visitor Registration',
  about: 'Changes to the reception desk app: pre-registered visitors, badge printing and host notifications.',
  shape: 'solo',
  entry: 'existing-app-change',
  stage: 'Stage 4 — Build Plan',
  verdicts: [
    ['P', 'Kickoff', 'PASS', 'every intake question has an answer'],
    ['0', 'Triage', 'PASS', 'scope confirmed on 2026-09-21'],
    ['1', 'Analysis', 'PASS', 'current app analysed'],
    ['2', 'Requirements', 'PASS', '6 change requests'],
    ['3', 'Architecture & Design', 'PASS', 'design signed off'],
    ['4', 'Build Plan', 'FAIL', '✋ build plan written, awaiting sign-off'],
    ['5', 'Build', 'PENDING', ''],
    ['6', 'Test', 'PENDING', ''],
  ],
  decisions: [
    ['P', 'Change the existing reception app', 'CONFIRMED'],
    ['3', 'Badges printed from the browser', 'CONFIRMED'],
  ],
  workers: [
    {
      name: 'Wren',
      role: 'solo-lead',
      model: 'opus',
      activity: 'Finished its turn',
      task: { name: 'Build plan', summary: 'Six change requests in three sprints.' },
      cost: 54.2,
      hoursAgo: 2,
      talk: [
        { user: 'Write the build plan for the six change requests.' },
        { say: 'The build plan is in architecture/build-plan.md: three sprints, badge printing first. It needs your sign-off before the build starts.' },
      ],
    },
  ],
  issues: [{ number: 21, title: 'Sign off the build plan', labels: ['decision'], body: 'Three sprints, badge printing first.' }],
  pulls: [],
  commits: [
    [18, 'Kickoff: change the reception app'],
    [6, 'Stage 3: design signed off'],
    [1, 'Build plan: three sprints'],
  ],
  days: [[12, 'P'], [19, '0'], [24, '1'], [31, '2'], [22, '3'], [28, '3'], [17, '4'], [9, '4']],
  total: 600,
  escalation: {
    by: 'solo-lead',
    title: 'The build plan is ready for your sign-off',
    details: 'Three sprints: badge printing, pre-registration, then host notifications.',
    options: ['Sign off the build plan', 'Ask for changes'],
    recommendation: 'Sign off: the order follows what reception asked for first.',
    minutesAgo: 95,
  },
  proposals: [],
};

const SUPPLIERS: DemoProject = {
  id: 'supplier-onboarding',
  name: 'Supplier Onboarding',
  about: 'A Mendix app for procurement to onboard new suppliers: documents, checks and approval.',
  shape: 'solo',
  entry: 'requirements-driven',
  stage: 'Stage 1 — Analysis',
  verdicts: [
    ['P', 'Kickoff', 'PASS', 'every intake question has an answer'],
    ['0', 'Triage', 'PASS', 'scope confirmed on 2026-10-02'],
    ['1', 'Analysis', 'PENDING', 'process map in progress'],
    ['2', 'Requirements', 'PENDING', ''],
    ['3', 'Architecture & Design', 'PENDING', ''],
    ['4', 'Build Plan', 'PENDING', ''],
    ['5', 'Build', 'PENDING', ''],
    ['6', 'Test', 'PENDING', ''],
  ],
  decisions: [['P', 'Requirements-driven build from the procurement handbook', 'CONFIRMED']],
  workers: [
    {
      name: 'Quill',
      role: 'solo-lead',
      model: 'sonnet',
      activity: 'Finished its turn',
      task: { name: 'Process map', summary: 'How a supplier is onboarded today.' },
      cost: 18.4,
      hoursAgo: 26,
      talk: [
        { user: 'Map how a supplier is onboarded today.' },
        { say: 'The current process is mapped in analysis/process-map.md; I will wait for the procurement interview notes before going on.' },
      ],
    },
  ],
  issues: [{ number: 4, title: 'Process map: onboarding today', labels: ['stage-1'], body: 'How a supplier is onboarded today.' }],
  pulls: [],
  commits: [
    [7, 'Kickoff: supplier onboarding'],
    [5, 'Stage 0: scope signed off'],
  ],
  days: [[11, 'P'], [16, '0'], [21, '1'], [8, '1']],
  total: 1200,
  paused: true,
  proposals: [],
};

export const PROJECTS = [TRAVEL, LOANS, VISITORS, SUPPLIERS];

// ---- Writing it ------------------------------------------------------------------------------------

const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const json = (file: string, v: unknown) => write(file, `${JSON.stringify(v, null, 2)}\n`);
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

function projectFiles(p: DemoProject, at: number): Record<string, string> {
  const rows = p.verdicts.map(([id, title, status, detail]) => `<tr><td>${id}</td><td>${title}</td><td><span class="${status}">${status}</span></td><td>${detail}</td></tr>`).join('\n');
  return {
    'README.md': `# ${p.name}\n\n${p.about}\n`,
    '.gitignore': '.agent-office/\n',
    'PROJECT.md': `# PROJECT.md\n\nEntry mode: ${p.entry}\nSize tier: standard\n\n## Current stage\n\n**${p.stage}**, in progress\n\n## Decisions\n\n| Stage | Decision | Status | Notes |\n|---|---|---|---|\n${p.decisions.map(([s, d, st]) => `| ${s} | ${d} | ${st} | |`).join('\n')}\n\n## Open questions\n`,
    'intake.md': `# Intake\n\n## 1. Entry mode\n\nAnswered (CONFIRMED): ${p.entry}\n\n## 2. What is this project, and what is driving it?\n\nAnswered (CONFIRMED): ${p.about}\n`,
    'index.html': `<!doctype html>\n<title>${p.name} · stages</title>\n<!-- gate-check, ${day(at)} -->\n<table>\n<tr><th>Stage</th><th>Title</th><th>Status</th><th>Detail</th></tr>\n${rows}\n</table>\n`,
  };
}

function gitInit(dir: string, p: DemoProject, at: number) {
  const files = projectFiles(p, at);
  const git = (env: Record<string, string>, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=agents@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: 'ignore', windowsHide: true });
  mkdirSync(dir, { recursive: true });
  git({}, 'init', '-q', '-b', 'main');
  p.commits.forEach(([daysAgo, subject], i) => {
    const when = new Date(at - daysAgo * DAY - (3 + i) * HOUR).toISOString();
    // The project's files arrive with the first commit; each later one leaves a line in the changelog.
    if (i === 0) for (const [f, text] of Object.entries(files)) write(path.join(dir, f), text);
    else write(path.join(dir, 'CHANGELOG.md'), `${p.commits.slice(1, i + 1).map(([, s]) => `- ${s}`).join('\n')}\n`);
    git({ GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }, 'add', '-A');
    git({ GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }, 'commit', '-qm', subject);
  });
}

function transcriptOf(g: Gen, sessionId: string, cwd: string, model: string, talk: Say[], end: number): string {
  const out: string[] = [];
  let parent: string | null = null;
  let t = end - talk.length * 3 * MIN;
  const line = (v: Record<string, unknown>) => {
    const uuid = g.uuid();
    out.push(JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId, version: '2.1.0', ...v, uuid, timestamp: new Date(t).toISOString() }));
    parent = uuid;
    t += 3 * MIN;
  };
  const usage = () => ({ input_tokens: 12, output_tokens: 420, cache_creation_input_tokens: 1800, cache_read_input_tokens: 42000 });
  for (const s of talk) {
    if ('user' in s) line({ type: 'user', message: { role: 'user', content: s.user } });
    else if ('say' in s) line({ type: 'assistant', message: { id: `msg_${g.hex(24)}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: s.say }], stop_reason: null, usage: usage() } });
    else {
      const id = `toolu_${g.hex(24)}`;
      line({ type: 'assistant', message: { id: `msg_${g.hex(24)}`, type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id, name: s.tool, input: s.input }], stop_reason: 'tool_use', usage: usage() } });
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: s.result ?? 'ok', is_error: false }] } });
    }
  }
  return `${out.join('\n')}\n`;
}

interface Placed {
  id: string;
  w: DemoWorker;
  sessionId: string;
  transcript: string;
  color: string;
}

function workersOf(g: Gen, p: DemoProject, dir: string, at: number): { saved: unknown[]; placed: Placed[] } {
  const placed: Placed[] = [];
  const saved = p.workers.map((w, i) => {
    const id = g.workerId();
    const sessionId = g.uuid();
    const model = MODEL_ID[w.model];
    const file = path.join(dir, '.agent-office', 'transcripts', `${sessionId}.jsonl`);
    const text = transcriptOf(g, sessionId, dir.replaceAll('\\', '/'), model, w.talk, at - w.hoursAgo * HOUR);
    write(file, text);
    const color = COLORS[i % COLORS.length];
    placed.push({ id, w, sessionId, transcript: file, color });
    const calls = Math.round(w.cost * 9);
    const seen = at - w.hoursAgo * HOUR;
    const role = w.role ? ROLE_BY_ID.get(w.role)! : undefined;
    return {
      id,
      kind: 'agent',
      provider: 'claude',
      model: w.model,
      effort: w.model === 'opus' ? 'high' : 'medium',
      deskId: `desk-${i + 1}`,
      name: w.name,
      color,
      createdBy: role ? 'the office (team)' : PERSON,
      createdAt: at - (8 + i) * DAY,
      prompt: role ? `You are ${w.name}, the team's ${role.title}. Read your Playbook and carry on with the project.` : `Work on GitHub issue #${w.issue} in this repo: read it with \`gh issue view ${w.issue}\` and follow it exactly.`,
      title: role ? `${w.name} (${role.title})` : `GitHub issue #${w.issue}`,
      ...(role ? { team: role.team } : {}),
      sessionId,
      activity: w.activity,
      task: w.task,
      ...(w.pr ? { pr: { number: w.pr, url: `https://github.com/${OWNER}/${p.id}/pull/${w.pr}` } } : {}),
      workedMs: Math.round(w.cost * 2.2) * MIN,
      tracker: {
        files: { [file]: { offset: Buffer.byteLength(text) } },
        transcript: file,
        since: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 },
        base: { input: calls * 400, output: calls * 300, cacheWrite: calls * 9000, cacheRead: calls * 50000, cost: w.cost, calls, at: seen },
        at: seen,
        model,
        parts: { [`|${model}`]: { cost: w.cost, calls } },
      },
      hookToken: g.hex(32),
      midTurn: !!w.live,
    };
  });
  return { saved, placed };
}

function queueOf(g: Gen, p: DemoProject, placed: Placed[], at: number): { maxWorkers: number; tasks: QueueTask[] } {
  const tasks: QueueTask[] = [];
  for (const i of p.issues.filter((x) => !x.closed && !p.workers.some((w) => w.issue === x.number) && !/^Decide/.test(x.title))) {
    tasks.push({ id: g.hex(12), provider: 'claude', model: 'sonnet', effort: 'medium', issue: i.number, title: `Issue #${i.number}: ${i.title}`, prompt: `Work on GitHub issue #${i.number} in this repo: read it with \`gh issue view ${i.number}\` and follow it exactly.`, addedBy: PERSON, addedAt: at - 3 * HOUR, status: 'queued' } as QueueTask);
  }
  for (const pl of placed.filter((x) => !x.w.role && x.w.issue)) {
    const pr = p.pulls.find((x) => x.number === pl.w.pr);
    tasks.push({ id: g.hex(12), provider: 'claude', model: pl.w.model, effort: 'medium', issue: pl.w.issue, title: `Issue #${pl.w.issue}: ${pl.w.task.name}`, prompt: '', addedBy: PERSON, addedAt: at - 30 * HOUR, status: 'done', attemptId: g.hex(8), workerId: pl.id, workerName: pl.w.name, branch: `feature/issue-${pl.w.issue}`, startedAt: at - 29 * HOUR, finishedAt: at - 21 * HOUR, outcome: 'done', ...(pr ? { pr: { number: pr.number, url: `https://github.com/${OWNER}/${p.id}/pull/${pr.number}`, state: pr.state, title: pr.title } } : {}) } as QueueTask);
  }
  return { maxWorkers: 0, tasks };
}

function rosterOf(g: Gen, p: DemoProject, placed: Placed[], at: number): RosterData {
  const settings = defaultSettings();
  // Jeff off: he'd ask a model about every turn. Standups by hand only.
  settings.jeff = { waiting: 'off', triage: 'off', priority: 'off', waitingPolicy: 'agree' };
  settings.autonomy = 3;
  const members = {} as Record<RoleId, MemberRecord>;
  const NAMES: Record<RoleId, string> = { pm: 'Ada', 'lead-designer': 'Hedy', 'lead-developer': 'Linus', 'lead-tester': 'Grace', 'chief-analyst': 'Radia', 'solo-lead': 'Niklaus' };
  for (const r of ROLES) {
    const pl = placed.find((x) => x.w.role === r.id);
    members[r.id] = pl ? { name: pl.w.name, model: pl.w.model, phase: 'active', workerId: pl.id, hiredAt: at - 8 * DAY } : { name: NAMES[r.id], model: r.model, phase: 'none' };
  }
  const who = (role: RoleId) => ({ workerId: members[role].workerId ?? g.workerId(), by: members[role].name, role, team: ROLE_BY_ID.get(role)!.team });
  const standups: Standup[] = [];
  const proposals: Proposal[] = [];
  if (p.standup) {
    const startedAt = at - 5 * HOUR;
    const date = day(startedAt);
    const leads = Object.keys(p.standup.done) as RoleId[];
    standups.push({
      id: date,
      date,
      startedAt,
      by: 'schedule',
      status: 'compiled',
      compiledAt: startedAt + 9 * MIN,
      waiting: [],
      reports: leads.map((role) => ({ role, name: members[role].name, source: 'live', heading: ROLE_BY_ID.get(role)!.title, done: p.standup!.done[role] ?? [], next: p.standup!.next[role] ?? [], blockers: [] })),
      proposalIds: [],
      page: `# Standup ${date}\n\n${leads.map((r) => `## ${members[r].name}\n\n- ${(p.standup!.done[r] ?? []).join('\n- ')}`).join('\n\n')}\n`,
      savedTo: `docs/standups/${date}.md`,
    });
  }
  for (const x of p.proposals) {
    const s = standups[0];
    const pr: Proposal = { id: g.hex(10), standup: s?.id ?? day(at), role: x.by, team: ROLE_BY_ID.get(x.by)!.team, by: members[x.by].name, kind: x.kind, title: x.title, detail: x.detail, status: x.status };
    if (x.status !== 'pending') Object.assign(pr, { decidedBy: PERSON, decidedAt: at - 4 * HOUR });
    s?.proposalIds.push(pr.id);
    proposals.push(pr);
  }
  const escalations: Escalation[] = [];
  if (p.escalation) {
    const e = p.escalation;
    escalations.push(makeEscalation({ urgency: 'important', trigger: 'milestone', title: e.title, details: e.details, options: e.options, recommendation: e.recommendation }, who(e.by), settings.autonomy, `esc-${g.hex(10)}`, at - e.minutesAgo * MIN));
  }
  const raw: RosterData = {
    settings,
    shape: p.shape,
    coverage: defaultCoverage(p.shape),
    members,
    standups,
    proposals,
    escalations,
    lastActivityAt: at - MIN,
    lastStandupAt: standups.at(-1)?.startedAt,
    harvested: {},
    spend: { day: '', usd: 0, seen: {} },
    subagents: {},
    subagentNames: {},
    subagentActions: [],
    subagentRuns: [],
    outbox: emptyOutbox(),
    held: [],
  };
  return reviveRoster(JSON.parse(JSON.stringify(raw)), g.rand);
}

function budgetOf(p: DemoProject, placed: Placed[], at: number): FloorFile {
  const n = p.days.length;
  const d = emptyLedger(at - (n + 1) * DAY);
  const agents: AgentInfo[] = placed.map((pl) => ({ key: pl.id, name: pl.w.name, role: pl.w.role ? ROLE_BY_ID.get(pl.w.role)!.title : 'Worker', kind: 'worker', provider: 'claude' }));
  const weights = placed.map((pl) => pl.w.cost);
  const sum = weights.reduce((a, b) => a + b, 0);
  p.days.forEach(([usd, stage], i) => {
    const date = day(at - (n - 1 - i) * DAY);
    if (!d.stages.length || d.stages.at(-1)!.stage !== stage) d.stages.push({ at: at - (n - 1 - i) * DAY, stage });
    placed.forEach((pl, k) => {
      const cost = Math.round(((usd * weights[k]) / sum) * 100) / 100;
      if (cost > 0) book(d, { day: date, agent: pl.id, model: MODEL_ID[pl.w.model], stage, ...(pl.w.issue ? { issue: pl.w.issue } : {}), cost, calls: Math.max(1, Math.round(cost * 9)) }, agents[k]);
    });
  });
  // What each agent's session had spent is booked already (in the days above): nothing new to book today.
  for (const pl of placed) {
    const calls = Math.round(pl.w.cost * 9);
    d.seen[pl.id] = { cost: pl.w.cost, calls, parts: { [`|${MODEL_ID[pl.w.model]}`]: { cost: pl.w.cost, calls } } };
  }
  prune(d, day(at));
  d.backfilled = true;
  const stages = [...new Set(p.days.map(([, s]) => s)), ...(['4', '5', '6'] as StageId[])].filter((s, i, a) => a.indexOf(s) === i);
  const plan: BudgetPlan = {
    lines: stages.map((stage) => ({ id: `stage-${stage}`, stage, label: `Stage ${stage}`, usd: Math.round(p.total / stages.length / 10) * 10, days: 4, basis: 'default' })),
    start: day(at - n * DAY),
    end: day(at + 30 * DAY),
    basis: 'standard tier, default rates',
    generatedAt: at - n * DAY,
  };
  return { ledger: d, settings: { total: p.total, autoPause: true, level: 'balanced', threshold: 80 }, plan, alerts: [] };
}

function ghData(root: string, p: DemoProject, at: number) {
  const iso = (h: number) => new Date(at - h * HOUR).toISOString();
  const issues = p.issues.map((i, k) => ({
    number: i.number,
    title: i.title,
    state: i.closed ? 'CLOSED' : 'OPEN',
    url: `https://github.com/${OWNER}/${p.id}/issues/${i.number}`,
    author: { login: 'alex-pm' },
    labels: i.labels.map((name) => ({ name, color: name === 'decision' ? 'd93f0b' : name.startsWith('stage') ? '0e8a16' : '1d76db' })),
    assignees: [],
    createdAt: iso(60 - k * 6),
    updatedAt: iso(10 - k),
    body: i.body,
    comments: [],
  }));
  const pulls = p.pulls.map((x, k) => ({
    number: x.number,
    title: x.title,
    state: x.state,
    isDraft: false,
    url: `https://github.com/${OWNER}/${p.id}/pull/${x.number}`,
    author: { login: `${x.by.toLowerCase()}-agent` },
    labels: [],
    reviewDecision: x.state === 'MERGED' ? 'APPROVED' : '',
    headRefName: x.branch,
    headRefOid: 'a'.repeat(40),
    baseRefName: 'main',
    createdAt: iso(30 - k * 5),
    updatedAt: iso(2 + k),
    ...(x.state === 'MERGED' ? { mergedAt: iso(20) } : {}),
    additions: x.additions,
    deletions: x.deletions,
    statusCheckRollup: [{ name: 'build', workflowName: 'CI', status: x.checks === 'pass' ? 'COMPLETED' : 'IN_PROGRESS', conclusion: x.checks === 'pass' ? 'SUCCESS' : '' }],
    body: x.closes ? `Closes #${x.closes}.` : '',
    closingIssuesReferences: x.closes ? [{ number: x.closes }] : [],
  }));
  json(path.join(root, `${p.id}.json`), { issues, pulls });
}

export interface Demo {
  root: string;
  officeDir: string;
  dataDir: string;
  github: string;
  agents: string;
  floors: { id: string; name: string; dir: string }[];
  mainFloor: string;
}

/** Writes the demo office under `out` for a screenshot taken at `at` (ms). */
export function generateDemo(out: string, at: number, seed = 7): Demo {
  const root = path.resolve(out);
  const g = new Gen(seed, at);
  const officeDir = path.join(root, 'office');
  const dataDir = path.join(officeDir, '.agent-office');
  const github = path.join(root, 'github');
  mkdirSync(dataDir, { recursive: true });
  const floors = PROJECTS.map((p) => ({ id: p.id, name: p.name, dir: path.join(officeDir, 'projects', p.id) }));
  json(
    path.join(dataDir, 'floors.json'),
    PROJECTS.map((p, i) => ({ id: p.id, name: p.name, repo: `${OWNER}/${p.id}`, dir: floors[i].dir, palette: i, addedBy: PERSON, addedAt: at - (24 - i * 5) * DAY })),
  );
  const pauses = Object.fromEntries(PROJECTS.filter((p) => p.paused).map((p) => [p.id, { by: PERSON, at: at - 20 * HOUR, why: 'person', waiting: [] }]));
  json(path.join(dataDir, 'project-run.json'), { pauses, pacing: {} });
  const office: OfficeFile = { fx: { ...DEFAULT_FX }, threshold: 80, ledger: emptyLedger(at - 30 * DAY) };
  json(path.join(dataDir, 'budget', 'office.json'), office);
  const agents: Record<string, { transcript: string; tool: string; input: Record<string, unknown> }> = {};
  PROJECTS.forEach((p, i) => {
    const dir = floors[i].dir;
    gitInit(dir, p, at);
    const { saved, placed } = workersOf(g, p, dir, at);
    json(path.join(dir, '.agent-office', 'workers.json'), saved);
    json(path.join(dir, '.agent-office', 'queue.json'), queueOf(g, p, placed, at));
    json(path.join(dataDir, 'roster', `${p.id}.json`), rosterOf(g, p, placed, at));
    write(path.join(dataDir, 'budget', `${p.id}.json`), JSON.stringify(budgetOf(p, placed, at)));
    for (const pl of placed) if (pl.w.live) agents[pl.id] = { transcript: pl.transcript, ...pl.w.live };
    ghData(github, p, at);
  });
  const agentsFile = path.join(root, 'demo-agents.json');
  json(agentsFile, agents);
  return { root, officeDir, dataDir, github, agents: agentsFile, floors, mainFloor: TRAVEL.id };
}

export { PM_NAME };

// The command line.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const out = arg('out');
  const at = Number(arg('at'));
  if (!out || !Number.isFinite(at)) {
    console.error('usage: node --import tsx scripts/docs/demo.ts --out <dir> --at <ms>');
    process.exit(2);
  }
  if (!/(^|[\\/])test-office/i.test(path.resolve(out))) {
    console.error(`refused: ${out} is not a test-office… folder`);
    process.exit(2);
  }
  console.log(JSON.stringify(generateDemo(out, at)));
}
