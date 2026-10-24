// Change requests from the App Workspace (C4 of the App Workspace proposal, plan 5.5): the business owner says
// in their own words what should behave differently, about the page and the version on screen, and the
// office hands it to the team's lead as a task like any other (server/change-requests/: a task id minted
// through the roster's task record before anything is typed, the roster's delivery, the audit log). This is
// the part both sides read: what a request keeps, the task's text, and the one rule that says where a
// request is, in business words, from what the office already knows about its task. Pure.
//
// The state is derived, never stored: the task's record and the member's task (handed over, waiting on a
// decision, how it ended), the pull request that carries its `Task:` line (open, merged and its merge
// commit), whether the running version contains that commit, and the business status (shared/
// business-status.ts) for the revision that contains it.
//
//   Received          the task is made and waits for the lead's turn under way to end
//   Being worked on   the lead has it; or its change is finished but not in the running version yet
//   Ready to try      the running version contains its change (the version named)
//   Done              the business status of a revision that contains its change is accepted or later
//   Needs your answer the task waits on a decision of yours (the member's task says so explicitly)
//   Stopped           its task was cancelled
//
// Missing facts never move a request forward: a change whose commit can't be placed stays Being worked on.

import type { BusinessState } from './business-status.js';
import type { RoleId } from './roster/roles.js';

/** What the office keeps of a request (server/change-requests/store: <data>/change-requests/<project>.json). */
export interface ChangeRequestRecord {
  /** CR-<n>, per project. */
  id: string;
  /** The task it is (server/tasks/): every request has one, minted before anything was typed. */
  taskId: string;
  executionId?: string;
  /** The person's words, as they wrote them. */
  text: string;
  /** The page of the app on screen when they asked (a path within the app), when the canvas showed one. */
  page?: string;
  /** The app had moved on from that page by itself (a click inside it): the page is where it was last sent. */
  pageMoved?: boolean;
  /** The version the canvas was running then (the served revision), when one ran. */
  revision?: string;
  by: string;
  owner?: string;
  at: number;
  /** Who it went to: the team's lead (whoever covers management), else whoever covers analysis. */
  role: RoleId;
  member: string;
  workerId?: string;
  /** Held until the lead's turn under way ends, then sent. */
  delivery: 'held' | 'sent' | 'woke';
  dispatchId?: string;
}

export type RequestState = 'received' | 'working' | 'ready' | 'done' | 'needs-answer' | 'stopped';

/** The words people see for each state. */
export const REQUEST_WORDS: Record<RequestState, string> = {
  received: 'Received',
  working: 'Being worked on',
  ready: 'Ready to try',
  done: 'Done',
  'needs-answer': 'Needs your answer',
  stopped: 'Stopped',
};

/** The pill's tone per state (the App Workspace's .aw-pill classes). */
export const REQUEST_TONE: Record<RequestState, 'idle' | 'busy' | 'good' | 'bad' | 'warn'> = { received: 'idle', working: 'busy', ready: 'good', done: 'good', 'needs-answer': 'warn', stopped: 'bad' };

/** The business states a request is done at: accepted, approved for release, deployed (recorded). */
export const DONE_STATES: readonly BusinessState[] = ['accepted', 'release-approved', 'deployed-recorded'];

/** What the state is worked out from (server/change-requests/view.ts gathers it). */
export interface RequestFacts {
  delivery: ChangeRequestRecord['delivery'];
  /** The task was handed to a member (an assigned event on its record, or a member's task carries its id). */
  assigned: boolean;
  /** The last end on the task's record. */
  ended?: 'completed' | 'cancelled' | 'superseded';
  /** The member's task's provenance (roster/resume.ts outcomeOf), when a member has it. */
  outcome?: 'open' | 'claimed' | 'decision' | 'integrated' | 'delivered' | 'cancelled' | 'legacy';
  /** The change that carries its `Task:` line: open, merged (with its merge commit) or closed unmerged. */
  change?: { state: 'OPEN' | 'MERGED' | 'CLOSED'; commit?: string };
  /** The running version, and whether it contains the change's commit (undefined: not known). */
  served?: string;
  inServed?: boolean;
  /** The project's business status, and whether its revision contains the change's commit. */
  business?: { state: BusinessState; revision?: string };
  inBusiness?: boolean;
}

