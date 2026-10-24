// Developer changes (the Developer view's first useful release, docs/site/architecture/revisions-and-changes.md): one
// request from the Developer view, tied to the revisions it goes through. The office keeps a record of its own
// per project (server/dev-changes/store.ts: <data>/dev-changes/<project>.jsonl, append only, hash-chained like
// the task record) with only what nothing else knows:
//
//   - the change: DC-<n>, the person's words, who asked and when, the client's idempotency key
//   - where it is in the queue (made in order; activated, set aside, cancelled, flagged for clarification)
//   - the source revision (main's head when asked, or the revision on screen) and the page/element it points at
//   - the candidate heads seen on its branch (dev/DC-<n>) or on a PR carrying its Task: line, appended, never rewritten
//
// Everything else is derived each time from what the office already keeps (the task record, the roster, the PR
// list, the live app's served revision), never stored: the state below, the revision strip and the check binding.
// Pure: the page imports the types and the words.
//
//   Queued                the change waits its turn (+ why: another change is with the team, no lead at work,
//                         the project paused, the spend cap reached, the lead asleep)
//   With the team         handed to the lead as a task, nothing seen on its branch yet
//   On candidate @C       the newest head seen on dev/DC-n (or a PR with its Task: line)
//   Merged into main @M   its PR merged (merge commit M); where the preview is couldn't be told
//   In preview            the served revision contains M
//   Preview behind        main has M, the live app serves an older revision
//   Preview not running   M is merged and nothing serves
//   Needs clarification   the page or element it points at is gone at main's head: not started blindly
//   Cancelled             cancelled before it started, or its task was cancelled
//   Candidate not found   the team finished or set it aside and no branch or PR follows the convention: said, never guessed

import { sameRevision } from './testing/record.js';

/** DC-<n>, per project. */
export const CHANGE_ID = /^DC-[1-9]\d{0,6}$/;
/** The branch the lead is asked to work on for a change. */
export const changeBranch = (id: string) => `dev/${id}`;
/** An idempotency key from the client (a draft id): a retry with the same key never makes a second change. */
export const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const QN_RE = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/;
const NAME_RE = /^[A-Za-z_][\w]{0,99}$/;

/**
 * What a request points at in the model: a page (or snippet, layout) by its qualified name, and optionally one
 * widget on it by name. The key is document + widget name; the widget's `$ID` is kept as a hint only (it
 * changes when a widget is re-made under the same name).
 */
export interface ElementRef {
  docType: 'page' | 'snippet' | 'layout';
  docQn: string;
  widgetName?: string;
  widgetType?: string;
  /** The widget's $ID at the source revision: a hint, never the key. */
  id?: string;
  /** Plain words for it ("Submit button"). */
  label?: string;
}

/** A head seen for the change, in the order seen. Never moved or rewritten: a newer head is a new candidate. */
export interface Candidate {
  sha: string;
  /** Where it was seen: its branch dev/DC-n (as fetched into the project folder or a PR's head), or a PR with its Task: line. */
  via: 'branch' | 'pr';
  branch: string;
  pr?: number;
  seenAt: number;
}

/**
 * Where a change was asked from: the Developer view's docked chat, its fallback dialog (a phone or a page with no
 * chat), a guided check's "Something's wrong", or a "Please try this" card's "Something's wrong". Every entry point
 * makes the same record; this only says which one did.
 */
export type ChangeVia = 'chat' | 'dialog' | 'validation' | 'try';
const VIAS: readonly ChangeVia[] = ['chat', 'dialog', 'validation', 'try'];
export const cleanVia = (v: unknown): ChangeVia | undefined => (VIAS.includes(v as ChangeVia) ? (v as ChangeVia) : undefined);

/** Why a queued change hasn't started: the condition that has to change first. */
export type QueueWhy = 'behind' | 'no-lead' | 'paused' | 'cap' | 'asleep' | 'refused';

