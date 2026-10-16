// Change answer's service (Slice 1B-3): one decision's current answer, its full history (from the answer
// store, never the bounded copies on the escalation or the book), the work that used it (links.ts), and the
// change itself, through the 1B-1 dispatcher in its order:
//   1. the stale check: the page's expectedRev against the revision the decision's own record points at
//      (a 409 with the current state, nothing written or typed);
//   2. the claim; 3. revision n+1 appended with supersedes: n; 4–7. one dispatch to whoever records it,
//      saying "This replaces my answer rev n to ESC-<id>: … Record it as `Decided per ESC-<id> rev n+1`";
//   8. only once it settled: the escalation or the book entry points at rev n+1 and its dispatch, the
//      follow-through starts again on n+1, and rev n's finding is kept for the history (store.ts).
// A dispatch whose outcome is unclear leaves the record on rev n until reconcile or a person settles it: the
// pending change is on disk before anything is typed (pending.ts), so that survives a restart, and nothing
// moves on an unknown outcome. Every action is an admin's (the route checks).

import path from 'node:path';
import type { AuditInput } from '../../shared/audit.js';
import { decisionLabel, type AnswerRevisionKind, type DecisionRef, type DispatchRecord } from '../../shared/dispatch.js';
import type { Escalation, EscalationVerdict } from '../../shared/roster/escalation.js';
import { fyiNow, isEscalationVerdict } from '../../shared/roster/escalation.js';
import { answersMessage, expectedOf, type PmAnswer, type Question } from '../../shared/questions.js';
import { primaryAnswer, type Recording } from '../../shared/followthrough.js';
import { noWorkText, type DecisionLinks } from '../../shared/task-links.js';
import { escAnswerWords, escChangeLine, qChangeLine, Q_CHANGE_KINDS, type AnswerDetail, type ChangeBody, type HistoryRev, type QChangeKind } from '../../shared/change-answer.js';
import type { Dispatcher, Target } from '../dispatch/service.js';
import type { FollowQuestions } from '../followthrough/service.js';
import type { FollowStore } from '../followthrough/store.js';
import { expectedWords } from '../followthrough/judge.js';
import { pushExpected } from '../questions/book.js';
import { citationRule } from '../roster/prompts.js';
import { escalationLinks, questionLinks, type LinkSources } from './links.js';
import { ChangeStore, type KeptOutcome } from './store.js';
import { pendingFor, type PendingAnswers, type PendingEntry } from './pending.js';

export interface ChangeDeps {
  dataDir: string;
  now(): number;
  dispatcher: Dispatcher;
  /** Recorded as given's findings (followthrough/store.ts): an escalation's lives there. */
  follow: FollowStore;
  escalations(floorId: string): Escalation[];
  questions?(): FollowQuestions | undefined;
  escTarget(floorId: string, e: Escalation, by: string): ((text: string) => Target) | string;
  qTarget(floorId: string, key: string, by: string): Promise<((text: string) => Target) | string>;
  /** What the links read besides the escalations: the members' tasks and the model change requests. */
  sources(floorId: string): Omit<LinkSources, 'escalations' | 'blocks'>;
  /** The roster written (critical) and the team view told, after an escalation's resolution changed. */
  flush(floorId: string): Promise<void>;
  record(e: AuditInput): void;
  /** Slice 1B-4: the revision's task links and their evidence (server/tasks/links.ts). */
  taskLinks?(floorId: string, decision: DecisionRef, rev: number): Promise<DecisionLinks | undefined>;
}

export type ChangeResult = { ok: true; rev: number; note?: string } | { ok: false; status: number; error: string; current?: unknown };

/** What a change asked for (the pending entry's input, on disk until its dispatch settles). */
interface Asked {
  rev: number;
  verdict?: EscalationVerdict;
  kind?: QChangeKind;
  text: string;
  option?: string;
  by: string;
  at: number;
  oldId?: string;
}

