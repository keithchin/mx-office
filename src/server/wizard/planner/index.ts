// The New project planner: the Chief Analyst drafting a project brief with the person, in the wizard
// (docs/site/get-started/first-project.md). One per office, made on first use. It keeps the drafts
// (drafts.ts), reads the attached files' text, and runs the planning calls (engine.ts: the real `claude` CLI,
// or the test planner) under hard caps: a spend cap per draft (the call's own --max-budget-usd is what the
// draft has left), a timeout per call, one request at a time per person, a cap on calls per hour across the
// office, and a pause after three failures in a row. Every call's spend is office spend (budget/meter.ts,
// source "planner"). When it can't run (no CLI, test mode without the test planner, paused, capped), the
// page offers the same brief editor to fill in by hand.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyOp, attachProblem, changedIds, cleanBrief, counts, draftRepoOf, emptyBrief, mergeTurn, safeFileName, ATTACH_MAX_BYTES, ATTACH_MAX_FILES, ATTACH_TYPES, START_MODES, type AttachmentNote, type ItemOp, type PlannerStatus, type StartMode } from '../../../shared/brief.js';
import { interviewModeOf } from '../../../shared/wizard.js';
import { fileIndexText, takesSource, type SourceFolder } from '../../../shared/source-folder.js';
import { priceOf, resolvedModel } from '../../usage.js';
import { resolveCommand } from '../../workers/process.js';
import { testModeOf } from '../../testmode.js';
import type { Ctx } from '../../office/context.js';
import { docxText } from './docx.js';
import { DraftStore, type DraftState } from './drafts.js';
import { cliEngine, type PlannerEngine, type PlannerFile } from './engine.js';
import { officeCallEnv } from './cli.js';
import { fakeEngine } from './fake.js';

export interface PlannerConfig {
  /** auto: the claude CLI; fake: the test planner; off: never (always by hand). AGENT_OFFICE_PLANNER. */
  mode: 'auto' | 'fake' | 'off';
  /** AGENT_OFFICE_PLANNER_MODEL, Sonnet by default: capable and cheap. */
  model: string;
  /** The spend cap per draft, USD (AGENT_OFFICE_PLANNER_CAP_USD). */
  capUsd: number;
  /** Per call (AGENT_OFFICE_PLANNER_TIMEOUT_S). */
  timeoutMs: number;
  /** Planning calls per hour across the office (AGENT_OFFICE_PLANNER_PER_HOUR). */
  perHour: number;
}

/** A change or assurance draft's repository; the other modes name none. */
const repoFor = (mode: StartMode, raw: unknown) => (mode === 'change' || mode === 'assurance' ? draftRepoOf(raw) : undefined);

const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

export function plannerConfig(env: NodeJS.ProcessEnv = process.env): PlannerConfig {
  const m = (env.AGENT_OFFICE_PLANNER ?? '').toLowerCase();
  return {
    mode: m === 'fake' ? 'fake' : m === 'off' ? 'off' : 'auto',
    model: /^[a-z0-9.\-[\]]{3,60}$/i.test(env.AGENT_OFFICE_PLANNER_MODEL ?? '') ? env.AGENT_OFFICE_PLANNER_MODEL! : 'sonnet',
    capUsd: num(env.AGENT_OFFICE_PLANNER_CAP_USD, 2, 0.1, 50),
    timeoutMs: num(env.AGENT_OFFICE_PLANNER_TIMEOUT_S, 240, 20, 1200) * 1000,
    perHour: num(env.AGENT_OFFICE_PLANNER_PER_HOUR, 20, 1, 500),
  };
}

/**
 * Rough sizes of a draft's calls, for the start page's "about $…": the brief, one chat turn and the
 * domains, every input token priced as a cache write (what the CLI sends it as). From the first real
 * run (2026-10-12, Sonnet 5.5, a 0.056 MB PDF): brief about 11,000 in (with the PDF) and 2,900 out,
 * $0.049; chat 5,700 in and 3,300 out, $0.047; domains 4,200 in and 1,800 out, $0.029; $0.125 in all.
 * Rounded up, these give $0.150 for that draft.
 */
