// Mx Office analyses an incident when it's resolved: the root cause, its impact and corrective actions,
// drafted from the incident's evidence (analysis-input.ts) by one capped call or the test analyser
// (analysis-engine.ts), in the background after the incident is marked resolved. Its state is on the
// incident (`analysis`: pending, running, done or failed, kept in the incidents file like every change),
// so a restart mid-run finds it running and marks it failed, ready to retry; one analysis per incident at
// a time, whoever asks. Caps: a spend cap per incident (AGENT_OFFICE_INCIDENT_ANALYSIS_CAP_USD, $0.30), a
// cap on analyses per hour across the office (AGENT_OFFICE_INCIDENT_ANALYSIS_PER_HOUR), a timeout. Each
// call is metered as `incident` spend, on the incident's floor (else the office's own). The answer fills
// root cause, impact and corrective actions only where a person hasn't written them (or where its own
// earlier draft still stands); beside a person's text it's a suggestion. Installed by office.ts.

import type { AuditActor } from '../../shared/audit.js';
import { impactLine, type AnalysisResult, type DraftedField, type IncidentAnalysis } from '../../shared/incident-analysis.js';
import { incidentRef, type Incident } from '../../shared/incidents.js';
import { withBilling } from '../budget/meter.js';
import { testModeOf } from '../testmode.js';
import { resolvedModel } from '../usage.js';
import { resolveCommand } from '../workers/process.js';
import { officeCallEnv } from '../wizard/planner/cli.js';
import { plannerConfig } from '../wizard/planner/index.js';
import { auditOf, incidentStore } from './index.js';
import { analysisInput, floorEvents, gatherFacts } from './analysis-input.js';
import { cliAnalysisEngine, fakeAnalysisEngine, type AnalysisAnswer, type AnalysisEngine } from './analysis-engine.js';

export interface AnalysisConfig {
  /** auto: the claude CLI (the test analyser in test mode); fake: always the test analyser; off: never. AGENT_OFFICE_INCIDENT_ANALYSIS. */
  mode: 'auto' | 'fake' | 'off';
  /** The planner's model (AGENT_OFFICE_PLANNER_MODEL, Sonnet by default). */
  model: string;
  /** What one incident's analyses may spend in all, USD. */
  capUsd: number;
  timeoutMs: number;
  /** Analyses started per hour across the office. */
  perHour: number;
}

const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

export function analysisConfig(env: NodeJS.ProcessEnv = process.env): AnalysisConfig {
  const m = (env.AGENT_OFFICE_INCIDENT_ANALYSIS ?? '').toLowerCase();
  return {
    mode: m === 'fake' ? 'fake' : m === 'off' ? 'off' : 'auto',
    model: plannerConfig(env).model,
    capUsd: num(env.AGENT_OFFICE_INCIDENT_ANALYSIS_CAP_USD, 0.3, 0.02, 10),
    timeoutMs: num(env.AGENT_OFFICE_INCIDENT_ANALYSIS_TIMEOUT_S, 120, 20, 600) * 1000,
    perHour: num(env.AGENT_OFFICE_INCIDENT_ANALYSIS_PER_HOUR, 20, 1, 500),
  };
}

const ACTOR: AuditActor = { kind: 'office', name: 'Mx Office' };
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The incident with `r` written in: root cause, impact text and corrective actions where they're empty or
 * still hold the analysis's own draft; a person's text is left as it is (the page shows the analysis
 * beside it). Pure, for the tests.
 */
export function applyAnalysis(i: Incident, r: AnalysisResult, a: IncidentAnalysis): { incident: Incident; drafted: DraftedField[] } {
  const out = structuredClone(i);
  const mine = (f: DraftedField) => a.drafted.includes(f);
  const drafted: DraftedField[] = [];
  if (!out.rootCause?.trim() || mine('rootCause')) {
    out.rootCause = r.rootCause.text;
    drafted.push('rootCause');
  }
  if (!out.impact.text?.trim() || mine('impact')) {
    out.impact = { ...out.impact, text: impactLine(r) };
    drafted.push('impact');
  }
  if (!out.actions.length || mine('actions')) {
    out.actions = r.correctiveActions.map((x, n) => ({ id: `mx${n + 1}`, text: x.action, status: 'open' as const, kind: x.kind, ...(x.owner ? { owner: x.owner } : {}) }));
    drafted.push('actions');
  }
  return { incident: out, drafted };
}