const LEGACY = 'Answered before answer revisions were kept, so it can’t be changed here: tell the agent directly';
const notYet = (at: number): Recording => ({ outcome: 'not-recorded-yet', at });
const kindOfVerdict = (v: EscalationVerdict): AnswerRevisionKind => (v === 'approve' ? 'approve' : v === 'reject' ? 'reject' : v === 'dismiss' ? 'moot' : 'reply');
const Q_REV_KIND: Record<QChangeKind, AnswerRevisionKind> = { answer: 'answer', accept: 'accept-proposal', moot: 'moot' };
/** A dispatch that went nowhere (refused, failed): the decision stays where it was. */
const dropped = (r: DispatchRecord) => r.state === 'refused' || r.state === 'failed';
const notSentResult = (r: DispatchRecord | undefined, oldRev: number): ChangeResult | undefined => (r && dropped(r) ? { ok: false, status: 502, error: `Not sent (${r.history[r.history.length - 1]?.note ?? r.state}): the answer stays at rev ${oldRev}` } : undefined);
const kept = (r: Recording | undefined): KeptOutcome | undefined => (r ? { outcome: r.outcome, ...(r.rev !== undefined ? { rev: r.rev } : {}) } : undefined);

export class ChangeAnswer {
  readonly store: ChangeStore;
  /** Changes whose dispatch hasn't settled yet, on disk (shared with Send correction). */
  readonly pending: PendingAnswers;

  constructor(private readonly deps: ChangeDeps) {
    this.store = new ChangeStore(path.join(deps.dataDir, 'change-answer'));
    this.pending = pendingFor(deps.dataDir, deps.dispatcher);
    this.pending.record = deps.record;
    this.pending.register('change', (f, e, r) => this.finish(f, e, r));
  }

  private esc(floorId: string, decision: DecisionRef) {
    return decision.startsWith('esc:') ? this.deps.escalations(floorId).find((e) => `esc:${e.id}` === decision) : undefined;
  }

  private async question(floorId: string, decision: DecisionRef) {
    if (!decision.startsWith('q:')) return undefined;
    const qs = this.deps.questions?.();
    if (!qs) return undefined;
    const book = await qs.book(floorId);
    const key = decision.slice(2);
    return { qs, book, key, a: book.answers[key] as PmAnswer | undefined, q: book.set?.questions.find((x) => x.key === key) };
  }

  private blocksOf(book: Awaited<ReturnType<FollowQuestions['book']>> | undefined) {
    const m = new Map((book?.set?.questions ?? []).map((q) => [q.key, q.blocks]));
    return (key: string) => m.get(key) || undefined;
  }

  /** Why an escalation's answer can't be changed now, if it can't. */
  private escBlocked(e: Escalation): string | undefined {
    if (e.status !== 'resolved' || !e.resolution) return 'It isn’t answered yet: answer it on its card';
    if (e.resolution.outcome === 'superseded') return `It was closed as a duplicate${e.resolution.supersededBy ? ` of ESC-${e.resolution.supersededBy}` : ''}: change the answer there`;
    if (!e.resolution.answerRev) return LEGACY;
    return undefined;
  }

  private qBlocked(a: PmAnswer | undefined, q: Question | undefined): string | undefined {
    if (!q) return 'That question is no longer there (collect again?)';
    if (!a || (a.status !== 'sent' && a.status !== 'recorded')) return 'Its answer hasn’t been sent yet: change it on its card';
    if (a.answerRev === undefined) return LEGACY;
    return undefined;
  }