/** The change as made (the record's create line). */
export interface DevChangeNew {
  id: string;
  /** The client's draft id: the same key again is the same change. */
  key?: string;
  text: string;
  by: string;
  owner?: string;
  at: number;
  /** The revision it was asked against: main's head then, or the revision on screen. Set at intake, never moved. */
  source: { sha?: string; kind: 'main' | 'viewed' | 'unknown' };
  /** The page of the running app on screen (a path within the app), when the canvas showed one. */
  page?: string;
  pageMoved?: boolean;
  /** The served revision on the canvas then, when one ran (what C4 calls the request's version). */
  revision?: string;
  /** The page or element it points at in the model, when one was picked. */
  ref?: ElementRef;
  /** The change this one corrects (a "Something's wrong" after trying it), when it is a correction. */
  of?: string;
  /** Which entry point made it. */
  via?: ChangeVia;
}

/** Something that happened to a change, oldest first. */
export type DevChangeEvent =
  | { type: 'activated'; at: number; requestId: string; taskId: string; executionId?: string; member: string; role: string; workerId?: string; delivery: 'held' | 'sent' | 'woke'; main?: string }
  | { type: 'clarify'; at: number; why: string; main?: string }
  | { type: 'cancelled'; at: number; by: string }
  | { type: 'edited'; at: number; by: string; text: string }
  | { type: 'candidate'; at: number; candidate: Candidate }
  | { type: 'settled'; at: number; why: 'merged' | 'cancelled' | 'set-aside' | 'not-found' };

/** One line of the record: a change made, or an event on one. Each is hash-chained to the line before. */
export type DevChangeLine = { op: 'create'; change: DevChangeNew } | { op: 'event'; id: string; event: DevChangeEvent };

/** A change with every line folded in. */
export interface DevChange extends DevChangeNew {
  /** Where it is in the queue, from its events. */
  queue: 'queued' | 'active' | 'settled' | 'cancelled' | 'clarify';
  activated?: Extract<DevChangeEvent, { type: 'activated' }>;
  clarify?: { why: string; at: number; main?: string };
  cancelled?: { at: number; by: string };
  settled?: { at: number; why: Extract<DevChangeEvent, { type: 'settled' }>['why'] };
  candidates: Candidate[];
}

/** Folds one line into the changes read so far (in file order). Unknown lines are skipped. */
export function foldChange(into: Map<string, DevChange>, l: DevChangeLine): void {
  if (l.op === 'create' && l.change && typeof l.change.id === 'string') {
    if (!into.has(l.change.id)) into.set(l.change.id, { ...l.change, queue: 'queued', candidates: [] });
    return;
  }
  if (l.op !== 'event' || typeof l.id !== 'string' || !l.event) return;
  const c = into.get(l.id);
  if (!c) return;
  const e = l.event;
  switch (e.type) {
    case 'activated':
      if (c.queue === 'queued' || c.queue === 'clarify') ((c.queue = 'active'), (c.activated = e));
      break;
    case 'clarify':
      if (c.queue === 'queued') ((c.queue = 'clarify'), (c.clarify = { why: e.why, at: e.at, ...(e.main ? { main: e.main } : {}) }));
      break;
    case 'cancelled':
      if (c.queue === 'queued' || c.queue === 'clarify') ((c.queue = 'cancelled'), (c.cancelled = { at: e.at, by: e.by }));
      break;
    case 'edited':
      if (c.queue === 'queued' || c.queue === 'clarify') c.text = e.text;
      break;
    case 'candidate':
      if (!c.candidates.some((x) => x.sha === e.candidate.sha)) c.candidates.push(e.candidate);
      break;
    case 'settled':
      if (c.queue === 'active') ((c.queue = 'settled'), (c.settled = { at: e.at, why: e.why }));
      break;
  }
}

/** The number in DC-<n>. */
export const changeNumber = (id: string) => Number(id.slice(3)) || 0;

/** The queue in order: queued changes, oldest first. */
export const queuedOf = (all: readonly DevChange[]) => all.filter((c) => c.queue === 'queued').sort((a, b) => changeNumber(a.id) - changeNumber(b.id));
/** The one active change, if any. */
export const activeOf = (all: readonly DevChange[]) => all.find((c) => c.queue === 'active');

// ---- what's asked for, cleaned -------------------------------------------------------------------------------

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** A revision from the client, when it reads as one. */
export const cleanSha = (v: unknown): string | undefined => (typeof v === 'string' && SHA_RE.test(v.trim()) ? v.trim().toLowerCase() : undefined);