export class IncidentAnalyzer {
  readonly config: AnalysisConfig;
  /** Each incident's analysis under way, for the tests to wait on; also the in-process lock. */
  readonly running = new Map<string, Promise<void>>();
  private recent: number[] = [];
  private now: () => number;
  private given?: AnalysisEngine;
  private made?: AnalysisEngine;
  private floorName?: (id: string) => string;

  constructor(opts: { config?: AnalysisConfig; engine?: AnalysisEngine; now?: () => number; floorName?: (id: string) => string } = {}) {
    this.config = opts.config ?? analysisConfig();
    this.now = opts.now ?? Date.now;
    this.given = opts.engine;
    this.floorName = opts.floorName;
  }

  /** What drafts it: the one handed in, else the test analyser in test mode (or when asked for), else the CLI. */
  engine(): AnalysisEngine {
    if (this.given) return this.given;
    if (this.config.mode === 'fake' || testModeOf().on) return fakeAnalysisEngine();
    this.made ??= cliAnalysisEngine({ claude: resolveCommand('claude'), env: officeCallEnv(), model: this.config.model, timeoutMs: this.config.timeoutMs });
    return this.made;
  }

  /** Why a new analysis of `i` can't start now, or undefined when it can. */
  private refusal(i: Incident, engine: AnalysisEngine): string | undefined {
    if (this.config.mode === 'off') return 'Incident analysis is switched off in this office (AGENT_OFFICE_INCIDENT_ANALYSIS=off)';
    const why = engine.why();
    if (why) return why;
    if (this.config.capUsd - (i.analysis?.costUsd ?? 0) < 0.01) return `This incident’s analyses reached their ${usd(this.config.capUsd)} cap`;
    this.recent = this.recent.filter((t) => this.now() - t < 3_600_000);
    if (this.recent.length >= this.config.perHour) return `Incident analyses are capped at ${this.config.perHour} an hour across the office, and that’s reached: retry later`;
    return undefined;
  }

  /** Whether one is under way for the incident: in this process, or recorded so. */
  busy(i: Incident): boolean {
    return this.running.has(i.id) || i.analysis?.status === 'pending' || i.analysis?.status === 'running';
  }

  /**
   * Starts the analysis of a resolved incident, in the background: on resolving it (`note`: what the
   * person already knows) and on Retry. Never two at once for one incident. The incident as it is now, or
   * why not (nothing is started then; a cap or limit is recorded on it as a failed analysis to retry).
   */
  start(id: string, by: string, note?: string): { incident?: Incident; error?: string } {
    const store = incidentStore();
    const was = store?.get(id);
    if (!store || !was) return { error: 'No such incident' };
    if (was.status !== 'resolved') return { error: 'Only a resolved incident is analysed' };
    if (this.busy(was)) return { incident: was, error: 'Mx Office is already analysing this incident' };
    const engine = this.engine();
    const prev = was.analysis;
    const base: IncidentAnalysis = { status: 'pending', requestedAt: this.now(), requestedBy: by, costUsd: prev?.costUsd ?? 0, attempts: prev?.attempts ?? 0, drafted: prev?.drafted ?? [], ...(note?.trim() ? { note: note.trim().slice(0, 2000) } : prev?.note ? { note: prev.note } : {}), ...(prev?.result ? { result: prev.result, model: prev.model } : {}) };
    const why = this.refusal(was, engine);
    if (why) return { incident: this.put(was, { ...base, status: 'failed', error: why, finishedAt: this.now() }, `Analysis didn’t start: ${why}`), error: why };
    this.recent.push(this.now());
    const i = this.put(was, base);
    const run = this.run(id, engine).finally(() => this.running.delete(id));
    this.running.set(id, run);
    return { incident: i };
  }

