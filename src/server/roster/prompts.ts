// What the office says to the team's agents: the first message of a hire (its Playbook, its handoff
// note), the request for a handoff before it's benched, the standup question, the Project Manager's
// decisions and answers to escalations, and the review nudge. Plain functions of their inputs, so the
// tests can read exactly what an agent is told. "The Project Manager" is always the human who owns the
// project; the coordinating agent is "the Project Coordinator" (role id `pm`).

import { autonomyBrief, DECISION_LABEL, HUMAN_FULL, REVIEW_POLICY, TRIGGER_LABEL, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import { VERDICT_WORD, type Escalation, type EscalationVerdict } from '../../shared/roster/escalation.js';
import { journalPath, playbookPath, ROLE_BY_ID, standupPath, type RoleId } from '../../shared/roster/roles.js';
import type { Proposal } from '../../shared/roster/types.js';
import type { SubagentResult } from '../workers/subagents.js';

/** How much of a handoff note goes into a hire's first message: the rest is in the journal. */
const HANDOFF_CHARS = 4000;

/** How a relay that needs nothing back ends: a reply would only spend a turn that nobody reads. */
export const NO_REPLY = 'This is a relay: no reply needed. Act on it if it asks for something, otherwise carry on.';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(the rest is in the journal)` : s);

/**
 * The rule every Lead and the Project Coordinator works by (their Playbook and first message carry
 * it): a question for the human goes through `escalate`, never into the chat. Nobody watches an
 * agent's terminal; one that asks there and ends its turn sits idle until the office benches it, and
 * the question is lost with its session.
 */
export const ASK_THE_PM = [
  '**Questions for the Project Manager go through `escalate`, never the chat.** The Project Manager does not watch your terminal: a question you write in your chat and then end your turn on is never seen, and an idle session may be benched. Whenever you need the Project Manager (or the client, through them) to answer, decide or sign something off:',
  '- raise it with `office-workers escalate` (or the `escalate` MCP tool). Batch related questions into one escalation: number them in the details, and give options and your recommendation where sensible;',
  '- then end your turn, or carry on with whatever it does not block. Never end a turn on a question that is not in an open escalation.',
  'It shows in the Project Manager\'s approvals, and their answer comes back to you as a prompt. While it is open (unless the office files it as FYI) you are not benched for being idle; if you are benched meanwhile, the office hires you back with the answer.',
].join('\n');

/** The first message of a fresh hire of a role: who it is, its Playbook, and where it left off. */
export function primePrompt(roleId: RoleId, name: string, level: AutonomyLevel, handoff?: { at: number; text: string }, task?: string, answers: string[] = [], team?: string): string {
  const role = ROLE_BY_ID.get(roleId)!;
  return [
    `You are ${name}, the ${role.title} of this project's team in Agent Office. ${role.mission}`,
    // `team`: what it covers on a Solo or Startup team (members.ts); an Enterprise member hears of the Coordinator as before.
    `You work for ${HUMAN_FULL}.${team !== undefined ? ` ${team}` : roleId === 'pm' ? '' : ' The Project Coordinator is the agent that coordinates the Leads and relays escalations; it is not the Project Manager.'}`,
    '',
    `Start by reading your Playbook, \`${playbookPath(roleId)}\` (also loaded as the \`team-${roleId}\` skill), the project's CLAUDE.md and your team journal \`${journalPath(role.team)}\`. The office just wrote the Playbook and any missing team files into your folder: commit them with your first change.`,
    '',
    autonomyBrief(level),
    '',
    ASK_THE_PM,
    '',
    handoff
      ? `This is a fresh session: your previous session was benched on ${new Date(handoff.at).toISOString().slice(0, 16).replace('T', ' ')} UTC after writing this handoff note. Pick up from it:\n\n${clip(handoff.text, HANDOFF_CHARS)}`
      : 'This is your first session on the project: get your bearings, then write a short `— Kickoff` entry in your journal (what you found, what you plan).',
    ...(answers.length ? ['', 'While you were away, the Project Manager answered your escalations:', ...answers] : []),
    '',
    task ? `Your task from the Project Manager: ${task}` : 'No task yet: once you have your bearings, say in one line what you will do next and wait for the Project Manager or the Project Coordinator.',
  ].join('\n');
}

