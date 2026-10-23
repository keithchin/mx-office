// Guided validation's findings (C5, shared/guided-validation.ts): what a person marked on a scenario of the
// version on screen, "Works as expected" or "Something's wrong", kept per project in the office's own data
// (<data>/guided-validation/<project>.json: the marks, each with its version, and the correction a "wrong"
// made), and audited as `validation.mark`. A mark is only ever for the version the live app serves now: a
// page showing an older one is told so (409) and nothing is kept. "Something's wrong" becomes a correction
// through the change requests' own path (server/change-requests/: a task minted before anything is typed);
// when that is refused, the mark is refused with it, so a "wrong" never stands without its task.
//
// The marks are evidence beside the business status, never an input of it (the business status has no
// business-review input), so they change no verification. The seams (deps) are what index.ts wires to the
// office, so the tests drive it with fakes.

import path from 'node:path';
import { parseStoreSync } from '../durable/read.js';
import { writeTextDurableSync } from '../durable/write.js';
import { cleanPage } from '../../shared/change-requests.js';
import { correctionText, NOTE_MAX, WRONG_MIN, type FindingRecord, type Verdict } from '../../shared/guided-validation.js';
import type { AuditInput } from '../../shared/audit.js';

export interface MarkAsk {
  revision: unknown;
  scenario: unknown;
  verdict: unknown;
  note?: unknown;
  page?: unknown;
  pageMoved?: unknown;
  by: string;
  owner?: string;
}

export type MarkResult = { ok: true; finding: FindingRecord } | { ok: false; status: number; error: string; served?: string };

export interface ValidationDeps {
  dataDir: string;
  now(): number;
  /** The revision the project's live app serves now (undefined: nothing serves). */
  served(floorId: string): string | undefined;
  /** The scenarios at a revision (id and title), as the Review section lists them. */
  scenarios(floorId: string, revision: string): Promise<{ id: string; title: string }[]>;
  /** A change request through the change requests' path: the request (with its task id), or why not. */
  correct(floorId: string, ask: { text: string; page?: string; pageMoved?: boolean; revision: string; by: string; owner?: string }): Promise<{ id: string; taskId: string } | string>;
  record(e: AuditInput): void;
}

interface Book {
  version: 1;
  next: number;
  items: FindingRecord[];
}

/** How many marks a project keeps (the audit log keeps the history). */
const KEPT = 2000;
const SHA = /^[0-9a-f]{7,64}$/i;
const same = (a: string, b: string) => a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase());

export class ValidationBook {
  private books = new Map<string, Book>();

  constructor(private deps: ValidationDeps) {}

  private file(floorId: string) {
    return path.join(this.deps.dataDir, 'guided-validation', `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  private book(floorId: string): Book {
    let b = this.books.get(floorId);
    if (b) return b;
    try {
      const v = parseStoreSync(this.file(floorId)) as Partial<Book>;
      b = v?.version === 1 && Array.isArray(v.items) && typeof v.next === 'number' ? { version: 1, next: v.next, items: v.items.filter((x) => x && typeof x.revision === 'string' && typeof x.scenario === 'string') } : undefined;
    } catch {
      b = undefined;
    }
    b ??= { version: 1, next: 1, items: [] };
    this.books.set(floorId, b);
    return b;
  }

  private save(floorId: string) {
    writeTextDurableSync(this.file(floorId), JSON.stringify(this.book(floorId)));
  }

  /** The marks made at `revision` (exactly that version), oldest first. */
  at(floorId: string, revision: string): FindingRecord[] {
    return this.book(floorId).items.filter((x) => same(x.revision, revision));
  }

  /** Every mark that made a correction, newest first. */
  corrections(floorId: string): FindingRecord[] {
    return this.book(floorId)
      .items.filter((x) => x.correction)
      .sort((a, b) => b.at - a.at);
  }

  /** Marks a scenario of the version on screen. "Something's wrong" makes its correction first. */
  async mark(floorId: string, ask: MarkAsk): Promise<MarkResult> {
    const revision = typeof ask.revision === 'string' && SHA.test(ask.revision) ? ask.revision.toLowerCase() : undefined;
    if (!revision) return { ok: false, status: 400, error: 'Say which version you checked' };
    const verdict: Verdict | undefined = ask.verdict === 'works' || ask.verdict === 'wrong' ? ask.verdict : undefined;
    if (!verdict) return { ok: false, status: 400, error: 'Say whether it works as expected or something’s wrong' };
    const note = typeof ask.note === 'string' ? ask.note.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX) : '';
    if (verdict === 'wrong' && note.length < WRONG_MIN) return { ok: false, status: 400, error: 'Say what went wrong, so the team can put it right' };
    const served = this.deps.served(floorId);
    if (!served || !same(served, revision)) return { ok: false, status: 409, error: served ? 'The app moved on to another version since you opened this check. Nothing was kept: look at the new version and mark it there.' : 'The app isn’t running now, so there’s no version to mark. Nothing was kept.', ...(served ? { served } : {}) };
    const scenarioId = typeof ask.scenario === 'string' ? ask.scenario : '';
    const sc = (await this.deps.scenarios(floorId, revision)).find((s) => s.id === scenarioId);
    if (!sc) return { ok: false, status: 400, error: 'That guided check isn’t part of this version' };
    const page = cleanPage(ask.page);
    const pageMoved = !!page && ask.pageMoved === true;
    let correction: FindingRecord['correction'];
    if (verdict === 'wrong') {
      const r = await this.deps.correct(floorId, { text: correctionText(sc.title, sc.id, revision, note), ...(page ? { page } : {}), ...(pageMoved ? { pageMoved } : {}), revision, by: ask.by, ...(ask.owner ? { owner: ask.owner } : {}) });
      if (typeof r === 'string') return { ok: false, status: 400, error: r };
      if (!r.taskId) return { ok: false, status: 400, error: 'The office couldn’t make a task for this correction, so nothing was kept. Try again.' };
      correction = { id: r.id, taskId: r.taskId };
    }
    const b = this.book(floorId);
    const id = `GV-${b.next++}`;
    const finding: FindingRecord = { id, revision, scenario: sc.id, title: sc.title, verdict, ...(note ? { note } : {}), ...(page ? { page } : {}), ...(pageMoved ? { pageMoved } : {}), by: ask.by, ...(ask.owner ? { owner: ask.owner } : {}), at: this.deps.now(), ...(correction ? { correction } : {}) };
    b.items.push(finding);
    b.items = b.items.slice(-KEPT);
    try {
      this.save(floorId);
    } catch (err) {
      console.error(`agent-office: guided validation: couldn't save ${floorId}: ${(err as Error).message}`);
    }
    this.deps.record({
      floor: floorId,
      actor: { kind: 'human', name: ask.by, ...(ask.owner ? { id: ask.owner } : {}) },
      action: 'validation.mark',
      target: { kind: 'scenario', id: sc.id, label: sc.title },
      summary: `Marked the guided check “${sc.title}” on version ${revision.slice(0, 7)}: ${verdict === 'works' ? 'works as expected' : `something’s wrong, sent to the team as ${correction!.id}`}`,
      details: { id, revision, scenario: sc.id, verdict, page, length: note.length, ...(correction ? { correction: correction.id } : {}) },
      ...(correction ? { ids: { taskId: correction.taskId } } : {}),
    });
    return { ok: true, finding };
  }
}
