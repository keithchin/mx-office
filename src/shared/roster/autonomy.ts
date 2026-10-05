// How much a floor's team may decide without the Project Manager (the human who owns the project):
// four levels, from the Project Manager approving every task to approving only client-facing
// milestones and the budget. One table says what needs the Project Manager at each level, and a second
// one (REVIEW_POLICY) when a Lead escalates the outcome of reviewing a subagent's work, so the
// Playbooks, the prompts, the standup, the approvals queue and the escalation channel can't disagree.
// The Project Manager always has the final say: a level only decides what is *asked*, never what
// they may veto. Pure: the browser imports it too.

export type AutonomyLevel = 1 | 2 | 3 | 4;
export const DEFAULT_AUTONOMY: AutonomyLevel = 2;

/** Who the human is, in every agent-facing text: one phrase, so no prompt calls them anything else. */
export const HUMAN = 'the Project Manager';
/** The same, spelled out where an agent could mistake the human for the Project Coordinator agent. */
export const HUMAN_FULL = 'the Project Manager (the human who owns the project)';

/** What a Lead might want to do that could need the Project Manager. */
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
  /** What needs the Project Manager's approval at this level. */
  approves: readonly DecisionKind[];
}

export const AUTONOMY: Record<AutonomyLevel, AutonomyDef> = {
  1: { level: 1, name: 'Directive', summary: 'Leads only propose; the Project Manager approves every task.', approves: DECISION_KINDS },
  2: { level: 2, name: 'Guided', summary: 'Leads may create tasks within the approved scope; the Project Manager approves design and architecture changes and merges.', approves: ['scope', 'design', 'architecture', 'peer-review', 'merge', 'milestone', 'client-milestone', 'budget'] },
  3: { level: 3, name: 'Delegated', summary: "Leads may approve each other's work within budget; the Project Manager approves milestones and merges.", approves: ['merge', 'milestone', 'client-milestone', 'budget'] },
  4: { level: 4, name: 'Autonomous', summary: 'The Project Manager approves only client-facing milestones and the budget.', approves: ['client-milestone', 'budget'] },
};

export const isAutonomyLevel = (v: unknown): v is AutonomyLevel => v === 1 || v === 2 || v === 3 || v === 4;

/** Whether `kind` has to wait for the Project Manager at `level`. */
export function needsApproval(level: AutonomyLevel, kind: DecisionKind): boolean {
  return AUTONOMY[level].approves.includes(kind);
}
/** @deprecated the old name of needsApproval, from when the human was called the CTO. */
export const needsCto = needsApproval;

/** What the team may decide itself at `level`: the kinds that don't need the Project Manager. */
export function teamMayDecide(level: AutonomyLevel): DecisionKind[] {
  return DECISION_KINDS.filter((k) => !needsApproval(level, k));
}

/** The paragraph every Playbook and prompt carries, so a Lead always knows where the line is. */
export function autonomyBrief(level: AutonomyLevel): string {
  const a = AUTONOMY[level];
  const may = teamMayDecide(level).map((k) => DECISION_LABEL[k]);
  return [
    `Autonomy level ${level} (${a.name}): ${a.summary}`,
    `Needs the Project Manager's approval: ${a.approves.map((k) => DECISION_LABEL[k]).join('; ')}.`,
    may.length ? `You may decide without asking: ${may.join('; ')}.` : 'You may decide nothing on your own: propose everything.',
    `Anything that needs ${HUMAN_FULL} goes under "### Proposals" in your team journal (it reaches them at the next standup, summarised by the Project Coordinator); never act on it before it is approved. What can't wait for the standup is an escalation (see the review protocol in your Playbook). The Project Manager always has the final say.`,
  ].join('\n');
}

/**
 * The floor's daily cost cap at `level`, from the per-level setting (dollars; missing or 0 = off):
 * the Project Manager can give a more autonomous team a tighter, or looser, leash.
 */
export function capAt(caps: Partial<Record<AutonomyLevel, number>> | undefined, level: AutonomyLevel): number | undefined {
  const v = caps?.[level];
  return typeof v === 'number' && v > 0 ? v : undefined;
}

// ---- The Lead review loop: when a subagent's result goes up to the Project Manager -----------------

