// One collection of a floor's open questions: the project's folder (main) and each agent's worktree,
// each read the toolkit's way (brd.ts finds the files, script.ts runs bin/open-questions.sh for the
// verdicts), the BRDs read for what the script doesn't print (the title, kind, evidence, blocks, owner,
// proposed position), then merged by (file, id): a worktree's copy wins over main's when it says something
// different (it's newer work; every worktree also has main's files as they were), and where each came from
// is kept (whose working copy, committed or not). If the script is missing or
// fails, the BRDs' own `openQuestions` are read with the script's rules (normalise.ts) and the set says
// so; a failure never reads as "no questions". The script runs again only when a folder's files change.

import type { BrdRef, Question, QuestionSet, QuestionSource } from '../../shared/questions.js';
import { findQuestionFiles, optionsOf, raisedAt, readBrd, signatureOf, text, type ReadBrd } from './brd.js';
import { assumedWithoutConsent, normalise } from './normalise.js';
import { originFile, type ScriptOutcome, type ScriptQuestion, type ScriptRunner } from './script.js';

/** What the page says when the script couldn't give the verdicts. */
export const FALLBACK_NOTE = 'read from the BRD files (toolkit script unavailable)';

/** A folder to read: the floor's own checkout, or one of its worktrees. */
export interface Folder {
  dir: string;
  where: 'main' | 'worktree';
  agent?: string;
  workerId?: string;
  worktree?: string;
}

export interface CollectDeps {
  floor: string;
  floorDir: string;
  /** The pinned toolkit's bin/open-questions.sh, when it's there. */
  script(): Promise<string | undefined>;
  run: ScriptRunner;
  /** Which of `rels` (relative to `dir`) are new or changed in the working copy; undefined when git can't say. */
  changed(dir: string, rels: string[]): Promise<Set<string> | undefined>;
  now(): number;
}

/** One folder's reading, kept while its files don't change. */
interface FolderRead {
  sig: string;
  script?: string;
  brds: ReadBrd[];
  outcome?: ScriptOutcome;
}

export interface Collected {
  set: QuestionSet;
  /** Each question's file time (ms), for its age when nothing better is known. */
  mtimes: Record<string, number>;
}

const keyOf = (file: string, id: string) => `${file}#${id}`;

export class Collector {
  private cache = new Map<string, FolderRead>();

  constructor(private readonly deps: CollectDeps) {}

  private async readFolder(f: Folder, scriptOf: () => Promise<string | undefined>): Promise<FolderRead | undefined> {
    const found = await findQuestionFiles(f.dir);
    if (!found.brds.length && !found.smes.length) {
      this.cache.delete(f.dir);
      return undefined;
    }
    const script = await scriptOf();
    const sig = signatureOf(found);
    const hit = this.cache.get(f.dir);
    if (hit && hit.sig === sig && hit.script === script && hit.outcome?.ok) return hit;
    const brds = await Promise.all(found.brds.map(readBrd));
    const outcome: ScriptOutcome = script ? await this.deps.run(script, f.dir, this.deps.floorDir) : { ok: false, why: 'bin/open-questions.sh is not in the project\'s toolkit' };
    const read: FolderRead = { sig, ...(script ? { script } : {}), brds, outcome };
    this.cache.set(f.dir, read);
    return read;
  }

  /** Every folder, one after another (one script at a time), merged. */
  async collect(folders: readonly Folder[]): Promise<Collected> {
    // Looked for once, and only when a folder has BRDs (a pinned toolkit may have to be made first).
    let found: Promise<string | undefined> | undefined;
    const script = () => (found ??= this.deps.script().catch(() => undefined));
    const merged = new Map<string, { q: Question; mtime: number; sig: string }>();
    const brdRefs = new Map<string, BrdRef>();
    const problems: string[] = [];
    let examined = false;
    let fellBack = false;
    // Main first, so any worktree's copy replaces it.
    const ordered = [...folders].sort((a, b) => (a.where === b.where ? 0 : a.where === 'main' ? -1 : 1));
    for (const f of ordered) {
      let read: FolderRead | undefined;
      try {
        read = await this.readFolder(f, script);
      } catch (err) {
        problems.push(`${f.worktree ?? 'main'}: ${(err as Error).message}`);
        continue;
      }
      if (!read) continue;
      examined = true;
      if (!read.outcome?.ok) {
        fellBack = true;
        problems.push(`${f.worktree ?? 'main'}: ${read.outcome?.why ?? 'not run'}`);
      }
      for (const b of read.brds) if (b.error) problems.push(b.error);
      const rels = read.brds.map((b) => b.found.rel);
      const changed = await this.deps.changed(f.dir, rels).catch(() => undefined);
      const source = (rel: string): QuestionSource => ({
        where: f.where,
        ...(f.agent ? { agent: f.agent } : {}),
        ...(f.workerId ? { workerId: f.workerId } : {}),
        ...(f.worktree ? { worktree: f.worktree } : {}),
        committed: !!changed && !changed.has(rel),
        rel,
      });
      for (const { q, mtime, brd, sig } of questionsOf(read, source)) {
        const had = merged.get(q.key);
        // A file just as already read (a worktree's untouched copy of main's) stays where it was read first.
        if (had && had.sig === sig) continue;
        // A worktree beats main; between two worktrees, the newer file.
        if (had && had.q.source.where === 'worktree' && (f.where === 'main' || had.mtime >= mtime)) continue;
        merged.set(q.key, { q, mtime, sig });
        if (brd) brdRefs.set(brd.file, brd);
      }
    }
    const questions = [...merged.values()].map((x) => x.q);
    const brds = [...brdRefs.values()].filter((b) => questions.some((q) => q.file === b.file)).sort((a, b) => a.file.localeCompare(b.file));
    const via: QuestionSet['via'] = !examined ? 'none' : fellBack ? 'brd' : 'script';
    const set: QuestionSet = { floor: this.deps.floor, at: this.deps.now(), via, ...(via === 'brd' ? { note: FALLBACK_NOTE } : {}), brds, questions, ...(problems.length ? { problems: problems.slice(0, 20) } : {}) };
    return { set, mtimes: Object.fromEntries([...merged].map(([k, v]) => [k, v.mtime])) };
  }
}

