// Recorded as given's service (Slice 1B-2): what Needs you and the Questions page show of each answered
// decision still being followed through, the escalations' findings worked out on the asks look's reads
// (asks/readers.ts: no look of its own), and the person's three choices on one:
//   - Accept as recorded: a new answer revision (kind accept-as-recorded, basis recorded-differently) with
//     the recorded words, appended to the answer store. Nothing is sent: there's nothing to tell anyone.
//   - Send correction: a new revision (kind correction) and a dispatch through the 1B-1 dispatcher that
//     supersedes the one before, telling the agent what was decided and the citation to use now.
//   - Dismiss: stop following this revision through (a new revision shows again).
// Each is an admin's (the route checks), with the decision's expectedRev checked like any answer (a 409
// when it changed). None of them blocks other work. Only recorded as given at the current revision,
// merged into main, takes an item off by itself (shared/followthrough.ts faithful).

import path from 'node:path';
import type { AuditInput } from '../../shared/audit.js';
import { decisionLabel, type AnswerRevisionKind, type DecisionRef, type DispatchRecord } from '../../shared/dispatch.js';
import { VERDICT_WORD, type Escalation } from '../../shared/roster/escalation.js';
import { faithful, followLevel, locationWords, whereWords, type FollowAction, type FollowItem, type FollowView, type Recording } from '../../shared/followthrough.js';
import { answersMessage, type PmAnswer, type Question } from '../../shared/questions.js';
import type { AnswerLine } from '../answers/store.js';
import type { AnswerResult, Dispatcher, Target } from '../dispatch/service.js';
import type { Read } from '../asks/sources.js';
import { pushExpected, type BookData } from '../questions/book.js';
import { correctionPrompt } from '../roster/prompts.js';
import { citations, expectedFromRecord, expectedWords, judgeCitation, type Citation, type Judged } from './judge.js';
import { Locator, type Where } from './locate.js';
import { FollowStore } from './store.js';

/** The revisions that ask an agent to record a decision (an FYI noted, a dismissal or "I've done it" don't). */
const FOLLOW_KINDS: ReadonlySet<AnswerRevisionKind> = new Set(['answer', 'approve', 'reject', 'reply', 'accept-as-recorded', 'correction']);
/** The most items the feed carries. */
const MAX_ITEMS = 60;

export interface FollowQuestions {
  book(floorId: string): Promise<BookData>;
  commit(floorId: string): Promise<void>;
}

export interface FollowDeps {
  dataDir: string;
  now(): number;
  dispatcher: Dispatcher;
  /** The floor's escalations (the roster's own copies: an action updates the one answered). */
  escalations(floorId: string): Escalation[];
  questions?(): FollowQuestions | undefined;
  /** Who a correction of escalation `e` is typed to: a target maker, or why it can't be sent now. */
  escTarget(floorId: string, e: Escalation, by: string): ((text: string) => Target) | string;
  /** Who a correction of question `key` is typed to. */
  qTarget(floorId: string, key: string, by: string): Promise<((text: string) => Target) | string>;
  /** The roster written (critical) after an escalation's resolution changed. */
  flush(floorId: string): Promise<void>;
  record(e: AuditInput): void;
}

export type ActResult = { ok: true; note?: string } | { ok: false; status: number; error: string; current?: unknown };

const notYet = (at = 0): Recording => ({ outcome: 'not-recorded-yet', at });
const ACTOR = { kind: 'office' as const, name: 'Recorded as given' };

export class FollowThrough {
  readonly store: FollowStore;

  constructor(private readonly deps: FollowDeps) {
    this.store = new FollowStore(path.join(deps.dataDir, 'followthrough'));
  }

  /** The escalations followed through: answered with an answer revision that asks for a record, and that revision. */
  private escFollow(floorId: string): { e: Escalation; line: AnswerLine }[] {
    const out: { e: Escalation; line: AnswerLine }[] = [];
    for (const e of this.deps.escalations(floorId)) {
      // A duplicate closed as superseded asked nobody to record anything.
      if (e.status !== 'resolved' || !e.resolution?.answerRev || e.resolution.outcome === 'superseded') continue;
      const line = this.deps.dispatcher.answers.latest(floorId, `esc:${e.id}`);
      if (line && FOLLOW_KINDS.has(line.kind)) out.push({ e, line });
    }
    return out;
  }

