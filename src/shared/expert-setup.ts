// Expert mode's New project wizard (docs/site/using-the-office/expert-mode.md): the thin form a person fills in
// (ExpertForm), what it adds to the setup's plan (ProjectPlan.mode and .expert, run by server/wizard/expert-step.ts),
// the form's checks, and the setup's progress in the Expert wizard's own words. Pure code with no DOM or Node
// imports, so the page and the office use the same rules and the tests run them.

import { cleanProjectId } from './team-server.js';
import { slugProblem, slugify, type JobView, type ProjectPlan, type StepId, type StepStatus } from './wizard.js';
import { groupStatus, stepNote, type SetupGroupView } from './setup-groups.js';

/** The models an Expert session can start on: Sonnet by default, Opus one switch away. */
export const EXPERT_MODELS = ['sonnet', 'opus'] as const;
export type ExpertModel = (typeof EXPERT_MODELS)[number];
export const DEFAULT_EXPERT_MODEL: ExpertModel = 'sonnet';
/** The Mendix version a new Expert project starts on when the office has it. */
export const DEFAULT_EXPERT_MENDIX = '11.12.4';
/** A pin left at the default: the newest toolkit commit / the office's mxcli release, worked out when the setup runs. */
export const LATEST = 'latest';
/** The brief is one paragraph: at most this many characters. */
export const EXPERT_BRIEF_MAX = 1500;
/** Where the brief goes in the project, for the session to read (the office never types it into the session). */
export const EXPERT_BRIEF_FILE = 'docs/project-brief.md';
export const MAX_BUDGET_USD = 100_000;

/** What the Expert wizard sends (POST /api/expert/create). */
export interface ExpertForm {
  /** What the person typed ("Order Desk"); the folder and repository use its slug. */
  name: string;
  mendix: string;
  /** Create the app on Team Server, or connect an app already in the Mendix Portal (its App ID). */
  app: 'create' | 'connect';
  appId?: string;
  /** 'latest' or a toolkit commit (7–40 hex). */
  toolkit: string;
  /** 'latest' or an mxcli version (v0.21.0). */
  mxcli: string;
  /** Demo users while building locally (they block Deploy, nothing else). */
  demoUsers: boolean;
  /** The budget's total in USD; the session pauses at 100 %. */
  budget: number;
  model: ExpertModel;
  /** Optional, one paragraph. */
  brief?: string;
}

/** What an Expert project's plan carries besides the setup's usual fields (ProjectPlan.expert). */
export interface ExpertPlan {
  model: ExpertModel;
  toolkit: string;
  mxcli: string;
  demoUsers: boolean;
  budget: number;
  brief: string;
  /** The name as typed, for the project's own title. */
  title: string;
}

/** What the wizard offers for the pins (GET /api/expert/setup-info): read from the office, never from the network. */
export interface ExpertSetupInfo {
  toolkit: { latest?: { sha: string; date?: string }; recent: { sha: string; date?: string; subject?: string }[] };
  mxcli: { latest?: string; versions: string[] };
}

export const DEFAULT_BUDGET_USD = 800;

export function blankExpertForm(mendixVersions: readonly string[], fallback: string): ExpertForm {
  return {
    name: '',
    mendix: mendixVersions.includes(DEFAULT_EXPERT_MENDIX) ? DEFAULT_EXPERT_MENDIX : fallback,
    app: 'create',
    toolkit: LATEST,
    mxcli: LATEST,
    demoUsers: true,
    budget: DEFAULT_BUDGET_USD,
    model: DEFAULT_EXPERT_MODEL,
    brief: '',
  };
}

const SHA = /^[0-9a-f]{7,40}$/i;
const MXCLI_VERSION = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const isExpertModel = (v: unknown): v is ExpertModel => (EXPERT_MODELS as readonly unknown[]).includes(v);
export const cleanPin = (v: unknown, kind: 'toolkit' | 'mxcli'): string | undefined => {
  if (v === undefined || v === '' || v === LATEST) return LATEST;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return (kind === 'toolkit' ? SHA : MXCLI_VERSION).test(s) ? (kind === 'toolkit' ? s.toLowerCase() : s) : undefined;
};

/** The first thing wrong with the form, in the words the page shows; undefined when it can be created. */
export function expertFormProblem(f: ExpertForm, versions: readonly string[]): string | undefined {
  const slug = slugify(f.name ?? '');
  if (!f.name?.trim()) return 'Give the project a name';
  const bad = slugProblem(slug);
  if (bad) return `Project name: ${bad}`;
  if (!versions.includes(f.mendix)) return `Studio Pro ${f.mendix || '(none)'} isn't installed on the office's machine`;
  if (f.app !== 'create' && f.app !== 'connect') return 'Create the app on Team Server, or connect an existing one';
  if (f.app === 'connect' && !cleanProjectId(f.appId)) return 'Paste the App ID of the existing app (the Portal: the app’s Settings › General › App ID)';
  if (!cleanPin(f.toolkit, 'toolkit')) return 'Pick a toolkit version';
  if (!cleanPin(f.mxcli, 'mxcli')) return 'Pick an mxcli version';
  if (!(Number(f.budget) > 0)) return 'Set a budget above $0';
  if (Number(f.budget) > MAX_BUDGET_USD) return `At most $${MAX_BUDGET_USD.toLocaleString('en-US')}`;
  if (!isExpertModel(f.model)) return 'Pick Sonnet or Opus';
  if ((f.brief ?? '').length > EXPERT_BRIEF_MAX) return `Keep the brief to one paragraph (at most ${EXPERT_BRIEF_MAX} characters)`;
  return undefined;
}

