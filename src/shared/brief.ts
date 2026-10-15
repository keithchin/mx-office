// The New project flow's project brief (docs/site/get-started/first-project.md): what the Chief Analyst
// drafts from the description and the attached documents, what the person confirms, edits and approves,
// and the functional domains drafted after the approval. Pure code with no Node imports: the page and the
// office (server/wizard/planner/) apply the same honesty rules, so an item the model inferred is always
// Assumed until a person confirms it, and an open question is always Unverified.

import type { InterviewMode, SizeTier } from './wizard.js';
import type { SourceFolder } from './source-folder.js';

export const BRIEF_TAGS = ['answered', 'assumed', 'unverified'] as const;
export type BriefTag = (typeof BRIEF_TAGS)[number];

export const SECTION_IDS = ['goal', 'success', 'roles', 'scope', 'constraints', 'questions'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Each section's title, the line shown while it's drafted, and a tip (the mockup's words). */
export const SECTION_INFO: Record<SectionId, { title: string; status: string; tip: string; prefix: string }> = {
  goal: { title: 'Goal', status: 'Identifying the project goal…', tip: 'Tip: one sentence for the goal keeps every agent pointed the same way.', prefix: 'g' },
  success: { title: 'Success criteria', status: 'Turning "success" into things we can test…', tip: 'Each criterion becomes acceptance evidence at Stage 6.', prefix: 's' },
  roles: { title: 'User roles', status: 'Finding who uses the app…', tip: 'Roles become the app’s security roles and the "As a…" in every story.', prefix: 'r' },
  scope: { title: 'Scope', status: 'Drawing the line: in and out of scope…', tip: 'What’s out of scope is as useful as what’s in.', prefix: 'i' },
  constraints: { title: 'Constraints', status: 'Checking constraints and the platform…', tip: 'Constraints feed the ✋ Stage 3 architecture decision.', prefix: 'c' },
  questions: { title: 'Open questions', status: 'Listing what I couldn’t find…', tip: 'Open questions stay Unverified until someone answers them.', prefix: 'q' },
};

/** How a person settled an item in the brief: "chat-confirmed" is an item already in the brief that they confirmed in the chat. */
export type SettledHow = 'confirmed' | 'edited' | 'added' | 'chat' | 'chat-confirmed';
const SETTLED: readonly string[] = ['confirmed', 'edited', 'added', 'chat', 'chat-confirmed'];

/** A role's "When I…" statement the Chief Analyst wrote itself (nobody said it in those words). */
export const DRAFTED = 'drafted by the Chief Analyst';

export interface BriefItem {
  id: string;
  text: string;
  tag: BriefTag;
  /** Where it came from: "from your description", "from notes.pdf p.2", "inferred from …", "open question (from notes.pdf p.3)". */
  source: string;
  /** User roles: the role's name and its "When I… I need to…" statement (`text` is what the role is). */
  name?: string;
  when?: string;
  /** Where the statement came from: DRAFTED unless the person or a document says it ("from notes.pdf p.1"). */
  whenSource?: string;
  /** Scope: in or out. */
  side?: 'in' | 'out';
  /** A person settled it here: confirmed, edited, added it, or said it in the chat. */
  by?: { name: string; at: string; how: SettledHow };
}

export interface Brief {
  title: string;
  /** One line about the app, for the repository's description. */
  description: string;
  sections: Record<SectionId, BriefItem[]>;
}

export interface DomainStory {
  /** VIS-1. */
  id: string;
  title: string;
  /** "As a …, I want …, so that …". */
  text: string;
  /** How many acceptance criteria the story has drafted. */
  ac: number;
}

export interface Domain {
  /** Three capital letters, the stories' prefix: VIS. */
  code: string;
  name: string;
  roles: string[];
  description: string;
  stories: DomainStory[];
}

export interface Domains {
  domains: Domain[];
  /** The size tier the domains suggest (the runbook's small tier: at most 1 module, 8 screens, 25 use cases). */
  tier?: SizeTier;
  tierWhy?: string;
}

export interface Approval {
  by: string;
  at: string;
  /** How many items were still Assumed when it was approved: they're recorded as ASSUMED. */
  assumed: number;
}

/** What the office did with an attached file, said as it is. */
export type ReadState = 'text' | 'extracted' | 'given' | 'read' | 'not-read';
export const READ_LABEL: Record<ReadState, string> = {
  text: 'read as text',
  extracted: 'text extracted (no images)',
  given: 'handed to the Chief Analyst to read',
  read: 'read by the Chief Analyst',
  'not-read': 'not read',
};

export interface AttachmentNote {
  name: string;
  size: number;
  read: ReadState;
  /** More about how it was read: "first 60 KB of 210 KB", "the test planner doesn't read PDFs". */
  note?: string;
}

/** What a project plan carries of its brief (ProjectPlan.brief): written into the project at setup. */
export interface PlanBrief {
  /** The wizard draft it came from: its attachments are copied into the project's sources/ at setup. */
  draftId?: string;
  brief: Brief;
  domains?: Domains;
  approved?: Approval;
  attachments: AttachmentNote[];
  /** Drafted by hand, without the Chief Analyst. */
  manual?: boolean;
}

/** The start page's four ways in. */
export const START_MODES = ['plan', 'change', 'migrate', 'assurance'] as const;
export type StartMode = (typeof START_MODES)[number];

/** The existing app's repository a change or assurance draft names (owner/name), and its GitHub description when the office already had it. */
export interface DraftRepo {
  owner: string;
  name: string;
  description?: string;
}

/** The repository the start page sent, cleaned: undefined when it isn't a usable owner/name. */
export function draftRepoOf(raw: unknown): DraftRepo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const owner = typeof r.owner === 'string' ? r.owner.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) return undefined;
  const description = typeof r.description === 'string' ? r.description.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  return { owner, name, ...(description ? { description } : {}) };
}

