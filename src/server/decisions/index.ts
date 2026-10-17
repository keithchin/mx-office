// Decision cards on the server (shared/decisions/, docs/site/using-the-office/needs-you.md): the person's
// Separate choices (./store.ts), and a card's buttons that answer escalations in a way the plain answer
// route doesn't: Noted (an FYI), I've done it (a hands-on action: the agent re-checks, never "APPROVED",
// then a harmless status check where one exists, ./check.ts), Can't now, and for an AWAITING-PM line
// that's gone, Resolved or Still needed. An answer on a card that folds several escalations answers each:
// FYIs among them are noted. Every action is audited (decisions.* or escalation.*); the routes
// (http/routes/decisions.ts) let only admins act.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { escalationKind, doneMessage } from '../../shared/decisions/words.js';
import type { DecisionsView, DecisionSplit } from '../../shared/decisions/types.js';
import type { EscalationVerdict } from '../../shared/roster/escalation.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { answerGroup, type EscalationAnswer } from '../roster/escalation-answer.js';
import type { AnswerResult } from '../dispatch/service.js';
import { audit, human } from '../audit/index.js';
import { SplitsStore } from './store.js';
import { checkFor, runCheck, type CheckResult } from './check.js';
import { closeDuplicates, type CloseRequest } from './duplicates.js';
import { allowCommand, keepBlocked } from './permission.js';

export type DecisionAction = 'separate' | 'answer' | 'noted' | 'done' | 'cant-now' | 'resolved' | 'still-needed' | 'close-duplicates' | 'allow-command' | 'keep-blocked';
export const DECISION_ACTIONS: readonly DecisionAction[] = ['separate', 'answer', 'noted', 'done', 'cant-now', 'resolved', 'still-needed', 'close-duplicates', 'allow-command', 'keep-blocked'];
export const isDecisionAction = (v: unknown): v is DecisionAction => typeof v === 'string' && (DECISION_ACTIONS as readonly string[]).includes(v);

export interface DecisionAct {
  action: DecisionAction;
  /** The card's primary escalation. */
  escalation?: string;
  /** The card's other open escalations (an answer answers them too). */
  others?: string[];
  verdict?: EscalationVerdict;
  text?: string;
  cardId?: string;
  sourceId?: string;
  /** The answer revision the page saw on the card's escalation (0 for an open one): a stale one is a 409. */
  expectedRev?: number;
  /** Close duplicates (the clean-up card, ./duplicates.ts): the groups the person confirmed. */
  groups?: CloseRequest[];
}

/** A card action's outcome: an error (with its HTTP status: 409 when the decision changed meanwhile), or nothing. */
export type ActError = { error: string; status: number; current?: unknown } | undefined;
const fail = (error: string | undefined): ActError => (error ? { error, status: 400 } : undefined);

/** GET /api/decisions: the splits, and the status checks run after I've done it (by escalation id). */
export interface DecisionsFullView extends DecisionsView {
  checks: Record<string, CheckResult>;
}

const services = new WeakMap<object, DecisionsService>();

export function decisionsOf(ctx: Ctx): DecisionsService {
  let s = services.get(ctx.cfg);
  if (!s) services.set(ctx.cfg, (s = new DecisionsService(ctx)));
  return s;
}

export class DecisionsService {
  readonly splits: SplitsStore;
  /** The last status check per floor and escalation (kept in memory: a check is a hint, not a record). */
  private checks = new Map<string, Record<string, CheckResult>>();

  constructor(private readonly ctx: Ctx) {
    this.splits = new SplitsStore(ctx.cfg.dataDir);
  }

  async view(floor: Floor, admin: boolean): Promise<DecisionsFullView> {
    return { floor: floor.id, splits: await this.splits.get(floor.id), admin, checks: { ...(this.checks.get(floor.id) ?? {}) } };
  }

  /** A card's button: the error, or undefined when it's done. `by`/`owner`: who pressed it. */
  async act(floor: Floor, a: DecisionAct, by: string, owner?: string): Promise<string | undefined> {
    return (await this.actResult(floor, a, by, owner))?.error;
  }

