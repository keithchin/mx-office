// What the office says to the team's agents: the first message of a hire (its Playbook, its handoff
// note), the request for a handoff before it's benched, the standup question, and the CTO's
// decisions. Plain functions of their inputs, so the tests can read exactly what an agent is told.

import { autonomyBrief, DECISION_LABEL, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import { journalPath, playbookPath, ROLE_BY_ID, standupPath, type RoleId } from '../../shared/roster/roles.js';
import type { Proposal } from '../../shared/roster/types.js';

/** How much of a handoff note goes into a hire's first message: the rest is in the journal. */
const HANDOFF_CHARS = 4000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(the rest is in the journal)` : s);

/** The first message of a fresh hire of a role: who it is, its Playbook, and where it left off. */
export function primePrompt(roleId: RoleId, name: string, level: AutonomyLevel, handoff?: { at: number; text: string }, task?: string): string {
  const role = ROLE_BY_ID.get(roleId)!;
  return [
    `You are ${name}, the ${role.title} of this project's team in Agent Office. ${role.mission}`,
    '',
    `Start by reading your Playbook, \`${playbookPath(roleId)}\` (also loaded as the \`team-${roleId}\` skill), the project's CLAUDE.md and your team journal \`${journalPath(role.team)}\`. The office just wrote the Playbook and any missing team files into your folder: commit them with your first change.`,
    '',
    autonomyBrief(level),
    '',
    handoff
      ? `This is a fresh session: your previous session was benched on ${new Date(handoff.at).toISOString().slice(0, 16).replace('T', ' ')} UTC after writing this handoff note. Pick up from it:\n\n${clip(handoff.text, HANDOFF_CHARS)}`
      : 'This is your first session on the project: get your bearings, then write a short `— Kickoff` entry in your journal (what you found, what you plan).',
    '',
    task ? `Your task from the CTO: ${task}` : 'No task yet: once you have your bearings, say in one line what you will do next and wait for the CTO or the Project Manager.',
  ].join('\n');
}

/** Asked of a Lead before it's benched: everything worth keeping, written down, then nothing more. */
export function benchPrompt(roleId: RoleId, lessons: string, stamp: string): string {
  const role = ROLE_BY_ID.get(roleId)!;
  return [
    `The office is benching you to free resources: your session will be stopped and cleared once you've finished this turn, and your next hire starts fresh from your Playbook and the note you write now. Do only this:`,
    '',
    `1. Append a handoff entry to \`${journalPath(role.team)}\`, headed \`## ${stamp} — Handoff\`, with: **What I know** (state of the work, where things are), **Decisions** (and why), **Open threads**, **Next steps**. Make it enough for a fresh session to carry on without asking.`,
    `2. Append any durable lessons (gotchas, working recipes, mistakes not to repeat) to \`${lessons}\`, one dated bullet each. If \`mxcli brain capture\` is available, capture them there too.`,
    '3. Commit both files (with any finished work) and push your branch. Leave unfinished work committed on the branch, never lost.',
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
    'Proposals are what needs the CTO (or what you suggest the project does): one per line, `- [kind] Title — why`, kind one of task, scope, design, architecture, peer-review, merge, milestone, client-milestone, budget. Each becomes an Approve / Reject / Change card for the CTO; approved ones become GitHub issues for your team.',
    extra,
    "Then reply `standup posted`. Don't start new work in this turn; carry on with what you were doing afterwards.",
  ].filter(Boolean).join('\n');
}

/** To the PM, when the office has drafted the standup page in its folder. */
export function standupCompiledPrompt(date: string, pending: number): string {
  return [
    `The office compiled today's standup into \`${standupPath(date)}\` in your folder, from the Leads' answers and the journals of those not at their desks.`,
    `Add a **Summary** at the top (≤ 5 lines: progress, risks, what needs the CTO${pending ? ` — ${pending} proposal${pending === 1 ? '' : 's'} await the CTO's decision` : ''}), then commit and push it. Reply \`standup summarised\`.`,
  ].join('\n');
}

/** To the PM, the CTO's decisions on proposals since it was last told, in one message. */
export function outcomesPrompt(decided: Proposal[]): string {
  const line = (p: Proposal) => {
    const what = p.status === 'approved' ? `APPROVED${p.issue?.number ? ` → issue #${p.issue.number}` : p.issue?.dryRun ? ' (dry run: no issue made)' : ''}` : p.status === 'rejected' ? `REJECTED: ${p.reason ?? 'no reason given'}` : `CHANGE REQUESTED: ${p.reason ?? ''}`;
    return `- ${p.by} (${p.team}), ${DECISION_LABEL[p.kind]}: "${p.title}" — ${what}`;
  };
  return [`The CTO decided on standup proposals:`, ...decided.map(line), '', 'Record them in `docs/team/management.md` and pass each on to the Lead concerned through its team journal. Reply `noted`.'].join('\n');
}

/** To a Lead at work when the CTO changes the floor's autonomy level. */
export function autonomyPrompt(level: AutonomyLevel): string {
  return [`The CTO changed this floor's autonomy level. Your Playbook has been rewritten with it; from now on:`, '', autonomyBrief(level), '', 'Carry on. Reply `ok`.'].join('\n');
}