/** "owner/name", for the repository field. */
export const repoText = (r: DraftRepo | undefined | null) => (r ? `${r.owner}/${r.name}` : '');

/** The repository a field names, with its description when the office's repository list already has it (no new call); null when it isn't owner/name. */
export function repoFrom(text: string, known: readonly { name: string; description?: string }[]): DraftRepo | null {
  const v = text.trim();
  const parts = v.split('/');
  if (parts.length !== 2) return null;
  const description = known.find((r) => r.name.toLowerCase() === v.toLowerCase())?.description;
  return draftRepoOf({ owner: parts[0], name: parts[1], description }) ?? null;
}

export interface ChatMsg {
  who: 'you' | 'ca';
  text: string;
  at: string;
  /** The brief's items this turn changed or added (highlighted). */
  changed?: string[];
  files?: string[];
}

/** A wizard draft as the page sees it (server/wizard/planner/drafts.ts keeps it in the office's data). */
export interface DraftView {
  id: string;
  /** Goes up by one each time the brief changes: DRAFT v2. */
  version: number;
  mode: StartMode;
  prompt: string;
  interview: InterviewMode;
  attachments: AttachmentNote[];
  /** Change and assurance: the app's repository, so a resumed draft still knows it. */
  repo?: DraftRepo;
  /** Migrate and change: a local source folder (shared/source-folder.ts), scanned, copied into sources/legacy/ at setup. */
  source?: SourceFolder;
  /** new: not drafted yet; drafting: the Chief Analyst is writing it; ready: there is a brief; failed: drafting stopped (see message). */
  status: 'new' | 'drafting' | 'ready' | 'failed';
  brief?: Brief;
  /** Filled in by hand, without the Chief Analyst. */
  manual: boolean;
  chat: ChatMsg[];
  /** What the Chief Analyst is doing for this draft now. */
  busy?: 'brief' | 'chat' | 'domains';
  approved?: Approval;
  domains?: Domains;
  domainsStatus?: 'mapping' | 'ready' | 'failed' | 'skipped';
  /** Office spend on this draft so far, and its cap, in USD. */
  spent: number;
  cap: number;
  /** Why something stopped (the cap, a failure, the planner unavailable), in a sentence. */
  message?: string;
  updatedAt: number;
  /** The setup started from it. */
  job?: string;
}

