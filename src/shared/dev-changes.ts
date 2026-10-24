// Developer changes (docs/site/architecture/revisions-and-changes.md): one request, from any entry point, tied to
// the revisions it goes through. The office keeps a record of its own per project (server/dev-changes/store.ts:
// <data>/dev-changes/<project>.jsonl, append only, hash-chained like the task record) with only what nothing else
// knows:
//
//   - the change: DC-<n>, the person's words, who asked and when, the client's idempotency key, which entry point
//   - where it is in the queue (made in order; activated, handed again, cancelled, superseded, settled, flagged)
//   - the source revision (main's head when asked, or the revision on screen) and what it points at in the model
//   - the candidate heads seen on its branch (dev/DC-<n>) or on a PR carrying its Task: line, appended, never
//     rewritten (one seen after a cancellation is marked late: never counted)
//   - the commits on main a person may link to it (possibly related, then confirmed or dismissed)
//   - for a request made before this record existed (a C4 CR-n, a Model-tab MCR-n): a linked record whose alias
//     is the old id, added by an append-only link pass; the old record and its history are never rewritten
//
// Everything else is derived each time from what the office already keeps (the task record, the roster, the PR
// list, git, the live app's served revision, the data-impact guard's holds, guided validation's reviews), never
// stored: the four facts (dev-change-state.ts, dev-change-facts.ts), the revision strip and the check binding.
// Pure: the page imports the types and the words.

import { sameRevision } from './testing/record.js';
import type { ChangeFour } from './dev-change-facts.js';
import type { ChangeStatus } from './dev-change-state.js';

export * from './dev-change-state.js';
export * from './dev-change-facts.js';

/** DC-<n>, per project. */
export const CHANGE_ID = /^DC-[1-9]\d{0,6}$/;
/** The branch the lead is asked to work on for a change. */
export const changeBranch = (id: string) => `dev/${id}`;
/** An idempotency key from the client (a draft id): a retry with the same key never makes a second change. */
export const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const QN_RE = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/;
const MODULE_RE = /^[A-Za-z_][\w]{0,99}$/;
const NAME_RE = /^[A-Za-z_][\w]{0,99}$/;
const MEMBER_RE = /^[A-Za-z_][\w]{0,99}(\.[A-Za-z_][\w]{0,99})?$/;

/** What a reference names: a page (snippet, layout), a widget on one, an entity or attribute, a microflow or nanoflow. */
export type RefKind = 'page' | 'widget' | 'entity' | 'attribute' | 'microflow' | 'nanoflow';
export type RefDocType = 'page' | 'snippet' | 'layout' | 'microflow' | 'nanoflow' | 'domainmodel';
const DOC_TYPES: readonly RefDocType[] = ['page', 'snippet', 'layout', 'microflow', 'nanoflow', 'domainmodel'];

/**
 * What a request points at in the model: `{kind, doc, name}`. The document is a unit by its qualified name (a
 * page, snippet or layout; a microflow or nanoflow; a module's domain model by the module's name); the name is
 * the element in it (a widget by name, an entity "Order" or an attribute "Order.Notes"). The key is document +
 * name; a widget's `$ID` is kept as a hint only (it changes when a widget is re-made under the same name).
 */
export interface ElementRef {
  docType: RefDocType;
  docQn: string;
  widgetName?: string;
  widgetType?: string;
  /** The widget's $ID at the source revision: a hint, never the key. */
  id?: string;
  /** Plain words for it ("Submit button"). */
  label?: string;
  /** What it names (derived for references made before this field: refKind). */
  kind?: RefKind;
  /** An entity ("Order") or attribute ("Order.Notes") in a domain model. */
  name?: string;
}

/** What a reference names, for one made before `kind` existed too. */
export function refKind(r: ElementRef): RefKind {
  if (r.kind) return r.kind;
  if (r.docType === 'microflow' || r.docType === 'nanoflow') return r.docType;
  if (r.docType === 'domainmodel') return r.name?.includes('.') ? 'attribute' : 'entity';
  return r.widgetName ? 'widget' : 'page';
}

/** The model unit a reference is in, as the unit index keys it ("page:Shop.Order_Edit", "domainmodel:Shop"). */
export const refDoc = (r: Pick<ElementRef, 'docType' | 'docQn'>) => `${r.docType}:${r.docQn}`;

/** A head seen for the change, in the order seen. Never moved or rewritten: a newer head is a new candidate. */
export interface Candidate {
  sha: string;
  /** Where it was seen: its branch dev/DC-n (as fetched into the project folder or a PR's head), or a PR with its Task: line. */
  via: 'branch' | 'pr';
  branch: string;
  pr?: number;
  seenAt: number;
  /** Seen after the change was cancelled or superseded: shown as "after cancellation: not counted", never settles anything. */
  late?: true;
}

