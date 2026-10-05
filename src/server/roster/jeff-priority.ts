// Jeff's third judgement, priority: which escalation should the Project Manager resolve first? When
// one is raised or resolved (and the first time a floor's team is looked at, for the open ones already
// there), the floor's open, non-FYI escalations are re-ranked: Jeff rates the ones he hasn't (one call
// each: a level, "agents are stopped on it", "delaying it risks something big"), at most once an hour
// per escalation unless its text changed, and the office scores and numbers them all
// (shared/roster/jeff-rank.ts). The rating is kept on the escalation (`jeffRank`), logged as kind
// 'priority' and broadcast like his other judgements ("→ #1"). Off in the team settings: never asked,
// and the lists keep their own order. Advisory: nothing is sent to anyone.

import { escalationOrder, type Escalation } from '../../shared/roster/escalation.js';
import { PRIORITY_LEVELS, rankable, rankSig, rerank } from '../../shared/roster/jeff-rank.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import { clipState, type Questions } from '../judge/pure.js';
import type { Roster } from './index.js';
import type { Jeff } from './jeff.js';
import type { TeamFloor } from './types.js';

/** Jeff rates an escalation again at most this often (unless its text changed). */
export const RERATE_MS = 3_600_000;
const STATE_MAX = 3000;
const TEXT_LOGGED = 300;

export const PRIORITY_QUESTIONS: Questions = {
  priority: { type: 'score', instructions: 'How soon should the Project Manager (the human) resolve this escalation?', criteria: PRIORITY_LEVELS },
  blocking: { type: 'noul', instructions: 'Agents are stopped until the Project Manager answers this.' },
  risk: { type: 'noul', instructions: 'Delaying this risks security, data loss, budget overrun or a client milestone.' },
};

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m} minute${m === 1 ? '' : 's'}` : m < 48 * 60 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'}` : `${Math.round(m / 1440)} days`;
};

/** What Jeff reads about an escalation: the short facts first, the details last (they're what gets clipped). */
export function priorityState(e: Escalation, now: number): string {
  const role = e.role ? ROLE_BY_ID.get(e.role)?.title : undefined;
  return [
    `An escalation to the Project Manager (the human), raised by ${e.by}${role ? ` (${role})` : ''}, open for ${ago(now - e.at)}.`,
    `Urgency the agent gave it: ${e.urgency}${e.trigger ? ` · trigger: ${e.trigger}` : ''}`,
    `Title: ${e.title}`,
    e.options.length ? `Options: ${e.options.join(' | ')}` : '',
    e.recommendation ? `The agent recommends: ${e.recommendation}` : '',
    e.details ? `Details:\n${e.details}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export class JeffPriority {
  /** When Jeff was last asked about an escalation, and about which text: failures count too, so a down Jeff isn't asked on every event. */
  private tried = new Map<string, { at: number; sig: string }>();
  /** Floors being re-ranked right now, and floors to go round again once that's done. */
  private running = new Set<string>();
  private again = new Set<string>();
  /** Floors whose open escalations were looked at since the office started. */
  private looked = new Set<string>();

  constructor(
    private roster: Roster,
    private jeff: Jeff,
  ) {}

  private on(floor: TeamFloor): boolean {
    return !!this.roster.deps.judge && this.roster.data(floor.id).settings.jeff.priority !== 'off';
  }

  /** The first time a floor's team is shown: rank the open escalations already there. */
  firstLook(floor: TeamFloor) {
    if (this.looked.has(floor.id)) return;
    this.looked.add(floor.id);
    this.kick(floor);
  }

  /** Re-ranks in the background (raise and resolve are synchronous); a failure is logged, never thrown. */
  kick(floor: TeamFloor) {
    void this.rerank(floor).catch((err: unknown) => console.error(`agent-office: Jeff's priority on ${floor.id}: ${(err as Error)?.message ?? err}`));
  }

  /** Whether Jeff is due to rate `e`: never asked about this text, or not within the hour. */
  due(e: Escalation, now: number): boolean {
    if (!rankable(e)) return false;
    const sig = rankSig(e);
    const t = this.tried.get(e.id);
    const last = Math.max(t?.sig === sig ? t.at : -Infinity, e.jeffRank?.sig === sig ? e.jeffRank.at : -Infinity);
    return now - last >= RERATE_MS;
  }

  /**
   * Re-ranks the floor's open escalations: the order again right away (one was raised or answered),
   * then Jeff asked about each one that's due, loudest first, the order again after each answer.
   */
  async rerank(floor: TeamFloor): Promise<void> {
    if (!this.on(floor)) return;
    if (this.running.has(floor.id)) return void this.again.add(floor.id);
    this.running.add(floor.id);
    try {
      do {
        this.again.delete(floor.id);
        const list = this.roster.data(floor.id).escalations;
        if (rerank(list, this.roster.deps.now())) this.roster.touch(floor);
        const due = list.filter((e) => this.due(e, this.roster.deps.now())).sort(escalationOrder);
        for (const e of due) {
          if (!this.on(floor)) return;
          await this.rate(floor, e);
        }
      } while (this.again.has(floor.id));
    } finally {
      this.running.delete(floor.id);
      this.again.delete(floor.id);
    }
  }

  private async rate(floor: TeamFloor, e: Escalation) {
    const now = this.roster.deps.now();
    const sig = rankSig(e);
    this.tried.set(e.id, { at: now, sig });
    const state = priorityState(e, now);
    const v = await this.roster.deps.judge!(state, PRIORITY_QUESTIONS, { max: STATE_MAX, keep: 'head' });
    const p = v?.answers.priority;
    const b = v?.answers.blocking;
    const r = v?.answers.risk;
    if (!v || p?.type !== 'score' || b?.type !== 'noul' || r?.type !== 'noul') return;
    // Answered while it was being judged, or its text changed meanwhile: the rating is of something else now.
    if (!rankable(e) || rankSig(e) !== sig) return;
    const top = PRIORITY_LEVELS.length - 1;
    e.jeffRank = { score: 0, by: v.by, at: now, blocking: b.noul, risk: r.noul, level: p.level ?? PRIORITY_LEVELS[Math.round(p.score)], priority: p.score / top, sig };
    const list = this.roster.data(floor.id).escalations;
    rerank(list, this.roster.deps.now());
    this.roster.touch(floor);
    const rank = e.jeffRank.rank!;
    // The office's own order: loudest, then newest (escalationOrder), among the same open ones.
    const open = list.filter(rankable);
    const ruleRank = open.sort(escalationOrder).indexOf(e) + 1;
    // Compared only once he has rated them all: until then his numbers count fewer.
    const all = open.every((x) => x.jeffRank?.rank !== undefined);
    this.jeff.record(floor, v, {
      kind: 'priority',
      subject: `${e.by}: ${e.title}`.slice(0, 120),
      jeff: `#${rank}`,
      detail: `score ${e.jeffRank.score} · ${e.jeffRank.level.split(':')[0]} · blocking ${b.noul.toFixed(2)} · risk ${r.noul.toFixed(2)}`,
      rule: `#${ruleRank}`,
      agree: all ? rank === ruleRank : null,
      acted: true,
      text: clipState(state, TEXT_LOGGED, 'head'),
      verdict: `→ #${rank}`,
    });
  }
}
