// The Questions service: per floor, a collection (collect.ts) at most every five minutes on its own, when
// someone asks (the page's 🔄, or opening it with nothing collected yet), and shortly after an agent's
// turn ends (it may just have written questions); one at a time per floor, never overlapping. Each is
// taken into the floor's book (book.ts) and saved; new questions waiting on the person, and answers the
// toolkit now shows recorded, are audited as questions.* (which also tells the pages to fetch again). The
// person's answers come here too, and Send: one message to the agent whose worktree the questions are in
// (or whoever covers Analysis), through the team's delivery, after their turn unless they say now. The
// office never edits a BRD itself and makes no GitHub call.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditInput } from '../../shared/audit.js';
import { answersMessage, blocksWork, needOf, needsClient, waitingOnYou, type AnswerKind, type PmAnswer, type Question, type QuestionsNeed, type QuestionsView, type Recipient } from '../../shared/questions.js';
import type { StuckDraft } from '../../shared/stuck.js';
import { emptyBook, markSent, ready, reviveBook, setAnswer, settleJudged, sinceOf, takeCollection, type BookData } from './book.js';
import type { RecordedLocation } from '../../shared/followthrough.js';
import type { Collector, Folder } from './collect.js';
import { exportRows, type ExportRow, type ExportWhich } from './export.js';
import type { AnswerResult, AnswerSpec } from '../dispatch/service.js';
import type { AnswerRevisionKind, DecisionRef } from '../../shared/dispatch.js';

/** What a Send came to: an error, or the dispatch that carried it (`unknown`: its outcome couldn't be established). */
export type QSendResult = string | undefined | { error?: string; dispatchId?: string; unknown?: boolean };

const REV_KIND: Record<AnswerKind | 'clear', AnswerRevisionKind> = { answer: 'answer', accept: 'accept-proposal', moot: 'moot', 'ask-client': 'noted', clear: 'correction' };

/** How often each floor is collected on its own. */
export const COLLECT_MS = 5 * 60_000;
/** After an agent's turn ends, how long to wait for the burst to settle. */
export const TURN_SETTLE_MS = 15_000;

export interface QFloor {
  id: string;
  name: string;
  dir: string;
}

export interface QuestionsDeps {
  dataDir: string;
  now(): number;
  floors(): Iterable<QFloor>;
  /** The floor's own folder and its agents' worktrees. */
  folders(floor: QFloor): Promise<Folder[]>;
  /** The floor's collector (one per floor, so its cache lasts). */
  collector(floor: QFloor): Collector;
  /** Who a question's answer goes to: its worktree's agent when it's at work on the floor, else whoever covers Analysis. */
  recipientOf(floor: QFloor, q: Question): Recipient | undefined;
  /** Types `text` into worker `workerId` as the person (after their turn unless `now`): an error, or undefined. */
  send(floor: QFloor, workerId: string, text: string, by: string, when: 'now' | 'after', owner?: string, covers?: { decision: DecisionRef; answerRev: number }[]): QSendResult | Promise<QSendResult>;
  /** The durable answer path (server/dispatch/): the stale check, the claim and the answer store. Without it (a test), answers are kept as before. */
  answer?(floor: QFloor, spec: AnswerSpec): Promise<AnswerResult>;
  /** Where a question's record is (Slice 1B-2): one per collection, its git cached for that collection. */
  locator?(floor: QFloor): (q: Question) => Promise<RecordedLocation | undefined>;
  /** Hours a decision may wait before it's stuck (stuck detection's setting), and whether stuck detection is on. */
  decisionHours(): number | undefined;
  record(e: AuditInput): void;
}

const ACTOR = { kind: 'office' as const, name: 'Questions' };