/** Whether the office can draft with the Chief Analyst now, and what it costs. */
export interface PlannerStatus {
  available: boolean;
  /** Why not, in a sentence, when it isn't. */
  why?: string;
  /** The deterministic test planner (no model call). */
  fake: boolean;
  model: string;
  /** The per-draft cap, USD. */
  capUsd: number;
  /** About what a draft costs (the brief, one chat turn and the domains), USD, before attachments; and per MB attached. */
  estimateUsd: number;
  perMbUsd: number;
  limits: { maxFiles: number; maxBytes: number; types: string[] };
}

export const ATTACH_TYPES = ['.pdf', '.docx', '.md', '.txt'] as const;
export const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACH_MAX_FILES = 5;

/** Why a file can't be attached, or undefined when it can. */
export function attachProblem(name: string, size: number, count: number): string | undefined {
  const ext = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? '';
  if (!(ATTACH_TYPES as readonly string[]).includes(ext)) return `${name}: only ${ATTACH_TYPES.join(', ')} files can be attached for now`;
  if (size > ATTACH_MAX_BYTES) return `${name} is ${(size / 1024 / 1024).toFixed(1)} MB: at most ${ATTACH_MAX_BYTES / 1024 / 1024} MB each`;
  if (size <= 0) return `${name} is empty`;
  if (count >= ATTACH_MAX_FILES) return `At most ${ATTACH_MAX_FILES} files`;
  return undefined;
}

/** A file name safe to keep on disk and to name in a prompt: no folders, no odd characters. */
export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const clean = base.replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || 'file';
}

// ---- Cleaning and the honesty rules ---------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const isTag = (v: unknown): v is BriefTag => (BRIEF_TAGS as readonly unknown[]).includes(v);
/** A source that says the item wasn't given but worked out. */
const INFERRED = /^(inferred|assum|guess|a common|common|typical|probabl|likely|default|usual)/i;
/** An "assumption" that only says something isn't known: that's an open question, not a default anyone chose. */
const UNKNOWN = /\b(not stated|unknown|unclear|not specified)\b/i;
/** A source the model said came from the chat. */
export const FROM_CHAT = /^from (the|our) chat/i;

/** An open question's source: "open question", keeping where it came from ("open question (from notes.pdf p.3)"). */
function questionSource(source: string): string {
  const s = source.trim();
  if (/^open question/i.test(s)) return s;
  return /^from /i.test(s) && !FROM_CHAT.test(s) ? `open question (${s})` : 'open question';
}

/** A role's statement source: kept when it names where the words came from, else drafted. */
const whenSourceOf = (v: unknown) => {
  const s = str(v, 200);
  return /^from /i.test(s) ? s : DRAFTED;
};

/** Whether a role's statement is still the Chief Analyst's own wording (a person who confirmed, edited or added the role made it theirs). */
export const whenDrafted = (it: BriefItem) => !!it.when && (it.whenSource ?? DRAFTED) === DRAFTED && !(it.by && it.by.how !== 'chat' && it.by.how !== 'chat-confirmed');

export const emptyBrief = (title = ''): Brief => ({ title, description: '', sections: { goal: [], success: [], roles: [], scope: [], constraints: [], questions: [] } });

/**
 * The honesty rules, on one item: an open question is Unverified; an item a person settled is Answered;
 * an "answered" item with no source, or one whose source says it was inferred, is Assumed; an assumed
 * item says it was inferred.
 */
