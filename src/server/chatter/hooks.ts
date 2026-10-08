// The one-line hooks the office calls where it sends something from one agent to another, or on one's
// behalf (bus.ts carries them to the chatter): each says it the way it would be said in the thread.
// The office's own messages get light framing; an agent's words are kept as they are.

import type { Escalation } from '../../shared/roster/escalation.js';
import type { Proposal } from '../../shared/roster/types.js';
import { noteChatter, OFFICE, workerParty } from './bus.js';

type Who = { id: string; name: string };
type Member = { name: string; workerId?: string };

const memberParty = (m: Member, roleId: 'pm') => ({ name: m.name, kind: 'agent' as const, roleId, ...(m.workerId ? { workerId: m.workerId } : {}) });

/** The office passed new escalations to the Project Coordinator (roster/escalations.ts flushCoordinator). */
export function relayedToCoordinator(floor: string, coordinator: Who, list: Escalation[]) {
  if (!list.length) return;
  const text = list.length === 1 ? `Heads-up: ${list[0].by} escalated “${list[0].title}” to the Project Manager.` : `Heads-up, ${list.length} new escalations to the Project Manager: ${list.map((e) => `${e.by}: “${e.title}”`).join('; ')}.`;
  noteChatter(floor, { kind: 'relay', from: OFFICE, to: workerParty(coordinator), text, ...(list.length === 1 ? { ref: { escalationId: list[0].id } } : {}) });
}

/** The office passed the Project Manager's proposal decisions to the Coordinator (roster/standup-run.ts flushPm). */
export function decisionsRelayed(floor: string, coordinator: Who, list: Proposal[]) {
  if (!list.length) return;
  noteChatter(floor, { kind: 'relay', from: OFFICE, to: workerParty(coordinator), text: `The Project Manager decided: ${list.map((p) => `${p.by}'s “${p.title}” ${p.status === 'change' ? 'needs changes' : p.status}${p.reason ? ` (${p.reason})` : ''}`).join('; ')}.` });
}

/** A review nudge (roster/nudge.ts): a Lead's subagent came back and its turn ended. */
export function reviewNudged(floor: string, lead: Who, agent?: string, first?: string) {
  noteChatter(floor, { kind: 'nudge', from: OFFICE, to: workerParty(lead), text: `${agent ? (first ? `${first}, your ${agent},` : `Your ${agent}`) : 'Your subagent'} is back: review what it did, then carry on or escalate.`, ...(agent ? { ref: { subagent: agent } } : {}) });
}

/** The back-to-work nudge (roster/back-to-work.ts): a member stopped with its task open; `by` when a person pressed Nudge. */
export function backToWorkNudged(floor: string, member: Who, task?: string, by?: string) {
  noteChatter(floor, { kind: 'nudge', from: OFFICE, to: workerParty(member), text: `${task ? `You stopped with ${task} open: carry on, or escalate if you're blocked.` : "You're idle with no task: say what you'll do next, or escalate."}${by ? ` (${by} asked)` : ''}` });
}

/** The nudge about a subagent with a poor track record (roster/subagents.ts nudgeLead). */
export function struggleNudged(floor: string, lead: Who, subagent: string, why: string, who = subagent) {
  noteChatter(floor, { kind: 'nudge', from: OFFICE, to: workerParty(lead), text: `${who} has been struggling (${why}). Warn it, bench it or swap its model if you think it's time.`, ref: { subagent } });
}

/** A Lead's subagent decision under a `tell` gate: it tells the Project Coordinator (roster/subagents.ts). */
export function toldCoordinator(floor: string, lead: Who, coordinator: Member, text: string, subagent: string) {
  noteChatter(floor, { kind: 'relay', from: workerParty(lead), to: memberParty(coordinator, 'pm'), text, ref: { subagent } });
}

/** One agent prompting another with `office-workers tell` (hooks/office-workers.ts): its words as they are. */
export function agentTold(floor: string, from: Who, to: Who, text: string) {
  noteChatter(floor, { kind: 'relay', from: workerParty(from), to: workerParty(to), text });
}

/** One agent hiring another with a task (`office-workers hire`): the task is its handoff. */
export function agentHired(floor: string, from: Who, to: Who, task: string) {
  noteChatter(floor, { kind: 'handoff', from: workerParty(from), to: workerParty(to), text: task });
}

/** One agent saying a PR is another's (`office-workers pr --worker`): it's theirs to carry on. */
export function prHanded(floor: string, from: Who, to: Who, pr: number) {
  noteChatter(floor, { kind: 'handoff', from: workerParty(from), to: workerParty(to), text: `PR #${pr} is yours now.`, ref: { pr } });
}