const EST = { brief: [7_000, 3_500], chat: [6_000, 3_500], domains: [4_500, 2_500], tokensPerMb: 80_000 } as const;
const FAILS_BEFORE_PAUSE = 3;
const PAUSE_MS = 10 * 60_000;
/** Text read from each attached file, and from all of them, at most. */
const TEXT_PER_FILE = 60_000;
const TEXT_TOTAL = 150_000;

export interface Who {
  id: string;
  name: string;
}

const iso = (t: number) => new Date(t).toISOString();

export class Planner {
  readonly drafts: DraftStore;
  readonly engine: PlannerEngine;
  readonly config: PlannerConfig;
  private now: () => number;
  private busyPeople = new Set<string>();
  private recent: number[] = [];
  private fails = 0;
  private pausedUntil = 0;
  /** The background work of each draft, for the tests to wait on. */
  readonly running = new Map<string, Promise<void>>();

  constructor(dataDir: string, opts: { engine?: PlannerEngine; config?: PlannerConfig; now?: () => number } = {}) {
    this.config = opts.config ?? plannerConfig();
    this.now = opts.now ?? Date.now;
    this.drafts = new DraftStore(path.join(dataDir, 'wizard-drafts'));
    this.engine = opts.engine ?? defaultEngine(this.config);
    try {
      this.drafts.prune(this.now());
    } catch {
      // the folder isn't there yet
    }
  }

  /** Why the Chief Analyst can't draft now, or undefined when it can. */
  unavailable(): string | undefined {
    if (this.config.mode === 'off') return 'Drafting with the Chief Analyst is switched off in this office (AGENT_OFFICE_PLANNER=off)';
    const why = this.engine.why();
    if (why) return why;
    if (this.now() < this.pausedUntil) return 'The Chief Analyst’s planning calls failed three times in a row, so they’re paused for a few minutes';
    this.recent = this.recent.filter((t) => this.now() - t < 3_600_000);
    if (this.recent.length >= this.config.perHour) return `The office’s planning calls are capped at ${this.config.perHour} an hour, and that’s reached: try again later`;
    return undefined;
  }

  status(): PlannerStatus {
    const fake = this.engine.kind === 'fake';
    // Priced as the meter will book it: the model the CLI runs for the alias (sonnet: claude-sonnet-5-5).
    const [pin, pout] = priceOf(resolvedModel(this.config.model));
    const call = ([inT, outT]: readonly [number, number]) => (inT * pin * 1.25 + outT * pout) / 1e6;
    const why = this.unavailable();
    return {
      available: !why,
      ...(why ? { why } : {}),
      fake,
      model: fake ? 'test planner' : this.config.model,
      capUsd: this.config.capUsd,
      estimateUsd: fake ? 0 : call(EST.brief) + call(EST.chat) + call(EST.domains),
      perMbUsd: fake ? 0 : (EST.tokensPerMb * pin * 1.25) / 1e6,
      limits: { maxFiles: ATTACH_MAX_FILES, maxBytes: ATTACH_MAX_BYTES, types: [...ATTACH_TYPES] },
    };
  }

  /** A new draft for `who`: from the start page, or empty to fill in by hand. */
  create(who: Who, raw: Record<string, unknown>): DraftState {
    const mode = (START_MODES as readonly unknown[]).includes(raw.mode) ? (raw.mode as StartMode) : 'plan';
    const manual = raw.manual === true;
    const repo = repoFor(mode, raw.repo);
    return this.drafts.create({
      owner: who.id,
      ownerName: who.name,
      version: manual ? 1 : 0,
      mode,
      prompt: typeof raw.prompt === 'string' ? raw.prompt.replace(/\r/g, '').slice(0, 8000) : '',
      interview: interviewModeOf(raw.interview),
      attachments: [],
      ...(repo ? { repo } : {}),
      status: manual ? 'ready' : 'new',
      ...(manual ? { brief: emptyBrief(typeof raw.title === 'string' ? raw.title.slice(0, 100) : '') } : {}),
      manual,
      chat: [],
      spent: 0,
      cap: this.config.capUsd,
    });
  }