export interface RequestStatus {
  state: RequestState;
  words: string;
  /** One line under the state, in business words. */
  detail: string;
  /** The version that has it, once known (a full revision). */
  version?: string;
}

const at = (state: RequestState, detail: string, version?: string): RequestStatus => ({ state, words: REQUEST_WORDS[state], detail, ...(version ? { version } : {}) });

/** Where a request is (the table at the top of this file). */
export function requestState(f: RequestFacts): RequestStatus {
  if (f.ended === 'cancelled' || f.outcome === 'cancelled') return at('stopped', 'The team stopped this request. Ask the team lead why, or ask for it again.');
  if (f.outcome === 'decision') return at('needs-answer', 'The team needs a decision from you to go on: it’s under Decisions.');
  const merged = f.change?.state === 'MERGED' ? f.change.commit : undefined;
  if (merged) {
    if (f.inBusiness && f.business && f.business.revision && DONE_STATES.includes(f.business.state)) return at('done', 'In a version you accepted.', f.business.revision);
    if (f.inServed && f.served) return at('ready', 'In the running version now: try it in the app.', f.served);
    return at('working', 'Finished by the team, on its way to the running app.');
  }
  if (f.outcome === 'integrated' || f.outcome === 'delivered') return at('working', 'Finished by the team, on its way to the running app.');
  if (f.change?.state === 'OPEN') return at('working', 'The team is working on it.');
  if (f.change?.state === 'CLOSED') return at('working', 'A first attempt was set aside; the team carries on.');
  if (f.ended === 'superseded') return at('received', 'The team put it aside for other work for now.');
  if (f.assigned || f.delivery !== 'held') return at('working', 'The team lead has it.');
  return at('received', 'Waiting for the team lead to finish what they’re doing.');
}

/** A request with its state, as GET /api/change-requests gives it. */
export interface ChangeRequestView extends ChangeRequestRecord, RequestStatus {}

/** The newest request that isn't settled (done or stopped), else the newest: the panel's current request. */
export function currentRequest(list: readonly ChangeRequestView[]): ChangeRequestView | undefined {
  const sorted = [...list].sort((a, b) => b.at - a.at);
  return sorted.find((r) => r.state !== 'done' && r.state !== 'stopped') ?? sorted[0];
}

/** The longest request text kept. */
export const REQUEST_MAX = 4000;

/** A page of the app as a path within it (path, query and hash, never another site), or undefined. */
export function cleanPage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s.startsWith('/') || s.startsWith('//') || /[\s\u0000-\u001f]/.test(s)) return undefined;
  return s.slice(0, 300);
}

/** The first line of a request, for titles: its first non-empty line, at most `max` characters. */
export function requestTitle(text: string, max = 90): string {
  const first = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** The task as it's typed to the lead: what was asked, about which page and version, and how to go about it. */
export function requestTaskText(r: Pick<ChangeRequestRecord, 'id' | 'text' | 'page' | 'pageMoved' | 'revision' | 'by'>): string {
  return [
    `Change request ${r.id} from ${r.by}: ${requestTitle(r.text)}`,
    '',
    `${r.by} asked for this in the Developer view, looking at the running app.`,
    '',
    '```change-request',
    `id: ${r.id}`,
    `page: ${r.page ?? 'unknown'}${r.pageMoved ? ' (the app had moved on from there by itself; this is where it was last opened)' : ''}`,
    `version: ${r.revision ?? 'unknown (no version was running)'}`,
    'request: |',
    ...r.text.replace(/\r\n?/g, '\n').trim().split('\n').map((l) => `  ${l}`),
    '```',
    '',
    'How to handle it:',
    '- This is the business owner asking, in their words. Work out what it means for the app and plan the work as you usually would, yourself or through your team.',
    `- Keep this task's \`Task:\` line (below) on the work that delivers it (commit trailers and the PR description) and name ${r.id} there: that is how the office shows them where their request is.`,
    `- If it's unclear, changes the agreed scope, or needs a choice only they can make, escalate it (\`office-workers escalate\`, with ${r.id} in the title and \`--trigger scope\` or \`--trigger question\`), adding \`--artifact\` when a screenshot, process map or document helps them answer.`,
    `- The version is what they were looking at: if the app has moved on since, check the page still behaves as they saw it first.`,
  ].join('\n');
}