/** A folder's questions: each BRD's with the script's verdict (or the rules' when it didn't run), and the script's rows from sme-questions.md alone. */
function questionsOf(read: FolderRead, source: (rel: string) => QuestionSource): { q: Question; mtime: number; brd?: BrdRef; sig: string }[] {
  const rows = read.outcome?.ok ? read.outcome.json.questions : [];
  const byKey = new Map<string, ScriptQuestion>();
  for (const r of rows) for (const part of r.origin.split('+').map((s) => s.trim())) byKey.set(keyOf(part, r.id), r);
  const used = new Set<ScriptQuestion>();
  const out: { q: Question; mtime: number; brd?: BrdRef; sig: string }[] = [];
  for (const b of read.brds) {
    const ref: BrdRef = { file: b.file, ...(b.id ? { id: b.id } : {}), ...(b.title ? { title: b.title } : {}) };
    // The whole file's questions: a worktree whose copy differs in any of them owns them all (it's the one to record answers in).
    const sig = JSON.stringify(b.questions);
    for (const raw of b.questions) {
      const id = text(raw.id);
      const question = text(raw.question);
      if (!id || !question) continue;
      const row = byKey.get(keyOf(b.file, id));
      if (row) used.add(row);
      const rule = normalise(raw);
      const state = row?.state ?? rule.state;
      const since = raisedAt(raw.raisedAtGate);
      const q: Question = {
        key: keyOf(b.file, id),
        id,
        file: b.file,
        ...(b.id ? { brd: b.id } : {}),
        ...(b.title ? { brdTitle: b.title } : {}),
        question,
        ...opt('kind', text(raw.kind)),
        state,
        rawStatus: text(raw.status) ?? '',
        ...opt('reason', row?.reason ?? rule.reason),
        ...opt('evidence', text(raw.evidence)),
        ...opt('proposedPosition', text(raw.proposedPosition)),
        ...opt('blocks', text(raw.blocks)),
        ...opt('owner', text(raw.owner)),
        ...opt('sourceRef', text(raw.sourceRef)),
        ...opt('options', optionsOf(raw.options)),
        ...opt('answer', text(raw.answer) ?? text(raw.resolution)),
        ...opt('consentBy', text(raw.consentBy)),
        ...opt('consentAt', text(raw.consentAt)),
        ...opt('assumption', text(raw.decision) ?? text(raw.assumption) ?? (row?.assumption || undefined)),
        ...(state === 'UNRAISED' && assumedWithoutConsent(raw) ? { assumedNoConsent: true } : {}),
        ...(since !== undefined ? { since } : {}),
        source: source(b.found.rel),
      };
      out.push({ q, mtime: b.found.mtimeMs, brd: ref, sig });
    }
  }
  // What only sme-questions.md has (no BRD carries it).
  for (const r of rows) {
    if (used.has(r)) continue;
    const file = originFile(r.origin);
    if (file.endsWith('.brd.json')) continue;
    out.push({
      q: { key: keyOf(file, r.id), id: r.id, file, question: r.question, state: r.state, rawStatus: r.rawStatus ?? '', ...opt('reason', r.reason), ...opt('assumption', r.assumption || undefined), source: source(`analysis/${file}`) },
      mtime: 0,
      sig: JSON.stringify(r),
    });
  }
  return out;
}

function opt<K extends string, V>(k: K, v: V | undefined): { [P in K]?: V } {
  return (v === undefined ? {} : { [k]: v }) as { [P in K]?: V };
}