  /** One decision's current answer, history and linked work (GET /api/answers/detail). */
  async detail(floorId: string, decision: DecisionRef): Promise<AnswerDetail | string> {
    await this.deps.dispatcher.ready(floorId);
    const lines = await this.deps.dispatcher.answers.history(floorId, decision);
    const st = await this.store.get(floorId);
    const records = this.deps.dispatcher.store.list(floorId);
    const revOf = (r: DispatchRecord) => (r.decision === decision ? r.answerRev : r.covers?.find((c) => c.decision === decision)?.answerRev);
    const qx = await this.question(floorId, decision);
    const sources: LinkSources = { escalations: this.deps.escalations(floorId), ...this.deps.sources(floorId), blocks: this.blocksOf(qx?.book) };
    const e = this.esc(floorId, decision);
    let base: Pick<AnswerDetail, 'title' | 'rev' | 'links' | 'input' | 'blocked'>;
    let current: Recording | undefined;
    if (e) {
      current = (await this.deps.follow.get(floorId)).recordings[decision];
      const blocked = this.escBlocked(e);
      base = { title: e.title, rev: e.resolution?.answerRev ?? 0, links: escalationLinks(e, sources), input: { kind: 'esc', options: e.options, ...(e.recommendation ? { recommendation: e.recommendation } : {}), fyi: fyiNow(e) }, ...(blocked ? { blocked } : {}) };
    } else if (qx?.q || qx?.a) {
      current = qx.a?.recording ?? (qx.a?.status === 'recorded' ? { outcome: 'recorded', rev: qx.a.answerRev, at: qx.a.recordedAt ?? 0 } : undefined);
      const blocked = this.qBlocked(qx.a, qx.q);
      base = { title: qx.q?.question ?? qx.key, rev: qx.a?.answerRev ?? 0, links: questionLinks(qx.key, sources), input: { kind: 'q', options: qx.q?.options ?? [], ...(qx.q?.proposedPosition ? { proposedPosition: qx.q.proposedPosition } : {}) }, ...(blocked ? { blocked } : {}) };
    } else return 'No such decision';
    const revs: HistoryRev[] = lines.map((l) => {
      const outcome = l.rev === base.rev ? kept(current) : st.outcomes[decision]?.[String(l.rev)];
      return {
        rev: l.rev,
        kind: l.kind,
        ...(l.option ? { option: l.option } : {}),
        text: l.text,
        by: l.by,
        at: l.at,
        ...(l.supersedes ? { supersedes: l.supersedes } : {}),
        ...(l.basis ? { basis: l.basis } : {}),
        dispatch: records.filter((r) => revOf(r) === l.rev).map((r) => ({ state: r.state, ...(r.confirmedBy ? { confirmedBy: r.confirmedBy } : {}), ...(r.workerName ? { to: r.workerName } : {}) })),
        ...(outcome ? { outcome } : {}),
      };
    });
    const taskLinks = base.rev && this.deps.taskLinks ? await this.deps.taskLinks(floorId, decision, base.rev).catch(() => undefined) : undefined;
    return { floor: floorId, decision, label: decisionLabel(decision), ...base, revs, ...(taskLinks ? { taskLinks } : {}) };
  }

  /** The Project Manager's new answer (POST /api/answers/change). */
  async change(floorId: string, b: ChangeBody, o: { by: string; owner?: string }): Promise<ChangeResult> {
    await this.deps.dispatcher.ready(floorId);
    await this.store.get(floorId);
    const text = typeof b.text === 'string' ? b.text.replace(/\r\n?/g, '\n').trim().slice(0, 4000) : '';
    const option = typeof b.option === 'string' && b.option.trim() ? b.option.trim() : undefined;
    const e = this.esc(floorId, b.decision);
    if (e) return this.changeEscalation(floorId, e, b, { text, option, by: o.by, owner: o.owner });
    const qx = await this.question(floorId, b.decision);
    if (qx) return this.changeQuestion(floorId, qx, b, { text, option, by: o.by, owner: o.owner });
    return { ok: false, status: 404, error: 'No such decision' };
  }

  private audit(floorId: string, x: { decision: DecisionRef; kind: 'escalation' | 'question'; id: string; label: string; by: string; owner?: string; rev: number; words: string; dispatchId?: string }) {
    this.deps.record({ floor: floorId, actor: { kind: 'human', name: x.by, ...(x.owner ? { id: x.owner } : {}) }, action: 'answer.change', target: { kind: x.kind, id: x.id, label: x.label.slice(0, 80) }, summary: `Changed the answer to ${decisionLabel(x.decision)} (rev ${x.rev} replaces rev ${x.rev - 1}): ${x.words.slice(0, 200)}`, details: { rev: x.rev, supersedes: x.rev - 1 }, ids: { decision: x.decision, answerRev: x.rev, ...(x.dispatchId ? { dispatchId: x.dispatchId } : {}) }, severity: 'notice' });
  }

