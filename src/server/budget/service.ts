// The Budget: a spend ledger per project, fed from the same usage deltas the office's Ledger is
// (workers/manager.ts books each worker's delta there and then sends the worker's update, which is when
// this books the same delta, split by subagent and model), plus the office's own background calls
// (budget/meter.ts), which it books on the floor they served and into the office's Ledger, where they
// weren't before. Free of the office's context (index.ts makes the real one), so the tests drive it.

import type { RunRecord } from '../../shared/analysis.js';
import type { Usage, UsageState, WorkerInfo } from '../../shared/protocol.js';
import type { AgentInfo, FxView, StageId } from '../../shared/budget/types.js';
import { ROLES } from '../../shared/roster/roles.js';
import { issueOf, seenOf, splitDelta } from './attribute.js';
import { backfill } from './backfill.js';
import { fetchFx, fxDue, fxView } from './fx.js';
import { book, noteStage, prune, type LedgerData } from './ledger.js';
import { SOURCE_LABEL, type BackgroundSpend } from './meter.js';
import { BudgetStore, type FloorFile } from './store.js';

export interface FloorRef {
  id: string;
  name: string;
  dir: string;
}

export interface BudgetDeps {
  dataDir: string;
  now(): number;
  floors(): FloorRef[];
  workers(floorId: string): WorkerInfo[];
  /** The floor a worker is on. */
  floorOfWorker(workerId: string): string | undefined;
  /** A team member's role title on a floor (by worker id, or by name for a gone one); undefined for anyone else. */
  roleOf(floorId: string, workerId: string, name: string): string | undefined;
  /** The issue on a worker's queue task, if it has one. */
  taskIssue(floorId: string, workerId: string): number | undefined;
  stageOf(dir: string): StageId;
  /** The office's own Ledger: background calls go into it too. */
  officeLedger: { add(u: Usage): void; state(): UsageState };
  /** The analysis runs (for the back-fill). */
  runs(): RunRecord[];
  /** Something changed on a floor's budget (its view should be fetched again). */
  changed?(floorId: string): void;
  /** The team's settings the insights read (idle benching, Jeff's waiting mode, early drafts), when the floor has a team. */
  team?(floorId: string): { idleMinutes: number; jeffWaiting: 'off' | 'shadow' | 'on'; earlyDrafts: boolean } | undefined;
  /** Token efficiency (0-100) from the worker ranking, by worker id. */
  efficiency?(floorId: string): Record<string, number>;
  fetch?: typeof fetch;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The day `ms` falls on, on the office's clock (the office Ledger's days). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SUBAGENT_TITLE = new Map(ROLES.flatMap((r) => r.subagents.map((s) => [s.id, s.title] as const)));

export class BudgetService {
  readonly store: BudgetStore;
  private fxFetching?: Promise<unknown>;
  private loaded = new Set<string>();
  /** After spend landed on a floor: the alerts and the pause (control.ts, set by index.ts). */
  onSpend?: (floor: FloorRef) => void;
  /** A floor's file was first loaded: the budget's pause goes back on after a restart. */
  onLoad?: (floor: FloorRef) => void;

  constructor(readonly deps: BudgetDeps) {
    this.store = new BudgetStore(deps.dataDir, deps.now);
  }

  get today(): string {
    return localDay(this.deps.now());
  }

  /** A floor's file, made (and back-filled from history) the first time. */
  file(floor: FloorRef): FloorFile {
    const fresh = !this.store.has(floor.id);
    const f = this.store.floor(floor.id);
    if (!this.loaded.has(floor.id)) {
      this.loaded.add(floor.id);
      this.onLoad?.(floor);
    }
    if (fresh && !f.ledger.backfilled) {
      backfill(f.ledger, this.deps.workers(floor.id), this.deps.runs().filter((r) => r.floor === floor.id), {
        dayOf: localDay,
        today: this.today,
        roleOf: (id, name) => this.deps.roleOf(floor.id, id, name) ?? 'Worker',
        agentFor: (w, sub, role) => this.agentFor(w, sub, role),
      });
      this.store.changed(floor.id);
    }
    return f;
  }

  floorRef(id: string): FloorRef | undefined {
    return this.deps.floors().find((f) => f.id === id);
  }

  agentFor(w: { id: string; name: string; provider?: string }, sub: string, role: string): AgentInfo {
    if (!sub) return { key: w.id, name: w.name, role, kind: 'worker', ...(w.provider ? { provider: w.provider } : {}) };
    return { key: `${w.id}/${sub}`, name: SUBAGENT_TITLE.get(sub) ?? sub, role: sub, kind: 'subagent', lead: w.id };
  }

