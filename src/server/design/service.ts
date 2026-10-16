// Design systems' service (docs/site/using-the-office/design-systems.md): the client's (or an independent
// project's) design system and its immutable versions (./store.ts), the projects' bindings, apply records and
// ✋ proposals (./projects.ts), the wizard's step and the card's Adopt (./adopt.ts), pattern selections, runtime
// captures (./capture.ts) and the agent-context line (./line.ts). Every change is audited (design.*). Free of
// the office's context (./index.ts makes the real one), so the tests drive it with fakes; browsing never calls
// a model and never starts a runtime.

import type { AuditInput } from '../../shared/audit.js';
import { patternById } from '../../shared/design/patterns.js';
import { pointerOf, type DesignInput, type DesignKind, type DesignOwner, type PackageManifest, type PatternSelection, type SelectionScope } from '../../shared/design/types.js';
import type { ClientDesignView, DesignChoice, DesignChoicesView, DesignNeedView, ProjectDesignView, VersionView } from '../../shared/design/views.js';
import { mxcliVersion, type Run } from './apply.js';
import { applyInPlace, applyOnBranch, type AdoptEnv } from './adopt.js';
import { Captures, type Shooter } from './capture.js';
import { DesignLines } from './line.js';
import { DesignProjects } from './projects.js';
import { scanTheme, scanWords } from './scan.js';
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
  /** The floor's live app: running (with its URL and commit) or not. Never started from here. */
  live(floor: string): { running: boolean; status: string; url?: string; sha?: string };
  audit(e: AuditInput): void;
  now(): number;
  run?: Run;
  shooter?: Shooter;
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

  constructor(private deps: DesignDeps) {
    this.store = new DesignStore(deps.dataDir, deps.now);
    this.projects = new DesignProjects(this.store.root);
    this.lines = new DesignLines(this.store.root, deps.dataDir, this.projects, (id, n) => this.store.packageDir(id, n), deps.now);
    this.captures = new Captures(this.store.root, deps.shooter, deps.now);
  }

  ready(): Promise<unknown> {
    return Promise.all([this.store.load(), this.projects.load()]);
  }

  private floor(id: string) {
    return this.deps.floors().find((f) => f.id === id);
  }

  private env(log?: (l: string) => void): AdoptEnv {
    return { projects: this.projects, packageDir: (id, n) => this.store.packageDir(id, n), mxcli: this.deps.mxcli, run: this.deps.run, now: this.deps.now, log };
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
    return {
      floor: floorId,
      name: f.name,
      ...(client ? { client } : {}),
      ...(binding ? { binding } : {}),
      ...(proposal ? { proposal } : {}),
      ...(ap ? { apply: { state: ap.state, at: ap.at, ...(ap.detail ? { detail: ap.detail } : {}) } } : {}),
      ...(available ? { available } : {}),
      ...(own ? { own: { ...own, versions: await this.versions(own.id) } } : {}),
      selections: [...(await this.projects.selectionsOf(floorId))],
      captures: [...(await this.captures.list(floorId))].reverse(),
      live: { running: live.running, status: live.status },
      admin,
    };
  }

  needView(floorId: string, admin: boolean): DesignNeedView {
    const p = this.projects.proposal(floorId);
    const ap = this.projects.apply(floorId);
    return { floor: floorId, ...(p ? { proposal: p } : {}), ...(ap?.state === 'failed' && p ? { failed: { detail: ap.detail ?? 'the apply failed', at: ap.at } } : {}), admin };
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
    if (r.ok) void this.lines.prepare(floorId).catch(() => undefined);
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
    const mpr = findMpr(f.dir);
    const scan = mpr ? await scanTheme(path.dirname(mpr)) : { start: 'unknown' as const, fenced: [], overrides: [], custom: [], modules: [], noTheme: true };
    await this.projects.propose({ floor: floorId, systemId, name: s.name, n, digest: v.digest, scan, since: this.deps.now(), by });
    this.deps.audit({ floor: floorId, actor: human(by), action: 'design.propose', target: { kind: 'design-system', id: systemId, label: `${s.name} v${n}` }, summary: `Proposed ${s.name} v${n} for ${f.name}: the app has ${scanWords(scan)}. Waiting for the Project Manager on the ✋ card` });
    return undefined;
  }

  /** Adopt on the card: applied on a branch of its own, and the binding recorded. */
  async adopt(floorId: string, by: string): Promise<string | undefined> {
    await this.ready();
    const p = this.projects.proposal(floorId);
    const f = this.floor(floorId);
    if (!p || !f) return 'Nothing is waiting to be adopted on this project';
    if (this.busy.has(floorId)) return 'Already adopting: wait for it to finish';
    this.busy.add(floorId);
    try {
      const m = await this.verified(p.systemId, p.n);
      if (typeof m === 'string') return m;
      const r = await applyOnBranch(this.env(), floorId, f.dir, m, { kind: 'decision', by, at: this.deps.now(), ref: `design:${floorId}:${p.digest.slice(0, 12)}` });
      this.audited(floorId, by, m, r.ok, r.detail);
      if (!r.ok) return r.detail;
      void this.lines.prepare(floorId).catch(() => undefined);
      return undefined;
    } finally {
      this.busy.delete(floorId);
    }
  }

  /** Keep existing design on the card: the proposal goes, nothing changes. */
  async keep(floorId: string, by: string): Promise<string | undefined> {
    const p = await this.projects.dropProposal(floorId);
    if (!p) return 'Nothing is waiting on this project';
    this.deps.audit({ floor: floorId, actor: human(by), action: 'design.keep', target: { kind: 'design-system', id: p.systemId, label: `${p.name} v${p.n}` }, summary: `Kept the app's existing design instead of ${p.name} v${p.n}` });
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
    void this.lines.prepare(floorId).catch(() => undefined);
    return undefined;
  }

  /** Capture now: screenshots of the running live app (never starts one). */
  async capture(floorId: string, by: string): Promise<string | number> {
    const live = this.deps.live(floorId);
    if (!live.running || !live.url) return 'The live app isn’t running: start it on the Live app tab first (a capture never starts it)';
    const b = this.projects.binding(floorId);
    const made = await this.captures.capture(floorId, live.url, { ...(live.sha ? { appSha: live.sha } : {}), design: b ? pointerOf(b) : 'none', by });
    this.deps.audit({ floor: floorId, actor: human(by), action: 'design.capture', target: { kind: 'project', id: floorId }, summary: `Captured ${made.length} screenshots of the live app${live.sha ? ` at ${live.sha.slice(0, 7)}` : ''}` });
    return made.length;
  }

  forget(floorId: string): Promise<void> {
    return this.projects.forget(floorId);
  }
}