  /** act, with the error's HTTP status (a 409 carries the decision's current state). */
  async actResult(floor: Floor, a: DecisionAct, by: string, owner?: string): Promise<ActError> {
    const actor = human(by, owner);
    if (a.action === 'separate') {
      if (!a.cardId || !a.sourceId || a.cardId === a.sourceId) return fail('Which source, from which card?');
      const s: DecisionSplit = { cardId: a.cardId.slice(0, 300), sourceId: a.sourceId.slice(0, 300), by, at: Date.now() };
      if (await this.splits.add(floor.id, s)) audit.record({ floor: floor.id, actor, action: 'decisions.separate', target: { kind: 'decision', id: s.cardId, label: s.sourceId }, summary: `Separated ${s.sourceId} from the decision card ${s.cardId}: they show as two cards`, details: { cardId: s.cardId, sourceId: s.sourceId } });
      return undefined;
    }
    const roster = rosterOf(this.ctx);
    const tf = teamFloor(this.ctx, floor);
    if (a.action === 'close-duplicates') {
      const r = await closeDuplicates(roster, tf, a.groups ?? [], await this.splits.get(floor.id), by, owner);
      return r.ok ? undefined : { error: r.error, status: r.status };
    }
    const all = roster.data(floor.id).escalations;
    const e = all.find((x) => x.id === a.escalation);
    if (!e) return fail('No such escalation');
    // Answered meanwhile: a 409 with its state when the page said what it saw.
    if (e.status !== 'open') return a.expectedRev !== undefined ? { error: 'This decision changed since you opened it', status: 409, current: { decision: `esc:${e.id}`, rev: e.resolution?.answerRev ?? 1, state: `answered by ${e.resolution?.by ?? 'someone'}` } } : fail(`Already answered by ${e.resolution?.by ?? 'someone'}`);
    const others = (a.others ?? []).map((id) => all.find((x) => x.id === id && x.status === 'open' && x.id !== e.id)).filter((x): x is NonNullable<typeof x> => !!x);
    const text = typeof a.text === 'string' ? a.text.slice(0, 4000) : '';
    const answered = (r: AnswerResult): ActError => (r.ok ? undefined : { error: r.error, status: r.status, ...(r.current ? { current: r.current } : {}) });
    const ans = (id: string, x: Omit<EscalationAnswer, 'by'>): { id: string } & EscalationAnswer => ({ id, by, ...x });
    // An answer on a card answers every escalation it folds, as one group (a dispatch per member, roster/escalation-answer.ts).
    // A permission card (./permission.ts): Allow writes the rule and keeps it open until a run is seen; Keep blocked rejects it.
    if ((a.action === 'allow-command' || a.action === 'keep-blocked') && !e.permission) return { error: 'Only for a permission card', status: 400 };
    switch (a.action) {
      case 'allow-command':
        return fail(await allowCommand(roster, tf, e, by, owner));
      case 'keep-blocked':
        return answered(await keepBlocked(roster, tf, e, by, text, a.expectedRev));
      case 'noted':
        return answered(await answerGroup(roster, tf, ans(e.id, { verdict: 'dismiss', raw: '', outcome: 'noted', expectedRev: a.expectedRev }), others.filter((o) => escalationKind(o).kind === 'fyi').map((o) => ans(o.id, { verdict: 'dismiss', raw: '', outcome: 'noted' }))));
      case 'done': {
        const err = answered(await answerGroup(roster, tf, ans(e.id, { verdict: 'reply', raw: text, outcome: 'done', expectedRev: a.expectedRev }), this.alsoAnswer(others, by, (k) => (k === 'hands-on' ? { verdict: 'reply', text, outcome: 'done' } : { verdict: 'reply', text: doneMessage(by) }))));
        if (err) return err;
        this.check(floor, e.id, `${e.title}\n${e.details}`);
        return undefined;
      }
      case 'answer':
        if (!a.verdict) return { error: 'reply, approve or reject', status: 400 };
        return answered(await answerGroup(roster, tf, ans(e.id, { verdict: a.verdict, raw: text, expectedRev: a.expectedRev }), this.alsoAnswer(others, by, () => ({ verdict: a.verdict!, text }))));
      case 'resolved':
        if (!e.sourceGone) return { error: 'Only for one whose AWAITING-PM line is gone', status: 400 };
        return answered(await answerGroup(roster, tf, ans(e.id, { verdict: 'dismiss', raw: `Resolved: ${e.sourceGone.what}`, expectedRev: a.expectedRev }), []));
      case 'still-needed':
        return fail(await roster.escalations.tell(tf, e.id, 'still needed', `${by} says this is still needed: “${e.title}”. It is gone from your newest journal entry's AWAITING-PM line; if it still waits on the Project Manager, put it back (or escalate it), else say what settled it.${text ? `\n\n${text}` : ''}`, by));
      case 'cant-now':
        if (escalationKind(e).kind !== 'hands-on') return { error: "Can't now is only for a hands-on action", status: 400 };
        return fail(await roster.escalations.tell(tf, e.id, "can't now", `${by} can't do this now: “${e.title}”. Carry on with what doesn't need it, keep it in your AWAITING-PM line, and say what it still blocks.${text ? `\n\n${text}` : ''}`, by));
    }
  }

  /** The card's other open escalations, answered with it: FYIs among them noted, the rest as `how` says for their kind. */
  private alsoAnswer(others: readonly { id: string; trigger?: string; fyi: boolean; options: string[]; title: string; details: string; from?: { kind: string } }[], by: string, how: (kind: string) => { verdict: EscalationVerdict; text: string; outcome?: 'done' }): ({ id: string } & EscalationAnswer)[] {
    return others.map((o) => {
      const { kind } = escalationKind(o as never);
      if (kind === 'fyi') return { id: o.id, by, verdict: 'dismiss' as const, raw: '', outcome: 'noted' as const };
      const h = how(kind);
      return { id: o.id, by, verdict: h.verdict, raw: h.text || (h.verdict === 'reply' ? doneMessage(by) : ''), ...(h.outcome ? { outcome: h.outcome } : {}) };
    });
  }

  /** The status check after I've done it, in the background: never blocks, never changes the card's state. */
  private check(floor: Floor, id: string, words: string) {
    const kind = checkFor(words);
    if (!kind) return;
    void runCheck(kind, { dataDir: this.ctx.cfg.dataDir, testMode: this.ctx.cfg.testMode, now: () => Date.now() })
      .then((r) => {
        if (!r) return;
        const m = this.checks.get(floor.id) ?? {};
        m[id] = r;
        this.checks.set(floor.id, m);
        audit.record({ floor: floor.id, actor: { kind: 'office', name: 'Decision cards' }, action: 'decisions.check', target: { kind: 'escalation', id, label: r.label }, summary: `${r.label} after "I've done it" (a check, not proof): ${r.ok ? 'OK' : 'not OK'}${r.faked ? ' (test mode: faked)' : ''}`, details: { kind: r.kind, ok: r.ok, faked: !!r.faked }, severity: 'info' });
      })
      .catch(() => undefined);
  }
}