/** Asked of a Lead before it's benched: everything worth keeping, written down, then nothing more. */
export function benchPrompt(roleId: RoleId, lessons: string, stamp: string): string {
  const role = ROLE_BY_ID.get(roleId)!;
  return [
    `The office is benching you to free resources: your session will be stopped and cleared once you've finished this turn, and your next hire starts fresh from your Playbook and the note you write now. Do only this:`,
    '',
    "1. First, if you are waiting on an answer, decision or sign-off from the Project Manager (or the client) that is not already in an open escalation — for instance a question you asked in your chat — raise it now with `office-workers escalate` (or the `escalate` MCP tool), all of them batched in one escalation with options where sensible. That puts it in the Project Manager's approvals, and their answer brings you back.",
    `2. Append a handoff entry to \`${journalPath(role.team)}\`, headed \`## ${stamp} — Handoff\`, with: **What I know** (state of the work, where things are), **Decisions** (and why), **Open threads**, **Next steps**. Make it enough for a fresh session to carry on without asking. End it with one line \`AWAITING-PM: <what you are waiting on, in one line>\` if you are waiting on the Project Manager or the client, or \`AWAITING-PM: none\`.`,
    `3. Append any durable lessons (gotchas, working recipes, mistakes not to repeat) to \`${lessons}\`, one dated bullet each. If \`mxcli brain capture\` is available, capture them there too.`,
    '4. Commit both files (with any finished work) and push your branch. Leave unfinished work committed on the branch, never lost.',
    '',
    "Don't start anything new. When it's written, reply `handoff written` and stop.",
  ].join('\n');
}

/** The standup question to an active Lead. `extra` adds role-specific asks (the analyst's data and memo). */
export function standupPrompt(roleId: RoleId, date: string, stamp: string, extra = ''): string {
  const role = ROLE_BY_ID.get(roleId)!;
  return [
    `Standup ${date}. Append a standup entry to \`${journalPath(role.team)}\` headed \`## ${stamp} — Standup\` with these sections, short bullets each (write "- none" for an empty one):`,
    '### Done', '### Next', '### Blockers', '### Proposals',
    'Proposals are what needs the Project Manager (or what you suggest the project does): one per line, `- [kind] Title — why`, kind one of task, scope, design, architecture, peer-review, merge, milestone, client-milestone, budget. Each becomes an Approve / Reject / Change card for the Project Manager; approved ones become GitHub issues for your team.',
    extra,
    "Then reply `standup posted`. Don't start new work in this turn; carry on with what you were doing afterwards.",
  ].filter(Boolean).join('\n');
}

/** To the Project Coordinator, when the office has drafted the standup page in its folder. */
export function standupCompiledPrompt(date: string, pending: number, escalations: Escalation[] = []): string {
  const open = escalations.filter((e) => e.status === 'open');
  return [
    `The office compiled today's standup into \`${standupPath(date)}\` in your folder, from the Leads' answers and the journals of those not at their desks.`,
    `Add a **Summary** at the top (≤ 5 lines: progress, risks, what needs the Project Manager${pending ? ` — ${pending} proposal${pending === 1 ? '' : 's'} await their decision` : ''}${open.length ? ` — ${open.length} open escalation${open.length === 1 ? '' : 's'}` : ''}), then commit and push it. Reply \`standup summarised\`.`,
    ...(open.length ? ['', 'Open escalations to the Project Manager (summarise them under **Escalations**; the Project Manager answers them on the project console, not you):', ...open.map(escalationLine)] : []),
  ].join('\n');
}

/** To the Project Coordinator, the Project Manager's decisions on proposals since it was last told, in one message. */
export function outcomesPrompt(decided: Proposal[]): string {
  const line = (p: Proposal) => {
    const what = p.status === 'approved' ? `APPROVED${p.issue?.number ? ` → issue #${p.issue.number}` : p.issue?.dryRun ? ' (dry run: no issue made)' : ''}` : p.status === 'rejected' ? `REJECTED: ${p.reason ?? 'no reason given'}` : `CHANGE REQUESTED: ${p.reason ?? ''}`;
    return `- ${p.by} (${p.team}), ${DECISION_LABEL[p.kind]}: "${p.title}" — ${what}`;
  };
  return [`The Project Manager decided on standup proposals:`, ...decided.map(line), '', `Record them in \`docs/team/management.md\`. Each Lead is told its own decisions by the office: only note in a Lead's journal what another team must plan around. ${NO_REPLY}`].join('\n');
}

/** To a Lead at work when the Project Manager changes the floor's autonomy level. */
export function autonomyPrompt(level: AutonomyLevel): string {
  return [`The Project Manager changed this floor's autonomy level. Your Playbook has been rewritten with it (autonomy and review protocol); from now on:`, '', autonomyBrief(level), '', `Escalate a review outcome when: ${REVIEW_POLICY[level].rule}`, '', 'Carry on. Reply `ok`.'].join('\n');
}

// ---- The review loop -----------------------------------------------------------------------------

