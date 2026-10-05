// The Firm (see docs/firm.md): an office-level team of Reviewer Agents, separate from every
// project's team. They audit a project from outside, with no shared context and no instructions of
// the project's own. The roles, who each one is attached to on a project team, what each checks and
// produces, and the models they may run on are data here, so the server, the prompts and the
// /firm page all read the same table. Pure: the browser imports it too.

import type { RoleId, TeamId } from '../roster/roles.js';

export type ReviewerId = 'partner' | 'design' | 'code' | 'qa' | 'requirements' | 'security' | 'cost';

/** A model a reviewer can run on: a full model id, so the price table and the badge are exact. */
export interface FirmModel {
  id: string;
  label: string;
  /** The alias Claude Code knows it by (the office's own model picker uses these). */
  alias: 'fable' | 'opus' | 'sonnet';
}

export const FIRM_MODELS: readonly FirmModel[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1', alias: 'fable' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', alias: 'opus' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', alias: 'sonnet' },
];
/** Best-in-class reviewing, and not cheap: every reviewer starts on it until the PM picks another. */
export const DEFAULT_FIRM_MODEL = 'claude-fable-5-1';
export const isFirmModel = (v: unknown): v is string => typeof v === 'string' && FIRM_MODELS.some((m) => m.id === v || m.alias === v);
/** A model id from an id or an alias; the default for anything else. */
export const firmModelId = (v: unknown): string => FIRM_MODELS.find((m) => m.id === v || m.alias === v)?.id ?? DEFAULT_FIRM_MODEL;
export const firmModelLabel = (id: string): string => FIRM_MODELS.find((m) => m.id === id || m.alias === id)?.label ?? id;

export interface ReviewerSkill {
  /** What it's called on the reviewer's card. */
  name: string;
  /** What it checks, in a line. */
  checks: string;
}

export interface ReviewerRole {
  id: ReviewerId;
  title: string;
  icon: string;
  /** The fixed professional name a fresh Firm starts with (the PM can't rename them: they're the Firm's). */
  name: string;
  /** The project team it's attached to, and the role there it interviews. The Partner talks to the Project Coordinator. */
  team: TeamId;
  interviews: RoleId;
  /** Always on an engagement (the Partner), on by default, or only when the PM adds it. */
  staffing: 'always' | 'default' | 'optional';
  mission: string;
  skills: ReviewerSkill[];
  /** The tools it reaches for (in its own read-only checkout). */
  tools: string[];
  /** What it leaves in its engagement folder, beside its section of the report. */
  produces: string[];
  /** Its portrait's palette: suit, tie, hair, skin (client/firm/portraits.ts). */
  look: { suit: string; tie: string; hair: string; skin: string; glasses?: boolean };
}