  /** The stage now, noted in the floor's stage timeline. */
  private stageNow(floor: FloorRef, d: LedgerData): StageId {
    const s = this.deps.stageOf(floor.dir);
    noteStage(d, s, this.deps.now());
    return s;
  }

  /** A worker's update: books what it spent since last time. */
  onWorker(floorId: string, w: WorkerInfo) {
    if (w.kind !== 'agent' || !w.usage) return;
    const floor = this.floorRef(floorId);
    if (!floor) return;
    const f = this.file(floor);
    const d = f.ledger;
    const seen = d.seen[w.id];
    if (!seen && w.createdAt < d.startedAt) {
      // Hired before the ledger started and not back-filled with the rest (it came back later): its history.
      backfill(d, [w], [], { dayOf: localDay, today: this.today, roleOf: (id, name) => this.deps.roleOf(floorId, id, name) ?? 'Worker', agentFor: (x, sub, role) => this.agentFor(x, sub, role) });
      this.store.changed(floorId);
      return;
    }
    const pieces = splitDelta(seen, w.usage, w.model ?? 'claude');
    if (!pieces.length) return;
    const unmetered = (w.provider ?? 'claude') !== 'claude';
    const role = this.deps.roleOf(floorId, w.id, w.name) ?? 'Worker';
    const stage = this.stageNow(floor, d);
    const issue = issueOf(this.deps.taskIssue(floorId, w.id), w.prompt);
    const day = this.today;
    for (const p of pieces) {
      const agent = this.agentFor(w, p.sub, role);
      book(d, { day, agent: agent.key, model: p.model, stage, cost: unmetered ? 0 : p.cost, calls: p.calls, ...(unmetered ? { unmetered: true } : {}), ...(issue !== undefined ? { issue } : {}), ...(w.pr ? { pr: w.pr.number } : {}) }, agent);
    }
    d.seen[w.id] = seenOf(w.usage);
    prune(d, day);
    this.store.changed(floorId);
    this.afterSpend(floorId);
  }

  /** One of the office's background calls: on the floor it served (else the office's own), and into the office's Ledger. */
  onBackground(s: BackgroundSpend) {
    const floorId = s.floor ?? (s.worker ? this.deps.floorOfWorker(s.worker) : undefined);
    const floor = floorId ? this.floorRef(floorId) : undefined;
    if (!s.unmetered && !s.inLedger && (s.usage.cost || s.usage.calls)) this.deps.officeLedger.add({ input: s.usage.input, output: s.usage.output, cacheWrite: s.usage.cacheWrite, cacheRead: s.usage.cacheRead, cost: s.usage.cost, calls: s.usage.calls });
    const d = floor ? this.file(floor).ledger : this.store.office().ledger;
    const agent: AgentInfo = { key: `bg:${s.source}`, name: SOURCE_LABEL[s.source], role: 'Office background', kind: 'background' };
    const stage = floor ? this.stageNow(floor, d) : '—';
    book(d, { day: this.today, agent: agent.key, model: s.model, stage, cost: s.unmetered ? 0 : s.usage.cost, calls: s.usage.calls, ...(s.unmetered ? { unmetered: true } : {}) }, agent);
    prune(d, this.today);
    this.store.changed(floor ? floor.id : 'office');
    if (floor) this.afterSpend(floor.id);
  }

  /** After spend landed on a floor (step 2 checks the alerts here). */
  protected afterSpend(floorId: string) {
    const floor = this.floorRef(floorId);
    if (floor) this.onSpend?.(floor);
    this.deps.changed?.(floorId);
  }

  /** The exchange rate now; a daily fetch starts in the background when one is due. */
  fx(): FxView {
    const o = this.store.office();
    if (fxDue(o.fx, o.fxLast, this.today) && !this.fxFetching) {
      this.fxFetching = this.refreshFx().finally(() => (this.fxFetching = undefined));
    }
    return fxView(o.fx, o.fxLast);
  }

  /** Fetches the rate now (daily mode); the last good one is kept on failure. */
  async refreshFx(): Promise<FxView> {
    const o = this.store.office();
    if (o.fx.mode === 'daily' && o.fx.currency !== 'USD') {
      o.fxLast = await fetchFx(o.fx.currency, o.fxLast, this.today, this.deps.fetch ?? fetch);
      this.store.changed('office');
    }
    return fxView(o.fx, o.fxLast);
  }

  flush() {
    this.store.flush();
  }
}