  /** The draft, if it's `who`'s. */
  get(id: string, who: Who): DraftState | undefined {
    const d = this.drafts.get(id);
    return d && d.owner === who.id ? d : undefined;
  }

  /** The start page's fields changed (the description, the mode, the interview style, the app's repository). */
  update(d: DraftState, raw: Record<string, unknown>) {
    if (typeof raw.prompt === 'string') d.prompt = raw.prompt.replace(/\r/g, '').slice(0, 8000);
    if ((START_MODES as readonly unknown[]).includes(raw.mode)) d.mode = raw.mode as StartMode;
    if (raw.interview !== undefined) d.interview = interviewModeOf(raw.interview);
    // The app's repository, kept only while the draft is a change or assurance (null, or another mode, forgets it).
    const repo = repoFor(d.mode, raw.repo === undefined ? d.repo : raw.repo);
    if (repo) d.repo = repo;
    else delete d.repo;
    // The source folder, kept only while the draft is a migration or a change.
    if (!takesSource(d.mode)) delete d.source;
    this.drafts.save(d);
  }

  /** The source folder, scanned (server/wizard/source-folder.ts); why not, when it can't be kept. */
  setSource(d: DraftState, folder: SourceFolder): string | undefined {
    if (d.status === 'drafting') return 'Wait for the draft to finish';
    if (!takesSource(d.mode)) return 'A source folder is for Migrate an app and Change an existing app';
    d.source = folder;
    this.drafts.save(d);
    return undefined;
  }

  clearSource(d: DraftState) {
    delete d.source;
    this.drafts.save(d);
  }

  /** Attaches a file; why not, when it can't be. */
  addFile(d: DraftState, rawName: string, bytes: Buffer): string | undefined {
    if (d.status === 'drafting') return 'Wait for the draft to finish';
    const name = safeFileName(rawName);
    const others = d.attachments.filter((a) => a.name !== name);
    const bad = attachProblem(name, bytes.length, others.length);
    if (bad) return bad;
    this.drafts.writeFile(d.id, name, bytes);
    d.attachments = [...others, this.noteOf(name, bytes)];
    this.drafts.save(d);
    return undefined;
  }

  removeFile(d: DraftState, rawName: string) {
    const name = safeFileName(rawName);
    d.attachments = d.attachments.filter((a) => a.name !== name);
    this.drafts.removeFile(d.id, name);
    this.drafts.save(d);
  }

  /** What will happen to a file, said before the draft. */
  private noteOf(name: string, bytes: Buffer): AttachmentNote {
    const ext = path.extname(name).toLowerCase();
    if (ext === '.docx') return docxText(bytes) !== undefined ? { name, size: bytes.length, read: 'extracted' } : { name, size: bytes.length, read: 'not-read', note: 'couldn’t read it as a Word document' };
    if (ext === '.pdf') return this.engine.kind === 'fake' ? { name, size: bytes.length, read: 'not-read', note: 'the test planner doesn’t read PDFs' } : { name, size: bytes.length, read: 'given' };
    return { name, size: bytes.length, read: 'text' };
  }