export class QuestionsService {
  private books = new Map<string, Promise<BookData>>();
  private running = new Map<string, Promise<void>>();
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly deps: QuestionsDeps) {}

  start() {
    this.stopped = false;
    this.timer = setInterval(() => void this.collectAll(), COLLECT_MS);
    this.timer.unref?.();
    const first = setTimeout(() => void this.collectAll(), 45_000);
    first.unref?.();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const t of this.turnTimers.values()) clearTimeout(t);
    this.turnTimers.clear();
  }

  private file(floorId: string) {
    return path.join(this.deps.dataDir, 'questions', `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  /** The floor's book, read from disk the first time (asynchronously). */
  book(floorId: string): Promise<BookData> {
    let p = this.books.get(floorId);
    if (!p) {
      p = readFile(this.file(floorId), 'utf8').then(
        (t) => reviveBook(JSON.parse(t)),
        () => emptyBook(),
      );
      this.books.set(floorId, p);
    }
    return p;
  }

  private async save(floorId: string, d: BookData) {
    if (this.stopped) return;
    const f = this.file(floorId);
    try {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(`${f}.tmp`, JSON.stringify(d));
      await rename(`${f}.tmp`, f);
    } catch (err) {
      console.error(`agent-office: questions: couldn't save ${floorId}: ${(err as Error).message}`);
    }
  }

  /** Every floor, one after another; never throws. */
  async collectAll(): Promise<void> {
    for (const f of this.deps.floors()) {
      if (this.stopped) return;
      await this.collect(f).catch((err: Error) => console.error(`agent-office: questions: couldn't collect ${f.id}: ${err.message}`));
    }
  }

  /** Whether a collection of the floor is running now. */
  collecting = (floorId: string) => this.running.has(floorId);

  /** One collection of the floor (joins the one running, if any). */
  collect(floor: QFloor): Promise<void> {
    const going = this.running.get(floor.id);
    if (going) return going;
    const p = this.collectNow(floor).finally(() => this.running.delete(floor.id));
    this.running.set(floor.id, p);
    return p;
  }

  private async collectNow(floor: QFloor) {
    const folders = await this.deps.folders(floor);
    const { set, mtimes } = await this.deps.collector(floor).collect(folders);
    if (this.stopped) return;
    const d = await this.book(floor.id);
    const now = this.deps.now();
    const before = new Map(Object.values(d.answers).map((a) => [a.key, a.recording?.outcome]));
    const { fresh, recorded, judged } = takeCollection(d, set, mtimes, now);
    // Recorded as given (Slice 1B-2): where each found record is (git, off the event loop, once per collection), then only a faithful one is recorded.
    if (judged.length) await this.locate(floor, judged);
    recorded.push(...settleJudged(judged, now));
    const differs = judged.filter(({ a }) => (a.recording?.outcome === 'recorded-differently' || a.recording?.outcome === 'recorded-older-rev') && before.get(a.key) !== a.recording.outcome);
    if (differs.length) this.deps.record({ floor: floor.id, actor: ACTOR, action: 'questions.recorded-differently', target: { kind: 'questions', id: differs.map(({ a }) => a.id).join(','), label: `${differs.length} answer${differs.length === 1 ? '' : 's'}` }, summary: `Recorded differently from your answer: ${differs.map(({ a }) => `${a.id} (${a.recording?.outcome === 'recorded-older-rev' ? `for rev ${a.recording.rev}` : 'different words'})`).join(', ')}`, details: { ids: differs.map(({ a }) => a.id) }, severity: 'notice' });
    if (fresh.length) {
      const from = [...new Set(fresh.map((q) => (q.source.where === 'main' ? 'main' : (q.source.agent ?? q.source.worktree ?? 'a worktree'))))];
      this.deps.record({ floor: floor.id, actor: ACTOR, action: 'questions.new', target: { kind: 'questions', id: `batch-${d.batch}`, label: `${fresh.length} question${fresh.length === 1 ? '' : 's'}` }, summary: `${fresh.length} open question${fresh.length === 1 ? '' : 's'} for the client on the Questions page (from ${from.join(', ')})`, details: { ids: fresh.map((q) => q.id).slice(0, 50), via: set.via }, severity: 'notice' });
    }
    if (recorded.length) this.deps.record({ floor: floor.id, actor: ACTOR, action: 'questions.recorded', target: { kind: 'questions', id: recorded.map((a) => a.id).join(','), label: `${recorded.length} answer${recorded.length === 1 ? '' : 's'}` }, summary: `Recorded in the BRDs: ${recorded.map((a) => `${a.id} (${a.recordedState})`).join(', ')}`, details: { ids: recorded.map((a) => a.id) } });
    await this.save(floor.id, d);
  }

  /** Each judged answer's record located (skipped when nothing is recorded); a failure leaves it unlocated, never "merged". */
  private async locate(floor: QFloor, judged: readonly { a: PmAnswer; q: Question }[]) {
    const at = this.deps.locator?.(floor);
    if (!at) return;
    for (const { a, q } of judged) {
      if (!a.recording || a.recording.outcome === 'not-recorded-yet') continue;
      const l = await at(q).catch(() => undefined);
      if (l) a.recording.location = l;
    }
  }

  /** Who question `key`'s answer goes to now (a correction's recipient, server/followthrough/). */
  async recipient(floor: QFloor, key: string): Promise<Recipient | undefined> {
    const q = (await this.book(floor.id)).set?.questions.find((x) => x.key === key);
    return q ? this.deps.recipientOf(floor, q) : undefined;
  }

  /** The floor's book saved after a change made outside this service (the follow-through actions, server/followthrough/). */
  async commit(floorId: string): Promise<void> {
    await this.save(floorId, await this.book(floorId));
  }

  /** An agent's turn just ended on the floor: collect again shortly (several ends at once are one collection). */
  turnEnded(floor: QFloor) {
    if (this.stopped) return;
    clearTimeout(this.turnTimers.get(floor.id));
    const t = setTimeout(() => {
      this.turnTimers.delete(floor.id);
      void this.collect(floor).catch(() => undefined);
    }, TURN_SETTLE_MS);
    t.unref?.();
    this.turnTimers.set(floor.id, t);
  }

  /** What the page shows; starts a collection (not waited for) when there's none yet or the last is old. */
  async view(floor: QFloor, admin: boolean): Promise<QuestionsView> {
    const d = await this.book(floor.id);
    if (!this.collecting(floor.id) && (!d.set || this.deps.now() - d.set.at > COLLECT_MS)) void this.collect(floor).catch(() => undefined);
    const routes: Record<string, string> = {};
    const recipients = new Map<string, Recipient>();
    for (const q of d.set?.questions ?? []) {
      const r = this.deps.recipientOf(floor, q);
      if (!r) continue;
      routes[q.key] = r.name;
      recipients.set(r.name, r);
    }
    const need = needOf(floor.id, d.set, d.answers, d.batch, d.batchSince);
    return { floor: floor.id, ...(d.set ? { set: d.set } : {}), answers: d.answers, routes, recipients: [...recipients.values()], collecting: this.collecting(floor.id), admin, ...(need ? { need } : {}) };
  }

  /** What Needs you reads: the questions waiting on the person, keyed by batch. */
  async need(floor: QFloor): Promise<QuestionsNeed | undefined> {
    const d = await this.book(floor.id);
    return needOf(floor.id, d.set, d.answers, d.batch, d.batchSince);
  }

  /** The person's answer to one question (kind 'clear' takes it back): the error, or undefined. */
  async answer(floor: QFloor, key: string, kind: AnswerKind | 'clear', o: { text?: string; option?: string; by: string; owner?: string; expectedRev?: number }): Promise<string | undefined> {
    return (await this.answerResult(floor, key, kind, o))?.error;
  }

  /**
   * answer, with the error's status: a 409 (with the current revision) when `expectedRev` is stale. With the
   * durable path, the revision is appended to the answer store (claim first, fsync'd) before the book changes.
   */
  async answerResult(floor: QFloor, key: string, kind: AnswerKind | 'clear', o: { text?: string; option?: string; by: string; owner?: string; expectedRev?: number }): Promise<{ error: string; status: number; current?: unknown } | undefined> {
    const d = await this.book(floor.id);
    const q = d.set?.questions.find((x) => x.key === key);
    if (!q) return { error: 'No such question (collect again?)', status: 400 };
    const input = { kind, ...(o.text !== undefined ? { text: o.text } : {}), ...(o.option ? { option: o.option } : {}), by: o.by, at: this.deps.now() };
    if (this.deps.answer) {
      const r = await this.deps.answer(floor, {
        decision: `q:${key}`,
        expectedRev: o.expectedRev,
        current: () => ({ rev: d.answers[key]?.answerRev ?? 0, state: d.answers[key]?.status ?? 'unanswered' }),
        // The checks setAnswer makes, on a copy: nothing is written when they fail.
        check: () => setAnswer(structuredClone(d), q, input),
        revision: { kind: REV_KIND[kind], ...(o.option ? { option: o.option } : {}), text: (o.text ?? '').trim(), by: o.by },
        apply: (rev) => {
          setAnswer(d, q, input);
          if (d.answers[key]) d.answers[key].answerRev = rev;
        },
      });
      if (!r.ok) return { error: r.error, status: r.status, ...(r.current ? { current: r.current } : {}) };
    } else {
      const err = setAnswer(d, q, input);
      if (err) return { error: err, status: 400 };
    }
    this.deps.record({ floor: floor.id, actor: { kind: 'human', name: o.by, ...(o.owner ? { id: o.owner } : {}) }, action: 'questions.answer', target: { kind: 'question', id: q.key, label: q.id }, summary: kind === 'clear' ? `Took back the answer to ${q.id}` : `${kind === 'accept' ? 'Accepted the proposal for' : kind === 'moot' ? 'Marked not relevant:' : kind === 'ask-client' ? 'To ask the client:' : 'Answered'} ${q.id} (${q.file})`, details: { kind, ...(o.text ? { text: o.text.slice(0, 500) } : {}) }, severity: 'info' });
    await this.save(floor.id, d);
    return undefined;
  }

  /** The answers ready for `to`, and the message Send would type (the page's preview). */
  async draft(floor: QFloor, to: string, by: string): Promise<{ answers: PmAnswer[]; recipient?: Recipient; text: string }> {
    const d = await this.book(floor.id);
    const qs = new Map((d.set?.questions ?? []).map((q) => [q.key, q]));
    const answers = ready(d).filter((a) => {
      const q = qs.get(a.key);
      return q && this.deps.recipientOf(floor, q)?.name === to;
    });
    const recipient = answers.length ? this.deps.recipientOf(floor, qs.get(answers[0].key)!) : undefined;
    return { answers, ...(recipient ? { recipient } : {}), text: answers.length ? answersMessage(answers, qs, by) : '' };
  }

  /** Send answers to <to>: one message with every answer ready for them, then each marked sent. */
  async send(floor: QFloor, to: string, o: { by: string; owner?: string; when: 'now' | 'after' }): Promise<string | undefined> {
    const { answers, recipient, text } = await this.draft(floor, to, o.by);
    if (!answers.length) return 'No answers are ready to send to them';
    if (!recipient) return 'Nobody is at work to record them (no analyst on the team)';
    const d = await this.book(floor.id);
    // One dispatch carrying every answer ready (covers), each at the revision the person gave.
    const covers = answers.map((a) => ({ decision: `q:${a.key}`, answerRev: d.answers[a.key]?.answerRev ?? 0 }));
    const out = await this.deps.send(floor, recipient.workerId, text, o.by, o.when, o.owner, covers);
    if (typeof out === 'string') return out;
    if (out?.error) return out.error;
    if (out?.unknown) {
      // Its outcome couldn't be established: the answers stay pending (release 47 offers Send again), pointing at the dispatch; Needs you asks the person.
      for (const a of answers) if (d.answers[a.key]) d.answers[a.key].dispatchId = out.dispatchId;
      await this.save(floor.id, d);
      return `Couldn't confirm the answers were typed to ${recipient.name}: say what happened on the card in Needs you`;
    }
    const now = this.deps.now();
    markSent(
      d,
      answers.map((a) => a.key),
      recipient.name,
      now,
    );
    if (out?.dispatchId) for (const a of answers) if (d.answers[a.key]) d.answers[a.key].dispatchId = out.dispatchId;
    this.deps.record({ floor: floor.id, actor: { kind: 'human', name: o.by, ...(o.owner ? { id: o.owner } : {}) }, action: 'questions.sent', target: { kind: 'worker', id: recipient.workerId, label: recipient.name }, summary: `Sent ${answers.length} answer${answers.length === 1 ? '' : 's'} to ${recipient.name} to record in the BRDs (${o.when === 'now' ? 'now' : 'after their turn'}): ${answers.map((a) => a.id).join(', ')}`, details: { when: o.when, ids: answers.map((a) => a.id), kinds: answers.map((a) => a.kind) }, severity: 'notice' });
    await this.save(floor.id, d);
    return undefined;
  }

  /** A Send's dispatch that settled after the fact: the answers it covers, still pending, are marked sent to it. */
  async dispatched(floorId: string, r: { id: string; decision: DecisionRef; covers?: { decision: DecisionRef }[]; workerName?: string }): Promise<void> {
    const d = await this.book(floorId);
    const keys = (r.covers?.length ? r.covers.map((c) => c.decision) : [r.decision]).filter((x) => x.startsWith('q:')).map((x) => x.slice(2)).filter((k) => d.answers[k]?.status === 'pending');
    if (!keys.length) return;
    markSent(d, keys, r.workerName ?? 'the analyst', this.deps.now());
    for (const k of keys) d.answers[k].dispatchId = r.id;
    await this.save(floorId, d);
  }

  /** The client's answers taken in (from the filled-in file or pasted lines), each ready to send. */
  async importAnswers(floor: QFloor, rows: readonly { id: string; answer: string; brd?: string }[], o: { by: string; owner?: string; how: 'file' | 'text' }): Promise<{ matched: string[]; unknown: string[]; skipped: string[] }> {
    const d = await this.book(floor.id);
    const now = this.deps.now();
    const qs = d.set?.questions ?? [];
    const out = { matched: [] as string[], unknown: [] as string[], skipped: [] as string[] };
    for (const r of rows) {
      const same = qs.filter((q) => q.id.toLowerCase() === r.id.toLowerCase());
      const q = same.length > 1 && r.brd ? (same.find((x) => (x.brd && r.brd!.startsWith(x.brd)) || r.brd === x.file) ?? same[0]) : same[0];
      if (!q) {
        out.unknown.push(r.id);
        continue;
      }
      const err = setAnswer(d, q, { kind: 'answer', text: r.answer, by: o.by, at: now, fromClient: { by: o.by, at: now } });
      (err ? out.skipped : out.matched).push(q.id);
    }
    if (out.matched.length) this.deps.record({ floor: floor.id, actor: { kind: 'human', name: o.by, ...(o.owner ? { id: o.owner } : {}) }, action: 'questions.imported', target: { kind: 'questions', id: out.matched.join(','), label: `${out.matched.length} answer${out.matched.length === 1 ? '' : 's'}` }, summary: `Imported the client's answers (${o.how === 'file' ? 'from the file' : 'pasted'}): ${out.matched.join(', ')}`, details: { ...out } });
    await this.save(floor.id, d);
    return out;
  }

  /** The rows for the client's file. */
  async exportRows(floor: QFloor, which: ExportWhich): Promise<ExportRow[]> {
    const d = await this.book(floor.id);
    return exportRows(d.set?.questions ?? [], d.answers, which);
  }

  /**
   * Stuck detection's source (stuck/sources.ts): a user-only question that blocks work and has waited on
   * the person longer than the decision threshold is a decision waiting on you, raised once; answered (or
   * settled in the BRD), it resolves by itself.
   */
  async stuckDrafts(floor: QFloor, now: number): Promise<StuckDraft[]> {
    const hours = this.deps.decisionHours();
    if (hours === undefined) return [];
    const d = await this.book(floor.id);
    const out: StuckDraft[] = [];
    for (const q of d.set?.questions ?? []) {
      if (!needsClient(q) || !blocksWork(q) || !waitingOnYou(q, d.answers[q.key])) continue;
      const since = sinceOf(d, q);
      if (since === undefined || now - since < hours * 3_600_000) continue;
      out.push({
        id: `decision-${q.brd ?? q.file.replace(/\.brd\.json$/, '')}-${q.id}`,
        kind: 'decision',
        since,
        blocks: [q.blocks!],
        evidence: [{ label: `${q.file}: openQuestions ${q.id} (${q.state}, ${q.source.where === 'main' ? 'main' : `${q.source.agent ?? q.source.worktree}'s worktree`})` }],
        decision: { id: q.id, question: q.question.length > 140 ? `${q.question.slice(0, 139)}…` : q.question, rows: '', journeys: [], brd: q.file },
        // Its decision card is the question's: one answer path, the Questions page (shared/decisions/).
        questionKey: q.key,
      });
    }
    return out;
  }
}