export function honestItem(it: BriefItem, section: SectionId): BriefItem {
  if (section === 'questions') return { ...it, tag: 'unverified', source: questionSource(it.source), by: undefined };
  if (it.by) return { ...it, tag: 'answered' };
  const source = it.source.trim();
  if (it.tag === 'answered' && (!source || INFERRED.test(source))) return { ...it, tag: 'assumed', source: source || 'inferred (no source given)' };
  if (it.tag === 'assumed' && !source) return { ...it, source: 'inferred (no source given)' };
  return { ...it, source };
}

function cleanItem(raw: unknown, section: SectionId, id: string): BriefItem | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const text = str(r.text, 600);
  const name = section === 'roles' ? str(r.name, 80) : '';
  if (!text && !name) return undefined;
  const by = r.by && typeof r.by === 'object' ? (r.by as Record<string, unknown>) : undefined;
  const how = SETTLED.includes(by?.how as string) ? (by!.how as SettledHow) : undefined;
  const item: BriefItem = {
    id: /^[a-z][a-z0-9-]{0,30}$/i.test(String(r.id ?? '')) ? String(r.id) : id,
    text,
    tag: isTag(r.tag) ? r.tag : 'assumed',
    source: str(r.source, 200),
    ...(section === 'roles' ? { name: name || 'Unnamed role', when: str(r.when, 400), whenSource: whenSourceOf(r.whenSource) } : {}),
    ...(section === 'scope' ? { side: r.side === 'out' ? ('out' as const) : ('in' as const) } : {}),
    ...(how && str(by!.name, 80) ? { by: { name: str(by!.name, 80), at: str(by!.at, 40), how } } : {}),
  };
  return honestItem(item, section);
}

/** A brief from anywhere (the model, the page, a saved draft), cleaned: lengths cut, ids unique, honesty rules applied. Undefined when it isn't one. */
export function cleanBrief(raw: unknown): Brief | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const secs = (r.sections && typeof r.sections === 'object' ? r.sections : r) as Record<string, unknown>;
  const out = emptyBrief(str(r.title, 100));
  out.description = str(r.description, 300).replace(/\n+/g, ' ');
  const seen = new Set<string>();
  let any = false;
  /** "Assumed" items that only say something isn't known: they become open questions (the last section). */
  const unknowns: BriefItem[] = [];
  for (const s of SECTION_IDS) {
    const list = Array.isArray(secs[s]) ? (secs[s] as unknown[]).slice(0, 40) : [];
    if (Array.isArray(secs[s])) any = true;
    let n = 0;
    const moved = s === 'questions' ? unknowns.splice(0) : [];
    for (const x of [...list, ...moved]) {
      let it = moved.includes(x as BriefItem) ? honestItem({ ...(x as BriefItem), id: `q${++n}` }, s) : cleanItem(x, s, `${SECTION_INFO[s].prefix}${++n}`);
      if (!it) continue;
      if (s !== 'questions' && s !== 'roles' && it.tag === 'assumed' && !it.by && UNKNOWN.test(it.text)) {
        const { side: _side, ...rest } = it;
        unknowns.push(rest);
        continue;
      }
      if (s === 'scope' && it.side === 'out' && /^i\d+$/.test(it.id)) it = { ...it, id: it.id.replace(/^i/, 'o') };
      while (seen.has(it.id)) it = { ...it, id: `${SECTION_INFO[s].prefix}${++n}` };
      seen.add(it.id);
      out.sections[s].push(it);
    }
  }
  return any || out.title ? out : undefined;
}

/** Every item, in order. */
export const allItems = (b: Brief): BriefItem[] => SECTION_IDS.flatMap((s) => b.sections[s]);
export const sectionOf = (b: Brief, id: string): SectionId | undefined => SECTION_IDS.find((s) => b.sections[s].some((x) => x.id === id));

