// Portfolios on the server (docs/site/using-the-office/portfolios.md): the grouping (./store.ts), connecting
// and disconnecting a company brain (./wire.ts), what each hire is offered (the prime-prompt line and its
// context manifest, ./manifest.ts) and noticing when the brain changed under a live session (one Needs-you
// card per project: Rehire for a fresh session, or Dismiss). Every office dependency comes in through
// PortfolioDeps, so the tests run it on synthetic fixtures. With no portfolios.json nothing here does
// anything: hireContext answers undefined and the hire's first message is byte-identical to before (P01).

import type { AuditInput } from '../../shared/audit.js';
import {
  changeWords,
  diffEmpty,
  diffRouted,
  isPortfolioId,
  primeLine,
  windowsForm,
  type BrainAct,
  type BrainChange,
  type BrainChangeView,
  type BrainRead,
  type ContextManifest,
  type ExistingContext,
  type Portfolio,
  type PortfoliosView,
  type WiringCheckView,
  type WiringProblem,
} from '../../shared/portfolios.js';
import { BrainReader, brainProblem, snapshotKey } from './brain.js';
import { ManifestStore } from './manifest.js';
import { PortfolioStore } from './store.js';
import { blockBrain, checkWiring, surfacesOf, unwireProject, wireProject, type WireEnv, type WiringCheck } from './wire.js';
import { DismissStore } from './dismiss.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PortfolioFloor {
  id: string;
  name: string;
  dir: string;
  projectId?: string;
}

export interface HiredMember {
  role: string;
  name: string;
  workerId: string;
}

export interface PortfolioDeps {
  dataDir: string;
  floors(): PortfolioFloor[];
  /** Git Bash, the project's toolkit and the contributing clone's deny list, for running the wiring script. */
  wireEnv(floorDir: string): Promise<WireEnv>;
  /** The floor's members at work now (role, name, worker). */
  hired(floorId: string): HiredMember[];
  /** A member's phase (active, benching, benched…), for Rehire. */
  phase(floorId: string, role: string): string | undefined;
  bench(floorId: string, role: string, by: string): string | undefined;
  hire(floorId: string, role: string, by: string): Promise<string | undefined>;
  audit(e: AuditInput): void;
  now(): number;
}

/** What a hire is given: the one line for its first message, and how to record the manifest once it's hired. */
export interface HireContext {
  line: string;
  record(role: string, workerId: string, sessionId?: string): Promise<void>;
}

const REHIRE_CHECK_MS = 15_000;

export class PortfolioService {
  readonly store: PortfolioStore;
  readonly manifests: ManifestStore;
  readonly reader: BrainReader;
  private dismissed: DismissStore;
  private changes = new Map<string, BrainChange>();
  private wiring = new Map<string, WiringProblem>();
  private checks = new Map<string, WiringCheck>();
  private rehiring = new Map<string, { roles: Set<string>; by: string }>();
  private rehireTimer?: ReturnType<typeof setInterval>;

  constructor(readonly deps: PortfolioDeps) {
    this.store = new PortfolioStore(deps.dataDir, deps.now);
    this.manifests = new ManifestStore(deps.dataDir);
    this.reader = new BrainReader(deps.now);
    this.dismissed = new DismissStore(deps.dataDir);
  }

  private floor(id: string) {
    return this.deps.floors().find((f) => f.id === id);
  }

  // ---- Reading ------------------------------------------------------------------------------------

  async view(admin: boolean): Promise<PortfoliosView> {
    const list = await this.store.load();
    const floors = this.deps.floors();
    const grouped = new Set(list.flatMap((p) => p.projectIds));
    const portfolios = await Promise.all(
      list.map(async (p) => ({
        ...p,
        projects: p.projectIds.map((id) => ({ id, name: floors.find((f) => f.id === id)?.name ?? `${id} (not in the office now)`, ...(p.brain && this.checks.get(id) ? { wiring: { ok: this.checks.get(id)!.ok, problems: this.checks.get(id)!.problems } } : {}) })),
        ...(p.brain ? { read: await this.reader.read(p.brain.path) } : {}),
      })),
    );
    return { portfolios, ungrouped: floors.filter((f) => !grouped.has(f.id)).map((f) => ({ id: f.id, name: f.name })), admin };
  }