  private async changeEscalation(floorId: string, e: Escalation, b: ChangeBody, i: { text: string; option?: string; by: string; owner?: string }): Promise<ChangeResult> {
    const decision = `esc:${e.id}`;
    const blocked = this.escBlocked(e);
    if (blocked) return { ok: false, status: 409, error: blocked, current: { decision, rev: e.resolution?.answerRev ?? 0 } };
    // Slice 1B-4: "No implementation work required" restates the answer as it stands, with the person's reason.
    const noWork = b.noWork === true;
    const verdict = noWork ? e.resolution!.verdict : b.verdict;
    if (noWork && verdict === 'dismiss') return { ok: false, status: 400, error: 'A dismissed FYI asked for no work: there is nothing to state' };
    if (!isEscalationVerdict(verdict)) return { ok: false, status: 400, error: 'verdict is one of reply, approve, reject (dismiss for an FYI)' };
    if (verdict === 'dismiss' && !fyiNow(e)) return { ok: false, status: 400, error: 'Noted is only for an FYI: this one asks something, so answer it' };
    if (i.option && !e.options.includes(i.option)) return { ok: false, status: 400, error: 'That is not one of its options' };
    const text = noWork ? (e.resolution!.text ?? '') : i.text || (i.option ? `Go with: ${i.option}` : '');
    if (!noWork && verdict === 'reply' && !text) return { ok: false, status: 400, error: 'Write your new answer' };
    if (!noWork && verdict === 'reject' && !text) return { ok: false, status: 400, error: 'Say why it is rejected' };
    const oldRev = e.resolution!.answerRev!;
    const words = noWork ? `${noWorkText(i.text)} (the answer stands: ${escAnswerWords(verdict, text)})` : escAnswerWords(verdict, text);
    const make = verdict === 'dismiss' ? undefined : this.deps.escTarget(floorId, e, i.by);
    if (typeof make === 'string') return { ok: false, status: 400, error: make };
    const oldId = e.resolution!.dispatchId;
    const at = this.deps.now();
    const res = await this.deps.dispatcher.answer(floorId, {
      decision,
      expectedRev: typeof b.expectedRev === 'number' ? b.expectedRev : -1,
      current: () => ({ rev: e.resolution?.answerRev ?? 0, state: `answered by ${e.resolution?.by ?? 'someone'}` }),
      revision: { kind: noWork ? 'no-work-required' : kindOfVerdict(verdict), ...(i.option && !noWork ? { option: i.option } : {}), text, by: i.by, supersedes: oldRev, ...(noWork && i.text ? { note: i.text } : {}) },
      targets: (rev) => {
        if (!make) return [];
        const prompt = [`The Project Manager (${i.by}) changed their answer to your escalation “${e.title}”.`, '', escChangeLine(e.id, oldRev, rev, words), '', citationRule(e.id, rev, primaryAnswer({ text, kind: kindOfVerdict(verdict), ...(i.option && !noWork ? { option: i.option } : {}) })), `Anything you did on the strength of rev ${oldRev} may need to change: check it against this answer, and note in your journal what you changed.`].join('\n');
        const input = { verdict, text, ...(i.option ? { option: i.option } : {}), by: i.by, at, ...(oldId ? { oldId } : {}) };
        return [this.pending.guard(floorId, { ...make(prompt), ...(oldId ? { supersedes: oldId } : {}) }, { decision, fromRev: oldRev, toRev: rev, kind: 'change', at, input })];
      },
      apply: async (rev, records) => {
        const rec = records[0];
        if (rec && dropped(rec)) return;
        await this.applyEscalation(floorId, e, { rev, verdict, text, by: i.by, at, ...(oldId ? { oldId } : {}) }, rec);
        if (rec) await this.pending.clear(floorId, rec.id);
      },
    });
    if (!res.ok) return { ok: false, status: res.status, error: res.error, ...(res.current ? { current: res.current } : {}) };
    const r = res.results[0];
    const notSent = notSentResult(r.records[0], oldRev);
    if (notSent) return notSent;
    this.audit(floorId, { decision, kind: 'escalation', id: e.id, label: e.title, by: i.by, owner: i.owner, rev: r.rev, words, dispatchId: r.records[0]?.id });
    return { ok: true, rev: r.rev, ...(r.pending ? { note: "Couldn't confirm the change was typed: say what happened on its card in Needs you" } : {}) };
  }

