// Jeff's "is it the same ask?": escalations join an open one as a +1 when their titles nearly match
// (sameAsk in jeff-ask.ts), but an agent that rewords its ask slips past that. mx-spike asked for one
// CI secret nine times ("Set repo secret…", "One command to set the e2e secret…", "Secret 404…"). So
// when a new escalation's title matches none, Jeff is asked whether it asks the Project Manager for the
// same thing as one of the floor's open ones, and only a confident yes joins it. He reads the titles and
// the start of the details (redacted and clipped by the judge, like everything he reads), answers within
// a few seconds or not at all, and is asked at most so often an hour per floor: any failure, a timeout or
// the cap means no join, and the escalation is raised as before.

import type { Escalation, EscalationAsk } from '../../shared/roster/escalation.js';
import type { AskOpts, Questions, Verdict } from '../judge/index.js';

/** Jeff joins a new escalation to an open one only this sure. */
export const SAME_AT = 0.85;
/** How long the agent raising it waits for Jeff before it's raised as its own. */
export const SAME_TIMEOUT_MS = 10_000;
/** Questions per floor per hour, so a burst of escalations isn't a burst of model calls. */
export const SAME_PER_HOUR = 30;
/** The open ones he compares with: the newest. */
const OPEN_MAX = 8;
const DETAILS_MAX = 400;
const STATE_MAX = 6000;

type Judge = (text: string, questions: Questions, opts?: AskOpts) => Promise<Verdict | undefined>;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** What Jeff reads: the new ask first, then the open ones numbered. */
export function sameState(ask: Pick<EscalationAsk, 'title' | 'details'>, open: readonly Pick<Escalation, 'title' | 'details' | 'by'>[]): string {
  return [
    'An agent wants to raise a new escalation to the Project Manager (the human):',
    `New: ${oneLine(ask.title)}${ask.details ? ` — ${oneLine(ask.details).slice(0, DETAILS_MAX)}` : ''}`,
    '',
    'Escalations already open on this floor:',
    ...open.map((e, i) => `open-${i + 1}: ${oneLine(e.title)} (raised by ${e.by})${e.details ? ` — ${oneLine(e.details).slice(0, DETAILS_MAX)}` : ''}`),
  ].join('\n');
}

export function sameQuestions(n: number): Questions {
  const criteria: Record<string, string> = { none: 'None of them: the new one asks the Project Manager for something else' };
  for (let i = 1; i <= n; i++) criteria[`open-${i}`] = `The new one asks for the same thing as open-${i}, however it is worded`;
  return {
    same: {
      type: 'choice',
      instructions:
        'Does the new escalation ask the Project Manager for the same thing as one of the open ones: the same decision, the same action for them to take, the same missing secret, access or approval? A follow-up or a reworded reminder of the same ask counts as the same. A different decision, a different secret or a different pull request does not.',
      criteria,
    },
  };
}

/** The open escalation Jeff says the new one is, when he's sure enough. */
export function readSame<E>(v: Verdict | undefined, open: readonly E[]): E | undefined {
  const a = v?.answers.same;
  if (!a || a.type !== 'choice' || a.choice === 'none' || a.confidence < SAME_AT) return undefined;
  const m = /^open-(\d+)$/.exec(a.choice);
  return m ? open[Number(m[1]) - 1] : undefined;
}

export class SameAsk {
  private asked = new Map<string, number[]>();

  constructor(
    private now: () => number,
    private timeoutMs = SAME_TIMEOUT_MS,
  ) {}

  /** The open escalation the new ask is the same as, in Jeff's judgement; undefined on any doubt or failure. */
  async find(floorId: string, judge: Judge, ask: Pick<EscalationAsk, 'title' | 'details'>, open: readonly Escalation[]): Promise<Escalation | undefined> {
    if (!open.length) return undefined;
    const now = this.now();
    const recent = (this.asked.get(floorId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= SAME_PER_HOUR) return undefined;
    recent.push(now);
    this.asked.set(floorId, recent);
    const list = open.slice(-OPEN_MAX);
    let timer: NodeJS.Timeout | undefined;
    try {
      const late = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), this.timeoutMs);
        timer.unref?.();
      });
      const v = await Promise.race([judge(sameState(ask, list), sameQuestions(list.length), { max: STATE_MAX, keep: 'head' }), late]);
      return readSame(v, list);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