  /** What a project already has wired, shown before Add to portfolio. */
  async existingContext(floorId: string): Promise<ExistingContext | undefined> {
    await this.store.load();
    const f = this.floor(floorId);
    if (!f) return undefined;
    const surfaces = surfacesOf(f.dir);
    const blocks: ExistingContext['blocks'] = [];
    for (const s of surfaces) {
      const text = await readFile(path.join(f.dir, s), 'utf8').catch(() => '');
      if (text.includes('COMPANY-BRAIN:BEGIN')) blocks.push({ file: s, ...(blockBrain(text) ? { brain: blockBrain(text) } : {}) });
    }
    const all = await this.manifests.all(floorId);
    const last = all[all.length - 1];
    const p = this.store.ofFloor(floorId);
    return { floor: floorId, ...(p ? { portfolio: { id: p.id, label: p.label } } : {}), blocks, manifests: all.length, ...(last ? { consumed: { portfolioId: last.portfolioId, path: last.brain.path } } : {}), surfaces };
  }

  // ---- Changing (admins only: the routes check) --------------------------------------------------

  async create(label: string, by: string): Promise<Portfolio | string> {
    const p = await this.store.create(label, by);
    if (typeof p !== 'string') this.deps.audit({ actor: { kind: 'human', name: by }, action: 'portfolio.create', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: `Created the portfolio ${p.label}` });
    return p;
  }

  /**
   * Adds an ungrouped project. Refused when it's in another portfolio, or when it already consumed a
   * different brain (its manifests say so): S03, no cross-portfolio moves in this phase.
   */
  async addProject(id: string, floorId: string, by: string): Promise<{ error?: string; check?: WiringCheckView }> {
    await this.store.load();
    const p = this.store.get(id);
    const f = this.floor(floorId);
    if (!p || !f) return { error: !p ? 'No such portfolio' : 'No such project' };
    const ctx = await this.existingContext(floorId);
    if (ctx?.consumed && ctx.consumed.portfolioId !== id) return { error: `This project already used another portfolio's company brain (${ctx.consumed.path}). Moving it isn't available: what it was offered can't be taken back.` };
    const err = await this.store.addProject(id, floorId);
    if (err) return { error: err };
    this.deps.audit({ floor: floorId, actor: { kind: 'human', name: by }, action: 'portfolio.add', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: `Added ${f.name} to the portfolio ${p.label}` });
    if (!p.brain) return {};
    return { check: await this.wireOne(p, f, by) };
  }

  /** A new project from the wizard joins its portfolio (after init and the pin instructions); throws on incomplete wiring, which is also a Needs-you card. */
  async joinFromWizard(floorId: string, id: string, by: string): Promise<string> {
    const r = await this.addProject(id, floorId, by);
    if (r.error) throw new Error(r.error);
    const p = this.store.get(id)!;
    if (!r.check) return `joined the portfolio ${p.label} (no company brain connected)`;
    if (!r.check.ok) throw new Error(`Company brain wiring is incomplete: ${r.check.problems.join('; ')}`);
    return `joined ${p.label}, company brain wired in ${r.check.surfaces.length} instruction files`;
  }

  /** Connects a brain: validates it, saves it, and wires every member project, each checked. */
  async connect(id: string, brainPath: string, by: string): Promise<{ error?: string; read?: BrainRead; results?: Record<string, WiringCheckView> }> {
    await this.store.load();
    const p = this.store.get(id);
    if (!p) return { error: 'No such portfolio' };
    const dir = windowsForm(brainPath.trim()).replace(/\/+$/, '');
    const bad = await brainProblem(dir);
    if (bad) return { error: bad };
    const other = this.store.all().find((x) => x.id !== id && x.brain && x.brain.path.toLowerCase() === dir.toLowerCase());
    if (other) return { error: `That brain is already connected to the portfolio ${other.label}: one brain per portfolio` };
    await this.store.setBrain(id, { path: dir, connectedAt: this.deps.now(), by });
    const read = await this.reader.read(dir, true);
    this.deps.audit({ actor: { kind: 'human', name: by }, action: 'portfolio.connect', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: `Connected the company brain ${dir} to ${p.label}${read.status === 'unversioned' ? ' (not versioned)' : ''}`, details: { status: read.status, snapshot: read.snapshot } });
    const results: Record<string, WiringCheckView> = {};
    for (const fid of p.projectIds) {
      const f = this.floor(fid);
      if (f) results[fid] = await this.wireOne(this.store.get(id)!, f, by);
    }
    return { read, results };
  }

  /** Disconnects: takes the pointer blocks out of every member project; manifests are kept. */
  async disconnect(id: string, by: string): Promise<{ error?: string; removed?: Record<string, string[]> }> {
    await this.store.load();
    const p = this.store.get(id);
    if (!p?.brain) return { error: p ? 'No brain is connected' : 'No such portfolio' };
    const removed: Record<string, string[]> = {};
    for (const fid of p.projectIds) {
      const f = this.floor(fid);
      if (!f) continue;
      removed[fid] = (await unwireProject(f.dir, p.brain.path, await this.deps.wireEnv(f.dir))).removed;
      this.checks.delete(fid);
      this.wiring.delete(fid);
      this.changes.delete(fid);
    }
    await this.store.setBrain(id, undefined);
    this.deps.audit({ actor: { kind: 'human', name: by }, action: 'portfolio.disconnect', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: `Disconnected the company brain from ${p.label} (pointer blocks removed; context manifests kept)` });
    return { removed };
  }

