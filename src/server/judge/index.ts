// Jeff, the office's quick judge: typed questions about a piece of text (is this agent waiting on the
// Project Manager? which team is this issue for?), answered by Jev, TypeSafe AI's fast "System One"
// model, when there's a key and Jev is healthy, else by one cheap Claude Haiku call (the analyzer's
// Haiku runner: the `claude` CLI, capped per hour). Text is redacted and clipped before it leaves.
// Any failure is "no answer": the callers then just keep their own rule. See roster/jeff.ts for the
// judgements themselves and docs/teams.md for what he does.

import type { JeffStatus } from '../../shared/judge.js';
import { Haiku } from '../analysis/llm.js';
import { childEnv } from '../workers/env.js';
import { resolveCommand } from '../workers/process.js';
import { JevKey } from './key.js';
import { meterUnpriced, withBilling } from '../budget/meter.js';
import { Breaker, clipState, FALLBACK_SYSTEM, fallbackInput, fallbackSchema, JEV_URL, jevRequest, parseFallback, parseJev, type Questions, type Verdict } from './pure.js';

export type { Answer, Answers, Question, Questions, Verdict } from './pure.js';

/** The part of the analyzer's Haiku runner Jeff uses (tests pass a fake). */
export interface HaikuLike {
  readonly enabled: boolean;
  ask(system: string, input: string, schema: object): Promise<any | null>;
}

export interface JudgeDeps {
  fetch?: typeof fetch;
  key?: () => string | undefined;
  haiku?: HaikuLike | null;
  now?: () => number;
  /** How long Jev gets before it counts as down. */
  timeoutMs?: number;
}

export interface AskOpts {
  /** How much text to send, and which end of it to keep (an agent's last words: the end). */
  max?: number;
  keep?: 'tail' | 'head';
}

export class Judge {
  readonly breaker: Breaker;
  private fetch: typeof fetch;
  private key: () => string | undefined;
  private haiku: HaikuLike | null;
  private now: () => number;
  private timeoutMs: number;

  constructor(deps: JudgeDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.fetch = deps.fetch ?? ((...a) => fetch(...a));
    const k = new JevKey(process.env, this.now);
    this.key = deps.key ?? (() => k.get());
    this.haiku = deps.haiku === undefined ? new Haiku(resolveCommand('claude'), childEnv()) : deps.haiku;
    this.timeoutMs = deps.timeoutMs ?? 3000;
    this.breaker = new Breaker(this.now);
  }

  /** Jeff's answers to every question, or undefined when neither Jev nor Haiku could give them. */
  async ask(text: string, questions: Questions, opts: AskOpts = {}): Promise<Verdict | undefined> {
    const state = clipState(text, opts.max ?? 4000, opts.keep ?? 'tail');
    if (!state) return undefined;
    const key = this.key();
    if (key && !this.breaker.open) {
      const v = await this.jev(key, state, questions);
      if (v) return v;
    }
    return this.fallback(state, questions);
  }

  private async jev(key: string, state: string, questions: Questions): Promise<Verdict | undefined> {
    const start = this.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(jevRequest(state, questions)),
        signal: ctl.signal,
      });
      if (!res.ok) {
        this.breaker.fail(`Jev answered HTTP ${res.status}`);
        return undefined;
      }
      const parsed = parseJev(questions, await res.json());
      if (!parsed) {
        this.breaker.fail("Jev's answer didn't fit the questions");
        return undefined;
      }
      this.breaker.ok();
      // Jev isn't priced by the office: counted on the Budget tab as not metered.
      meterUnpriced('jeff', parsed.model ?? 'jev');
      return { by: 'jev', model: parsed.model, answers: parsed.answers, ms: this.now() - start };
    } catch {
      this.breaker.fail(ctl.signal.aborted ? `Jev took longer than ${this.timeoutMs / 1000}s` : 'Jev is unreachable');
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fallback(state: string, questions: Questions): Promise<Verdict | undefined> {
    if (!this.haiku?.enabled) return undefined;
    const start = this.now();
    const raw = await withBilling({ source: 'jeff' }, () => this.haiku!.ask(FALLBACK_SYSTEM, fallbackInput(state, questions), fallbackSchema(questions))).catch(() => null);
    const answers = raw ? parseFallback(questions, raw) : undefined;
    return answers ? { by: 'haiku', model: 'claude-haiku', answers, ms: this.now() - start } : undefined;
  }

  /** Where he answers from right now, for the Analysis tab's pill. */
  status(): JeffStatus {
    const key = this.key();
    const haiku = !!this.haiku?.enabled;
    if (key && !this.breaker.open) return { state: 'jev', detail: 'Jev is live' };
    const why = !key ? 'No Jev key (~/.agent-office-jev-key)' : `${this.breaker.lastError ?? 'Jev is failing'}; trying again ${new Date(this.breaker.until!).toLocaleTimeString()}`;
    return haiku ? { state: 'haiku', detail: `${why}: on Claude Haiku` } : { state: 'unavailable', detail: `${why}, and no Claude CLI for the fallback` };
  }
}

const judges = new WeakMap<object, Judge>();

/** The office's Jeff, keyed like the roster by the office's config; made on first use. */
export function judgeFor(key: object, make: () => Judge = () => new Judge()): Judge {
  let j = judges.get(key);
  if (!j) {
    j = make();
    judges.set(key, j);
  }
  return j;
}