/** How loudly an escalation asks for the Project Manager, quietest first. */
export type Urgency = 'info' | 'important' | 'urgent' | 'critical';
export const URGENCIES: readonly Urgency[] = ['info', 'important', 'urgent', 'critical'];
export const isUrgency = (v: unknown): v is Urgency => typeof v === 'string' && (URGENCIES as readonly string[]).includes(v);

/** What a review turned up that might need the Project Manager. */
export type EscalationTrigger =
  | 'plan' | 'scope' | 'design' | 'architecture'
  | 'revisions-exhausted' | 'blocked' | 'milestone' | 'repeated-failure' | 'budget-risk'
  | 'security' | 'data-loss' | 'client-milestone' | 'budget-overrun' | 'blocked-no-path';
export const ESCALATION_TRIGGERS: readonly EscalationTrigger[] = ['plan', 'scope', 'design', 'architecture', 'revisions-exhausted', 'blocked', 'milestone', 'repeated-failure', 'budget-risk', 'security', 'data-loss', 'client-milestone', 'budget-overrun', 'blocked-no-path'];
export const isEscalationTrigger = (v: unknown): v is EscalationTrigger => typeof v === 'string' && (ESCALATION_TRIGGERS as readonly string[]).includes(v);

export const TRIGGER_LABEL: Record<EscalationTrigger, string> = {
  plan: 'a change to the plan',
  scope: 'a scope change',
  design: 'a design change',
  architecture: 'an architecture change',
  'revisions-exhausted': 'a review still failing after the allowed revision rounds',
  blocked: 'anything blocking',
  milestone: 'a milestone-level issue',
  'repeated-failure': 'repeated failures',
  'budget-risk': 'a budget risk',
  security: 'a security issue',
  'data-loss': 'a risk of data loss',
  'client-milestone': 'a client-facing milestone',
  'budget-overrun': 'a budget overrun',
  'blocked-no-path': 'blocked with no path forward',
};

/** Escalated at every level, Autonomous included: what no team should decide alone. */
export const CRITICAL_TRIGGERS: readonly EscalationTrigger[] = ['security', 'data-loss', 'client-milestone', 'budget-overrun', 'blocked-no-path'];

export interface ReviewPolicy {
  level: AutonomyLevel;
  /** What a review outcome escalates to the Project Manager at this level (the critical ones included). */
  escalate: readonly EscalationTrigger[];
  /** Ask the Project Manager before dispatching a subagent's next step (Directive only). */
  askBeforeNextStep: boolean;
  /** Revision rounds a subagent gets on one task before a still-failing review is escalated. */
  maxRevisions: number;
  /** The quietest urgency that still alerts the Project Manager at this level: below it an escalation is filed as FYI. */
  minUrgency: Urgency;
  /** One line for the Playbook's table. */
  rule: string;
}

export const REVIEW_POLICY: Record<AutonomyLevel, ReviewPolicy> = {
  1: { level: 1, escalate: ['plan', 'scope', 'design', 'architecture', 'revisions-exhausted', 'blocked', 'milestone', 'repeated-failure', 'budget-risk', ...CRITICAL_TRIGGERS], askBeforeNextStep: true, maxRevisions: 2, minUrgency: 'info', rule: 'Escalate every review outcome that changes scope, design or plan, and ask before dispatching the next step.' },
  2: { level: 2, escalate: ['scope', 'design', 'architecture', 'revisions-exhausted', 'blocked', ...CRITICAL_TRIGGERS], askBeforeNextStep: false, maxRevisions: 2, minUrgency: 'important', rule: 'Escalate design, architecture and scope changes, a review still failing after 2 revision rounds, and anything blocking.' },
  3: { level: 3, escalate: ['milestone', 'repeated-failure', 'budget-risk', ...CRITICAL_TRIGGERS], askBeforeNextStep: false, maxRevisions: 3, minUrgency: 'urgent', rule: 'Escalate only milestone-level issues, repeated failures and budget risk.' },
  4: { level: 4, escalate: [...CRITICAL_TRIGGERS], askBeforeNextStep: false, maxRevisions: 3, minUrgency: 'critical', rule: 'Escalate only critical issues: security, data loss, a client-facing milestone, a budget overrun, or blocked with no path.' },
};

