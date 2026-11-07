// What the session screen's preview can pick at the served commit: the app's pages that open by address
// (the Developer view's business index, app-explorer/: a page with a Url that needs nothing passed to it), and
// the user roles and demo users from the model's project security (names and roles only, never a password;
// demo users are allowed for local work). All read from git at that commit, nothing from the running app.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import type { PreviewChoices } from '../../shared/expert.js';
import { explorerIndex } from '../app-explorer/index.js';
import { modelOf } from '../model/index.js';
import { list, str, strings } from '../model/bson.js';

const MAX_PAGES = 300;
const MAX_ROLES = 100;

/** The roles and demo users of a commit's model; empty when it has no project security unit. */
export async function rolesAt(ctx: Pick<Ctx, 'cfg'>, dir: string, sha: string): Promise<Pick<PreviewChoices, 'roles' | 'demoUsers' | 'demoOn'>> {
  const cm = await modelOf(ctx).units.commit(dir, sha);
  if (!cm) return { roles: [], demoUsers: [] };
  for (const [id, u] of cm.ix.units) {
    if (u.type !== 'Security$ProjectSecurity') continue;
    const sec = await cm.ix.read(id);
    if (!sec) break;
    const roles = list(sec.UserRoles).map((r) => str(r.Name)).filter(Boolean).slice(0, MAX_ROLES);
    const demoUsers = list(sec.DemoUsers)
      .map((d) => ({ user: str(d.UserName), roles: strings(d.UserRoles).map((r) => r.split('.').pop() ?? r) }))
      .filter((d) => d.user)
      .slice(0, MAX_ROLES);
    return { roles, demoUsers, ...(typeof sec.EnableDemoUsers === 'boolean' ? { demoOn: sec.EnableDemoUsers } : {}) };
  }
  return { roles: [], demoUsers: [] };
}

export async function previewChoices(ctx: Ctx, floor: Floor, rev: string): Promise<PreviewChoices> {
  const out: PreviewChoices = { rev, pages: [], roles: [], demoUsers: [] };
  try {
    const ix = await explorerIndex(ctx, floor, rev);
    if (ix.problem) out.problem = ix.problem;
    const seen = new Set<string>();
    for (const nodes of Object.values(ix.levels)) {
      for (const n of nodes) {
        if (n.kind !== 'page' || !n.url || !n.qn || seen.has(n.qn) || n.addon) continue;
        seen.add(n.qn);
        out.pages.push({ qn: n.qn, label: n.label, url: n.url });
      }
    }
    out.pages.sort((a, b) => a.label.localeCompare(b.label));
    out.pages.splice(MAX_PAGES);
  } catch (err) {
    out.problem = (err as Error).message;
  }
  try {
    Object.assign(out, await rolesAt(ctx, floor.dir, rev));
  } catch (err) {
    out.problem ??= (err as Error).message;
  }
  return out;
}