/**
 * Where a change was asked from: the Developer view's docked chat, its fallback dialog, a guided check's
 * "Something's wrong", a "Please try this" card's "Something's wrong", the Model tab's Change this (a linked record
 * beside MCR-n), or the link pass (a request made before this record, linked by its alias). Every entry point makes
 * or links the same record; this only says which one did.
 */
export type ChangeVia = 'chat' | 'dialog' | 'validation' | 'try' | 'model' | 'migrated';
const VIAS: readonly ChangeVia[] = ['chat', 'dialog', 'validation', 'try'];
/** The entry points a client may name (model and migrated are the server's own). */
export const cleanVia = (v: unknown): ChangeVia | undefined => (VIAS.includes(v as ChangeVia) ? (v as ChangeVia) : undefined);

/** Why a queued change hasn't started: the condition that has to change first. */
export type QueueWhy = 'behind' | 'no-lead' | 'paused' | 'cap' | 'asleep' | 'refused' | 'held' | 'depends';

/** The record a linked change stands beside (its alias): a C4 request or a Model-tab request, with what it was handed as. */
export interface LinkedTo {
  kind: 'cr' | 'mcr';
  id: string;
  taskId?: string;
  member?: string;
  role?: string;
  workerId?: string;
  at: number;
}

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
  /** What it points at in the model, when something was picked. */
  ref?: ElementRef;
  /** More elements (a Model-tab request about several). */
  refs?: ElementRef[];
  /** The change this one corrects (a "Something's wrong" after trying it), when it is a correction. */
  of?: string;
  /** Which entry point made it. */
  via?: ChangeVia;
  /** A linked record: it stands beside an older request (its alias), never queued here, its work followed from there. */
  linked?: LinkedTo;
}

/** How an active change's worker was stopped or isolated before its slot was released. */
export interface StopResult {
  /** slept: its terminal stopped mid-turn (its session kept); idle: between turns, nothing to stop; asleep: already; gone: no such worker any more. */
  how: 'slept' | 'idle' | 'asleep' | 'gone';
  worker?: string;
  /** Held prompts for the change taken back before they went in. */
  dropped?: number;
}

/** Something that happened to a change, oldest first. */
export type DevChangeEvent =
  | { type: 'activated'; at: number; requestId: string; taskId: string; executionId?: string; member: string; role: string; workerId?: string; delivery: 'held' | 'sent' | 'woke'; main?: string }
  | { type: 'clarify'; at: number; why: string; main?: string }
  | { type: 'cancelled'; at: number; by: string; byId?: string; active?: true; stop?: StopResult; pr?: number }
  | { type: 'superseded'; at: number; by: string; byId?: string; follow: string; stop?: StopResult }
  | { type: 'requeued'; at: number; by: string; why: 'retry' }
  | { type: 'edited'; at: number; by: string; text: string }
  | { type: 'candidate'; at: number; candidate: Candidate }
  | { type: 'related'; at: number; sha: string; subject: string; docs: string[]; explicit?: true }
  | { type: 'link'; at: number; sha: string; verdict: 'confirmed' | 'dismissed'; by: string; byId?: string }
  | { type: 'settled'; at: number; why: 'merged' | 'cancelled' | 'set-aside' | 'not-found' | 'abandoned' };

/** One line of the record: a change made, or an event on one. Each is hash-chained to the line before. */
export type DevChangeLine = { op: 'create'; change: DevChangeNew } | { op: 'event'; id: string; event: DevChangeEvent };

/** A commit on main that overlaps a change's model units (possibly related), or names it (linked); a person may confirm or dismiss it. */
export interface Related {
  sha: string;
  subject: string;
  docs: string[];
  at: number;
  /** It names the change (its Task: line, its DC id or branch): linked, not just overlapping. */
  explicit?: true;
  verdict?: 'confirmed' | 'dismissed';
  by?: string;
  decidedAt?: number;
}