  /** The files as the engine gets them: their text (at most 60 KB each, 150 KB in all), or a PDF's path. */
  private filesFor(d: DraftState): PlannerFile[] {
    let left = TEXT_TOTAL;
    const out: PlannerFile[] = [];
    for (const a of d.attachments) {
      const p = path.join(this.drafts.filesDir(d.id), a.name);
      let bytes: Buffer;
      try {
        bytes = readFileSync(p);
      } catch {
        continue;
      }
      const ext = path.extname(a.name).toLowerCase();
      if (ext === '.pdf') {
        if (a.read === 'given' || a.read === 'read') out.push({ name: a.name, path: p });
        continue;
      }
      const full = ext === '.docx' ? docxText(bytes) : bytes.toString('utf8');
      if (full === undefined || left <= 0) {
        if (left <= 0) a.note = 'not read: the attachments’ text limit was reached';
        continue;
      }
      const cut = Math.min(TEXT_PER_FILE, left);
      const text = full.slice(0, cut);
      left -= text.length;
      a.note = full.length > text.length ? `first ${Math.round(text.length / 1000)} KB of ${Math.round(full.length / 1000)} KB read` : undefined;
      out.push({ name: a.name, path: p, text, note: a.note });
    }
    return out;
  }

  /** Why a planning call can't go now for `who` on `d`, or undefined (and the call is counted). */
  private gate(d: DraftState, who: Who): string | undefined {
    if (this.busyPeople.has(who.id) || d.busy) return 'The Chief Analyst is still working on your last request: wait for it to finish';
    const why = this.unavailable();
    if (why) return why;
    if (d.spent >= d.cap - 0.01) return `This draft’s planning budget ($${d.cap.toFixed(2)}) is used up: carry on by hand`;
    this.recent.push(this.now());
    return undefined;
  }

  private settle(ok: boolean) {
    if (ok) this.fails = 0;
    else if (++this.fails >= FAILS_BEFORE_PAUSE) {
      this.fails = 0;
      this.pausedUntil = this.now() + PAUSE_MS;
    }
  }

  /** Runs `work` for the draft in the background, holding `who` and the draft busy until it's done. */
  private background(d: DraftState, who: Who, busy: NonNullable<DraftState['busy']>, work: () => Promise<void>) {
    this.busyPeople.add(who.id);
    d.busy = busy;
    this.drafts.save(d);
    const p = work()
      .catch((err: Error) => {
        d.message = `Something went wrong: ${err.message}`;
      })
      .finally(() => {
        this.busyPeople.delete(who.id);
        delete d.busy;
        this.drafts.save(d);
        this.running.delete(d.id);
      });
    this.running.set(d.id, p);
  }

  /** Starts drafting the brief from the description and the files; why not, when it can't. */
  draft(d: DraftState, who: Who): string | undefined {
    if (!d.prompt.trim() && !d.attachments.length && !d.source) return 'Describe the app first, or attach a document';
    const bad = this.gate(d, who);
    if (bad) return bad;
    d.status = 'drafting';
    d.manual = false;
    delete d.message;
    d.chat = [...d.chat, { who: 'you', text: d.prompt.trim().slice(0, 600), at: iso(this.now()), ...(d.attachments.length ? { files: d.attachments.map((a) => a.name) } : {}) }];
    this.background(d, who, 'brief', async () => {
      const files = this.filesFor(d);
      // A source folder goes in as its file index only: the planner never reads the tree (its sandbox is an empty folder).
      const req = { mode: d.mode, prompt: d.prompt, files, repo: d.repo, ...(d.source && takesSource(d.mode) ? { sourceIndex: fileIndexText(d.source) } : {}) };
      let r = await this.engine.brief({ ...req, budgetUsd: d.cap - d.spent });
      d.spent += r.cost;
      // A PDF that came back unread (rehearsal 2: the model asked for page ranges and the page renderer failed): one
      // retry naming it, only while the draft's cap and the hourly limit allow, and counted against that limit.
      const unread = (filesRead: string[]) => d.attachments.filter((a) => a.read === 'given' && !filesRead.includes(a.name)).map((a) => a.name);
      const missed = r.value ? unread(r.value.filesRead) : [];
      if (r.value && missed.length && !this.unavailable() && d.cap - d.spent >= 0.01) {
        this.recent.push(this.now());
        const again = await this.engine.brief({ ...req, unread: missed, budgetUsd: d.cap - d.spent });
        d.spent += again.cost;
        if (again.value && unread(again.value.filesRead).length < missed.length) r = { ...again, value: { brief: again.value.brief, filesRead: [...new Set([...r.value.filesRead, ...again.value.filesRead])] } };
      }
      this.settle(!!r.value);
      if (!r.value) {
        d.status = d.brief ? 'ready' : 'failed';
        d.message = `${r.error ?? 'The Chief Analyst couldn’t draft the brief'}. ${d.brief ? 'The brief so far is kept.' : 'You can fill the brief in yourself.'}`;
        return;
      }
      for (const a of d.attachments) if (a.read === 'given') ((a.read = r.value.filesRead.includes(a.name) ? 'read' : 'not-read'), a.read === 'not-read' && (a.note = 'the Chief Analyst didn’t say it read it'));
      d.brief = r.value.brief;
      d.version += 1;
      d.status = 'ready';
      const c = counts(d.brief);
      d.chat.push({ who: 'ca', text: `Done. I marked ${c.assumed} item${c.assumed === 1 ? '' : 's'} as Assumed: please confirm or edit them. ${c.open} question${c.open === 1 ? '' : 's'} I couldn’t answer ${c.open === 1 ? 'is' : 'are'} Unverified. You can approve now; anything still assumed is recorded as ASSUMED.`, at: iso(this.now()) });
    });
    return undefined;
  }

