// Durable answers and dispatch (Slice 1B-1, docs/site/using-the-office/needs-you.md): what the person
// decided is appended to the answer store (server/answers/) before anything is typed, and every attempt
// to hand it on (typing it to an agent, holding it for after the agent's turn, opening a GitHub issue) is
// a dispatch record (server/dispatch/) whose intent is written before the attempt and whose outcome is
// written after it. What the office guarantees is durable intent plus reconciliation, and no automatic
// replay of an ambiguous attempt: an attempt whose outcome it can't establish stays `outcome-unknown`
// until a person says what happened. It never claims exactly-once delivery.
// Pure: the browser imports the types and the words.

/** Which decision a revision or a dispatch is about. */
export type DecisionRef = string; // 'esc:<id>' | 'q:<file>#<qid>' | 'stuck:<id>' | 'proposal:<id>' | 'mcr:<id>' | 'tell:<id>'

export const ANSWER_KINDS = ['answer', 'accept-proposal', 'moot', 'noted', 'done', 'approve', 'reject', 'reply', 'accept-as-recorded', 'correction'] as const;
export type AnswerRevisionKind = (typeof ANSWER_KINDS)[number];

/** The longest text a revision or a dispatch payload keeps (the answer store is the full history up to this). */
export const ANSWER_TEXT_MAX = 20_000;

/** One line of the answer store: a revision of a decision, full text and all. */
export interface AnswerRevision {
  decision: DecisionRef;
  rev: number;
  kind: AnswerRevisionKind;
  option?: string;
  text: string;
  by: string;
  at: number;
  supersedes?: number;
  basis?: 'recorded-differently';
}

export const DISPATCH_STATES = ['prepared', 'in-flight', 'submitted', 'held', 'refused', 'failed', 'not-sent', 'outcome-unknown', 'person-confirmed-sent', 'person-chose-resend', 'person-abandoned'] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];
export type DispatchChannel = 'type' | 'hold' | 'github-issue';

/** States that need nothing more from the office or a person. */
export const SETTLED_STATES: ReadonlySet<DispatchState> = new Set(['submitted', 'refused', 'failed', 'not-sent', 'person-confirmed-sent', 'person-chose-resend', 'person-abandoned']);
/** Unsettled: a rollback to an older build must wait until each is settled (the rollback guard). */
export const isUnsettled = (s: DispatchState) => !SETTLED_STATES.has(s);

/** The schema of `<data>/dispatch/<floor>.json`; a build that knows an older one must not run over unsettled records. */
export const DISPATCH_SCHEMA = 1;

export interface DispatchHistory {
  state: DispatchState;
  at: number;
  /** Why, in a few words (a refusal's reason, what reconcile found). */
  note?: string;
  by?: string;
}

export interface DispatchRecord {
  id: string;
  decision: DecisionRef;
  answerRev: number;
  /** Other decisions the same message carries (a question Send with several answers). */
  covers?: { decision: DecisionRef; answerRev: number }[];
  /** A card that answers several escalations: one id, a dispatch per member. */
  groupId?: string;
  workerId?: string;
  workerName?: string;
  /** Where to look for evidence, captured before typing. */
  sessionId?: string;
  transcriptPath?: string;
  transcriptOffset?: number;
  /** The exact text this dispatch types (its block: the office may add its resume line after it and run-state notes before it, never inside it). */
  payload: string;
  /** The marker line that ends the payload. */
  marker: string;
  channel: DispatchChannel;
  state: DispatchState;
  /** `system`: the office saw it go (typed, or transcript evidence). `person`: someone said "It went through". */
  confirmedBy?: 'system' | 'person';
  /** When it was marked in flight (just before the attempt). */
  dispatchedAt?: number;
  /** The dispatch this one replaces (Send again). */
  supersedes?: string;
  /** The dispatch that replaced this one. */
  supersededBy?: string;
  /** github-issue: the issue made, or the one a person linked. */
  issue?: { number?: number; url?: string };
  /** github-issue: the proposal and the repository folder, for reconcile and Create it. */
  proposalId?: string;
  createdAt: number;
  updatedAt: number;
  history: DispatchHistory[];
}

/** What GET /api/dispatch returns: the records that need a person, and whether you may act. */
export interface DispatchView {
  floor: string;
  admin: boolean;
  unsettled: DispatchRecord[];
}

export type DispatchPersonAction = 'send-again' | 'went-through' | 'abandon' | 'create-issue' | 'link-issue' | 'check';
export const DISPATCH_PERSON_ACTIONS: readonly DispatchPersonAction[] = ['send-again', 'went-through', 'abandon', 'create-issue', 'link-issue', 'check'];
export const isDispatchPersonAction = (v: unknown): v is DispatchPersonAction => typeof v === 'string' && (DISPATCH_PERSON_ACTIONS as readonly string[]).includes(v);

/** A decision ref as people read it in a marker: ESC-<id>, Q <id>, STUCK-<id>, PROPOSAL-<id>, MCR-<id>, TELL-<id>. */
export function decisionLabel(d: DecisionRef): string {
  const [kind, ...rest] = d.split(':');
  const id = rest.join(':');
  if (kind === 'esc') return `ESC-${id}`;
  if (kind === 'q') return `Q ${id.split('#').pop() ?? id}`;
  if (kind === 'stuck') return `STUCK-${id}`;
  if (kind === 'proposal') return `PROPOSAL-${id}`;
  if (kind === 'mcr') return `MCR-${id}`;
  if (kind === 'tell') return `TELL-${id}`;
  return d;
}

/** The marker line every typed answer ends with: `[office answer dsp_… · ESC-<id> rev <n>]`. */
export function answerMarker(id: string, decision: DecisionRef, rev: number, covers: readonly { decision: DecisionRef; answerRev: number }[] = []): string {
  const more = covers.filter((c) => c.decision !== decision).map((c) => `${decisionLabel(c.decision)} rev ${c.answerRev}`);
  return `[office answer ${id} · ${[`${decisionLabel(decision)} rev ${rev}`, ...more].join(', ')}]`;
}

/** The issue body marker a proposal's issue carries: `office-proposal: <id> rev <n>`. */
export const issueMarker = (proposalId: string, rev: number) => `office-proposal: ${proposalId} rev ${rev}`;

/** A typed block: the text and its marker as its own last line. */
export const withMarker = (text: string, marker: string) => `${text.replace(/\s+$/, '')}\n\n${marker}`;

/** The card's line for a record that needs a person. */
export function unknownLine(r: Pick<DispatchRecord, 'channel' | 'workerName' | 'state'>): string {
  if (r.channel === 'github-issue') return 'The issue may or may not have been created.';
  const who = r.workerName ?? 'the agent';
  if (r.state === 'held') return `Your answer is held for ${who}: it goes in once, after their turn.`;
  return `Couldn't confirm your answer was typed to ${who}.`;
}

/** How a settled state reads: a person's confirmation is never shown as the system's. */
export function stateWords(r: Pick<DispatchRecord, 'state' | 'confirmedBy'>): string {
  switch (r.state) {
    case 'submitted':
      return 'Typed (the office saw it go)';
    case 'person-confirmed-sent':
      return 'You said it went through (a person’s confirmation, not the office’s)';
    case 'person-chose-resend':
      return 'Sent again as a new dispatch';
    case 'person-abandoned':
      return 'Abandoned';
    case 'outcome-unknown':
      return 'Outcome unknown';
    case 'held':
      return 'Held for after the agent’s turn';
    case 'not-sent':
      return 'Not sent (the office stopped before sending)';
    default:
      return r.state;
  }
}
