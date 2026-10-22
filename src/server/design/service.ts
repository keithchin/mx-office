// Design systems' service (docs/site/using-the-office/design-systems.md): the client's (or an independent
// project's) design system and its immutable versions (./store.ts), the projects' bindings, apply records and
// ✋ proposals (./projects.ts), the wizard's step and the card's Adopt (./adopt.ts), pattern selections, runtime
// captures (./capture.ts) and the agent-context line (./line.ts). Every change is audited (design.*). Free of
// the office's context (./index.ts makes the real one), so the tests drive it with fakes; browsing never calls
// a model and never starts a runtime.

import type { AuditInput } from '../../shared/audit.js';
import { patternById } from '../../shared/design/patterns.js';
import { pointerOf, type DesignAdoption, type DesignInput, type DesignKind, type DesignOwner, type PackageManifest, type PatternSelection, type SelectionScope } from '../../shared/design/types.js';
import type { ClientDesignView, DesignChoice, DesignChoicesView, DesignNeedView, ProjectDesignView, VersionView } from '../../shared/design/views.js';
import { mxcliVersion, type Run } from './apply.js';
import { applyInPlace } from './adopt.js';
import { checkMerge, discardAdoption, reconcileAdoption, runAdoption, settled, type AdoptionEnv, type AdoptionPoint } from './adoption.js';
import { Captures, type Shooter } from './capture.js';
import { DesignLines, type GuidanceWriter } from './line.js';
import { DesignProjects } from './projects.js';
import { scanTheme, scanWords } from './scan.js';
import { stageWords } from '../../shared/design/words.js';
import { DesignStore } from './store.js';
import { findMpr } from '../liveapp/checkout.js';
import path from 'node:path';

export interface DesignFloor {
  id: string;
  name: string;
  dir: string;
}

export interface DesignDeps {
  dataDir: string;
  floors(): DesignFloor[];
  clientOf(floor: string): { id: string; label: string } | undefined;
  clientLabel(id: string): string | undefined;
  mxcli(): string | undefined;
  /**
   * The floor's live app: running (with its URL and its served commit, the one actually answering) or not,
   * and whether it's on its way to another build (updating). Never started from here.
   */
  live(floor: string): { running: boolean; status: string; url?: string; sha?: string; updating?: boolean };
  audit(e: AuditInput): void;
  now(): number;
  run?: Run;
  shooter?: Shooter;
  /** Tests: stop an adoption at a point as if the office had been killed there. */
  checkpoint?(point: AdoptionPoint): Promise<void>;
  /** Tests: the guidance files' writer (slow or failing). */
  guidanceWriter?: GuidanceWriter;
}

export const STUDIO_PRO = '11.12.4';
export const ATLAS = 'Atlas 3 (Studio Pro 11, CSS variables)';
const human = (name: string) => ({ kind: 'human' as const, name });

export class DesignService {
  readonly store: DesignStore;
  readonly projects: DesignProjects;
  readonly lines: DesignLines;
  readonly captures: Captures;
  private busy = new Set<string>();
  private loaded?: Promise<unknown>;
  private checked = new Map<string, number>();

  constructor(private deps: DesignDeps) {
    this.store = new DesignStore(deps.dataDir, deps.now);
    this.projects = new DesignProjects(this.store.root);
    this.lines = new DesignLines(this.store.root, deps.dataDir, this.projects, (id, n) => this.store.packageDir(id, n), deps.now, deps.guidanceWriter);
    this.captures = new Captures(this.store.root, deps.shooter, deps.now);
  }

  /** Loaded, and each open adoption put right with git once (after a restart: ./adoption.ts). */
  ready(): Promise<unknown> {
    this.loaded ??= Promise.all([this.store.load(), this.projects.load()]).then(() => Promise.all(this.projects.adoptionFloors().map((f) => this.reconcile(f))));
    return this.loaded;
  }