/** Whether a review that turned up `trigger` goes to the Project Manager at `level`. */
export function shouldEscalate(level: AutonomyLevel, trigger: EscalationTrigger): boolean {
  return REVIEW_POLICY[level].escalate.includes(trigger);
}

/**
 * Whether an escalation is below the floor's threshold, so the office files it as FYI (kept and shown,
 * but no toast or desktop alert): its trigger isn't one the level escalates, or, without a trigger,
 * its urgency is quieter than the level's. The office never refuses one: the Lead may know better.
 */
export function isFyi(level: AutonomyLevel, urgency: Urgency, trigger?: EscalationTrigger): boolean {
  if (urgency === 'critical' || (trigger && CRITICAL_TRIGGERS.includes(trigger))) return false;
  if (trigger) return !shouldEscalate(level, trigger);
  return URGENCIES.indexOf(urgency) < URGENCIES.indexOf(REVIEW_POLICY[level].minUrgency);
}

/** The four levels' escalation thresholds as a markdown table, the current one marked. */
export function reviewTable(current: AutonomyLevel): string {
  const rows = ([1, 2, 3, 4] as const).map((l) => {
    const p = REVIEW_POLICY[l];
    const name = `${l} ${AUTONOMY[l].name}`;
    return `| ${l === current ? `**→ ${name}**` : name} | ${p.rule} | ${p.maxRevisions} | ${p.askBeforeNextStep ? 'yes' : 'no'} | ${p.minUrgency} |`;
  });
  return ['| Level | Escalate to the Project Manager | Revision rounds | Ask before next step | Quietest urgency that alerts |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

/** The review protocol every Lead's Playbook carries: what to do with each subagent result, at `level`. */
export function reviewBrief(level: AutonomyLevel, journal: string): string {
  const p = REVIEW_POLICY[level];
  return [
    'After **every** subagent result, before anything else:',
    '1. **Review** it against the task you gave and its acceptance criteria. Run the cheap checks that apply (`mxcli check` on drafted MDL, the tests, the linter) rather than trusting its summary.',
    `2. **Record** a review entry in \`${journal}\`: \`## YYYY-MM-DD HH:MM — Review: <subagent> · <task>\`, then \`Verdict: accept | revise | escalate\` and one or two lines of why (and what the checks said). Then give the office the verdict for the subagent's track record: \`office-workers subagent review <subagent> --verdict accept|rework --note "…"\` (revise = rework).`,
    '3. **Act on the verdict** straight away:',
    `   - **accept** → ${p.askBeforeNextStep ? `ask ${HUMAN} before dispatching the subagent's next step (an \`important\` escalation with the step as your recommendation), then dispatch it once they agree` : "dispatch that subagent's next step immediately"}. Never leave a subagent's lane idle while its queue has work.`,
    `   - **revise** → send it back with specific revision notes (what is wrong, where, what "done" looks like). After ${p.maxRevisions} revision rounds on the same task, a still-failing review is \`revisions-exhausted\`.`,
    `   - **escalate** → raise it to ${HUMAN_FULL} with \`office-workers escalate\` (or the \`escalate\` MCP tool), then carry on with whatever it doesn't block. The Project Coordinator relays and summarises open escalations at the standup; the human's answer comes back to you as a prompt.`,
    '',
    `**When to escalate at level ${level} (${AUTONOMY[level].name}):** ${p.rule} Anything below that is yours to decide: decide it, and say so in the review entry.`,
    '',
    reviewTable(level),
    '',
    '`office-workers escalate --urgency <info|important|urgent|critical> --trigger <kind> --title "…" --option "A" --option "B" --recommend "A" <<\'EOF\'` … details … `EOF`',
    `Urgency: \`critical\` for security, data loss, a client-facing milestone, a budget overrun or blocked with no path; \`urgent\` when work stops until they answer; \`important\` for a decision needed today; \`info\` to keep them informed. Triggers: ${ESCALATION_TRIGGERS.join(', ')}. Below this level's threshold the office files it as FYI instead of alerting ${HUMAN}.`,
  ].join('\n');
}