/** An element reference from the client: kept only when the document reads as a qualified name (and the widget as a name). */
export function cleanRef(v: unknown): ElementRef | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const docType = r.docType === 'snippet' || r.docType === 'layout' ? r.docType : r.docType === 'page' || r.docType === undefined ? 'page' : undefined;
  const docQn = str(r.docQn, 200);
  if (!docType || !QN_RE.test(docQn)) return undefined;
  const widgetName = str(r.widgetName, 100);
  const out: ElementRef = { docType, docQn };
  if (widgetName && NAME_RE.test(widgetName)) out.widgetName = widgetName;
  const widgetType = str(r.widgetType, 80);
  if (out.widgetName && widgetType && /^[\w$.]+$/.test(widgetType)) out.widgetType = widgetType;
  const id = str(r.id, 64);
  if (out.widgetName && id && /^[\w+/=-]+$/.test(id)) out.id = id;
  const label = str(r.label, 120).replace(/[\u0000-\u001f]/g, ' ');
  if (label) out.label = label;
  return out;
}

/** What it points at, in words: "Submit button (SubmitBtn) on page Orders.Order_Edit". */
export function refWords(r: ElementRef): string {
  const doc = `${r.docType} ${r.docQn}`;
  if (!r.widgetName) return r.label ? `${r.label} (${doc})` : doc;
  return `${r.label ? `${r.label} (${r.widgetName})` : r.widgetName} on ${doc}`;
}

/** The lines a change adds to its task (shared/change-requests.ts requestTaskText puts them in). */
export function changeTaskLines(c: Pick<DevChangeNew, 'id' | 'source' | 'ref'>): { fence: string[]; how: string[] } {
  const branch = changeBranch(c.id);
  return {
    fence: [`change: ${c.id}`, `branch: ${branch}`, `source: ${c.source.sha ? `main @${c.source.sha}` : 'unknown'}`, ...(c.ref ? [`element: ${refWords(c.ref)}${c.ref.id ? ` ($ID ${c.ref.id}, a hint only)` : ''}`] : [])],
    how: [
      `- Do this work on its own branch \`${branch}\`, made from main (\`git switch -c ${branch} origin/main\`), and open its PR from that branch: the office follows the change by that branch's head. Don't reuse it for other work.`,
      `- Keep the \`Task:\` line and name ${c.id} in the PR. If the work ends up on another branch, say so in the PR: the office shows "candidate not found" rather than guess.`,
    ],
  };
}

// ---- the state ------------------------------------------------------------------------------------------------

export type ChangeState = 'queued' | 'with-team' | 'candidate' | 'merged' | 'in-preview' | 'preview-behind' | 'preview-off' | 'clarify' | 'cancelled' | 'not-found';

export const CHANGE_WORDS: Record<ChangeState, string> = {
  queued: 'Queued',
  'with-team': 'With the team',
  candidate: 'On candidate',
  merged: 'Merged into main',
  'in-preview': 'In preview',
  'preview-behind': 'Preview behind',
  'preview-off': 'Preview not running',
  clarify: 'Needs clarification',
  cancelled: 'Cancelled',
  'not-found': 'Candidate not found',
};

/** The pill's tone per state (the Developer view's .aw-pill classes). */
export const CHANGE_TONE: Record<ChangeState, 'idle' | 'busy' | 'good' | 'bad' | 'warn'> = {
  queued: 'idle',
  'with-team': 'busy',
  candidate: 'busy',
  merged: 'good',
  'in-preview': 'good',
  'preview-behind': 'warn',
  'preview-off': 'idle',
  clarify: 'warn',
  cancelled: 'bad',
  'not-found': 'warn',
};