  private sentOf(floorId: string, id: string | undefined): FollowItem['sent'] {
    const r = id ? this.deps.dispatcher.store.get(floorId, id) : undefined;
    return r ? { state: r.state, ...(r.confirmedBy ? { confirmedBy: r.confirmedBy } : {}), ...(r.workerName ? { to: r.workerName } : {}) } : undefined;
  }

  /** What the feed shows: each answered decision not yet recorded as given and merged (nor dismissed), the warnings first. */
  async view(floorId: string, admin: boolean): Promise<FollowView> {
    await this.deps.dispatcher.ready(floorId);
    const st = await this.store.get(floorId);
    const items: (FollowItem & { at: number })[] = [];
    for (const { e, line } of this.escFollow(floorId)) {
      const decision = `esc:${e.id}`;
      if (st.dismissed[decision]?.rev === line.rev) continue;
      const rec = st.recordings[decision] ?? notYet();
      if (faithful(rec, line.rev)) continue;
      items.push({ decision, kind: 'esc', label: decisionLabel(decision), title: e.title, rev: line.rev, decided: line.text || (line.kind === 'approve' ? VERDICT_WORD.approve : line.kind === 'reject' ? VERDICT_WORD.reject : line.kind), sent: this.sentOf(floorId, e.resolution?.dispatchId), recording: rec, ref: e.id, at: e.resolution?.at ?? e.at });
    }
    const book = await this.deps.questions?.()?.book(floorId);
    const qs = new Map((book?.set?.questions ?? []).map((q) => [q.key, q]));
    for (const a of Object.values(book?.answers ?? {})) {
      if (a.status !== 'sent' || a.answerRev === undefined || !a.expected?.length) continue;
      const decision = `q:${a.key}`;
      if (st.dismissed[decision]?.rev === a.answerRev) continue;
      const x = a.expected.find((v) => v.rev === a.answerRev) ?? a.expected[a.expected.length - 1];
      items.push({ decision, kind: 'q', label: decisionLabel(decision), title: qs.get(a.key)?.question ?? `${a.id} in ${a.file}`, rev: a.answerRev, decided: expectedWords(x), sent: this.sentOf(floorId, a.dispatchId), recording: a.recording ?? notYet(), ref: a.key, at: a.sentAt ?? a.at });
    }
    items.sort((a, b) => (followLevel(a.recording) === followLevel(b.recording) ? b.at - a.at : followLevel(a.recording) === 'warn' ? -1 : 1));
    return { floor: floorId, admin, items: items.slice(0, MAX_ITEMS).map(({ at: _at, ...i }) => i) };
  }

