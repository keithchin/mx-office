// The new-project setup's progress, as the wizard shows it: the fourteen technical steps (wizard.ts
// SETUP_STEPS) in five friendly groups that tick in order (Repository, Mendix app, Toolkit & gates, Save &
// publish, Team), each with a status rolled up from its steps and each step with the line it shows (a
// skipped step's real reason, a failed one's error). Pure code with no DOM or Node imports, so the page
// draws it and the tests check it (tests/setup-groups.test.ts).

import { SETUP_STEPS, type JobView, type ProjectPlan, type StepId, type StepStatus, type StepView } from './wizard.js';

export const SETUP_GROUP_IDS = ['repository', 'app', 'toolkit', 'save', 'team'] as const;
export type SetupGroupId = (typeof SETUP_GROUP_IDS)[number];

/** Which steps each group runs, in the order the setup runs them. Every step is in exactly one group. */
export const SETUP_GROUP_STEPS: Readonly<Record<SetupGroupId, readonly StepId[]>> = {
  repository: ['repo', 'clone'],
  app: ['env', 'app'],
  toolkit: ['init', 'hooks', 'intake', 'decisions', 'gates'],
  save: ['settings', 'commit', 'issue'],
  team: ['team', 'queue'],
};

const NAMES: Record<SetupGroupId, string> = { repository: 'Repository', app: 'Mendix app', toolkit: 'Toolkit & gates', save: 'Save & publish', team: 'Team' };

/** What a group does, in a sentence, for this plan. */
function sayOf(id: SetupGroupId, plan: Pick<ProjectPlan, 'kind' | 'mendix'>): string {
  switch (id) {
    case 'repository':
      return plan.kind === 'change' ? 'Use the existing repository and clone it here.' : 'Create the project’s repository and clone it here.';
    case 'app':
      return plan.kind === 'change' ? 'Write the toolkit settings and find the existing Mendix app.' : `Write the toolkit settings and create the app with Mendix ${plan.mendix}.`;
    case 'toolkit':
      return 'Set up the delivery toolkit and record what you decided.';
    case 'save':
      return 'Save the settings, push the first commit and open the Discovery issue.';
    case 'team':
      return 'Hire the project team and give it the first task.';
  }
}

/** A group's status: `failed` and `running` from any of its steps, `done` once every step is done or skipped. */
export type GroupStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * A group's status from its steps': any failed is failed; any running is running; all done or skipped is
 * done. Some finished and the rest still to come is running while the setup runs (between two steps), and
 * pending when it doesn't (a setup that stopped elsewhere, or was edited and waits for Retry).
 */
export function groupStatus(steps: readonly StepStatus[], jobRunning = false): GroupStatus {
  if (steps.some((s) => s === 'failed')) return 'failed';
  if (steps.some((s) => s === 'running')) return 'running';
  if (steps.length && steps.every((s) => s === 'done' || s === 'skipped')) return 'done';
  if (jobRunning && steps.some((s) => s === 'done' || s === 'skipped')) return 'running';
  return 'pending';
}

/**
 * A failed step's error in plainer words: a command named by its full path ("C:\…\modeler\mx.exe
 * create-project failed (exit 1): …") is named by its file ("mx.exe create-project failed …"); the
 * rest is the step's own words, which the full log still has in full.
 */
export function plainError(detail: string): string {
  return detail.trim().replace(/^(?:[A-Za-z]:[\\/]|\/)[^\s:]*[\\/]([^\\/\s]+)(?=\s)/, '$1');
}

/** The line under a step: a skipped step's reason ("skipped: offline test office: nobody is hired"), what a done or failed one said. */
export function stepNote(s: Pick<StepView, 'status' | 'detail'>): string | undefined {
  const d = s.detail?.trim();
  if (s.status === 'skipped') return d ? `skipped: ${d}` : 'skipped';
  if (s.status === 'pending') return undefined;
  if (s.status === 'failed' && d) return plainError(d);
  return d || undefined;
}

/** The failed step's headline, in plain words: "Couldn’t create the Mendix app (.mpr)." */
export function failHeadline(label: string): string {
  const l = label.trim().replace(/\.$/, '');
  return `Couldn’t ${l.charAt(0).toLowerCase()}${l.slice(1)}.`;
}

export interface SetupGroupView {
  id: SetupGroupId;
  name: string;
  /** What it does, in a sentence. */
  say: string;
  status: GroupStatus;
  steps: (StepView & { note?: string })[];
  /** How many of its steps were skipped (shown beside a done group, never hidden as done). */
  skipped: number;
  /** The step that failed, when the group did. */
  failed?: StepView;
  /** What a screen reader hears: "Mendix app: in progress". */
  announce: string;
}

const SAID: Record<GroupStatus, string> = { pending: 'waiting', running: 'in progress', done: 'done', failed: 'failed' };

/** The job's steps in their five groups, each with its status and its steps' lines. */
export function setupGroups(job: Pick<JobView, 'steps' | 'status'> & { plan: Pick<ProjectPlan, 'kind' | 'mendix'> }): SetupGroupView[] {
  const byId = new Map(job.steps.map((s) => [s.id, s]));
  // The groups tick in order: one that's only part done while an earlier group still has a step to go
  // (Save & publish's settings run before Toolkit & gates' gates) waits rather than spinning beside it.
  let earlierDone = true;
  return SETUP_GROUP_IDS.map((id) => {
    const steps = SETUP_GROUP_STEPS[id].map((sid) => {
      const s = byId.get(sid) ?? { id: sid, label: SETUP_STEPS.find((x) => x.id === sid)!.label, status: 'pending' as StepStatus };
      return { ...s, note: stepNote(s) };
    });
    const status = groupStatus(
      steps.map((s) => s.status),
      job.status === 'running' && earlierDone,
    );
    earlierDone &&= status === 'done';
    const skipped = steps.filter((s) => s.status === 'skipped').length;
    const failed = steps.find((s) => s.status === 'failed');
    const extra = status === 'done' && skipped ? `, ${skipped} skipped` : status === 'failed' && failed ? `: ${failed.label}` : '';
    return { id, name: NAMES[id], say: sayOf(id, job.plan), status, steps, skipped, failed, announce: `${NAMES[id]}: ${SAID[status]}${extra}` };
  });
}

/** The group a step is in, by its id or its label (an unfinished setup's card names the step by its label). */
export function groupNameOf(step: string): string | undefined {
  const s = SETUP_STEPS.find((x) => x.id === step || x.label === step);
  const g = s && SETUP_GROUP_IDS.find((id) => SETUP_GROUP_STEPS[id].includes(s.id));
  return g ? NAMES[g] : undefined;
}

/** The group the page opens by itself: the failed one, else the running one. */
export function openGroup(groups: readonly SetupGroupView[]): SetupGroupId | undefined {
  return (groups.find((g) => g.status === 'failed') ?? groups.find((g) => g.status === 'running'))?.id;
}