/** The words for why a change waits. */
export function queueWhyWords(why: QueueWhy, ahead?: string): string {
  switch (why) {
    case 'behind':
      return `${ahead ?? 'Another change'} is with the team: this one starts when that one is merged, cancelled or set aside.`;
    case 'no-lead':
      return 'No team lead is at work: it starts when the team is started in Project Management.';
    case 'paused':
      return 'The project is paused: it starts when the project is resumed.';
    case 'cap':
      return 'The team’s daily spend cap is reached: it starts when the cap allows work again.';
    case 'asleep':
      return 'The team lead is asleep: it starts when the lead is back at work.';
    case 'refused':
      return 'The office couldn’t hand it to the team lead just now: it tries again when the team moves.';
  }
}

/** What the state is worked out from (server/dev-changes/view.ts gathers it). */
export interface ChangeFacts {
  queue: DevChange['queue'];
  /** Queued: why it waits, its place (1 = next) and the change ahead. */
  why?: QueueWhy;
  position?: number;
  ahead?: string;
  clarify?: string;
  /** Who cancelled it, when the record says so. */
  cancelledBy?: string;
  /** The task's last end on its record, and the member's task's outcome. */
  ended?: 'completed' | 'cancelled' | 'superseded';
  outcome?: 'open' | 'claimed' | 'decision' | 'integrated' | 'delivered' | 'cancelled' | 'legacy';
  /** The newest candidate seen. */
  candidate?: Candidate;
  /** Its PR (on dev/DC-n, or carrying its Task: line): open, merged with its merge commit, or closed. */
  pr?: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; mergeCommit?: string };
  /** The live app: serving revision S, or not running. */
  preview?: { running: boolean; served?: string };
  /** Whether S contains the merge commit (undefined: couldn't tell). */
  inServed?: boolean;
}