/** The brief as one paragraph: line breaks folded, trimmed, cut to the limit. */
export const oneParagraph = (text: unknown): string =>
  typeof text === 'string'
    ? text
        .replace(/\r/g, '')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, EXPERT_BRIEF_MAX)
    : '';

/** ProjectPlan.expert from a saved plan or a request: cleaned, or undefined when it isn't one. */
export function cleanExpertPlan(v: unknown): ExpertPlan | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const toolkit = cleanPin(r.toolkit, 'toolkit');
  const mxcli = cleanPin(r.mxcli, 'mxcli');
  const budget = Math.round(Number(r.budget) * 100) / 100;
  if (!toolkit || !mxcli || !(budget > 0 && budget <= MAX_BUDGET_USD)) return undefined;
  return {
    model: isExpertModel(r.model) ? r.model : DEFAULT_EXPERT_MODEL,
    toolkit,
    mxcli,
    demoUsers: r.demoUsers !== false,
    budget,
    brief: oneParagraph(r.brief),
    title: typeof r.title === 'string' ? r.title.replace(/\s+/g, ' ').trim().slice(0, 100) : '',
  };
}

/** The plan's Expert fields, cleaned (plan.ts keeps them): a plan without `mode: 'expert'` has none. */
export function cleanExpertFields(r: Record<string, unknown>): Pick<ProjectPlan, 'mode' | 'expert'> {
  if (r.mode !== 'expert') return {};
  const expert = cleanExpertPlan(r.expert);
  return expert ? { mode: 'expert', expert } : {};
}

export const isExpertPlan = (plan: Pick<ProjectPlan, 'mode'> | undefined): boolean => plan?.mode === 'expert';

// ---- The setup's progress, in the Expert wizard's words -------------------------------------------------

/** The Expert setup's steps in five groups (the same group ids as the Team setup's, so the progress view draws them). */
const EXPERT_GROUPS: { id: SetupGroupView['id']; name: string; steps: StepId[]; say: (p: Pick<ProjectPlan, 'mendix' | 'teamServer'>) => string }[] = [
  { id: 'repository', name: 'Team Server app', steps: ['repo', 'clone'], say: (p) => (p.teamServer?.projectId ? 'Connect the existing app on Team Server and clone it here.' : p.teamServer ? 'Create the app on Team Server and clone it here.' : 'Make the project’s repository and clone it here (a test office has no Team Server).') },
  { id: 'app', name: 'Mendix app', steps: ['env', 'app'], say: (p) => `Write the toolkit settings and create the app with Mendix ${p.mendix}.` },
  { id: 'toolkit', name: 'Toolkit and mxcli', steps: ['init', 'hooks', 'intake', 'decisions', 'gates'], say: () => 'Install the toolkit and mxcli at their pins, and save your brief.' },
  { id: 'save', name: 'Settings and first push', steps: ['settings', 'commit', 'issue'], say: () => 'Save the model, budget and demo-user choice, then commit and push to Team Server.' },
  { id: 'team', name: 'Session', steps: ['team', 'queue'], say: () => 'Get the session ready in the project folder. No team is hired.' },
];

/** The steps' labels in Expert words (the Team setup's speak of GitHub, intake answers and hiring). */
function labelOf(id: StepId, p: Pick<ProjectPlan, 'teamServer'>): string | undefined {
  const words: Partial<Record<StepId, string>> = {
    repo: p.teamServer?.projectId ? 'Connect the app on Team Server' : p.teamServer ? 'Create the app on Team Server' : 'Make the project’s repository',
    clone: 'Clone it here',
    env: 'Write .claude/toolkit.env (mxcli pin)',
    app: 'Create the Mendix app (.mpr)',
    init: 'Install the toolkit at its pin',
    hooks: 'Install the pre-commit hook',
    intake: 'Save the brief',
    decisions: 'Decisions',
    gates: 'Gates',
    settings: 'Save the model, budget and demo users',
    commit: p.teamServer ? 'Commit and push to Team Server' : 'Commit and push',
    issue: 'Discovery issue',
    team: 'Get the session ready',
    queue: 'First task',
  };
  return words[id];
}

const SAID = { pending: 'waiting', running: 'in progress', done: 'done', failed: 'failed' } as const;

/** An Expert job's steps in its five groups (setup-groups.ts's shape), for the progress view. */
export function expertSetupGroups(job: Pick<JobView, 'steps' | 'status'> & { plan: Pick<ProjectPlan, 'mendix' | 'teamServer'> }): SetupGroupView[] {
  const byId = new Map(job.steps.map((s) => [s.id, s]));
  let earlierDone = true;
  return EXPERT_GROUPS.map((g) => {
    const steps = g.steps.map((sid) => {
      const s = byId.get(sid) ?? { id: sid, label: sid, status: 'pending' as StepStatus };
      return { ...s, label: labelOf(sid, job.plan) ?? s.label, note: stepNote(s) };
    });
    const status = groupStatus(
      steps.map((s) => s.status),
      job.status === 'running' && earlierDone,
    );
    earlierDone &&= status === 'done';
    const skipped = steps.filter((s) => s.status === 'skipped').length;
    const failed = steps.find((s) => s.status === 'failed');
    const extra = status === 'failed' && failed ? `: ${failed.label}` : '';
    return { id: g.id, name: g.name, say: g.say(job.plan), status, steps, skipped, failed, announce: `${g.name}: ${SAID[status]}${extra}` };
  });
}