  /** After a restart: an analysis recorded as pending or running stopped with the office; it's failed, ready to retry. */
  recover(): number {
    const store = incidentStore();
    let n = 0;
    for (const i of store?.list() ?? []) {
      if (!i.analysis || (i.analysis.status !== 'running' && i.analysis.status !== 'pending') || this.running.has(i.id)) continue;
      this.put(i, { ...i.analysis, status: 'failed', error: 'The office restarted while it was analysing', finishedAt: this.now() }, 'Analysis didn’t finish: the office restarted');
      n++;
    }
    return n;
  }

  private async run(id: string, engine: AnalysisEngine) {
    const store = incidentStore()!;
    let i = store.get(id)!;
    const a: IncidentAnalysis = { ...i.analysis!, status: 'running', startedAt: this.now(), attempts: (i.analysis?.attempts ?? 0) + 1 };
    i = this.put(i, a);
    let answer: AnalysisAnswer;
    try {
      const { facts, text } = analysisInput(gatherFacts(i, floorEvents(i), a.note, this.floorName));
      const budgetUsd = Math.max(0, this.config.capUsd - a.costUsd);
      answer = await withBilling({ floor: i.floors[0], source: 'incident' }, () => engine.analyse({ facts, input: text, budgetUsd }));
    } catch (err) {
      answer = { value: null, cost: 0, error: (err as Error).message };
    }
    // Read again: a person may have changed it meanwhile; their edits stand.
    const now = store.get(id) ?? i;
    const after: IncidentAnalysis = { ...(now.analysis ?? a), costUsd: Math.round((a.costUsd + answer.cost) * 10_000) / 10_000, finishedAt: this.now(), attempts: a.attempts };
    if (!answer.value) {
      this.put(now, { ...after, status: 'failed', error: (answer.error ?? 'No answer came back').slice(0, 300) }, `Analysis didn’t finish: ${answer.error ?? 'no answer came back'}`);
      return;
    }
    const model = engine.kind === 'fake' ? engine.model : resolvedModel(engine.model);
    const { incident, drafted } = applyAnalysis(now, answer.value, after);
    const done: IncidentAnalysis = { ...after, status: 'done', result: answer.value, model, drafted, error: undefined };
    this.put(incident, done, `Mx Office drafted an analysis (${answer.value.rootCause.confidence} confidence${drafted.length < 3 ? '; your own text is kept, the analysis is beside it' : ''}): check it`);
  }

  /** Writes the incident with `analysis`, a timeline line and an audit event when `line` says what happened. */
  private put(i: Incident, analysis: IncidentAnalysis, line?: string): Incident {
    const store = incidentStore()!;
    const out: Incident = { ...structuredClone(i), analysis: JSON.parse(JSON.stringify(analysis)) as IncidentAnalysis, updatedAt: this.now() };
    if (line) out.timeline = [...out.timeline, { at: this.now(), by: ACTOR.name, text: line.slice(0, 1000), kind: 'change' as const }].slice(-200);
    store.put(out, 'update', ACTOR.name);
    if (line) {
      const done = analysis.status === 'done';
      auditOf(out, ACTOR, 'incident.analysed', done ? `Mx Office drafted the analysis of ${incidentRef(out)} (${analysis.result?.rootCause.confidence} confidence, ${usd(analysis.costUsd)})` : `Mx Office’s analysis of ${incidentRef(out)} didn’t finish: ${analysis.error}`, { analysis: analysis.status, model: analysis.model, costUsd: analysis.costUsd, ...(done ? { confidence: analysis.result?.rootCause.confidence, drafted: analysis.drafted } : { error: analysis.error }) });
    }
    return out;
  }
}

let current: IncidentAnalyzer | undefined;

/** Uses `a` from now on (office.ts; the tests their own). */
export function useAnalyzer(a: IncidentAnalyzer | undefined) {
  current = a;
}
export const incidentAnalyzer = () => current;