  /** An open adoption checked against git now (never while this office is running it). */
  private async reconcile(floorId: string): Promise<DesignAdoption | undefined> {
    const f = this.floor(floorId);
    if (!f || this.busy.has(floorId)) return this.projects.adoption(floorId);
    const before = this.projects.adoption(floorId);
    try {
      const a = await reconcileAdoption(this.env(), floorId, f.dir);
      if (a?.status === 'active' && before?.status !== 'active') await this.activated(floorId, a);
      return a;
    } catch (err) {
      console.warn(`agent-office: design adoption on ${floorId}: ${(err as Error).message}`);
      return before;
    }
  }

  /** A candidate waiting to be merged: looked at again when its page asks, at most once a minute. */
  private async refresh(floorId: string): Promise<void> {
    const a = this.projects.adoption(floorId);
    const f = this.floor(floorId);
    if (!a || settled(a) || !f || this.busy.has(floorId)) return;
    // Running, but not here: left by an office that stopped (put right with git now).
    if (a.status === 'running') return void (await this.reconcile(floorId));
    if (!a.commit) return;
    if (this.deps.now() - (this.checked.get(floorId) ?? -Infinity) < 60_000) return;
    this.checked.set(floorId, this.deps.now());
    const next = await checkMerge(this.env(), a, f.dir).catch(() => a);
    if (next.status === 'active') await this.activated(floorId, next);
  }

  /** Merged: the binding is the project's now (said once in the audit log), and its guidance is written. */
  private async activated(floorId: string, a: DesignAdoption): Promise<void> {
    this.deps.audit({ floor: floorId, actor: { kind: 'office', name: 'Mx Office' }, action: 'design.apply', target: { kind: 'design-system', id: a.systemId, label: `${a.name} v${a.n}` }, summary: `Adopted ${a.name} v${a.n}: ${a.commit?.slice(0, 7) ?? 'the decision'} is on ${a.into ?? 'the default branch'}`.slice(0, 240), details: { digest: a.digest } });
    await this.lines.prepare(floorId).catch((err: Error) => console.warn(`agent-office: design guidance for ${floorId}: ${err.message}`));
  }

  private floor(id: string) {
    return this.deps.floors().find((f) => f.id === id);
  }

  private env(log?: (l: string) => void): AdoptionEnv {
    return { projects: this.projects, packageDir: (id, n) => this.store.packageDir(id, n), mxcli: this.deps.mxcli, run: this.deps.run, now: this.deps.now, log, ...(this.deps.checkpoint ? { checkpoint: this.deps.checkpoint } : {}) };
  }

  private async versions(id: string): Promise<VersionView[]> {
    const s = this.store.get(id);
    if (!s) return [];
    const bound = this.projects.bindings();
    const out: VersionView[] = [];
    for (const v of [...s.versions].reverse()) {
      const m = await this.store.manifest(id, v.n);
      const usedBy = Object.entries(bound).filter(([, b]) => b.systemId === id && b.n === v.n).map(([f]) => this.floor(f)?.name ?? f);
      out.push({ n: v.n, digest: v.digest, status: v.status, publishedAt: v.publishedAt, by: v.by, ...(v.approvedBy ? { approvedBy: v.approvedBy } : {}), ...(m?.themeName ? { themeName: m.themeName } : {}), ...(m ? { compat: m.compat, gaps: m.gaps } : {}), usedBy });
    }
    return out;
  }

  // ---- Views ---------------------------------------------------------------------------------------

  async clientView(client: string, admin: boolean): Promise<ClientDesignView> {
    await this.ready();
    const s = this.store.ofOwner({ client });
    const { versions: _v, ...system } = s ?? ({} as never);
    const top = s?.versions.at(-1);
    const latest = top ? await this.store.inputOf(s!.id, top.n) : undefined;
    return { client, label: this.deps.clientLabel(client) ?? client, ...(s ? { system } : {}), versions: s ? await this.versions(s.id) : [], ...(this.store.defaultOf(client) ? { default: this.store.defaultOf(client) } : {}), ...(latest ? { latest } : {}), admin };
  }