/** A change with every line folded in. */
export interface DevChange extends DevChangeNew {
  /** Where it is in the queue, from its events. */
  queue: 'queued' | 'active' | 'settled' | 'cancelled' | 'clarify' | 'superseded' | 'linked';
  activated?: Extract<DevChangeEvent, { type: 'activated' }>;
  /** Earlier hand-overs, when it was handed again (Retry). */
  previous?: Extract<DevChangeEvent, { type: 'activated' }>[];
  /** When it was put back at the front of the queue (Retry). */
  requeuedAt?: number;
  clarify?: { why: string; at: number; main?: string };
  cancelled?: { at: number; by: string; active?: true; stop?: StopResult; pr?: number };
  superseded?: { at: number; by: string; follow: string; stop?: StopResult; was: DevChange['queue'] };
  settled?: { at: number; why: Extract<DevChangeEvent, { type: 'settled' }>['why'] };
  candidates: Candidate[];
  related?: Related[];
}

const OVER = new Set<DevChange['queue']>(['cancelled', 'superseded']);

/** Folds one line into the changes read so far (in file order). Unknown lines are skipped. */
export function foldChange(into: Map<string, DevChange>, l: DevChangeLine): void {
  if (l.op === 'create' && l.change && typeof l.change.id === 'string') {
    if (!into.has(l.change.id)) into.set(l.change.id, { ...l.change, queue: l.change.linked ? 'linked' : 'queued', candidates: [] });
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
      // Before it started; or while the team had it (the worker stopped first, said in `stop`).
      if (c.queue === 'queued' || c.queue === 'clarify' || (e.active && c.queue === 'active')) ((c.queue = 'cancelled'), (c.cancelled = { at: e.at, by: e.by, ...(e.active ? { active: true as const } : {}), ...(e.stop ? { stop: e.stop } : {}), ...(e.pr ? { pr: e.pr } : {}) }));
      break;
    case 'superseded':
      if (!OVER.has(c.queue)) ((c.superseded = { at: e.at, by: e.by, follow: e.follow, ...(e.stop ? { stop: e.stop } : {}), was: c.queue }), (c.queue = 'superseded'));
      break;
    case 'requeued':
      if (c.queue === 'active' && c.activated) ((c.previous = [...(c.previous ?? []), c.activated]), (c.activated = undefined), (c.queue = 'queued'), (c.requeuedAt = e.at));
      break;
    case 'edited':
      if (c.queue === 'queued' || c.queue === 'clarify') c.text = e.text;
      break;
    case 'candidate':
      if (!c.candidates.some((x) => x.sha === e.candidate.sha)) c.candidates.push(OVER.has(c.queue) ? { ...e.candidate, late: true } : e.candidate);
      break;
    case 'related': {
      const list = (c.related ??= []);
      if (!list.some((r) => r.sha === e.sha)) list.push({ sha: e.sha, subject: e.subject, docs: e.docs, at: e.at, ...(e.explicit ? { explicit: true as const } : {}) });
      break;
    }
    case 'link': {
      const list = (c.related ??= []);
      let r = list.find((x) => x.sha === e.sha);
      if (!r) list.push((r = { sha: e.sha, subject: '', docs: [], at: e.at }));
      ((r.verdict = e.verdict), (r.by = e.by), (r.decidedAt = e.at));
      break;
    }
    case 'settled':
      if (c.queue === 'active') ((c.queue = 'settled'), (c.settled = { at: e.at, why: e.why }));
      break;
  }
}

/** The number in DC-<n>. */
export const changeNumber = (id: string) => Number(id.slice(3)) || 0;

/** A project's queue policy (server/dev-changes/policy.ts): corrections first (default on), wait for review of overlapping work (default off). */
export interface DevChangePolicy {
  correctionsFirst: boolean;
  waitForReview: boolean;
}
export const DEFAULT_CHANGE_POLICY: DevChangePolicy = { correctionsFirst: true, waitForReview: false };

/** The queue in order: a change handed again first, then corrections (by policy), then the oldest first. */
export function queuedOf(all: readonly DevChange[], policy: Pick<DevChangePolicy, 'correctionsFirst'> = DEFAULT_CHANGE_POLICY): DevChange[] {
  const rank = (c: DevChange) => (c.requeuedAt ? 0 : policy.correctionsFirst && c.of ? 1 : 2);
  return all.filter((c) => c.queue === 'queued').sort((a, b) => rank(a) - rank(b) || changeNumber(a.id) - changeNumber(b.id));
}
/** The one active change, if any (a linked record never takes the slot). */
export const activeOf = (all: readonly DevChange[]) => all.find((c) => c.queue === 'active');
/** The aliases a change answers to (CR-n, MCR-n). */
export const aliasesOf = (c: Pick<DevChange, 'linked'>) => (c.linked ? [c.linked.id] : []);

// ---- what's asked for, cleaned -------------------------------------------------------------------------------

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** A revision from the client, when it reads as one. */
export const cleanSha = (v: unknown): string | undefined => (typeof v === 'string' && SHA_RE.test(v.trim()) ? v.trim().toLowerCase() : undefined);