  /** Wires one project and runs the office's completion check; a partial result is an error and a Needs-you item. */
  async wireOne(p: Portfolio, f: PortfolioFloor, by: string): Promise<WiringCheckView> {
    let check: WiringCheck;
    try {
      check = await wireProject(f.dir, p.brain!.path, await this.deps.wireEnv(f.dir));
    } catch (err) {
      check = { ok: false, problems: [(err as Error).message], surfaces: surfacesOf(f.dir) };
    }
    this.noteCheck(p, f.id, check);
    this.deps.audit({ floor: f.id, actor: { kind: 'human', name: by }, action: check.ok ? 'portfolio.wire' : 'portfolio.wire-incomplete', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: check.ok ? `Wired ${f.name} to ${p.label}'s company brain (${check.surfaces.length} instruction files)` : `Wiring ${f.name} to ${p.label}'s company brain is incomplete: ${check.problems.join('; ')}`, severity: check.ok ? 'info' : 'warning' });
    return { ok: check.ok, problems: check.problems, surfaces: check.surfaces };
  }

  private noteCheck(p: Portfolio, floorId: string, check: WiringCheck) {
    this.checks.set(floorId, check);
    if (check.ok) this.wiring.delete(floorId);
    else if (!this.dismissed.has(floorId, `wiring:${check.problems.join('|')}`)) this.wiring.set(floorId, { floor: floorId, portfolioId: p.id, label: p.label, problems: check.problems, since: this.wiring.get(floorId)?.since ?? this.deps.now() });
  }

  // ---- At hire --------------------------------------------------------------------------------------

  /** The line and the manifest for a hire on `floorId`; undefined for a project in no portfolio, or one whose portfolio has no brain. */
  async hireContext(floorId: string): Promise<HireContext | undefined> {
    await this.store.load();
    const p = this.store.ofFloor(floorId);
    if (!p?.brain) return undefined;
    const read = await this.reader.read(p.brain.path);
    const f = this.floor(floorId);
    return {
      line: primeLine(p.label, read),
      record: (role, workerId, sessionId) => {
        const m: ContextManifest = {
          projectId: f?.projectId ?? floorId,
          floor: floorId,
          role,
          agentInstanceId: workerId,
          ...(sessionId ? { sessionId } : {}),
          preparedAt: this.deps.now(),
          portfolioId: p.id,
          brain: { path: read.path, snapshot: read.snapshot, dirty: read.dirty, routed: read.routed, excluded: read.excluded, status: read.status, ...(read.routing ? { routing: read.routing } : {}) },
        };
        // A fresh session against the current brain: any change card for it is settled.
        return this.manifests.append(m).then(() => void this.recompute(floorId, p, read));
      },
    };
  }

  // ---- Brain changes --------------------------------------------------------------------------------

  /** Works out the floor's change card against the brain as read. */
  async recompute(floorId: string, p: Portfolio, read: BrainRead): Promise<BrainChange | undefined> {
    const before = this.changes.get(floorId);
    const key = snapshotKey(read);
    if (read.status === 'unavailable' || this.dismissed.has(floorId, key)) {
      this.changes.delete(floorId);
      return undefined;
    }
    const latest = await this.manifests.latestByRole(floorId);
    const roles: BrainChange['roles'] = [];
    let diff: BrainChange['diff'] | undefined;
    for (const h of this.deps.hired(floorId)) {
      const m = latest.get(h.role);
      if (!m || m.agentInstanceId !== h.workerId || m.portfolioId !== p.id) continue;
      const d = diffRouted(m.brain.routed, read.routed);
      if (diffEmpty(d)) continue;
      roles.push({ role: h.role, name: h.name, workerId: h.workerId, preparedAt: m.preparedAt });
    }
    roles.sort((a, b) => b.preparedAt - a.preparedAt);
    if (roles.length) diff = diffRouted(latest.get(roles[0].role)!.brain.routed, read.routed);
    const pending = this.rehiring.get(floorId);
    if (!roles.length && !pending?.roles.size) {
      this.changes.delete(floorId);
      return undefined;
    }
    const change: BrainChange = { floor: floorId, portfolioId: p.id, label: p.label, key, roles, diff: diff ?? before?.diff ?? { corrected: [], withdrawn: [], added: [] }, since: before?.key === key ? before.since : this.deps.now(), ...(pending?.roles.size ? { rehiring: [...pending.roles] } : {}) };
    this.changes.set(floorId, change);
    if (before?.key !== key && roles.length) this.deps.audit({ floor: floorId, actor: { kind: 'office', name: 'The office' }, action: 'portfolio.brain-changed', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: changeWords(change.diff, roles[0].name), details: { snapshot: read.snapshot, corrected: change.diff.corrected.length, withdrawn: change.diff.withdrawn.length, added: change.diff.added.length } });
    return change;
  }