  /** What a new project of `client` may adopt: the approved versions of its design system, its default first. */
  async choices(client: string | undefined): Promise<DesignChoicesView> {
    await this.ready();
    if (!client) return { choices: [] };
    const s = this.store.ofOwner({ client });
    const d = this.store.defaultOf(client);
    const choices: DesignChoice[] = (s?.versions ?? [])
      .filter((v) => v.status === 'approved' || (d?.systemId === s?.id && d?.n === v.n))
      .map((v) => ({ systemId: s!.id, name: s!.name, n: v.n, digest: v.digest, kind: s!.kind, status: v.status, ...(d?.systemId === s!.id && d.n === v.n ? { recommended: true } : {}) }))
      .sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || b.n - a.n);
    return { client, choices };
  }

  async projectView(floorId: string, admin: boolean): Promise<ProjectDesignView | undefined> {
    await this.ready();
    const f = this.floor(floorId);
    if (!f) return undefined;
    await this.refresh(floorId);
    const client = this.deps.clientOf(floorId);
    const binding = this.projects.binding(floorId);
    const ap = this.projects.apply(floorId);
    const d = client ? this.store.defaultOf(client.id) : undefined;
    const ds = d ? this.store.get(d.systemId) : undefined;
    const dv = ds?.versions.find((v) => v.n === d!.n);
    const available = ds && dv && (binding?.systemId !== ds.id || binding.n !== dv.n) ? { systemId: ds.id, name: ds.name, n: dv.n, digest: dv.digest, kind: ds.kind, status: dv.status, recommended: true } : undefined;
    const own = this.store.ofOwner({ floor: floorId });
    const live = this.deps.live(floorId);
    const proposal = this.projects.proposal(floorId);
    const adoption = this.openAdoption(floorId);
    return {
      floor: floorId,
      name: f.name,
      ...(client ? { client } : {}),
      ...(binding ? { binding } : {}),
      ...(proposal ? { proposal } : {}),
      ...(adoption ? { adoption } : {}),
      ...(ap ? { apply: { state: ap.state, at: ap.at, ...(ap.detail ? { detail: ap.detail } : {}) } } : {}),
      ...(available ? { available } : {}),
      ...(own ? { own: { ...own, versions: await this.versions(own.id) } } : {}),
      selections: [...(await this.projects.selectionsOf(floorId))],
      captures: [...(await this.captures.list(floorId))].reverse(),
      live: { running: live.running, status: live.status },
      admin,
    };
  }

  /** The project's adoption while it's open (running, failed or a candidate on its branch), as the pages show it. */
  private openAdoption(floorId: string): DesignAdoption | undefined {
    const a = this.projects.adoption(floorId);
    if (!a || settled(a)) return undefined;
    delete a.worktree;
    return a;
  }

  needView(floorId: string, admin: boolean): DesignNeedView {
    void this.refresh(floorId).catch(() => undefined);
    const p = this.projects.proposal(floorId);
    const ap = this.projects.apply(floorId);
    const a = this.openAdoption(floorId);
    const failed = a?.failed ? { detail: `${stageWords(a.failed.stage)} failed: ${a.failed.detail}`, at: a.failed.at, stage: a.failed.stage } : ap?.state === 'failed' && p ? { detail: ap.detail ?? 'the apply failed', at: ap.at } : undefined;
    return { floor: floorId, ...(p ? { proposal: p } : {}), ...(a ? { adoption: a } : {}), ...(failed ? { failed } : {}), admin };
  }

  // ---- The client's design system ------------------------------------------------------------------

  async saveDraft(owner: DesignOwner, kind: DesignKind, input: DesignInput, by: string): Promise<string | undefined> {
    const s = await this.store.saveDraft(owner, kind, input, by);
    if (typeof s === 'string') return s;
    this.deps.audit({ ...(owner.floor ? { floor: owner.floor } : {}), actor: human(by), action: 'design.draft', target: { kind: 'design-system', id: s.id, label: s.name }, summary: `Saved a draft of ${s.name} (${kind === 'branded' ? 'Branded Atlas' : 'Atlas defaults'})` });
    return undefined;
  }

  async publish(id: string, by: string): Promise<string | { n: number; digest: string }> {
    await this.ready();
    const mx = this.deps.mxcli();
    const compat = { studioPro: STUDIO_PRO, atlas: ATLAS, mxcli: mx ? await mxcliVersion(mx, this.deps.run) : 'unknown', themeBase: 'signal' };
    const r = await this.store.publish(id, by, compat);
    if (typeof r === 'string') return r;
    const m = r.manifest;
    this.deps.audit({ ...(m.owner.floor ? { floor: m.owner.floor } : {}), actor: human(by), action: 'design.publish', target: { kind: 'design-system', id: m.id, label: m.name }, summary: `Published ${m.name} v${m.version} (digest ${m.digest.slice(0, 12)}, mxcli ${compat.mxcli})`, details: { version: m.version, digest: m.digest } });
    return { n: m.version, digest: m.digest };
  }

  async approve(id: string, n: number, by: string): Promise<string | undefined> {
    const v = await this.store.approve(id, n, by);
    if (typeof v === 'string') return v;
    const s = this.store.get(id)!;
    this.deps.audit({ actor: human(by), action: 'design.approve', target: { kind: 'design-system', id, label: s.name }, summary: `Approved ${s.name} v${n} (earlier approved versions superseded; bound projects keep theirs)`, details: { version: n, digest: v.digest } });
    return undefined;
  }

  async editFrom(id: string, n: number, by: string): Promise<string | undefined> {
    const s = await this.store.editFrom(id, n);
    if (typeof s === 'string') return s;
    this.deps.audit({ actor: human(by), action: 'design.draft', target: { kind: 'design-system', id, label: s.name }, summary: `Started a new draft of ${s.name} from v${n} (v${n} itself never changes)` });
    return undefined;
  }

  async setDefault(client: string, d: { systemId: string; n: number } | undefined, by: string): Promise<string | undefined> {
    const err = await this.store.setDefault(client, d);
    if (err) return err;
    const label = this.deps.clientLabel(client) ?? client;
    this.deps.audit({ actor: human(by), action: 'design.default', target: { kind: 'portfolio', id: client, label }, summary: d ? `Made ${this.store.get(d.systemId)?.name} v${d.n} ${label}'s default for new projects (existing projects keep their versions)` : `Cleared ${label}'s design default (new projects keep today's styling)` });
    return undefined;
  }

  // ---- Projects ------------------------------------------------------------------------------------

  /** The wizard's step for a new project: applies the chosen version in place, or turns into a ✋ proposal. */
  async setupNew(floorId: string, dir: string, systemId: string, n: number, by: string, log?: (l: string) => void): Promise<{ ok: boolean; detail: string }> {
    await this.ready();
    const m = await this.verified(systemId, n);
    if (typeof m === 'string') return { ok: false, detail: m };
    const r = await applyInPlace(this.env(log), floorId, dir, m, { kind: 'wizard', by, at: this.deps.now() });
    if (!r.ok && 'custom' in r && r.custom) {
      await this.propose(floorId, systemId, n, by);
      return { ok: true, detail: r.detail };
    }
    this.audited(floorId, by, m, r.ok, r.detail);
    if (r.ok) await this.lines.prepare(floorId).catch((err: Error) => console.warn(`agent-office: design guidance for ${floorId}: ${err.message}`));
    return r;
  }

  /** A published version that's still what its digest says (a changed package is refused, never applied). */
  private async verified(id: string, n: number): Promise<PackageManifest | string> {
    const m = await this.store.manifest(id, n);
    if (!m) return 'That design system version isn’t there';
    if (!(await this.store.verify(id, n))) return `${m.name} v${n}'s files don't match its digest any more: not applied`;
    return m;
  }

  private audited(floor: string, by: string, m: PackageManifest, ok: boolean, detail: string) {
    this.deps.audit({ floor, actor: human(by), action: ok ? 'design.apply' : 'design.apply-failed', target: { kind: 'design-system', id: m.id, label: `${m.name} v${m.version}` }, summary: `${ok ? 'Adopted' : 'Couldn’t adopt'} ${m.name} v${m.version}: ${detail}`.slice(0, 240), severity: ok ? 'info' : 'warning', details: { digest: m.digest } });
  }

  /** An existing project: scan, then one ✋ card ("Adopt Acme v1 in <project>?"). Nothing is applied. */
  async propose(floorId: string, systemId: string, n: number, by: string): Promise<string | undefined> {
    await this.ready();
    const f = this.floor(floorId);
    const s = this.store.get(systemId);
    const v = s?.versions.find((x) => x.n === n);
    if (!f || !s || !v) return 'No such project or version';
    const open = this.openAdoption(floorId);
    if (open && open.digest !== v.digest) return `${open.name} v${open.n}'s adoption is still open on this project: merge or discard it first`;
    const mpr = findMpr(f.dir);
    const scan = mpr ? await scanTheme(path.dirname(mpr)) : { start: 'unknown' as const, fenced: [], overrides: [], custom: [], modules: [], noTheme: true };
    await this.projects.propose({ floor: floorId, systemId, name: s.name, n, digest: v.digest, scan, since: this.deps.now(), by });
    this.deps.audit({ floor: floorId, actor: human(by), action: 'design.propose', target: { kind: 'design-system', id: systemId, label: `${s.name} v${n}` }, summary: `Proposed ${s.name} v${n} for ${f.name}: the app has ${scanWords(scan)}. Waiting for the Project Manager on the ✋ card` });
    return undefined;
  }

  /**
   * Adopt (or Retry) on the card: ./adoption.ts, apply → commit → push on a branch of its own; the binding
   * changes only once that candidate is merged into the default branch. One adoption per project at a time.
   */
  async adopt(floorId: string, by: string): Promise<string | undefined> {
    if (this.busy.has(floorId)) return 'Already adopting: wait for it to finish';
    this.busy.add(floorId);
    try {
      await this.ready();
      const p = this.projects.proposal(floorId);
      const f = this.floor(floorId);
      if (!p || !f) return 'Nothing is waiting to be adopted on this project';
      const m = await this.verified(p.systemId, p.n);
      if (typeof m === 'string') return m;
      // An adoption left running by an office that stopped is put right first, then carried on.
      if (this.projects.adoption(floorId)?.status === 'running') await reconcileAdoption(this.env(), floorId, f.dir);
      const r = await runAdoption(this.env(), floorId, f.dir, m, { kind: 'decision', by, at: this.deps.now(), ref: `design:${floorId}:${p.digest.slice(0, 12)}` });
      const a = r.adoption;
      if (a?.status === 'active') await this.activated(floorId, a);
      else this.deps.audit({ floor: floorId, actor: human(by), action: r.ok ? 'design.adopt' : 'design.adopt-failed', target: { kind: 'design-system', id: m.id, label: `${m.name} v${m.version}` }, summary: `${r.ok ? 'Committed' : 'Couldn’t adopt'} ${m.name} v${m.version}: ${r.detail}`.slice(0, 240), severity: r.ok ? 'info' : 'warning', details: { digest: m.digest, ...(a?.branch ? { branch: a.branch } : {}), ...(a?.commit ? { commit: a.commit } : {}), ...(a?.failed ? { stage: a.failed.stage } : {}) } });
      return r.ok ? undefined : r.detail;
    } finally {
      this.busy.delete(floorId);
    }
  }

  /** Keep existing design (or Discard a failed or waiting adoption): the card goes, the binding stays as it was. */
  async keep(floorId: string, by: string): Promise<string | undefined> {
    if (this.busy.has(floorId)) return 'Adopting right now: wait for it to finish';
    await this.ready();
    const f = this.floor(floorId);
    const open = this.openAdoption(floorId);
    const d = open && f ? await discardAdoption(this.env(), floorId, f.dir) : {};
    const p = await this.projects.dropProposal(floorId);
    if (!p && !d.adoption) return 'Nothing is waiting on this project';
    const what = p ?? d.adoption!;
    this.deps.audit({ floor: floorId, actor: human(by), action: 'design.keep', target: { kind: 'design-system', id: what.systemId, label: `${what.name} v${what.n}` }, summary: `Kept the app's existing design instead of ${what.name} v${what.n}${d.adoption ? `; the adoption was discarded${d.branchKept ? ` and the branch ${d.branchKept} left as it is` : ''}` : ''}` });
    return undefined;
  }

  /** "Use for…": a pattern selection, recorded only (no model call, nothing in the app changes). */
  async select(floorId: string, patternId: string, scope: SelectionScope, by: string, onBehalfOfClient: boolean): Promise<string | undefined> {
    await this.ready();
    const p = patternById(patternId);
    if (!p) return 'No such pattern';
    if (!this.projects.binding(floorId)) return 'Adopt a design system on this project first';
    const sel: PatternSelection = { patternId, version: p.version, scope, by, at: this.deps.now(), ...(onBehalfOfClient ? { onBehalfOfClient: true } : {}) };
    await this.projects.select(floorId, sel);
    const where = 'issue' in scope ? `issue #${scope.issue}` : 'page' in scope ? `page ${scope.page}` : 'the whole project';
    this.deps.audit({ floor: floorId, actor: human(by), action: 'design.select', target: { kind: 'pattern', id: `${patternId}@${p.version}`, label: p.title }, summary: `Chose ${p.title} (${patternId}@${p.version}) for ${where}${onBehalfOfClient ? ', recorded on behalf of the client' : ''}` });
    await this.lines.prepare(floorId).catch((err: Error) => console.warn(`agent-office: design guidance for ${floorId}: ${err.message}`));
    return undefined;
  }

  /**
   * Capture now: screenshots of the running live app (never starts one), each stamped with the served
   * revision. Refused while it updates; a shot taken as an update started (the served revision moved or
   * stopped) is thrown away rather than stamped with a guess, and the capture stops there.
   */
  async capture(floorId: string, by: string): Promise<string | number> {
    const live = this.deps.live(floorId);
    if (live.updating) return 'The live app is updating: try again in a moment (a capture is stamped only with the version that is actually running)';
    if (!live.running || !live.url || !live.sha) return 'The live app isn’t running: start it on the Live app tab first (a capture never starts it)';
    const sha = live.sha;
    const still = () => {
      const now = this.deps.live(floorId);
      return now.running && now.sha === sha;
    };
    const b = this.projects.binding(floorId);
    const r = await this.captures.capture(floorId, live.url, { appSha: sha, design: b ? pointerOf(b) : 'none', by, still });
    const made = r.made;
    this.deps.audit({ floor: floorId, actor: human(by), action: 'design.capture', target: { kind: 'project', id: floorId }, summary: `Captured ${made.length} screenshots of the live app at ${sha.slice(0, 7)}${r.interrupted ? ' (stopped: the live app started updating)' : ''}` });
    if (r.interrupted) return `The live app started updating during the capture: kept ${made.length} screenshot${made.length === 1 ? '' : 's'} taken at ${sha.slice(0, 7)}; capture again once it's running`;
    return made.length;
  }

  forget(floorId: string): Promise<void> {
    return this.projects.forget(floorId);
  }
}