/** An element reference from the client: kept only when the document reads as a qualified name (and the element as a name). */
export function cleanRef(v: unknown): ElementRef | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const docType: RefDocType | undefined = r.docType === undefined ? 'page' : DOC_TYPES.includes(r.docType as RefDocType) ? (r.docType as RefDocType) : undefined;
  const docQn = str(r.docQn, 200);
  if (!docType || !(docType === 'domainmodel' ? MODULE_RE : QN_RE).test(docQn)) return undefined;
  const out: ElementRef = { docType, docQn };
  if (docType === 'domainmodel') {
    const name = str(r.name, 201);
    if (!MEMBER_RE.test(name)) return undefined;
    out.name = name;
    out.kind = name.includes('.') ? 'attribute' : 'entity';
  } else if (docType === 'microflow' || docType === 'nanoflow') out.kind = docType;
  else {
    const widgetName = str(r.widgetName, 100);
    if (widgetName && NAME_RE.test(widgetName)) out.widgetName = widgetName;
    const widgetType = str(r.widgetType, 80);
    if (out.widgetName && widgetType && /^[\w$.]+$/.test(widgetType)) out.widgetType = widgetType;
    const id = str(r.id, 64);
    if (out.widgetName && id && /^[\w+/=-]+$/.test(id)) out.id = id;
    if (r.kind !== undefined) out.kind = out.widgetName ? 'widget' : 'page';
  }
  const label = str(r.label, 120).replace(/[\u0000-\u001f]/g, ' ');
  if (label) out.label = label;
  return out;
}

/** What it points at, in words: "Submit button (SubmitBtn) on page Orders.Order_Edit", "attribute Shop.Order.Notes". */
export function refWords(r: ElementRef): string {
  const k = refKind(r);
  if (k === 'entity' || k === 'attribute') return `${r.label ? `${r.label} (` : ''}${k} ${r.docQn}.${r.name}${r.label ? ')' : ''}`;
  const doc = `${r.docType} ${r.docQn}`;
  if (!r.widgetName) return r.label ? `${r.label} (${doc})` : doc;
  return `${r.label ? `${r.label} (${r.widgetName})` : r.widgetName} on ${doc}`;
}

/** Every element a change points at: its reference, then the others. */
export const refsOf = (c: Pick<DevChangeNew, 'ref' | 'refs'>): ElementRef[] => [...(c.ref ? [c.ref] : []), ...(c.refs ?? [])];

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

// ---- a change as the page gets it ------------------------------------------------------------------------------

/** A commit on main linked or possibly related to a change, for the page: whether this viewer may confirm or dismiss it. */
export interface RelatedView extends Related {
  mayDecide: boolean;
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
  /** Checks bound to the relevant revision (its newest candidate, or its merge commit). */
  checks?: CandidateChecks;
  /** The four facts, each from its own source: execution, verification, preview availability, human review. */
  facts: ChangeFour;
  /** Whether the person asking may cancel it now (not over yet, and theirs or an admin's). */
  mayCancel: boolean;
  /** Whether they may hand it over again (it needs attention: its worker is gone and there's no PR). */
  mayRetry?: boolean;
  /** The change this correction may mark superseded (its `of`), when this viewer may. */
  maySupersede?: string;
  /** Earlier requests it overlaps that nobody has tried yet: "depends on DC-k (not yet tried)". */
  depends?: { id: string; docs: string[] }[];
  /** A candidate or PR that showed up after it was cancelled or superseded: said, never counted. */
  late?: string;
  /** Commits on main linked or possibly related to it. */
  relatedView?: RelatedView[];
  /** The ids it also answers to (CR-n, MCR-n). */
  aliases?: string[];
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

const OPEN_STATES = new Set(['queued', 'clarify', 'working', 'candidate', 'attention']);

/** The newest change that isn't over, preferring the active one, then the next queued: the panel's current change. */
export function currentChange(list: readonly DevChangeView[]): DevChangeView | undefined {
  const active = list.find((c) => c.queue === 'active');
  if (active) return active;
  const live = [...list].filter((c) => c.state !== 'cancelled' && c.queue !== 'linked').sort((a, b) => changeNumber(b.id) - changeNumber(a.id));
  return live.find((c) => OPEN_STATES.has(c.state)) ?? live[0];
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);

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
  /** The project's queue policy, and whether this viewer may change it (admins). */
  policy?: DevChangePolicy;
  mayPolicy?: boolean;
}
