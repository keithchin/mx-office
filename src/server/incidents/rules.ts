// The automatic detection rules: what the office watches for and raises as an incident (index.ts's
// raise, which dedupes by rule and floor). Fed by office.ts from the audit log (failed sign-ins, Studio
// mode's held writes, failed workflows), workers' updates (crash loops), signals (signals.ts: test mode's
// refusals, gate-check and cleanup errors, the budget), what the office restored (interrupted turns) and
// a once-a-minute look at each floor (spend, the cap, undelivered answers). Every threshold is a setting
// (shared/incidents.ts); a rule that's off is never counted. A counted rule fires once its count is in
// its window, then starts counting again, so one burst is one incident (or one "seen again").

import type { AuditEvent } from '../../shared/audit.js';
import type { IncidentSettings, IncidentWorker } from '../../shared/incidents.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Detection } from './index.js';
import type { IncidentSignal } from './signals.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** How much spend history a floor keeps for its trailing average. */
const SPEND_KEEP = 25 * HOUR;
/** The trailing average needs at least this much history before a relative spike counts. */
const SPEND_MIN_HISTORY = 3 * HOUR;
/** A worker test mode refused again within this long isn't counted again. */
const REFUSED_AGAIN_MS = 10 * MIN;

export interface DetectorDeps {
  now: () => number;
  settings: () => IncidentSettings;
  raise: (d: Detection) => void;
  floorName: (id: string) => string;
  /** The floor whose folder is (or holds) `dir`. */
  floorOfDir: (dir: string) => string | undefined;
  /** The floor called `name` (the cleanup says floors by name). */
  floorOfName: (name: string) => string | undefined;
}

/** What the minute's look sees of one floor. */
export interface FloorSnapshot {
  id: string;
  /** Each worker's cost so far (dollars), by id. */
  costs: Record<string, number>;
  /** Why the office's prompts are paused there (its spend cap), if they are. */
  paused?: string;
  /** Answers to escalations not delivered to their agent yet. */
  undelivered: { id: string; title: string; by: string; at: number }[];
}

interface SpendTrack {
  /** Each worker's cost as last seen, so a worker going home doesn't take its spend with it. */
  seen: Map<string, number>;
  total: number;
  samples: { at: number; total: number }[];
  firedAt?: number;
}

export class IncidentDetector {
  private windows = new Map<string, { at: number; auditId?: string; worker?: IncidentWorker }[]>();
  private status = new Map<string, WorkerInfo['status']>();
  private refusedAt = new Map<string, number>();
  private spend = new Map<string, SpendTrack>();
  private paused = new Map<string, string | undefined>();
  private toldUndelivered = new Set<string>();

  constructor(private d: DetectorDeps) {}

  private rule<K extends keyof IncidentSettings['rules']>(k: K) {
    return this.d.settings().rules[k];
  }

  /** Counts one more for `key`; the burst (and true) once `count` are within `minutes`, which starts the count over. */
  private count(key: string, count: number, minutes: number, item: { auditId?: string; worker?: IncidentWorker } = {}) {
    const now = this.d.now();
    const list = (this.windows.get(key) ?? []).filter((x) => now - x.at < minutes * MIN);
    list.push({ at: now, ...item });
    if (list.length >= count) {
      this.windows.delete(key);
      return list;
    }
    this.windows.set(key, list);
    return undefined;
  }

  private where(floor: string | undefined) {
    return floor ? ` on ${this.d.floorName(floor)}` : '';
  }

  // ---- The audit log ---------------------------------------------------------------------------------

  onAudit(e: AuditEvent) {
    const floor = e.floor && e.floor !== '_office' ? e.floor : undefined;
    if (e.action === 'login.fail') {
      const r = this.rule('loginFailed');
      if (!r.on) return;
      const burst = this.count('login', r.count!, r.minutes!, { auditId: e.id });
      if (burst) this.d.raise({ rule: 'loginFailed', severity: 'sev2', title: 'Repeated failed sign-ins', summary: `${burst.length} sign-ins failed within ${r.minutes} minutes`, auditIds: ids(burst) });
    } else if (e.action === 'studio.denied') {
      const r = this.rule('studioDenied');
      if (!r.on) return;
      const burst = this.count(`studio:${floor}`, r.count!, r.minutes!, { auditId: e.id, worker: { name: e.actor.name, id: e.actor.id, floor } });
      if (burst) this.d.raise({ rule: 'studioDenied', floor, severity: 'near-miss', title: `Studio mode held agents' writes${this.where(floor)}`, summary: `${burst.length} writes held by Studio mode within ${r.minutes} minutes: agents kept trying to change the project while Studio Pro had it open`, auditIds: ids(burst), workers: workersOf(burst) });
    } else if (e.action === 'flow.fail') {
      this.failedRun(floor, `the ${e.target?.label ?? e.target?.id ?? 'a'} workflow`, e.id);
    }
  }

