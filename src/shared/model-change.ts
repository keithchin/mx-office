// "Change this" in the Model tab (docs/site/…/model.md): the person never edits the model. They pick an
// element (or several) and say what should change; the office hands that to a team member as a task (a
// prompt, the Board's ✨ New task path, through the roster's delivery so it waits for the turn under way
// unless they say now), and the member makes the change with mxcli on a branch and opens a PR. Back in
// the Model tab the element carries a badge while the request is open, a "View change" link once its PR
// exists, and nothing once it merged. What's here is pure (the browser and the tests import it): the
// element kinds, the quick chips, who it goes to by coverage, the task's text, and how a request finds its
// PR in the floor's PR list the office already keeps (no polling of its own).

import type { Coverage } from './roster/coverage.js';
import type { RoleId, TeamId } from './roster/roles.js';

export const CHANGE_KINDS = ['entity', 'attribute', 'association', 'enumeration', 'enumvalue', 'microflow', 'nanoflow', 'page', 'snippet', 'constant'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const isChangeKind = (v: unknown): v is ChangeKind => typeof v === 'string' && (CHANGE_KINDS as readonly string[]).includes(v);

export const KIND_WORD: Record<ChangeKind, string> = {
  entity: 'Entity',
  attribute: 'Attribute',
  association: 'Association',
  enumeration: 'Enumeration',
  enumvalue: 'Enumeration value',
  microflow: 'Microflow',
  nanoflow: 'Nanoflow',
  page: 'Page',
  snippet: 'Snippet',
  constant: 'Constant',
};

/** One element picked in the Model tab: what it is and its qualified name (Module.Entity.Attribute, …). */
export interface ChangeElement {
  kind: ChangeKind;
  qn: string;
}

/** The quick changes offered per kind, each a start for the text box. */
export const CHIPS: Record<ChangeKind, readonly string[]> = {
  entity: ['Rename', 'Add attribute…', 'Add association…', 'Change access rules'],
  attribute: ['Rename', 'Make required', 'Change default', 'Change type'],
  association: ['Rename', 'Change multiplicity', 'Change delete behavior'],
  enumeration: ['Add value', 'Rename', 'Remove value…'],
  enumvalue: ['Rename', 'Change caption', 'Remove'],
  microflow: ['Rename', 'Add a validation', 'Change what it does…'],
  nanoflow: ['Rename', 'Change what it does…'],
  page: ['Rename', 'Change the layout', 'Add a field…', 'Change its look'],
  snippet: ['Rename', 'Change the layout', 'Change its look'],
  constant: ['Rename', 'Change default'],
};

/** The chips a selection offers: those of its kinds, in order, each once. */
export function chipsFor(elements: readonly ChangeElement[]): string[] {
  const out: string[] = [];
  for (const e of elements) for (const c of CHIPS[e.kind]) if (!out.includes(c)) out.push(c);
  return out.slice(0, 6);
}

/** A request about how a page looks, not what it does. */
const LOOK = /\b(look|looks|style|styling|colou?rs?|spacing|padding|margin|font|typography|theme|design|align(ment)?|icon|css|brand(ing)?|visual)\b/i;

/**
 * Which team a change belongs to: a page's or snippet's look to Design, everything else (the model, the
 * logic, a page's fields and actions) to Development, whoever covers it.
 */
export function changeTeam(elements: readonly ChangeElement[], request: string): TeamId {
  const visual = elements.length > 0 && elements.every((e) => e.kind === 'page' || e.kind === 'snippet');
  return visual && LOOK.test(request) ? 'design' : 'development';
}

/** Who a change goes to by default: whoever covers its team when they're at work, else whoever covers Development, else the first hired. */
export function defaultMember(coverage: Coverage, elements: readonly ChangeElement[], request: string, hired: readonly RoleId[]): RoleId | undefined {
  const want = coverage[changeTeam(elements, request)];
  if (hired.includes(want)) return want;
  if (hired.includes(coverage.development)) return coverage.development;
  return hired[0];
}

export type ChangeWhen = 'after' | 'now';
export const cleanWhen = (v: unknown): ChangeWhen => (v === 'now' ? 'now' : 'after');

/** What the person asked for, as the office keeps it. */
export interface ChangeRequest {
  /** MCR-<n>, per floor: in the task's text and asked for in the PR, which is how the PR is found. */
  id: string;
  elements: ChangeElement[];
  /** The branch the elements were read at ('main' or a branch) and its commit. */
  ref: string;
  sha?: string;
  request: string;
  role: RoleId;
  member: string;
  workerId?: string;
  when: ChangeWhen;
  at: number;
  by: string;
  /** 'held' until the member's turn ends, then 'sent'. */
  delivery: 'sent' | 'held' | 'woke';
  /** The durable dispatch that carried it (server/dispatch/). */
  dispatchId?: string;
}

export type ChangeState = 'open' | 'merged' | 'closed';

/** A request with its PR as the floor's PR list has it. */
export interface ChangeRequestView extends ChangeRequest {
  state: ChangeState;
  pr?: { number: number; url: string; branch: string; state: string };
}

export const fullQn = (e: ChangeElement) => e.qn;
const short = (sha?: string) => (sha ? sha.slice(0, 10) : 'unknown');

/** The first line of the task: what the member's task record and the board show. */
export function taskTitle(id: string, elements: readonly ChangeElement[], request: string): string {
  const what = elements.length === 1 ? elements[0].qn : `${elements[0].qn} and ${elements.length - 1} more`;
  const said = request.replace(/\s+/g, ' ').trim();
  return `Model change request ${id}: ${what}: ${said.length > 90 ? `${said.slice(0, 89)}…` : said}`;
}

/** The task as it's typed to the member: the structured block, the person's words, and how to go about it. */
export function changeTaskText(r: Pick<ChangeRequest, 'id' | 'elements' | 'ref' | 'sha' | 'request' | 'by'>): string {
  const docs = [...new Set(r.elements.map((e) => e.qn))];
  return [
    taskTitle(r.id, r.elements, r.request),
    '',
    `From ${r.by}, picked in the Model tab.`,
    '',
    '```model-change-request',
    `id: ${r.id}`,
    `branch: ${r.ref}`,
    `commit: ${r.sha ?? 'unknown'}`,
    'elements:',
    ...r.elements.map((e) => `  - ${e.qn} (${KIND_WORD[e.kind].toLowerCase()})`),
    'request: |',
    ...r.request.replace(/\r\n?/g, '\n').trim().split('\n').map((l) => `  ${l}`),
    '```',
    '',
    `The element${r.elements.length > 1 ? 's were' : ' was'} read at ${r.ref} @ ${short(r.sha)}: if that has moved on, check ${r.elements.length > 1 ? 'they still look' : 'it still looks'} the same first.`,
    '',
    'How to do it:',
    '- Make this change with mxcli on a branch (never on main directly), run mx check, open a PR that names the element(s).',
    `- Put "${r.id}" in the PR's title or description, so the office links the PR to this request.`,
    '- If the request is ambiguous or needs a decision (data loss, security, a rename that breaks references), escalate before changing.',
    `- Before changing, see what depends on ${docs.length > 1 ? 'them' : 'it'}: the toolkit's impact skill, or \`mxcli refs\` / \`mxcli impact\` on ${docs.map((d) => `\`${d}\``).join(', ')} (they write only the git-ignored catalog).`,
  ].join('\n');
}

/** A PR as the floor's list has it (GhPull's fields this needs). */
export interface ChangePull {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  headRefName: string;
  createdAt: string;
}

/** The assigned worker's PRs, as WorkerInfo has them. */
export interface ChangeWorker {
  pr?: { number: number };
  pastPrs?: number[];
}

const named = (id: string) => new RegExp(`(^|[^\\w-])${id.replace(/-/g, '\\-')}(?![\\w-])`, 'i');

/**
 * The request's PR: one that names its id (title or description), else the assigned worker's PR opened
 * since the request (its current one, else the first of its past ones), from the cached PR list.
 */
export function linkPull(r: Pick<ChangeRequest, 'id' | 'at'>, pulls: readonly ChangePull[], worker?: ChangeWorker): ChangePull | undefined {
  const re = named(r.id);
  const byId = pulls.filter((p) => re.test(p.title) || re.test(p.body ?? '')).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (byId.length) return byId.find((p) => p.state === 'MERGED') ?? byId.find((p) => p.state === 'OPEN') ?? byId[0];
  if (!worker) return undefined;
  const since = (p: ChangePull) => Date.parse(p.createdAt) >= r.at - 60_000;
  const nums = [...(worker.pr ? [worker.pr.number] : []), ...(worker.pastPrs ?? [])];
  const mine = nums.map((n) => pulls.find((p) => p.number === n)).filter((p): p is ChangePull => !!p && since(p));
  return mine.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
}

/** The request with its PR and state: merged once the PR merged, closed once it closed unmerged. */
export function requestView(r: ChangeRequest, pulls: readonly ChangePull[], worker?: ChangeWorker): ChangeRequestView {
  const p = linkPull(r, pulls, worker);
  const state: ChangeState = p?.state === 'MERGED' ? 'merged' : p?.state === 'CLOSED' ? 'closed' : 'open';
  return { ...r, state, ...(p ? { pr: { number: p.number, url: p.url, branch: p.headRefName, state: p.state } } : {}) };
}

/** Whether a request is about `qn`: it names it, or an element inside it (an entity's attribute, an enumeration's value). */
export const touches = (r: Pick<ChangeRequest, 'elements'>, qn: string) => r.elements.some((e) => e.qn === qn || e.qn.startsWith(`${qn}.`));

/** The open requests about `qn`, newest first (merged ones are gone; one whose PR closed unmerged stays until it's settled). */
export function openFor(views: readonly ChangeRequestView[], qn: string, exact = false): ChangeRequestView[] {
  return views.filter((v) => v.state !== 'merged' && (exact ? v.elements.some((e) => e.qn === qn) : touches(v, qn))).sort((a, b) => b.at - a.at);
}

/** The badge's words: "Change requested · Ada · #123" (the PR's number once it exists). */
export function badgeText(v: Pick<ChangeRequestView, 'member' | 'pr' | 'id' | 'state'>): string {
  return `Change requested · ${v.member} · ${v.pr ? `#${v.pr.number}${v.state === 'closed' ? ' (closed)' : ''}` : v.id}`;
}
