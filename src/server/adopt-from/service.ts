// Start from another app (shared/adopt-from.ts): which of a client's apps a new project can start from and what
// each offers (`sources`), what the plan's choices mean on the source as it is when the setup starts (`resolve`,
// never the page's word), and the record of what was adopted (`note`, `record`). Free of the office's context
// (./index.ts makes the real one), so the tests drive it with fakes. Nothing here copies a file between
// projects: each choice is carried out by the mechanism that owns it (wizard/adopt-step.ts).

import type { AuditInput } from '../../shared/audit.js';
import type { RoleId } from '../../shared/roster/roles.js';
import type { SkillOverrides } from '../../shared/roster/skills.js';
import type { ProjectPlan } from '../../shared/wizard.js';
import { skillChanges, type AdoptDesign, type AdoptItem, type AdoptRecord, type AdoptResolved, type AdoptSource, type AdoptSourcesView } from '../../shared/adopt-from.js';
import { AdoptStore } from './store.js';

export interface AdoptFloor {
  id: string;
  name: string;
  dir: string;
}

export interface AdoptDeps {
  dataDir: string;
  /** The clients and the design systems loaded (after a restart they load on first use). */
  ready?(): Promise<unknown>;
  floors(): AdoptFloor[];
  /** The client a project belongs to. */
  clientOf(floor: string): { id: string; label: string } | undefined;
  /** A client and whether it has a company brain. */
  client(id: string): { id: string; label: string; brain: boolean } | undefined;
  /** The project's design-system binding (design/projects.ts), as it is now. */
  binding(floor: string): { systemId: string; name: string; n: number; digest: string } | undefined;
  /** The same, with what the design-systems module says of its version (status, compatibility, check, capture). */
  design(floor: string): Promise<AdoptDesign | undefined>;
  /** The project's toolkit pin (toolkit-pin/), when it has one. */
  toolkit(floor: AdoptFloor): { sha: string; date?: string } | undefined;
  /** The Project Manager's per-role skill changes on the project (the Team tab's 🧰 Skills). */
  skills(floor: string): Partial<Record<RoleId, SkillOverrides>>;
  roleTitle(role: RoleId): string;
  audit?(e: AuditInput): void;
  now(): number;
}

export class AdoptService {
  readonly store: AdoptStore;

  constructor(private deps: AdoptDeps) {
    this.store = new AdoptStore(deps.dataDir);
  }

  /**
   * The apps a new project of `client` can start from: the client's own; with `all` (admins only) every other
   * client's apps too. An empty list is an answer, not an error (the step says there's nothing to adopt yet).
   */
  async sources(client: string | undefined, opts: { all: boolean; admin: boolean }): Promise<AdoptSourcesView> {
    const all = opts.all && opts.admin;
    await this.deps.ready?.().catch(() => undefined);
    const out: AdoptSource[] = [];
    if (client || all) {
      for (const f of this.deps.floors()) {
        const c = this.deps.clientOf(f.id);
        if (!c || (!all && c.id !== client)) continue;
        out.push(await this.source(f, c, client));
      }
    }
    out.sort((a, b) => Number(a.crossClient) - Number(b.crossClient) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const own = client ? this.deps.client(client) : undefined;
    return { ...(client ? { client } : {}), admin: opts.admin, all, ...(own ? { clientBrain: { client: own.label, connected: own.brain } } : {}), sources: out };
  }

  private async source(f: AdoptFloor, c: { id: string; label: string }, asked: string | undefined): Promise<AdoptSource> {
    const design = await this.deps.design(f.id).catch(() => undefined);
    const toolkit = this.deps.toolkit(f);
    const skills = this.deps.skills(f.id);
    const roleSkills = (Object.entries(skills) as [RoleId, SkillOverrides][]).map(([role, o]) => ({ role, title: this.deps.roleTitle(role), changes: Object.keys(o ?? {}).length })).filter((r) => r.changes);
    const brain = this.deps.client(c.id);
    return { floor: f.id, name: f.name, client: c, crossClient: c.id !== asked, ...(design ? { design } : {}), ...(brain ? { brain: { client: brain.label, connected: brain.brain } } : {}), ...(toolkit ? { toolkit } : {}), roleSkills };
  }

  /**
   * The plan's adoption made real at start: the source must be in the office, another client's app needs an
   * admin, and each choice is what the source has now (its binding, its pin, its role skills). A choice the
   * source can't give is left out (the page offered only what it had). Sets `plan.design` to the source's exact
   * version, so the wizard's own design step binds it. The refusal, or undefined.
   */
  resolve(plan: ProjectPlan, admin: boolean): string | undefined {
    const a = plan.adopt;
    if (!a) return undefined;
    if (!plan.portfolio) {
      delete plan.adopt;
      return undefined;
    }
    const f = this.deps.floors().find((x) => x.id === a.source);
    if (!f) return 'The app to start from isn’t in the office any more: pick another one';
    const c = this.deps.clientOf(f.id);
    if (c?.id !== plan.portfolio && !admin) return 'Only an admin can start from another client’s app';
    const resolved: AdoptResolved = { sourceName: f.name, ...(c ? { sourceClient: c } : {}) };
    if (a.design) {
      const b = this.deps.binding(f.id);
      if (b) {
        resolved.design = { systemId: b.systemId, name: b.name, n: b.n, digest: b.digest };
        plan.design = { choice: 'use', systemId: b.systemId, n: b.n };
      }
    }
    if (a.toolkit) {
      const t = this.deps.toolkit(f);
      if (t) resolved.toolkit = t;
    }
    if (a.roleSkills) {
      const m = this.deps.skills(f.id);
      if (skillChanges(m)) resolved.roleSkills = m;
    }
    const mine = this.deps.client(plan.portfolio);
    if (mine?.brain) resolved.brain = { client: mine.label };
    plan.adopt = { ...a, resolved };
    return undefined;
  }

  /** Records what was adopted (each kind once: a later note of the same kind replaces it), audited the first time. */
  async note(floor: string, plan: ProjectPlan, by: string, items: AdoptItem[]): Promise<AdoptRecord | undefined> {
    const r = plan.adopt?.resolved;
    if (!r || !items.length) return undefined;
    const had = await this.store.get(floor);
    const kinds = new Set(items.map((i) => i.kind));
    const rec: AdoptRecord = {
      floor,
      source: { floor: plan.adopt!.source, name: r.sourceName, ...(r.sourceClient ? { client: r.sourceClient.label } : {}) },
      at: had?.at ?? this.deps.now(),
      by: had?.by ?? by,
      items: [...(had?.items ?? []).filter((i) => !kinds.has(i.kind)), ...items],
    };
    await this.store.put(rec);
    this.deps.audit?.({ floor, actor: { kind: 'human', name: by }, action: 'floor.adopt-from', target: { kind: 'project', id: floor, label: r.sourceName }, summary: `Started from ${r.sourceName}: ${items.map((i) => `${i.text}${i.status === 'failed' ? ' (not available)' : ''}`).join('; ')}`.slice(0, 400) });
    return rec;
  }

  record(floor: string): Promise<AdoptRecord | undefined> {
    return this.store.get(floor);
  }
}