  /** The brief filled in by hand from here on (the fallback, or the person's choice). */
  manual(d: DraftState) {
    d.manual = true;
    if (!d.brief) d.brief = emptyBrief();
    d.status = 'ready';
    if (!d.version) d.version = 1;
    this.drafts.save(d);
  }

  /** A person's change to an item (confirm, edit, add, remove); why not, when it can't be made. */
  op(d: DraftState, op: ItemOp, who: Who): string | undefined {
    if (!d.brief) return 'There’s no brief yet';
    if (d.approved) return 'The scope is approved: changes now go through the Chief Analyst in Discovery';
    if (d.busy === 'chat') return 'The Chief Analyst is updating the brief: wait a moment';
    const next = applyOp(d.brief, op, { name: who.name, at: iso(this.now()) });
    if (typeof next === 'string') return next;
    d.brief = next;
    d.version += 1;
    this.drafts.save(d);
    return undefined;
  }

  /** A chat message to the Chief Analyst: it answers and updates the brief; why not, when it can't. */
  chat(d: DraftState, raw: string, who: Who): string | undefined {
    const text = raw.replace(/\r/g, '').trim().slice(0, 2000);
    if (!text) return 'Write a message first';
    if (!d.brief) return 'There’s no brief yet';
    if (d.approved) {
      d.chat.push({ who: 'you', text, at: iso(this.now()) }, { who: 'ca', text: 'Noted for the Discovery task. The scope is approved; changes now go through a scope change so the ✋ Stage 0 record stays honest.', at: iso(this.now()) });
      this.drafts.save(d);
      return undefined;
    }
    const bad = this.gate(d, who);
    if (bad) return bad;
    const history = d.chat.slice();
    d.chat.push({ who: 'you', text, at: iso(this.now()) });
    this.background(d, who, 'chat', async () => {
      const before = d.brief!;
      const r = await this.engine.chat({ mode: d.mode, repo: d.repo, brief: before, history, text, budgetUsd: d.cap - d.spent });
      d.spent += r.cost;
      this.settle(!!r.value);
      if (!r.value) {
        d.chat.push({ who: 'ca', text: `I couldn’t answer that: ${r.error ?? 'the call failed'}. The brief is as it was.`, at: iso(this.now()) });
        return;
      }
      const merged = cleanBrief(mergeTurn(before, r.value.brief, { name: who.name, at: iso(this.now()) })) ?? before;
      const changed = changedIds(before, merged);
      d.brief = merged;
      if (changed.length) d.version += 1;
      d.chat.push({ who: 'ca', text: r.value.reply, at: iso(this.now()), ...(changed.length ? { changed } : {}) });
    });
    return undefined;
  }