  /**
   * The asks look's reads (asks/readers.ts): every escalation followed through judged from the citations
   * found, located (git off the event loop, cached for the look), and kept; a change is audited.
   */
  async scan(floor: { id: string; dir: string }, reads: readonly Read[]): Promise<void> {
    await this.deps.dispatcher.ready(floor.id);
    const st = await this.store.get(floor.id);
    const follow = this.escFollow(floor.id).filter(({ e, line }) => st.dismissed[`esc:${e.id}`]?.rev !== line.rev);
    if (!follow.length) return;
    const hits = new Map<string, { where: Where; file: string; c: Citation }[]>();
    let failed = false;
    for (const r of reads) {
      for (const o of r.outcome?.values() ?? []) if (o === 'failed') failed = true;
      for (const [file, text] of r.files)
        for (const c of citations(text)) {
          const list = hits.get(c.id) ?? [];
          list.push({ where: { kind: r.place.kind, who: r.place.who, ...(r.place.dir ? { dir: r.place.dir } : {}), ...(r.place.sha ? { sha: r.place.sha } : {}), ...(r.place.branch ? { branch: r.place.branch } : {}) }, file, c });
          hits.set(c.id, list);
        }
    }
    const loc = new Locator(floor.dir);
    const now = this.deps.now();
    let changed = false;
    for (const { e } of follow) {
      const decision = `esc:${e.id}`;
      const history = await this.deps.dispatcher.answers.history(floor.id, decision);
      const had = st.recordings[decision];
      const found = hits.get(e.id) ?? [];
      // A read that failed proves nothing: what was found before stays.
      if (!found.length && failed && had) continue;
      const rec = await this.judgeEscalation(found, history, loc, now);
      st.recordings[decision] = rec;
      if (!had || had.outcome !== rec.outcome || had.rev !== rec.rev || had.location?.where !== rec.location?.where || had.location?.commitSha !== rec.location?.commitSha) {
        changed = true;
        if (rec.outcome !== 'not-recorded-yet' || had)
          this.deps.record({ floor: floor.id, actor: ACTOR, action: 'followthrough.recorded', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `${decisionLabel(decision)} rev ${history[history.length - 1]?.rev ?? '?'}: ${rec.outcome === 'recorded' ? 'recorded as given' : rec.outcome === 'recorded-differently' ? 'recorded differently' : rec.outcome === 'recorded-older-rev' ? `recorded for rev ${rec.rev}` : 'not recorded yet'}${rec.location ? ` (${whereWords(rec.location)}, ${locationWords(rec.location)})` : ''}`, details: { outcome: rec.outcome, ...(rec.location ? { location: rec.location } : {}) }, ids: { decision }, severity: followLevel(rec) === 'warn' ? 'notice' : 'info' });
      }
    }
    if (changed) await this.store.save(floor.id);
  }