export interface ChangeStatus {
  state: ChangeState;
  words: string;
  /** One line under it, in plain words. */
  detail: string;
  /** The revision the state names: the candidate C, the merge commit M, or the served S. */
  revision?: string;
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const at = (state: ChangeState, detail: string, revision?: string): ChangeStatus => ({ state, words: CHANGE_WORDS[state], detail, ...(revision ? { revision } : {}) });

/** Where a change is (the table at the top of this file). Missing facts never move it forward. */
export function changeState(f: ChangeFacts): ChangeStatus {
  if (f.queue === 'cancelled') return at('cancelled', `Cancelled${f.cancelledBy ? ` by ${f.cancelledBy}` : ''} before it started. Nothing was handed to the team.`);
  if (f.queue === 'clarify') return at('clarify', f.clarify ?? 'What it points at isn’t in the app any more: say what you mean now, or cancel it.');
  if (f.queue === 'queued') {
    const place = f.position && f.position > 1 ? `Number ${f.position} in the queue. ` : '';
    return at('queued', `${place}${queueWhyWords(f.why ?? 'behind', f.ahead)}`);
  }
  const merged = f.pr?.state === 'MERGED' ? f.pr.mergeCommit : undefined;
  if (merged) {
    if (f.preview && !f.preview.running) return at('preview-off', `Merged into main @${short(merged)}. The live preview isn’t running: start it on Project Management’s Live app page to try it.`, merged);
    if (f.inServed === true) return at('in-preview', `The live preview runs @${short(f.preview?.served)}, which contains it: try it in the app.`, merged);
    if (f.inServed === false) return at('preview-behind', `Merged into main @${short(merged)}, but the live preview still runs @${short(f.preview?.served)}, which doesn’t contain it yet.`, merged);
    return at('merged', `Merged into main @${short(merged)}. Whether the preview has it couldn’t be told.`, merged);
  }
  if (f.ended === 'cancelled' || f.outcome === 'cancelled') return at('cancelled', 'The team cancelled its task. Ask the team lead why, or ask for it again.');
  const finished = f.ended === 'completed' || f.ended === 'superseded' || f.outcome === 'integrated' || f.outcome === 'delivered' || f.queue === 'settled';
  if (f.candidate) {
    const pr = f.pr ? ` · PR #${f.pr.number}${f.pr.state === 'CLOSED' ? ' (closed without merging)' : ''}` : '';
    return at('candidate', `Candidate @${short(f.candidate.sha)} on ${f.candidate.branch}${pr}. Not merged: the live preview runs main, not this.`, f.candidate.sha);
  }
  if (finished) return at('not-found', 'The team says it’s done or set it aside, but nothing was found on its branch or on a PR with its Task line. Ask the team lead where the work is.');
  return at('with-team', f.outcome === 'decision' ? 'The team lead has it and waits on a decision of yours (under Decisions).' : 'The team lead has it. Nothing saved on its branch yet.');
}

/** Whether a change's turn is over for the queue (the next one may start), and why. Undefined: still active. */
export function settledWhy(f: ChangeFacts): Extract<DevChangeEvent, { type: 'settled' }>['why'] | undefined {
  if (f.pr?.state === 'MERGED' && f.pr.mergeCommit) return 'merged';
  if (f.ended === 'cancelled' || f.outcome === 'cancelled') return 'cancelled';
  if (f.ended === 'superseded') return 'set-aside';
  if (f.ended === 'completed' || f.outcome === 'integrated' || f.outcome === 'delivered') return f.candidate ? undefined : 'not-found';
  return undefined;
}

/** A change with its state, as GET /api/dev-changes gives it. */
export interface DevChangeView extends DevChange, ChangeStatus {
  branch: string;
  /** Its place in the queue (1 = next), while queued. */
  position?: number;
  /** The C4 request it became (CR-<n>) and its task, once handed over. */
  requestId?: string;
  taskId?: string;
  member?: string;
  /** Checks bound to its newest candidate. */
  checks?: CandidateChecks;
  /** Whether the person asking may cancel it now (queued or flagged, and theirs or an admin's). */
  mayCancel: boolean;
  /** What people said after trying it ("Looks right" / "Something's wrong"), each for the exact revision tried, oldest first. */
  reviews?: ChangeReview[];
}

/**
 * A person's scoped review of a change, from its "Please try this" card: kept as a guided-validation mark (C5's
 * book, scenario `change:DC-n`) for the exact revision the live preview served then. Evidence, never acceptance.
 */
export interface ChangeReview {
  /** The mark's id (GV-<n>). */
  id: string;
  verdict: 'works' | 'wrong';
  revision: string;
  by: string;
  at: number;
  note?: string;
  /** The correction "Something's wrong" made (DC-<n>). */
  correction?: string;
}

/** The scenario id a change's review is kept under in guided validation's book. */
export const reviewScenario = (id: string) => `change:${id}`;
/** The change a guided-validation scenario id names, when it's a change's review. */
export const reviewedChange = (scenario: string): string | undefined => (scenario.startsWith('change:') && CHANGE_ID.test(scenario.slice(7)) ? scenario.slice(7) : undefined);

/** The newest change that isn't cancelled, preferring the active one, then the next queued: the panel's current change. */
export function currentChange(list: readonly DevChangeView[]): DevChangeView | undefined {
  const active = list.find((c) => c.queue === 'active');
  if (active) return active;
  const live = [...list].filter((c) => c.state !== 'cancelled').sort((a, b) => changeNumber(b.id) - changeNumber(a.id));
  return live.find((c) => c.state === 'queued' || c.state === 'clarify') ?? live[0];
}

// ---- checks bound to a candidate -------------------------------------------------------------------------------

/** A check result as the stores keep it: the revision it ran on, its name, its verdict. */
export interface CheckResult {
  revision: string;
  name: string;
  verdict: 'passed' | 'failed' | 'skipped';
}

export interface CandidateChecks {
  /** The candidate they're about. */
  candidate: string;
  /** Results whose revision is exactly this candidate. */
  on: CheckResult[];
  /** Results on earlier candidates of the same change: shown as "on an earlier candidate", never moved across. */
  earlier: CheckResult[];
  /** One line in words. */
  line: string;
}

/** The checks to show against the newest candidate: only those on exactly it; older ones labelled; none never reads as passed. */
export function candidateChecks(candidates: readonly Candidate[], results: readonly CheckResult[], hasCI: boolean): CandidateChecks | undefined {
  const cur = candidates.at(-1);
  if (!cur) return undefined;
  const on = results.filter((r) => sameRevision(r.revision, cur.sha));
  const earlier = results.filter((r) => !sameRevision(r.revision, cur.sha) && candidates.slice(0, -1).some((c) => sameRevision(r.revision, c.sha)));
  let line: string;
  if (on.length) {
    const failed = on.filter((r) => r.verdict === 'failed').length;
    const passed = on.filter((r) => r.verdict === 'passed').length;
    line = failed ? `${failed} of ${on.length} checks failed on @${short(cur.sha)}` : passed === on.length ? `${passed} checks passed on @${short(cur.sha)}` : `${passed} of ${on.length} checks passed on @${short(cur.sha)}; the rest didn’t reach a verdict`;
  } else line = hasCI ? `No checks have reported on @${short(cur.sha)} yet` : 'No checks on this candidate (this project has no CI)';
  if (earlier.length) line += ` · ${earlier.length} on an earlier candidate`;
  return { candidate: cur.sha, on, earlier, line };
}

// ---- the revision strip ---------------------------------------------------------------------------------------

export interface StripFacts {
  main?: string;
  preview: { status: 'running' | 'updating' | 'off'; served?: string; lastServed?: string };
  /** How many commits main is ahead of the served revision (undefined: couldn't tell). */
  behind?: number;
  /** How many commits the served revision has that main hasn't (built from work not merged into main). */
  ahead?: number;
  /** The selected change, with its newest candidate when one is seen. */
  change?: { id: string; candidate?: string; branch: string };
}

export interface StripChip {
  key: 'main' | 'preview' | 'change';
  label: string;
  /** The full revision it names, when it names one. */
  sha?: string;
  tone: 'idle' | 'good' | 'warn' | 'busy';
  title: string;
}

/** The strip's chips: main @M, the live preview @S (behind main by N, or not running), the selected change's candidate @C. */
export function stripChips(f: StripFacts): StripChip[] {
  const out: StripChip[] = [];
  out.push(f.main ? { key: 'main', label: `main @${short(f.main)}`, sha: f.main, tone: 'idle', title: `Main’s head: ${f.main}` } : { key: 'main', label: 'main: not read yet', tone: 'idle', title: 'Main’s head couldn’t be read from the project folder' });
  const s = f.preview.served;
  if (f.preview.status === 'off' || !s) {
    const last = f.preview.lastServed ? ` (last ran @${short(f.preview.lastServed)})` : '';
    out.push({ key: 'preview', label: f.preview.status === 'updating' ? 'preview: starting' : 'preview: not running', tone: 'idle', title: `The live preview isn’t serving${last}` });
  } else {
    const same = !!f.main && sameRevision(s, f.main);
    const ahead = !same && f.ahead ? f.ahead : 0;
    const behind = same ? '' : f.behind ? ` · behind main by ${f.behind}` : f.behind === 0 || ahead ? '' : ' · behind main';
    const extra = ahead ? ` · ${ahead} not on main` : '';
    const level = same || (f.behind === 0 && !ahead);
    const title = level ? `The live preview runs main’s head ${s}` : `The live preview runs ${s}${f.behind ? `, behind main by ${f.behind} commit${f.behind === 1 ? '' : 's'}` : f.behind === undefined ? ', older than main' : ''}${ahead ? `, with ${ahead} commit${ahead === 1 ? '' : 's'} main doesn’t have (built from work not merged)` : ''}`;
    out.push({ key: 'preview', label: `preview @${short(s)}${behind}${extra}`, sha: s, tone: level ? 'good' : 'warn', title });
  }
  if (f.change) {
    const c = f.change.candidate;
    out.push(c ? { key: 'change', label: `${f.change.id} candidate @${short(c)}`, sha: c, tone: 'busy', title: `${f.change.id}’s newest head on ${f.change.branch}: ${c}. Not merged; the preview doesn’t run it.` } : { key: 'change', label: `${f.change.id}: no candidate yet`, tone: 'idle', title: `Nothing seen on ${f.change.branch} yet` });
  }
  return out;
}

/** What GET /api/dev-changes gives. */
export interface DevChangesView {
  floor: string;
  changes: DevChangeView[];
  strip: StripFacts;
  current: string | null;
  /** The project's ⏸ pause (who, when, why), while it's paused: queued changes start only after ▶ Resume. */
  pause?: { by: string; at: number; why: 'person' | 'restart' | 'budget' };
}