  /** The scope approved: recorded on the draft, then the functional domains drafted (when the Chief Analyst can). */
  approve(d: DraftState, who: Who): string | undefined {
    if (!d.brief) return 'There’s no brief yet';
    if (d.busy) return 'The Chief Analyst is still working: wait for it to finish';
    if (!d.brief.title.trim()) return 'Give the project a name first';
    if (!d.approved) d.approved = { by: who.name, at: iso(this.now()), assumed: counts(d.brief).assumed };
    this.mapDomains(d, who);
    return undefined;
  }

  /** Drafts (or drafts again) the functional domains; skipped when the brief is by hand or the Chief Analyst can't. */
  mapDomains(d: DraftState, who: Who) {
    if (d.domains || d.domainsStatus === 'mapping') return this.drafts.save(d);
    const bad = d.manual ? 'This brief was filled in by hand, so the domains are left to the BRDs at Stage 2' : this.gate(d, who);
    if (bad) {
      d.domainsStatus = 'skipped';
      d.message = bad;
      return this.drafts.save(d);
    }
    d.domainsStatus = 'mapping';
    this.background(d, who, 'domains', async () => {
      const r = await this.engine.domains({ brief: d.brief!, budgetUsd: d.cap - d.spent });
      d.spent += r.cost;
      this.settle(!!r.value);
      if (!r.value) {
        d.domainsStatus = 'failed';
        d.message = `${r.error ?? 'The domains couldn’t be drafted'}: they’re left to the BRDs at Stage 2. You can still create the project.`;
        return;
      }
      d.domains = r.value;
      d.domainsStatus = 'ready';
      const n = r.value.domains.reduce((a, x) => a + x.stories.length, 0);
      d.chat.push({ who: 'ca', text: `I grouped the work into ${r.value.domains.length} functional domains with ${n} stories. They become the BRD skeleton and the first build-plan items.`, at: iso(this.now()) });
    });
  }

  /** The draft became a project's setup. */
  linkJob(id: string, job: string) {
    const d = this.drafts.get(id);
    if (!d) return;
    d.job = job;
    this.drafts.save(d);
  }

  /** The draft's attached files, for the setup to copy into the project's sources/. */
  attachmentFiles(id: string): { name: string; path: string }[] {
    const d = this.drafts.get(id);
    return d ? d.attachments.map((a) => ({ name: a.name, path: path.join(this.drafts.filesDir(id), a.name) })) : [];
  }
}

function defaultEngine(c: PlannerConfig): PlannerEngine {
  if (c.mode === 'fake') return fakeEngine();
  return cliEngine({
    claude: resolveCommand('claude'),
    // The planner needs no GitHub at all.
    env: officeCallEnv(),
    model: c.model,
    timeoutMs: c.timeoutMs,
    // A test office never calls the real Claude: only the test planner (AGENT_OFFICE_PLANNER=fake) drafts there.
    refused: () => (testModeOf().on ? 'Test mode: this office only drafts with the test planner (AGENT_OFFICE_PLANNER=fake)' : undefined),
  });
}

const offices = new WeakMap<object, Planner>();

/** The office's planner: made on first use. */
export function plannerOf(ctx: Ctx): Planner {
  let p = offices.get(ctx.cfg);
  if (!p) {
    p = new Planner(ctx.cfg.dataDir);
    offices.set(ctx.cfg, p);
  }
  return p;
}

/** The planner if something already made it (the wizard's setup asks without making one). */
export const plannerIfMade = (ctx: Ctx): Planner | undefined => offices.get(ctx.cfg);
