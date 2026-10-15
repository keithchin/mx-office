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
import { audit, human } from '../audit/index.js';
import { SplitsStore } from './store.js';
import { checkFor, runCheck, type CheckResult } from './check.js';

export type DecisionAction = 'separate' | 'answer' | 'noted' | 'done' | 'cant-now' | 'resolved' | 'still-needed';
export const DECISION_ACTIONS: readonly DecisionAction[] = ['separate', 'answer', 'noted', 'done', 'cant-now', 'resolved', 'still-needed'];
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
}

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
    const actor = human(by, owner);
    if (a.action === 'separate') {
      if (!a.cardId || !a.sourceId || a.cardId === a.sourceId) return 'Which source, from which card?';
      const s: DecisionSplit = { cardId: a.cardId.slice(0, 300), sourceId: a.sourceId.slice(0, 300), by, at: Date.now() };
      if (await this.splits.add(floor.id, s)) audit.record({ floor: floor.id, actor, action: 'decisions.separate', target: { kind: 'decision', id: s.cardId, label: s.sourceId }, summary: `Separated ${s.sourceId} from the decision card ${s.cardId}: they show as two cards`, details: { cardId: s.cardId, sourceId: s.sourceId } });
      return undefined;
    }
    const roster = rosterOf(this.ctx);
    const tf = teamFloor(this.ctx, floor);
    const all = roster.data(floor.id).escalations;
    const e = all.find((x) => x.id === a.escalation);
    if (!e) return 'No such escalation';
    if (e.status !== 'open') return `Already answered by ${e.resolution?.by ?? 'someone'}`;
    const others = (a.others ?? []).map((id) => all.find((x) => x.id === id && x.status === 'open' && x.id !== e.id)).filter((x): x is NonNullable<typeof x> => !!x);
    const text = typeof a.text === 'string' ? a.text.slice(0, 4000) : '';
    switch (a.action) {
      case 'noted': {
        const err = roster.escalations.resolve(tf, e.id, 'dismiss', '', by, 'noted');
        if (err) return err;
        for (const o of others) if (escalationKind(o).kind === 'fyi') roster.escalations.resolve(tf, o.id, 'dismiss', '', by, 'noted');
        return undefined;
      }
      case 'done': {
        const err = roster.escalations.resolve(tf, e.id, 'reply', text, by, 'done');
        if (err) return err;
        this.alsoAnswer(tf, others, by, (k) => (k === 'hands-on' ? { verdict: 'reply', text, outcome: 'done' } : { verdict: 'reply', text: doneMessage(by) }));
        this.check(floor, e.id, `${e.title}\n${e.details}`);
        return undefined;
      }
      case 'answer': {
        if (!a.verdict) return 'reply, approve or reject';
        const err = roster.escalations.resolve(tf, e.id, a.verdict, text, by);
        if (err) return err;
        this.alsoAnswer(tf, others, by, () => ({ verdict: a.verdict!, text }));
        return undefined;
      }
      case 'resolved': {
        if (!e.sourceGone) return 'Only for one whose AWAITING-PM line is gone';
        return roster.escalations.resolve(tf, e.id, 'dismiss', `Resolved: ${e.sourceGone.what}`, by);
      }
      case 'still-needed':
        return roster.escalations.tell(tf, e.id, 'still needed', `${by} says this is still needed: “${e.title}”. It is gone from your newest journal entry's AWAITING-PM line; if it still waits on the Project Manager, put it back (or escalate it), else say what settled it.${text ? `\n\n${text}` : ''}`, by);
      case 'cant-now':
        if (escalationKind(e).kind !== 'hands-on') return "Can't now is only for a hands-on action";
        return roster.escalations.tell(tf, e.id, "can't now", `${by} can't do this now: “${e.title}”. Carry on with what doesn't need it, keep it in your AWAITING-PM line, and say what it still blocks.${text ? `\n\n${text}` : ''}`, by);
    }
  }

  /** The card's other open escalations, answered with it: FYIs among them noted, the rest as \`how\` says for their kind. */
  private alsoAnswer(tf: ReturnType<typeof teamFloor>, others: readonly { id: string; trigger?: string; fyi: boolean; options: string[]; title: string; details: string; from?: { kind: string } }[], by: string, how: (kind: string) => { verdict: EscalationVerdict; text: string; outcome?: 'done' }) {
    const roster = rosterOf(this.ctx);
    for (const o of others) {
      const { kind } = escalationKind(o as never);
      if (kind === 'fyi') {
        roster.escalations.resolve(tf, o.id, 'dismiss', '', by, 'noted');
        continue;
      }
      const h = how(kind);
      roster.escalations.resolve(tf, o.id, h.verdict, h.text || (h.verdict === 'reply' ? doneMessage(by) : ''), by, h.outcome);
    }
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