export const REVIEWERS: readonly ReviewerRole[] = [
  {
    id: 'partner',
    title: 'Engagement Partner',
    icon: '🎩',
    name: 'Eleanor Vance',
    team: 'management',
    interviews: 'pm',
    staffing: 'always',
    mission: 'Leads the audit and owns the final report: interviews the Project Coordinator, reads every specialist\'s section, consolidates them into one honest report for the Project Manager, with the executive summary, the re-forecast timeline and the prioritised recommendations.',
    skills: [
      { name: 'Engagement leadership', checks: 'Scope, plan vs reality, what the team promised and delivered' },
      { name: 'Executive synthesis', checks: 'One page the Project Manager can act on: verdict, top risks, next moves' },
      { name: 'Re-forecasting', checks: 'Milestones from build-plan.json / toolkit stages vs evidence, with confidence' },
      { name: 'Root cause analysis', checks: '5-whys / causal chains for the top problems across teams' },
    ],
    tools: ['Read', 'Grep', 'git log', 'office-workers firm evidence', 'office-workers firm ask'],
    produces: ['Executive summary', 'Detailed report', 'Project timeline after review', 'Expectations vs reality'],
    look: { suit: '#1d2a44', tie: '#c9a14a', hair: '#d9d4cc', skin: '#f1c9a5', glasses: true },
  },
  {
    id: 'design',
    title: 'Design Reviewer',
    icon: '🖋️',
    name: 'Julian Hale',
    team: 'design',
    interviews: 'lead-designer',
    staffing: 'default',
    mission: 'Reviews the look and the flow of every page against the Atlas design system and the wireframes, and how the Lead Designer\'s team decides and documents design.',
    skills: [
      { name: 'Design-system conformance', checks: 'Atlas classes, spacing, branding, no CSS that never applies' },
      { name: 'Flow & usability', checks: 'Journeys vs wireframes, dead ends, empty states' },
      { name: 'Accessibility', checks: 'Contrast, labels, keyboard paths (axe-style checks on the live app)' },
    ],
    tools: ['Read', 'Grep', 'mxcli (read-only)', 'Playwright against the live app'],
    produces: ['Screenshots', 'Design findings', 'Accessibility notes'],
    look: { suit: '#3b2f4a', tie: '#c9a14a', hair: '#2b1d14', skin: '#e0ac85' },
  },
  {
    id: 'code',
    title: 'Code & Architecture Reviewer',
    icon: '🏛️',
    name: 'Marcus Reed',
    team: 'development',
    interviews: 'lead-developer',
    staffing: 'default',
    mission: 'Reviews the app\'s structure and code: modules, domain model, microflows, layering, error handling and the way the Lead Developer\'s team builds and merges.',
    skills: [
      { name: 'Architecture & layering', checks: 'Module boundaries, domain model, dependencies, the blueprint vs the app' },
      { name: 'Code quality', checks: 'mxcli check / lint, duplication, dead code, error handling' },
      { name: 'Delivery hygiene', checks: 'PR size, review depth, rework, merge cadence' },
    ],
    tools: ['Read', 'Grep', 'git log / blame', 'mxcli check', 'mxcli lint'],
    produces: ['Findings register (code)', 'Architecture notes', 'Lint results'],
    look: { suit: '#22313f', tie: '#9b2c2c', hair: '#14110f', skin: '#8d5a3b' },
  },
  {
    id: 'qa',
    title: 'QA & Test Reviewer',
    icon: '🔬',
    name: 'Priya Natarajan',
    team: 'testing',
    interviews: 'lead-tester',
    staffing: 'default',
    mission: 'Tests the app with no bias: runs the existing tests, writes and runs its own (unit and Playwright e2e against the live app), and judges whether the test framework would catch what matters.',
    skills: [
      { name: 'Test strategy', checks: 'What is tested vs what matters, coverage gaps, flaky tests' },
      { name: 'Independent testing', checks: 'Its own test plan and cases, run against the app' },
      { name: 'Result audit', checks: 'Whether reported passes are real (tool output is not ground truth)' },
    ],
    tools: ['Read', 'Grep', 'the repo\'s test runner', 'Playwright + Chromium', 'mxcli'],
    produces: ['Test plan', 'Test cases', 'Test results', 'Screenshots'],
    look: { suit: '#1f3b3a', tie: '#c9a14a', hair: '#1b1210', skin: '#c68a62', glasses: true },
  },
  {
    id: 'requirements',
    title: 'Requirements & Delivery Reviewer',
    icon: '📐',
    name: 'Thomas Albright',
    team: 'analysis',
    interviews: 'chief-analyst',
    staffing: 'default',
    mission: 'Traces the requirements (BRD, module briefs, PROJECT.md decisions) to what was built and tested, and judges scope, plan and delivery against expectations.',
    skills: [
      { name: 'Requirements traceability', checks: 'BRD → issues → PRs → tests, gaps both ways' },
      { name: 'Scope & plan', checks: 'build-plan.json and toolkit stages vs what shipped' },
      { name: 'Decision register', checks: 'PROJECT.md decisions: made, followed, reversed' },
    ],
    tools: ['Read', 'Grep', 'office-workers firm evidence github', 'git log'],
    produces: ['Traceability matrix', 'Scope findings', 'Expectations vs reality input'],
    look: { suit: '#2e2a24', tie: '#2f5d7c', hair: '#8a6a45', skin: '#f0c8a8' },
  },
  {
    id: 'security',
    title: 'Security Reviewer',
    icon: '🛡️',
    name: 'Nadia Kerr',
    team: 'development',
    interviews: 'lead-developer',
    staffing: 'optional',
    mission: 'Reviews access rules, entity security, secrets handling and the integration surface for anything an attacker or an auditor would find first.',
    skills: [
      { name: 'Access & entity security', checks: 'Module roles, entity access, page/microflow access' },
      { name: 'Secrets & config', checks: 'Keys in the repo, constants, environment handling' },
      { name: 'Integration surface', checks: 'REST/OData exposure, input validation' },
    ],
    tools: ['Read', 'Grep', 'mxcli', 'secret scan (grep)'],
    produces: ['Security findings', 'Security scan output'],
    look: { suit: '#111827', tie: '#6b7280', hair: '#3a2418', skin: '#e8b892' },
  },
  {
    id: 'cost',
    title: 'Cost & Performance Reviewer',
    icon: '⚖️',
    name: 'Oliver Grant',
    team: 'management',
    interviews: 'pm',
    staffing: 'optional',
    mission: 'Judges how the workers actually performed: output per dollar, idle time, rework, escalation dodging — "is someone slacking?" — from the office\'s ranking, spend and activity, with evidence.',
    skills: [
      { name: 'Worker performance', checks: 'Per worker/role: output, merged work, rework, grades from the ranking' },
      { name: 'Spend analysis', checks: 'Token spend vs output, cost caps, expensive dead ends' },
      { name: '"Is someone slacking?"', checks: 'Idle time, low output per $, dodged escalations, with evidence' },
    ],
    tools: ['office-workers firm evidence ranking', 'office-workers firm evidence roster', 'Read'],
    produces: ['Worker performance table', 'Spend analysis'],
    look: { suit: '#2a2f3a', tie: '#c9a14a', hair: '#b9b2a8', skin: '#d9a07a' },
  },
];

export const REVIEWER_BY_ID: ReadonlyMap<ReviewerId, ReviewerRole> = new Map(REVIEWERS.map((r) => [r.id, r]));
export const isReviewerId = (v: unknown): v is ReviewerId => typeof v === 'string' && REVIEWER_BY_ID.has(v as ReviewerId);
/** The specialists attached to a project team, by team: the Partner always comes too. */
export const reviewersFor = (teams: readonly TeamId[]): ReviewerId[] => REVIEWERS.filter((r) => r.staffing === 'default' && teams.includes(r.team)).map((r) => r.id);
