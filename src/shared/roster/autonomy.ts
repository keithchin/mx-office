// How much a floor's team may decide without the CTO: four levels, from the CTO approving every task
// to the CTO approving only client-facing milestones and the budget. One table says what needs the
// CTO at each level, so the Playbooks, the prompts, the standup and the approvals queue can't disagree.
// The CTO always has the final say: a level only decides what is *asked*, never what the CTO may veto.

export type AutonomyLevel = 1 | 2 | 3 | 4;
export const DEFAULT_AUTONOMY: AutonomyLevel = 2;

/** What a Lead might want to do that could need the CTO. */
export type DecisionKind = 'task' | 'scope' | 'design' | 'architecture' | 'peer-review' | 'merge' | 'milestone' | 'client-milestone' | 'budget';
export const DECISION_KINDS: readonly DecisionKind[] = ['task', 'scope', 'design', 'architecture', 'peer-review', 'merge', 'milestone', 'client-milestone', 'budget'];
export const isDecisionKind = (v: unknown): v is DecisionKind => typeof v === 'string' && (DECISION_KINDS as readonly string[]).includes(v);

export const DECISION_LABEL: Record<DecisionKind, string> = {
  task: 'a task within the approved scope',
  scope: 'a task outside the approved scope',
  design: 'a design change',
  architecture: 'an architecture change',
  'peer-review': "approving another team's work",
  merge: 'merging a pull request',
  milestone: 'closing a milestone',
  'client-milestone': 'a client-facing milestone',
  budget: 'spending past the budget',
};

export interface AutonomyDef {
  level: AutonomyLevel;
  name: string;
  /** One line for the settings and the Playbooks. */
  summary: string;
  /** What needs the CTO at this level. */
  cto: readonly DecisionKind[];
}

export const AUTONOMY: Record<AutonomyLevel, AutonomyDef> = {
  1: { level: 1, name: 'Directive', summary: 'Leads only propose; the CTO approves every task.', cto: DECISION_KINDS },
  2: { level: 2, name: 'Guided', summary: 'Leads may create tasks within the approved scope; the CTO approves design and architecture changes and merges.', cto: ['scope', 'design', 'architecture', 'peer-review', 'merge', 'milestone', 'client-milestone', 'budget'] },
  3: { level: 3, name: 'Delegated', summary: "Leads may approve each other's work within budget; the CTO approves milestones and merges.", cto: ['merge', 'milestone', 'client-milestone', 'budget'] },
  4: { level: 4, name: 'Autonomous', summary: 'The CTO approves only client-facing milestones and the budget.', cto: ['client-milestone', 'budget'] },
};

export const isAutonomyLevel = (v: unknown): v is AutonomyLevel => v === 1 || v === 2 || v === 3 || v === 4;

/** Whether `kind` has to wait for the CTO at `level`. */
export function needsCto(level: AutonomyLevel, kind: DecisionKind): boolean {
  return AUTONOMY[level].cto.includes(kind);
}

/** What the team may decide itself at `level`: the kinds that don't need the CTO. */
export function teamMayDecide(level: AutonomyLevel): DecisionKind[] {
  return DECISION_KINDS.filter((k) => !needsCto(level, k));
}

/** The paragraph every Playbook and prompt carries, so a Lead always knows where the line is. */
export function autonomyBrief(level: AutonomyLevel): string {
  const a = AUTONOMY[level];
  const may = teamMayDecide(level).map((k) => DECISION_LABEL[k]);
  return [
    `Autonomy level ${level} (${a.name}): ${a.summary}`,
    `Needs the CTO's approval: ${a.cto.map((k) => DECISION_LABEL[k]).join('; ')}.`,
    may.length ? `You may decide without asking: ${may.join('; ')}.` : 'You may decide nothing on your own: propose everything.',
    'Anything that needs the CTO goes under "### Proposals" in your team journal (it reaches the CTO at the next standup); never act on it before it is approved. The CTO always has the final say.',
  ].join('\n');
}

/**
 * The floor's daily cost cap at `level`, from the per-level setting (dollars; missing or 0 = off):
 * the CTO can give a more autonomous team a tighter, or looser, leash.
 */
export function capAt(caps: Partial<Record<AutonomyLevel, number>> | undefined, level: AutonomyLevel): number | undefined {
  const v = caps?.[level];
  return typeof v === 'number' && v > 0 ? v : undefined;
}
