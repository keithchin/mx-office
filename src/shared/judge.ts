// Jeff, the office's quick judge (server/judge/): typed questions about a piece of text, answered by
// Jev (TypeSafe AI's "System One" model) or, when Jev is unavailable, by Claude Haiku. What the
// server logs of each judgement, and what GET /api/judge sends the Analysis tab. Pure: the browser
// imports it too.

/** Off: never asked. Shadow: asked and logged next to the office's own rule, never acted on. On: acts. */
export type JeffMode = 'off' | 'shadow' | 'on';
export const JEFF_MODES: readonly JeffMode[] = ['off', 'shadow', 'on'];
export const isJeffMode = (v: unknown): v is JeffMode => typeof v === 'string' && (JEFF_MODES as readonly string[]).includes(v);

export interface JeffSettings {
  /** Is an agent that just ended its turn waiting on the Project Manager? */
  waiting: JeffMode;
  /** Which team does a new issue belong to? */
  triage: JeffMode;
  /** Which escalation should the Project Manager resolve first? Advisory (a sort order), so no shadow. */
  priority: JeffPriorityMode;
}
/** Jeff's priority sort is on or off: it only orders lists, so there's nothing to watch first. */
export type JeffPriorityMode = 'off' | 'on';
export const isJeffPriorityMode = (v: unknown): v is JeffPriorityMode => v === 'off' || v === 'on';
export const DEFAULT_JEFF: JeffSettings = { waiting: 'shadow', triage: 'shadow', priority: 'on' };

export type JudgeKind = 'waiting' | 'triage' | 'priority';
export const JUDGE_KINDS: readonly JudgeKind[] = ['waiting', 'triage', 'priority'];
export const isJudgeKind = (v: unknown): v is JudgeKind => typeof v === 'string' && (JUDGE_KINDS as readonly string[]).includes(v);
export type JudgeBy = 'jev' | 'haiku';

/** One judgement, as logged (judge/<floor>.jsonl in the office's data dir). Text is redacted and clipped. */
export interface JudgeRow {
  at: number;
  kind: JudgeKind;
  /** What was judged: "Ada (w3)" or "#12 Fix the login page". */
  subject: string;
  by: JudgeBy;
  model: string;
  ms: number;
  /** Jeff's verdict in a word ("waiting", "not waiting", "development"), and the detail behind it. */
  jeff: string;
  detail: string;
  /** The office's own rule's verdict in the same words, or "none" when it has no opinion. */
  rule: string;
  /** Whether they said the same; null when the rule had no opinion. */
  agree: boolean | null;
  /** Whether Jeff's verdict was acted on (an escalation raised, a label put on). */
  acted: boolean;
  /** The judged text, clipped. */
  text?: string;
}

/** Sent to the floor as a judgement is made, so Jeff's room in the 2D view can react. */
export interface JudgeMade {
  kind: JudgeKind;
  by: JudgeBy;
  /** His verdict in a few words, for his speech bubble ("→ PM", "→ Development"). */
  verdict: string;
  agree: boolean | null;
  acted: boolean;
  at: number;
}

export interface JudgeDay {
  day: string;
  n: number;
  compared: number;
  agreed: number;
}

export interface JudgeKindSummary {
  kind: JudgeKind;
  mode: JeffMode;
  total: number;
  /** Judgements the rule had an opinion on, and how many of those Jeff agreed with. */
  compared: number;
  agreed: number;
  byJev: number;
  byHaiku: number;
  acted: number;
  avgMs: number;
  /** The last 14 days, oldest first. */
  days: JudgeDay[];
}

/** Where Jeff answers from right now: Jev, the Haiku fallback, or nowhere. */
export interface JeffStatus {
  state: 'jev' | 'haiku' | 'unavailable';
  detail: string;
}

export interface JudgeSummary {
  floor: string;
  status: JeffStatus;
  kinds: JudgeKindSummary[];
  /** The latest 50, disagreements first, newest first within each. */
  rows: JudgeRow[];
}

const DAY_MS = 86_400_000;
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** The Analysis tab's numbers from the logged rows. */
export function summarize(floor: string, rows: readonly JudgeRow[], modes: JeffSettings, status: JeffStatus, now: number): JudgeSummary {
  const kinds = JUDGE_KINDS.map((kind): JudgeKindSummary => {
    const list = rows.filter((r) => r.kind === kind);
    const compared = list.filter((r) => r.agree !== null);
    const days: JudgeDay[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = dayOf(now - i * DAY_MS);
      const on = list.filter((r) => dayOf(r.at) === day);
      const c = on.filter((r) => r.agree !== null);
      days.push({ day, n: on.length, compared: c.length, agreed: c.filter((r) => r.agree).length });
    }
    return {
      kind,
      mode: modes[kind],
      total: list.length,
      compared: compared.length,
      agreed: compared.filter((r) => r.agree).length,
      byJev: list.filter((r) => r.by === 'jev').length,
      byHaiku: list.filter((r) => r.by === 'haiku').length,
      acted: list.filter((r) => r.acted).length,
      avgMs: list.length ? Math.round(list.reduce((n, r) => n + r.ms, 0) / list.length) : 0,
      days,
    };
  });
  const latest = rows.slice(-50).reverse();
  const shown = [...latest.filter((r) => r.agree === false), ...latest.filter((r) => r.agree !== false)];
  return { floor, status, kinds, rows: shown };
}