  private failedRun(floor: string | undefined, what: string, auditId?: string) {
    const r = this.rule('flowFailed');
    if (!r.on) return;
    const burst = this.count(`flow:${floor}`, r.count!, r.minutes!, { auditId });
    if (burst) this.d.raise({ rule: 'flowFailed', floor, severity: 'sev3', title: `Workflow or gate-check runs failing${this.where(floor)}`, summary: `${burst.length} runs failed within ${r.minutes} minutes, the last ${what}`, auditIds: ids(burst) });
  }

  // ---- Workers -----------------------------------------------------------------------------------------

  /** A worker's update: an abnormal exit counts towards a crash loop. */
  onWorker(floor: string, w: WorkerInfo) {
    const before = this.status.get(w.id);
    this.status.set(w.id, w.status);
    if (w.status !== 'exited' || before === 'exited' || w.kind !== 'agent') return;
    if (w.exitCode === undefined || w.exitCode === 0) return;
    // Test mode's refusals are their own incident, not a crash.
    if (this.d.now() - (this.refusedAt.get(w.id) ?? -Infinity) < MIN) return;
    const r = this.rule('crashLoop');
    if (!r.on) return;
    const burst = this.count(`crash:${floor}:${w.id}`, r.count!, r.minutes!, { worker: { id: w.id, name: w.name, floor } });
    if (burst) this.d.raise({ rule: 'crashLoop', floor, severity: 'sev3', title: `Worker crash loop${this.where(floor)}`, summary: `${w.name} exited abnormally ${burst.length} times within ${r.minutes} minutes (last exit code ${w.exitCode})`, workers: [{ id: w.id, name: w.name, floor }] });
  }

  forgetWorker(id: string) {
    this.status.delete(id);
  }

  /** What the office restored on start: workers whose turn the last stop cut short. */
  onRestored(floor: string, interrupted: IncidentWorker[]) {
    const r = this.rule('interrupted');
    if (!r.on || interrupted.length < (r.count ?? 1)) return;
    const names = interrupted.map((w) => w.name).join(', ');
    this.d.raise({ rule: 'interrupted', floor, severity: 'sev3', title: `Office stopped with workers mid-turn${this.where(floor)}`, summary: `${interrupted.length} worker${interrupted.length === 1 ? ' was' : 's were'} interrupted mid-turn when the office last stopped: ${names}`, again: `Interrupted again: ${names}`, workers: interrupted, impact: { agents: interrupted.length } });
  }

  // ---- Signals -------------------------------------------------------------------------------------

  onSignal(s: IncidentSignal) {
    if (s.kind === 'launch.refused' || s.kind === 'launch.real') {
      const floor = this.d.floorOfDir(s.floorDir);
      const worker = { id: s.worker.id, name: s.worker.name, floor };
      if (s.kind === 'launch.refused') {
        const last = this.refusedAt.get(s.worker.id);
        this.refusedAt.set(s.worker.id, this.d.now());
        // The same worker refused again (someone woke it again): already on the incident.
        if (last !== undefined && this.d.now() - last < REFUSED_AGAIN_MS) return;
        this.d.raise({ rule: 'realLaunch', floor, severity: 'near-miss', title: `Test mode stopped a real agent launch${this.where(floor)}`, summary: `${s.worker.name} would have started ${s.command}: ${s.why}`, again: `Also stopped: ${s.worker.name} (${s.command})`, workers: [worker], impact: { agents: 1, spendUsd: 0 } });
      } else {
        this.d.raise({ rule: 'realLaunch', floor, severity: 'sev2', title: `A real agent started on a test office${this.where(floor)}`, summary: `${s.worker.name} started the real ${s.command} on a test office (real agents were allowed by AGENT_OFFICE_ALLOW_REAL_AGENTS)`, again: `Also started: ${s.worker.name} (${s.command})`, workers: [worker], impact: { agents: 1 } });
      }
    } else if (s.kind === 'gate-check.failed') {
      this.failedRun(this.d.floorOfDir(s.floorDir), `gate-check (${s.message.slice(0, 120)})`);
    } else if (s.kind === 'sweep.failed') {
      const r = this.rule('sweepErrors');
      if (!r.on) return;
      const floor = this.d.floorOfDir(s.path) ?? (s.floor ? this.d.floorOfName(s.floor) : undefined);
      const burst = this.count(`sweep:${floor}`, r.count!, r.minutes!);
      if (burst) this.d.raise({ rule: 'sweepErrors', floor, severity: 'sev3', title: `Worktree cleanup failing${this.where(floor)}`, summary: `The worktree cleanup failed ${burst.length} times within ${Math.round(r.minutes! / 60)} hours, the last on ${s.path}: ${s.why.slice(0, 200)}` });
    } else if (s.kind === 'budget.alert') {
      if (!this.rule('spendCap').on) return;
      this.d.raise({ rule: 'spendCap', floor: s.floor, severity: s.level === 'cap' ? 'sev3' : 'near-miss', title: s.level === 'cap' ? `Budget reached${this.where(s.floor)}` : `Budget nearly reached${this.where(s.floor)}`, summary: s.text, ...(s.spentUsd !== undefined ? { impact: { spendUsd: s.spentUsd } } : {}) });
    }
  }

