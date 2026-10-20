// Start from another app's composition (./service.ts): the office's floors, its clients (portfolios/), the
// design-systems module (design/), the toolkit pins (toolkit-pin/) and the roster's per-role skill changes,
// one service per office (adoptFromOf). And the wizard's side (adoptSetupOf, for wizard/adopt-step.ts): each
// choice carried out by the mechanism that owns it, never by copying files between projects.

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { designOf } from '../design/index.js';
import { portfoliosOf } from '../portfolios/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { alsoOf } from '../roster/coverage.js';
import { pinnedCommit } from '../toolkit-pin/index.js';
import { ensurePin, commitInfo } from '../toolkit-pin/pins.js';
import { wizardConfig } from '../wizard/config.js';
import { ROLE_BY_ID, ROLES, isRoleId, type RoleId } from '../../shared/roster/roles.js';
import { cleanOverrides, type SkillOverrides } from '../../shared/roster/skills.js';
import { deriveTokens } from '../../shared/design/tokens.js';
import type { AdoptDesign } from '../../shared/adopt-from.js';
import type { AdoptSetup } from '../wizard/adopt-step.js';
import { AdoptService } from './service.js';

const services = new WeakMap<object, AdoptService>();

export function adoptFromOf(ctx: Ctx): AdoptService {
  let s = services.get(ctx.cfg);
  if (!s) {
    const portfolios = portfoliosOf(ctx).store;
    const design = () => designOf(ctx);
    // Loaded now, so a setup started before anyone asked for the list still finds its source's client.
    void portfolios.load().catch(() => undefined);
    s = new AdoptService({
      dataDir: ctx.cfg.dataDir,
      ready: () => Promise.all([portfolios.load(), design().ready()]),
      floors: () => [...ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name, dir: f.dir })),
      clientOf: (floor) => {
        const p = portfolios.ofFloor(floor);
        return p ? { id: p.id, label: p.label } : undefined;
      },
      client: (id) => {
        const p = portfolios.get(id);
        return p ? { id: p.id, label: p.label, brain: !!p.brain } : undefined;
      },
      binding: (floor) => {
        const b = design().projects.binding(floor);
        return b ? { systemId: b.systemId, name: b.name, n: b.n, digest: b.digest } : undefined;
      },
      design: async (floor) => {
        const d = design();
        await d.ready();
        const b = d.projects.binding(floor);
        if (!b) return undefined;
        const [m, input, verified, caps] = await Promise.all([d.store.manifest(b.systemId, b.n), d.store.inputOf(b.systemId, b.n), d.store.verify(b.systemId, b.n).catch(() => false), d.captures.list(floor).catch(() => [])]);
        const v = d.store.get(b.systemId)?.versions.find((x) => x.n === b.n);
        const cap = [...caps].reverse().find((c) => c.design.startsWith(`${b.systemId}@v${b.n}`));
        const t = input ? deriveTokens(input).light : undefined;
        const out: AdoptDesign = {
          systemId: b.systemId,
          name: b.name,
          n: b.n,
          digest: b.digest,
          kind: b.kind,
          ...(v ? { status: v.status } : {}),
          ...(m ? { compat: { studioPro: m.compat.studioPro, mxcli: m.compat.mxcli, atlas: m.compat.atlas } } : {}),
          gaps: m?.gaps ?? [],
          ...(cap ? { capture: `/api/design/file?floor=${encodeURIComponent(floor)}&capture=${encodeURIComponent(cap.id)}` } : {}),
          swatch: t ? [t.brand, t.surface, t.ink, t.rail].filter(Boolean) : [],
          verified,
        };
        return out;
      },
      toolkit: (f) => {
        const sha = pinnedCommit(f.dir);
        return sha ? { sha } : undefined;
      },
      skills: (floor) => {
        const d = rosterOf(ctx).data(floor);
        const out: Partial<Record<RoleId, SkillOverrides>> = {};
        for (const r of ROLES) {
          const o = d.members[r.id]?.skills;
          if (o && Object.keys(o).length) out[r.id] = o;
        }
        return out;
      },
      roleTitle: (role) => ROLE_BY_ID.get(role)?.title ?? role,
      audit: (e) => void audit.record(e),
      now: () => Date.now(),
    });
    services.set(ctx.cfg, s);
  }
  return s;
}

/** The wizard's hands for each choice (wizard/adopt-step.ts). */
export function adoptSetupOf(ctx: Ctx): AdoptSetup {
  const svc = adoptFromOf(ctx);
  return {
    pin: async (sha) => {
      const root = wizardConfig().toolkitDir;
      const dir = await ensurePin(root, sha);
      const date = await commitInfo(root, sha).then((c) => c.date, () => undefined);
      return { sha, dir, ...(date ? { date } : {}) };
    },
    copySkills: (floorId, map) => {
      const floor = ctx.floors.get(floorId);
      if (!floor) return 0;
      const roster = rosterOf(ctx);
      const d = roster.data(floorId);
      let n = 0;
      for (const [role, raw] of Object.entries(map)) {
        if (!isRoleId(role) || !d.members[role]) continue;
        const clean = cleanOverrides(role, raw, alsoOf(d, role));
        d.members[role].skills = clean;
        n += Object.keys(clean).length;
      }
      // Saved now; each member's Playbook is written with them when it's hired (or rewritten if it already is).
      roster.touch(teamFloor(ctx, floor));
      for (const role of Object.keys(map)) if (isRoleId(role)) roster.members.rewrite(teamFloor(ctx, floor), role);
      return n;
    },
    bound: (floor) => {
      const b = designOf(ctx).projects.binding(floor);
      return b ? { systemId: b.systemId, n: b.n } : undefined;
    },
    proposed: (floor) => {
      const p = designOf(ctx).projects.proposal(floor);
      return p ? { systemId: p.systemId, n: p.n } : undefined;
    },
    wired: async (floor) => {
      const v = await portfoliosOf(ctx).view(true);
      for (const p of v.portfolios) {
        const x = p.projects.find((y) => y.id === floor);
        if (x) return x.wiring?.ok;
      }
      return undefined;
    },
    note: (floor, plan, by, items) => svc.note(floor, plan, by, items).then(() => undefined),
  };
}