export function counts(b: Brief): { assumed: number; open: number; answered: number } {
  const all = allItems(b);
  return { assumed: all.filter((x) => x.tag === 'assumed').length, open: all.filter((x) => x.tag === 'unverified').length, answered: all.filter((x) => x.tag === 'answered').length };
}

const same = (a: BriefItem, b: BriefItem) => a.text === b.text && a.tag === b.tag && (a.name ?? '') === (b.name ?? '') && (a.when ?? '') === (b.when ?? '') && (a.side ?? '') === (b.side ?? '');
/** Settled the same way by the same person (a confirmation in the chat is a change too). */
const sameBy = (a: BriefItem, b: BriefItem) => (a.by?.how ?? '') === (b.by?.how ?? '') && (a.by?.name ?? '') === (b.by?.name ?? '') && (a.by?.at ?? '') === (b.by?.at ?? '');

/** The ids of items new or changed in `next` against `prev`, including an item a person has now settled. */
export function changedIds(prev: Brief | undefined, next: Brief): string[] {
  const old = new Map((prev ? allItems(prev) : []).map((x) => [x.id, x]));
  return allItems(next).filter((x) => !old.has(x.id) || !same(old.get(x.id)!, x) || !sameBy(old.get(x.id)!, x)).map((x) => x.id);
}

/**
 * A brief the model sent back after a chat turn, made to keep what the person settled: an item they
 * confirmed, edited or added keeps its words and its Answered tag unless the model changed it from what
 * they said in the chat ("from the chat"), and an item the model says came from the chat is the person's.
 * An item already in the brief whose only change is its source, now the chat, is one the person
 * confirmed in the chat ("confirmed by you in the chat"): Answered, and counted as a change.
 */
export function mergeTurn(prev: Brief, next: Brief, who: { name: string; at: string }): Brief {
  const old = new Map(allItems(prev).map((x) => [x.id, x]));
  const out = emptyBrief(next.title || prev.title);
  out.description = next.description || prev.description;
  for (const s of SECTION_IDS) {
    out.sections[s] = next.sections[s].map((it) => {
      const was = old.get(it.id);
      const fromChat = FROM_CHAT.test(it.source);
      if (was?.by && !fromChat) return was;
      if (!fromChat || s === 'questions') return it;
      if (!was || !same(was, it)) return honestItem({ ...it, by: { name: who.name, at: who.at, how: 'chat' } }, s);
      // Only the source changed: the person re-confirmed the item, unless they had settled it already.
      if (was.by || FROM_CHAT.test(was.source)) return was;
      return honestItem({ ...it, tag: 'answered', by: { name: who.name, at: who.at, how: 'chat-confirmed' } }, s);
    });
  }
  return out;
}

export type ItemOp =
  | { op: 'confirm'; id: string }
  | { op: 'edit'; id: string; text?: string; name?: string; when?: string }
  | { op: 'add'; section: SectionId; text: string; name?: string; when?: string; side?: 'in' | 'out' }
  | { op: 'remove'; id: string }
  | { op: 'title'; text: string };