  /** The five-minute look: each connected brain read (off the loop, cached), each member project's card and wiring checked. */
  async tick(): Promise<void> {
    await this.store.load();
    for (const p of this.store.all()) {
      if (!p.brain) continue;
      const read = await this.reader.read(p.brain.path, true);
      for (const fid of p.projectIds) {
        const f = this.floor(fid);
        if (!f) continue;
        this.noteCheck(p, fid, await checkWiring(f.dir, p.brain.path));
        await this.recompute(fid, p, read);
      }
    }
  }

  /** What Needs you reads for a floor. */
  changeView(floorId: string, admin: boolean): BrainChangeView {
    const change = this.changes.get(floorId);
    const wiring = this.wiring.get(floorId);
    return { floor: floorId, ...(change ? { change } : {}), ...(wiring ? { wiring } : {}), admin };
  }

  /** A card's button: Rehire for a fresh session, Dismiss, Wire again, or Dismiss the wiring problem. */
  async act(floorId: string, act: BrainAct, by: string): Promise<string | undefined> {
    await this.store.load();
    const p = this.store.ofFloor(floorId);
    if (!p?.brain) return 'This project has no company brain';
    if (act === 'dismiss' || act === 'dismiss-wiring') {
      const key = act === 'dismiss' ? this.changes.get(floorId)?.key : `wiring:${this.wiring.get(floorId)?.problems.join('|') ?? ''}`;
      if (!key) return 'Nothing to dismiss';
      await this.dismissed.add(floorId, key);
      if (act === 'dismiss') this.changes.delete(floorId);
      else this.wiring.delete(floorId);
      this.deps.audit({ floor: floorId, actor: { kind: 'human', name: by }, action: 'portfolio.dismiss', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: act === 'dismiss' ? 'Dismissed the company brain change (sessions carry on as they were prepared)' : 'Dismissed the incomplete wiring' });
      return undefined;
    }
    const f = this.floor(floorId);
    if (!f) return 'No such project';
    if (act === 'rewire') {
      const c = await this.wireOne(p, f, by);
      return c.ok ? undefined : `Still incomplete: ${c.problems.join('; ')}`;
    }
    const change = this.changes.get(floorId);
    if (!change?.roles.length) return 'No session to refresh';
    const errors: string[] = [];
    const pending = this.rehiring.get(floorId) ?? { roles: new Set<string>(), by };
    for (const r of change.roles) {
      // Bench first (handoff note written), then hired again once benched: a fresh session gets a fresh manifest.
      const err = this.deps.bench(floorId, r.role, by);
      if (err) errors.push(err);
      else pending.roles.add(r.role);
    }
    if (pending.roles.size) {
      this.rehiring.set(floorId, pending);
      change.rehiring = [...pending.roles];
      this.watchRehires();
    }
    this.deps.audit({ floor: floorId, actor: { kind: 'human', name: by }, action: 'portfolio.rehire', target: { kind: 'portfolio', id: p.id, label: p.label }, summary: `Rehire for a fresh session: ${change.roles.map((r) => r.name).join(', ')}${errors.length ? ` (${errors.join('; ')})` : ''}` });
    return errors.length && !pending.roles.size ? errors.join('; ') : undefined;
  }

  /** Hires each benched member a Rehire asked for (a light in-memory check, only while one is pending). */
  async rehireBenched(): Promise<void> {
    for (const [floorId, pend] of this.rehiring) {
      for (const role of [...pend.roles]) {
        const phase = this.deps.phase(floorId, role);
        if (phase === 'benching' || phase === 'active') continue;
        pend.roles.delete(role);
        await this.deps.hire(floorId, role, pend.by).catch(() => undefined);
      }
      if (!pend.roles.size) {
        this.rehiring.delete(floorId);
        const c = this.changes.get(floorId);
        if (c) delete c.rehiring;
      }
    }
    if (!this.rehiring.size && this.rehireTimer) {
      clearInterval(this.rehireTimer);
      this.rehireTimer = undefined;
    }
  }

  private watchRehires() {
    if (this.rehireTimer) return;
    this.rehireTimer = setInterval(() => void this.rehireBenched(), REHIRE_CHECK_MS);
    this.rehireTimer.unref?.();
  }

  stop() {
    if (this.rehireTimer) clearInterval(this.rehireTimer);
  }
}

export { isPortfolioId };