  // ---- The minute's look -----------------------------------------------------------------------------

  tick(floors: readonly FloorSnapshot[]) {
    const now = this.d.now();
    for (const f of floors) {
      this.spendOf(f, now);
      this.capOf(f);
      this.undeliveredOf(f, now);
    }
  }

  private spendOf(f: FloorSnapshot, now: number) {
    const t = this.spend.get(f.id) ?? { seen: new Map<string, number>(), total: 0, samples: [] };
    this.spend.set(f.id, t);
    for (const [id, cost] of Object.entries(f.costs)) {
      const had = t.seen.get(id);
      // First sight of a worker: what it spent before the office watched isn't this hour's.
      if (had !== undefined && cost > had) t.total += cost - had;
      t.seen.set(id, cost);
    }
    t.samples.push({ at: now, total: t.total });
    t.samples = t.samples.filter((s) => now - s.at <= SPEND_KEEP);
    const r = this.rule('spendSpike');
    if (!r.on || (t.firedAt !== undefined && now - t.firedAt < HOUR)) return;
    const at = (when: number) => [...t.samples].reverse().find((s) => s.at <= when);
    const hourAgo = at(now - HOUR) ?? t.samples[0];
    const lastHour = t.total - hourAgo.total;
    const oldest = t.samples[0];
    const history = hourAgo.at - oldest.at;
    const avg = history >= SPEND_MIN_HISTORY ? ((hourAgo.total - oldest.total) / history) * HOUR : undefined;
    const usd = (n: number) => `$${n.toFixed(2)}`;
    let detection: Detection | undefined;
    if (lastHour >= r.absUsd!) detection = { rule: 'spendSpike', floor: f.id, severity: 'sev2', title: `Spend spike on ${this.d.floorName(f.id)}`, summary: `${usd(lastHour)} spent in the last hour, past the ${usd(r.absUsd!)} an hour limit`, impact: { spendUsd: round(lastHour) } };
    else if (avg !== undefined && lastHour >= r.minUsd! && lastHour > r.factor! * avg) detection = { rule: 'spendSpike', floor: f.id, severity: 'sev3', title: `Spend spike on ${this.d.floorName(f.id)}`, summary: `${usd(lastHour)} spent in the last hour, ${avg > 0 ? `${(lastHour / avg).toFixed(1)}×` : 'far above'} the trailing ${usd(avg)} an hour`, impact: { spendUsd: round(lastHour) } };
    if (!detection) return;
    t.firedAt = now;
    this.d.raise(detection);
  }

  private capOf(f: FloorSnapshot) {
    const before = this.paused.get(f.id);
    this.paused.set(f.id, f.paused);
    if (!f.paused || before || !this.rule('spendCap').on) return;
    this.d.raise({ rule: 'spendCap', floor: f.id, severity: 'near-miss', title: `Spend cap reached on ${this.d.floorName(f.id)}`, summary: `The floor's daily spend cap paused the office's prompts: ${f.paused}` });
  }

  private undeliveredOf(f: FloorSnapshot, now: number) {
    const r = this.rule('escalationUndelivered');
    if (!r.on) return;
    const late = f.undelivered.filter((e) => now - e.at >= r.minutes! * MIN && !this.toldUndelivered.has(e.id));
    if (!late.length) return;
    for (const e of late) this.toldUndelivered.add(e.id);
    const what = late.map((e) => `${e.by}'s “${e.title}”`).join(', ');
    this.d.raise({ rule: 'escalationUndelivered', floor: f.id, severity: 'sev3', title: `Escalation answers not delivered on ${this.d.floorName(f.id)}`, summary: `The answer to ${what} still hadn't reached ${late.length === 1 ? 'its agent' : 'their agents'} after ${r.minutes} minutes`, again: `Also undelivered: ${what}`, workers: late.map((e) => ({ name: e.by, floor: f.id })) });
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
const ids = (burst: { auditId?: string }[]) => burst.map((x) => x.auditId).filter((x): x is string => !!x);
function workersOf(burst: { worker?: IncidentWorker }[]): IncidentWorker[] {
  const out = new Map<string, IncidentWorker>();
  for (const x of burst) if (x.worker) out.set(x.worker.id ?? x.worker.name, x.worker);
  return [...out.values()];
}