  /** The best of the citations found: of the current revision before an older one, then main before a branch before a working copy, then as given first. */
  private async judgeEscalation(found: readonly { where: Where; file: string; c: Citation }[], history: readonly AnswerLine[], loc: Locator, now: number): Promise<Recording> {
    const judged = found.map((h) => ({ h, j: judgeCitation(h.c, history) })).filter((x): x is { h: (typeof found)[number]; j: Judged } => !!x.j);
    if (!judged.length) return notYet(now);
    const current = judged.filter((x) => x.j.outcome !== 'recorded-older-rev');
    const pool = current.length ? current : judged;
    const RANK = { 'merged-into-main': 3, 'committed-on-branch': 2, 'working-copy': 1 } as const;
    let best: Recording | undefined;
    const seen = new Set<string>();
    for (const { h, j } of pool) {
      const key = `${h.file}\0${h.c.block}\0${h.where.dir ?? h.where.sha}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const location = await loc.locateBlock(h.where, h.file, h.c.block);
      const rec: Recording = { outcome: j.outcome, ...(j.rev !== undefined ? { rev: j.rev } : {}), ...(j.text ? { text: j.text } : {}), location, at: now };
      const score = (r: Recording) => RANK[r.location!.where] * 2 + (r.outcome === 'recorded' ? 1 : 0);
      if (!best || score(rec) > score(best)) best = rec;
    }
    return best ?? notYet(now);
  }

  /** For stuck detection: whether register decision `id` has an answered escalation, and if so whether it's recorded faithfully. */
  async settledFor(floorId: string): Promise<(id: string) => 'faithful' | 'pending' | undefined> {
    await this.deps.dispatcher.ready(floorId);
    const st = await this.store.get(floorId);
    const follow = this.escFollow(floorId);
    return (id) => {
      const mine = follow.filter((x) => x.e.refs?.decisionId === id);
      if (!mine.length) return undefined;
      const newest = mine.sort((a, b) => (b.e.resolution?.at ?? 0) - (a.e.resolution?.at ?? 0))[0];
      return faithful(st.recordings[`esc:${newest.e.id}`], newest.line.rev) ? 'faithful' : 'pending';
    };
  }

  /** The person's choice on a follow-through item. */
  async act(floorId: string, decision: DecisionRef, action: FollowAction, o: { by: string; owner?: string; expectedRev?: number }): Promise<ActResult> {
    const view = await this.view(floorId, true);
    const it = view.items.find((i) => i.decision === decision);
    if (!it) return { ok: false, status: 409, error: 'This follow-through is no longer open' };
    if (o.expectedRev !== undefined && o.expectedRev !== it.rev) return { ok: false, status: 409, error: 'This decision changed since you opened it', current: { decision, rev: it.rev } };
    const base = { floor: floorId, actor: { kind: 'human' as const, name: o.by, ...(o.owner ? { id: o.owner } : {}) }, target: { kind: it.kind === 'esc' ? 'escalation' : 'question', id: it.ref, label: it.title.slice(0, 80) }, ids: { decision } };
    if (action === 'dismiss') {
      const st = await this.store.get(floorId);
      st.dismissed[decision] = { rev: it.rev, at: this.deps.now(), by: o.by };
      await this.store.save(floorId);
      this.deps.record({ ...base, action: 'followthrough.dismiss', summary: `Stopped following ${it.label} rev ${it.rev} through (${o.by})` });
      return { ok: true };
    }
    const r = it.recording;
    if (r.outcome !== 'recorded-differently' && r.outcome !== 'recorded-older-rev') return { ok: false, status: 400, error: 'Only a decision recorded differently can be accepted as recorded or corrected' };
    if (action === 'accept-as-recorded' && !r.text) return { ok: false, status: 400, error: 'There is no recorded text to accept' };
    const out = it.kind === 'esc' ? await this.actEscalation(floorId, it, action, o) : await this.actQuestion(floorId, it, action, o);
    if (!out.ok) return out;
    this.deps.record({ ...base, action: action === 'accept-as-recorded' ? 'followthrough.accept' : 'followthrough.correction', summary: action === 'accept-as-recorded' ? `Accepted ${it.label} as recorded (rev ${it.rev + 1}, the recorded words): ${(r.text ?? '').slice(0, 200)}` : `Sent a correction of ${it.label} (rev ${it.rev + 1}): ${it.decided.slice(0, 200)}`, details: { rev: it.rev + 1, supersedes: it.rev } });
    return out;
  }

  private result(r: AnswerResult): ActResult {
    if (!r.ok) return { ok: false, status: r.status, error: r.error, ...(r.current ? { current: r.current } : {}) };
    return r.results.some((x) => x.pending) ? { ok: true, note: "Couldn't confirm the correction was typed: say what happened on its card" } : { ok: true };
  }

  private async actEscalation(floorId: string, it: FollowItem, action: Exclude<FollowAction, 'dismiss'>, o: { by: string }): Promise<ActResult> {
    const e = this.deps.escalations(floorId).find((x) => x.id === it.ref);
    if (!e?.resolution) return { ok: false, status: 409, error: 'That escalation is no longer answered' };
    const st = await this.store.get(floorId);
    const current = () => ({ rev: e.resolution?.answerRev ?? 0, state: `answered by ${e.resolution?.by ?? 'someone'}` });
    if (action === 'accept-as-recorded') {
      const res = await this.deps.dispatcher.answer(floorId, {
        decision: it.decision,
        expectedRev: it.rev,
        current,
        revision: { kind: 'accept-as-recorded', basis: 'recorded-differently', text: it.recording.text!, by: o.by, supersedes: it.rev },
        apply: async (rev) => {
          e.resolution!.answerRev = rev;
          // The words accepted are the words recorded: as given now, wherever they are.
          st.recordings[it.decision] = { ...it.recording, outcome: 'recorded', rev, at: this.deps.now() };
          await Promise.all([this.store.save(floorId), this.deps.flush(floorId)]);
        },
      });
      return this.result(res);
    }
    const make = this.deps.escTarget(floorId, e, o.by);
    if (typeof make === 'string') return { ok: false, status: 400, error: make };
    const oldId = e.resolution.dispatchId;
    const res = await this.deps.dispatcher.answer(floorId, {
      decision: it.decision,
      expectedRev: it.rev,
      current,
      revision: { kind: 'correction', text: it.decided, by: o.by, supersedes: it.rev },
      targets: (rev) => [{ ...make(correctionPrompt({ escId: e.id, title: e.title, by: o.by, rev, decided: it.decided, recorded: it.recording.text ?? '', where: [whereWords(it.recording.location), locationWords(it.recording.location)].filter(Boolean).join(', ') })), ...(oldId ? { supersedes: oldId } : {}) }],
      apply: async (rev, records) => {
        e.resolution!.answerRev = rev;
        if (records[0]) e.resolution!.dispatchId = records[0].id;
        st.recordings[it.decision] = notYet(this.deps.now());
        await this.supersede(floorId, oldId, records[0]);
        await Promise.all([this.store.save(floorId), this.deps.flush(floorId)]);
      },
    });
    return this.result(res);
  }

  private async actQuestion(floorId: string, it: FollowItem, action: Exclude<FollowAction, 'dismiss'>, o: { by: string }): Promise<ActResult> {
    const qs = this.deps.questions?.();
    if (!qs) return { ok: false, status: 400, error: 'The Questions page is not running' };
    const book = await qs.book(floorId);
    const a: PmAnswer | undefined = book.answers[it.ref];
    const q: Question | undefined = book.set?.questions.find((x) => x.key === it.ref);
    if (!a || !q) return { ok: false, status: 409, error: 'That question is no longer there (collect again?)' };
    const current = () => ({ rev: a.answerRev ?? 0, state: a.status });
    if (action === 'accept-as-recorded') {
      const res = await this.deps.dispatcher.answer(floorId, {
        decision: it.decision,
        expectedRev: it.rev,
        current,
        revision: { kind: 'accept-as-recorded', basis: 'recorded-differently', text: it.recording.text!, by: o.by, supersedes: it.rev },
        apply: async (rev) => {
          a.answerRev = rev;
          pushExpected(a, expectedFromRecord(q, rev));
          a.recording = { ...it.recording, outcome: 'recorded', rev, at: this.deps.now() };
          if (faithful(a.recording, rev)) Object.assign(a, { status: 'recorded', recordedAt: this.deps.now(), recordedState: q.state });
          await qs.commit(floorId);
        },
      });
      return this.result(res);
    }
    const make = await this.deps.qTarget(floorId, it.ref, o.by);
    if (typeof make === 'string') return { ok: false, status: 400, error: make };
    const oldId = a.dispatchId;
    const res = await this.deps.dispatcher.answer(floorId, {
      decision: it.decision,
      expectedRev: it.rev,
      current,
      revision: { kind: 'correction', text: it.decided, by: o.by, supersedes: it.rev },
      targets: (rev) => {
        const copy: PmAnswer = { ...a, answerRev: rev };
        const text = `Correction: the BRD's record of ${a.id} differs from the Project Manager's answer (it says: ${it.recording.text ?? 'something else'}). Record it again exactly as below.\n\n${answersMessage([copy], new Map([[q.key, q]]), o.by)}`;
        return [{ ...make(text), ...(oldId ? { supersedes: oldId } : {}) }];
      },
      apply: async (rev, records) => {
        const prev = a.expected?.find((x) => x.rev === a.answerRev);
        a.answerRev = rev;
        if (prev) pushExpected(a, { ...prev, rev });
        if (records[0]) a.dispatchId = records[0].id;
        a.recording = notYet(this.deps.now());
        await this.supersede(floorId, oldId, records[0]);
        await qs.commit(floorId);
      },
    });
    return this.result(res);
  }

  /** The dispatch a correction replaces, marked so (its state stays what it was). */
  private async supersede(floorId: string, oldId: string | undefined, next: DispatchRecord | undefined) {
    if (!oldId || !next) return;
    const old = this.deps.dispatcher.store.get(floorId, oldId);
    if (old && !old.supersededBy) await this.deps.dispatcher.store.put(floorId, { ...old, supersededBy: next.id }).catch(() => undefined);
  }
}