  /** Step 8 of an escalation's change: it points at rev n+1, follow-through starts again, rev n's finding kept. */
  private async applyEscalation(floorId: string, e: Escalation, x: Asked & { verdict: EscalationVerdict }, rec: DispatchRecord | undefined) {
    const res = e.resolution!;
    const oldRev = res.answerRev ?? 0;
    const follow = await this.deps.follow.get(floorId);
    const decision = `esc:${e.id}`;
    await this.store.keep(floorId, decision, oldRev, kept(follow.recordings[decision] ?? notYet(this.deps.now())));
    const { outcome: _o, ...rest } = res;
    e.resolution = { ...rest, verdict: x.verdict, text: x.text, by: x.by, at: x.at, answerRev: x.rev, ...(rec ? { dispatchId: rec.id, delivered: true } : {}) };
    follow.recordings[decision] = notYet(this.deps.now());
    await this.supersede(floorId, x.oldId, rec);
    await Promise.all([this.deps.follow.save(floorId), this.deps.flush(floorId)]);
  }

  private async changeQuestion(floorId: string, qx: NonNullable<Awaited<ReturnType<ChangeAnswer['question']>>>, b: ChangeBody, i: { text: string; option?: string; by: string; owner?: string }): Promise<ChangeResult> {
    const { a, q, key } = qx;
    const decision = `q:${key}`;
    const blocked = this.qBlocked(a, q);
    if (blocked || !a || !q) return { ok: false, status: 409, error: blocked ?? 'That question is no longer there', current: { decision, rev: a?.answerRev ?? 0 } };
    // Slice 1B-4: "No implementation work required" restates the answer as it stands, with the person's reason.
    const noWork = b.noWork === true;
    const kind = noWork && Q_CHANGE_KINDS.includes(a.kind as QChangeKind) ? (a.kind as QChangeKind) : b.kind;
    if (!kind || !Q_CHANGE_KINDS.includes(kind)) return { ok: false, status: 400, error: noWork ? 'This answer can’t be restated as needing no work: change it instead' : `kind is one of ${Q_CHANGE_KINDS.join(', ')}` };
    // With noWork the answer stands as it is (its own text and option): only the reason is new.
    if (!noWork) {
      if (kind === 'accept' && !q.proposedPosition) return { ok: false, status: 400, error: 'There is no proposed position to accept' };
      if (kind === 'moot' && !i.text) return { ok: false, status: 400, error: 'Say why it is not relevant' };
      if (kind === 'answer' && !i.text && !i.option) return { ok: false, status: 400, error: 'Write the answer first' };
      if (i.option && (kind !== 'answer' || !q.options?.includes(i.option))) return { ok: false, status: 400, error: 'That is not one of its options' };
    }
    const make = await this.deps.qTarget(floorId, key, i.by);
    if (typeof make === 'string') return { ok: false, status: 400, error: make };
    const oldRev = a.answerRev!;
    const oldId = a.dispatchId;
    const at = this.deps.now();
    const text = noWork ? (a.text ?? '') : kind === 'accept' ? '' : i.text;
    const option = noWork ? a.option : kind === 'answer' ? i.option : undefined;
    const next = { kind, text, option, by: i.by, at };
    let words = '';
    const res = await this.deps.dispatcher.answer(floorId, {
      decision,
      expectedRev: typeof b.expectedRev === 'number' ? b.expectedRev : -1,
      current: () => ({ rev: a.answerRev ?? 0, state: a.status }),
      revision: { kind: noWork ? 'no-work-required' : Q_REV_KIND[kind], ...(option ? { option } : {}), text, by: i.by, supersedes: oldRev, ...(noWork && i.text ? { note: i.text } : {}) },
      targets: (rev) => {
        const copy: PmAnswer = { ...a, ...next, ...(text ? { text } : { text: undefined }), ...(option ? { option } : { option: undefined }), answerRev: rev };
        delete copy.fromClient;
        words = expectedWords(expectedOf(copy, q, rev));
        if (noWork) words = `${noWorkText(i.text)} (the answer stands: ${words})`;
        const input = { kind, text, ...(option ? { option } : {}), by: i.by, at, ...(oldId ? { oldId } : {}) };
        return [this.pending.guard(floorId, { ...make(`${qChangeLine(key, oldRev, rev, words)}\n\n${answersMessage([copy], new Map([[q.key, q]]), i.by)}`), ...(oldId ? { supersedes: oldId } : {}) }, { decision, fromRev: oldRev, toRev: rev, kind: 'change', at, input })];
      },
      apply: async (rev, records) => {
        const rec = records[0];
        if (rec && dropped(rec)) return;
        await this.applyQuestion(floorId, qx, { rev, kind, text, ...(option ? { option } : {}), by: i.by, at, ...(oldId ? { oldId } : {}) }, rec);
        if (rec) await this.pending.clear(floorId, rec.id);
      },
    });
    if (!res.ok) return { ok: false, status: res.status, error: res.error, ...(res.current ? { current: res.current } : {}) };
    const r = res.results[0];
    const notSent = notSentResult(r.records[0], oldRev);
    if (notSent) return notSent;
    this.audit(floorId, { decision, kind: 'question', id: key, label: q.id, by: i.by, owner: i.owner, rev: r.rev, words, dispatchId: r.records[0]?.id });
    return { ok: true, rev: r.rev, ...(r.pending ? { note: "Couldn't confirm the change was typed: say what happened on its card in Needs you" } : {}) };
  }