/** The office's nudge to a Lead whose turn ended right after a subagent came back. */
export function reviewNudgePrompt(roleId: RoleId, result: SubagentResult | undefined, level: AutonomyLevel, first?: string): string {
  const role = ROLE_BY_ID.get(roleId)!;
  const who = result?.agent ? (first ? `${first}'s (\`${result.agent}\`)` : `\`${result.agent}\`'s`) : "your subagent's";
  const what = result?.task ? ` (“${result.task}”)` : '';
  return [
    `Review ${who} last result${what} per your Playbook's review protocol, then continue or escalate.`,
    `Record \`— Review: <subagent> · <task>\` with accept / revise / escalate in \`${journalPath(role.team)}\`; on accept dispatch its next step now (level ${level}: ${REVIEW_POLICY[level].askBeforeNextStep ? 'ask the Project Manager first' : "don't leave its lane idle"}); escalate only what your level escalates.`,
    `Then record the verdict for its track record: \`office-workers subagent review ${result?.agent ?? '<subagent>'} --verdict accept|rework --note "…"\`.`,
    '(Automatic nudge from Agent Office, sent once per idle period. If there is genuinely nothing left to do, say so in one line and stop.)',
  ].join('\n');
}

/** To a Lead whose subagent the scorer flagged: consider a warning or the bench, per its skills. */
export function underperformingPrompt(name: string, model: string, why: string, skills: string[], first?: string): string {
  return [
    `Your subagent ${first ? `${first} (\`${name}\`, ${model})` : `\`${name}\` (${model})`} is underperforming: ${why}.`,
    `Consider it per your skills: ${skills.length ? skills.join('; ') : 'escalate to the Project Manager if it needs action'}. \`office-workers subagent list\` shows its track record. Or carry on with it if you know why.`,
    '(Automatic note from Agent Office, sent once per finding. Decide, act if you will, and carry on.)',
  ].join('\n');
}

/** To the Project Coordinator: what the Leads decided about their subagents (their gate was tell). */
export function subagentNewsPrompt(lines: string[]): string {
  return ["The Leads' subagent decisions since you were last told:", ...lines, '', `Note them in \`docs/team/management.md\` and mention them at the next standup. Don't act on them: they were the Leads' to decide. ${NO_REPLY}`].join('\n');
}

/** To a Lead at work when the Project Manager changed its skills. */
export function skillsChangedPrompt(lines: string[]): string {
  return ['The Project Manager changed your skills. Your Playbook has been rewritten (## Your skills); now:', ...lines, '', 'Carry on. Reply `ok`.'].join('\n');
}

/** To a Lead, what became of a subagent action it proposed or asked about. */
export function subagentDecisionPrompt(what: string, approved: boolean, by: string, reason?: string): string {
  return [`The Project Manager (${by}) ${approved ? 'approved' : 'rejected'} your request to ${what}.${approved ? ' The office has done it.' : ''}`, ...(reason ? [reason] : []), `Note it in your team journal and carry on. ${NO_REPLY}`].join('\n');
}

/**
 * To a Lead between turns, the notes the office queued for it (relays.ts): the Project Manager's
 * decisions on what it proposed, and relays meant for a Coordinator the floor doesn't have.
 */
export function leadNotesPrompt(lines: string[]): string {
  return ['Notes from the office since your last turn:', ...lines, '', `Record what changes your plan in your team journal and carry on. ${NO_REPLY}`].join('\n');
}

/** One escalation in a line, for the Coordinator and the standup. */
export function escalationLine(e: Escalation): string {
  return `- [${e.fyi ? 'FYI' : e.urgency}] ${e.by}${e.team ? ` (${e.team})` : ''}: “${e.title}”${e.trigger ? ` — ${TRIGGER_LABEL[e.trigger]}` : ''}${e.recommendation ? ` · recommends: ${e.recommendation}` : ''}`;
}

/** The Project Manager's answer to an escalation, as a prompt to the agent that raised it. */
export function escalationAnswerPrompt(e: Escalation, verdict: EscalationVerdict, text: string, by: string): string {
  return [
    `The Project Manager (${by}) answered your escalation “${e.title}”: ${VERDICT_WORD[verdict]}.`,
    ...(text ? ['', text] : []),
    '',
    verdict === 'reject'
      ? "Don't go ahead with it. Record the answer in your team journal, adjust the plan, and carry on with the rest of your work."
      : 'Record the answer in your team journal and act on it now: dispatch or continue the work it unblocks, per your review protocol.',
  ].join('\n');
}

/** To a member at work, answers to its escalations that its hire didn't carry (answered while it was being hired). */
export function owedAnswersPrompt(lines: string[]): string {
  return ['The Project Manager answered escalations of yours that you have not been told yet:', ...lines, '', 'Record them in your team journal and act on them now: continue the work they unblock, per your review protocol.'].join('\n');
}

/** To the Project Coordinator: escalations raised since it was last told, so it can relay and summarise them. */
export function escalationsToCoordinatorPrompt(list: Escalation[]): string {
  return [
    `New escalation${list.length === 1 ? '' : 's'} to the Project Manager (the human) on the project console:`,
    ...list.map(escalationLine),
    '',
    `Note them in \`docs/team/management.md\` and include them in the next standup summary. Don't answer them yourself: the Project Manager decides, and the office sends their answer to whoever raised it. If one blocks another team, tell that Lead through its journal. ${NO_REPLY}`,
  ].join('\n');
}