/** The brief with a person's change: confirm (Assumed → Answered, "confirmed by you"), edit, add, remove. Or why not. */
export function applyOp(b: Brief, op: ItemOp, who: { name: string; at: string }): Brief | string {
  const out: Brief = structuredClone(b);
  if (op.op === 'title') {
    const t = str(op.text, 100);
    if (!t) return 'Give the project a name';
    out.title = t;
    return out;
  }
  if (op.op === 'add') {
    if (!(SECTION_IDS as readonly string[]).includes(op.section)) return 'No such section';
    const text = str(op.text, 600);
    const name = str(op.name, 80);
    if (!text && !name) return 'Write something first';
    const prefix = op.section === 'scope' && op.side === 'out' ? 'o' : SECTION_INFO[op.section].prefix;
    const ids = new Set(allItems(out).map((x) => x.id));
    let n = out.sections[op.section].length + 1;
    while (ids.has(`${prefix}${n}`)) n++;
    const item: BriefItem = {
      id: `${prefix}${n}`,
      text,
      tag: 'answered',
      source: 'added by you',
      ...(op.section === 'roles' ? { name: name || 'Unnamed role', when: str(op.when, 400) } : {}),
      ...(op.section === 'scope' ? { side: op.side === 'out' ? ('out' as const) : ('in' as const) } : {}),
      by: { ...who, how: 'added' },
    };
    out.sections[op.section].push(honestItem(item, op.section));
    return out;
  }
  const s = sectionOf(out, op.id);
  if (!s) return 'That item isn’t in the brief any more';
  const list = out.sections[s];
  const i = list.findIndex((x) => x.id === op.id);
  if (op.op === 'remove') {
    list.splice(i, 1);
    return out;
  }
  if (op.op === 'confirm') {
    if (s === 'questions') return 'An open question is answered in the chat, not confirmed';
    list[i] = { ...list[i], tag: 'answered', by: { ...who, how: 'confirmed' } };
    return out;
  }
  const it = list[i];
  const text = op.text === undefined ? it.text : str(op.text, 600);
  if (!text && s !== 'roles') return 'An item can’t be empty: remove it instead';
  const next: BriefItem = { ...it, text, ...(s === 'roles' ? { name: str(op.name ?? it.name, 80) || it.name, when: str(op.when ?? it.when, 400) } : {}), by: { ...who, how: 'edited' } };
  list[i] = honestItem(s === 'questions' ? { ...next, by: undefined } : next, s);
  return out;
}

/** An item's source as the page says it: "confirmed by you · 10:42", or where it came from. */
export function sourceText(it: BriefItem, me?: string): string {
  if (!it.by) return it.source;
  const who = me && it.by.name === me ? 'you' : it.by.name;
  const at = /T(\d\d:\d\d)/.exec(it.by.at)?.[1] ?? '';
  const how = it.by.how === 'chat' ? `from the chat with ${who}` : it.by.how === 'chat-confirmed' ? `confirmed by ${who} in the chat` : `${it.by.how} by ${who}`;
  return at ? `${how} · ${at}` : how;
}

/** Functional domains from the model or a saved draft, cleaned: codes of three capitals, story ids CODE-n, counts in range. */
export function cleanDomains(raw: unknown): Domains | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const used = new Set<string>();
  const domains: Domain[] = [];
  for (const d of (Array.isArray(r.domains) ? r.domains : []).slice(0, 8) as Record<string, unknown>[]) {
    const name = str(d?.name, 80);
    if (!name) continue;
    let code = (str(d.code, 8).toUpperCase().replace(/[^A-Z]/g, '') || name.toUpperCase().replace(/[^A-Z]/g, '')).slice(0, 3).padEnd(3, 'X');
    for (let n = 2; used.has(code); n++) code = `${code.slice(0, 2)}${n}`;
    used.add(code);
    const stories = (Array.isArray(d.stories) ? d.stories : []).slice(0, 8).map((s: Record<string, unknown>) => ({ title: str(s?.title, 100), text: str(s?.text, 400), ac: Math.min(9, Math.max(1, Math.round(Number(s?.ac) || 1))) })).filter((s) => s.title || s.text);
    domains.push({ code, name, roles: (Array.isArray(d.roles) ? d.roles : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 6), description: str(d.description, 400), stories: stories.map((s, i) => ({ id: `${code}-${i + 1}`, title: s.title || s.text.slice(0, 60), text: s.text, ac: s.ac })) });
  }
  if (!domains.length) return undefined;
  return { domains, ...(r.tier === 'small' || r.tier === 'standard' ? { tier: r.tier } : {}), ...(str(r.tierWhy, 300) ? { tierWhy: str(r.tierWhy, 300) } : {}) };
}

/** The brief's name as a repository slug suggestion. */
export const titleOf = (b: Brief | undefined) => b?.title.trim() || 'New project';