  /** Step 8 of a question's change: the book entry is rev n+1, sent, followed through again; rev n's finding kept. */
  private async applyQuestion(floorId: string, qx: { qs: FollowQuestions; a?: PmAnswer; q?: Question; key: string }, x: Asked & { kind: QChangeKind }, rec: DispatchRecord | undefined) {
    const { a, q, qs } = qx;
    if (!a || !q) return;
    const decision = `q:${qx.key}`;
    const was = a.recording ?? (a.status === 'recorded' ? { outcome: 'recorded' as const, rev: a.answerRev, at: 0 } : undefined);
    await this.store.keep(floorId, decision, a.answerRev ?? 0, kept(was ?? notYet(this.deps.now())));
    a.kind = x.kind;
    if (x.text) a.text = x.text;
    else delete a.text;
    if (x.option) a.option = x.option;
    else delete a.option;
    delete a.fromClient;
    delete a.recordedAt;
    delete a.recordedState;
    Object.assign(a, { by: x.by, at: x.at, answerRev: x.rev, status: 'sent', sentAt: this.deps.now(), ...(rec?.workerName ? { sentTo: rec.workerName } : {}), ...(rec ? { dispatchId: rec.id } : {}) });
    pushExpected(a, expectedOf(a, q, x.rev));
    a.recording = notYet(this.deps.now());
    await this.supersede(floorId, x.oldId, rec);
    await qs.commit(floorId);
  }

  /**
   * A pending change whose dispatch settled as typed later (reconcile found it, a person said it went through,
   * Send again went), now or after a restart (pending.ts): the decision moves to the new revision. A decision
   * no longer at the revision it replaced is left as it is.
   */
  private async finish(floorId: string, p: PendingEntry, r: DispatchRecord): Promise<void> {
    const x = { ...(p.input as Omit<Asked, 'rev'>), rev: p.toRev };
    const e = this.esc(floorId, p.decision);
    if (e) {
      if (e.resolution?.answerRev === p.fromRev && x.verdict) await this.applyEscalation(floorId, e, { ...x, verdict: x.verdict }, r);
      return;
    }
    const qx = await this.question(floorId, p.decision);
    if (qx?.a?.answerRev === p.fromRev && x.kind) await this.applyQuestion(floorId, qx, { ...x, kind: x.kind }, r);
  }

  /** The dispatch a change replaces, marked so (its state stays what it was). */
  private async supersede(floorId: string, oldId: string | undefined, next: DispatchRecord | undefined) {
    if (!oldId || !next) return;
    const old = this.deps.dispatcher.store.get(floorId, oldId);
    if (old && !old.supersededBy) await this.deps.dispatcher.store.put(floorId, { ...old, supersededBy: next.id }).catch(() => undefined);
  }
}
