// The data-impact guard as the office runs it (./guard.ts): one per office, made the first time anything
// asks (dataImpactOf). What people do with it: read a project's hold (view), take a database dump of the
// live preview as the recovery step (dump), approve with the `data-impact approval` permission (approve),
// and, as an admin, say who besides the office admins holds that permission (setPolicy). The routes are
// http/routes/data-impact.ts; the live app consults `check` through liveapp/index.ts.

import { fixText } from '../../shared/text-repair.js';
import path from 'node:path';
import { audit, human } from '../audit/index.js';
import type { Ctx } from '../office/context.js';
import { databaseName, liveAppConfig } from '../liveapp/config.js';
import { pgBinDir } from '../liveapp/process.js';
import { ALTERNATIVES, approversWords, binds, cleanEnv, ENV_LIVE, type ImpactEnv, NO_DATA_STATEMENT, PERMISSION, UNCERTAINTY, type DataImpactApproval, type DataImpactPolicy, type DataImpactView, type DumpRecord, type Recovery } from '../../shared/data-impact.js';
import { DataImpactGuard, type GuardDeps } from './guard.js';
import { dumpStillThere, takeDump } from './pg.js';

type Deps = Pick<Ctx, 'cfg' | 'accounts' | 'meOf'> & Partial<Pick<Ctx, 'floors' | 'toFloor'>>;
export interface Who {
  name: string;
  id?: string;
}

const short = (sha: string) => sha.slice(0, 7);

export class DataImpact {
  readonly guard: DataImpactGuard;
  private dumping = new Map<string, Promise<DumpRecord>>();
  private listeners = new Set<(floorId: string) => void>();

  /** `opts` stands in for PostgreSQL in tests (the database, the dump). */
  constructor(
    private ctx: Deps,
    private opts: { pg?: GuardDeps['pg']; takeDump?: typeof takeDump } = {},
  ) {
    const cfg = liveAppConfig(ctx.cfg.dataDir);
    this.guard = new DataImpactGuard({
      dataDir: ctx.cfg.dataDir,
      pg: opts.pg ?? ((floorId, env) => (env === ENV_LIVE ? { ...cfg.db, database: databaseName(floorId), bin: pgBinDir() } : undefined)),
      changed: (floorId) => this.listeners.forEach((fn) => fn(floorId)),
    });
  }

  /** Hears when a project's hold or approvals change. */
  onChange(fn: (floorId: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Whether this person holds the permission: office admins (unless the policy says not), and the accounts the policy names. */
  mayApprove(accountId: string | undefined, policy = this.guard.store.policy()): boolean {
    return (policy.admins && this.ctx.meOf(accountId).admin) || (!!accountId && policy.accounts.includes(accountId));
  }

  approvers(policy = this.guard.store.policy()): string {
    const all = this.ctx.accounts.state(new Set()).accounts;
    const admins = policy.admins ? all.filter((a) => a.role === 'admin').map((a) => a.name) : null;
    const others = policy.accounts.map((id) => all.find((a) => a.id === id)?.name).filter((n): n is string => !!n && !(admins ?? []).includes(n));
    return approversWords(admins, others);
  }

  view(floorId: string, accountId: string | undefined, env: ImpactEnv = ENV_LIVE): DataImpactView {
    const rec = this.guard.store.get(floorId);
    const held = rec.holds[env];
    const policy = this.guard.store.policy();
    const approval = held ? rec.approvals.find((a) => !a.void && binds(a, held)) : undefined;
    const { assessment, ...fact } = held ?? ({} as Partial<NonNullable<typeof held>>);
    return {
      floor: floorId,
      env,
      permission: PERMISSION,
      ...(held ? { held: fact as NonNullable<DataImpactView['held']>, assessment } : {}),
      ...(approval ? { approval } : {}),
      approvals: [...rec.approvals].reverse().slice(0, 10),
      dumps: held ? rec.dumps.filter((d) => binds(d, held)).reverse() : [],
      canApprove: this.mayApprove(accountId, policy),
      approvers: this.approvers(policy),
      alternatives: ALTERNATIVES,
      uncertainty: UNCERTAINTY,
    };
  }

  /**
   * Dumps the live preview's database for the hold standing in `env` now (the live preview's own, or a candidate's
   * or an external push's: their data lives in the same database), checks it, and records it bound to that hold
   * (one at a time per project).
   */
  async dump(floorId: string, by: Who, env: ImpactEnv = ENV_LIVE): Promise<DumpRecord | string> {
    const held = this.guard.store.get(floorId).holds[env];
    if (!held) return env === ENV_LIVE ? 'Nothing is held on the live preview' : `Nothing is held for ${env} any more`;
    const pg = this.guard.d.pg?.(floorId, ENV_LIVE);
    if (!pg) return 'No database for the live preview to dump';
    let p = this.dumping.get(floorId);
    if (!p) {
      const file = path.join(this.guard.store.dumpDir(floorId), `${short(held.base)}-to-${short(held.target)}-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
      p = (this.opts.takeDump ?? takeDump)(pg, file)
        .then((got) => {
          const rec: DumpRecord = { id: path.basename(file, '.dump'), env, base: held.base, target: held.target, database: pg.database, path: file, ...got, by, at: Date.now() };
          this.guard.store.update(floorId, (r) => void r.dumps.push(rec));
          audit.record({ floor: floorId, actor: human(by.name, by.id), action: 'data-impact.dump', target: { kind: 'database', id: pg.database, label: `dump before ${short(held.target)}` }, summary: `Took a database dump of the live preview (${pg.database}) before ${short(held.target)}: ${got.size} bytes, sha256 ${got.sha256.slice(0, 12)}…, ${got.verified}`, details: { env, base: held.base, target: held.target, path: file, size: got.size, sha256: got.sha256, verified: got.verified }, severity: 'notice' });
          this.listeners.forEach((fn) => fn(floorId));
          return rec;
        })
        .finally(() => this.dumping.delete(floorId));
      this.dumping.set(floorId, p);
    }
    try {
      return await p;
    } catch (err) {
      return `The dump failed: ${(err as Error).message}`;
    }
  }

  /**
   * Approves the hold standing on the live preview, as seen at `base` → `target` (a 409 when it moved), with a
   * recovery step (a dump taken for this binding, still unchanged on disk, or the explicit "no data to keep")
   * and a reason. Returns the approval, or [status, error].
   */
  async approve(floorId: string, by: Who, accountId: string | undefined, body: { base?: unknown; target?: unknown; reason?: unknown; dump?: unknown; noData?: unknown; env?: unknown }): Promise<DataImpactApproval | [number, string]> {
    if (!this.mayApprove(accountId)) return [403, `You don't have the ${PERMISSION} permission. Who has it: ${this.approvers()}`];
    // The environment it binds (the live preview by default; a Developer change's candidate; an external push on a branch).
    const env = body.env === undefined ? ENV_LIVE : cleanEnv(body.env);
    if (!env) return [400, 'Which environment? (live-preview, candidate:DC-n or external:<branch>)'];
    const held = this.guard.store.get(floorId).holds[env];
    if (!held) return [409, env === ENV_LIVE ? 'Nothing is held on the live preview any more' : `Nothing is held for ${env} any more`];
    if (body.base !== held.base || body.target !== held.target) return [409, `The hold changed: it is now ${short(held.base)} → ${short(held.target)}. Look again before approving`];
    const reason = typeof body.reason === 'string' ? fixText(body.reason).replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (reason.length < 3) return [400, 'Say why (a reason is required)'];
    let recovery: Recovery;
    if (typeof body.dump === 'string' && body.dump) {
      const d = this.guard.store.get(floorId).dumps.find((x) => x.id === body.dump && binds(x, held));
      if (!d) return [400, 'That dump is not one taken for this hold'];
      const gone = await dumpStillThere(d.path, d.size, d.sha256);
      if (gone) return [409, `${gone}: take a new one`];
      recovery = { kind: 'dump', dump: d.id, path: d.path, size: d.size, sha256: d.sha256 };
    } else if (body.noData === true) recovery = { kind: 'none', statement: NO_DATA_STATEMENT };
    else return [400, 'Choose a recovery step: a database dump, or "no data to keep"'];
    return this.guard.record(floorId, { env, base: held.base, target: held.target, recovery, reason, by: { name: by.name, ...(by.id ? { id: by.id } : {}) } });
  }

  /**
   * Releases a stale hold (shared/data-impact-stale.ts): the office found it guards nothing any more (`stale`, worked
   * out by the caller from the record, the live preview and git, never from the request). Recorded as an approval
   * whose recovery step is "none needed, a stale hold released (why)", with the person's reason: it binds the same
   * environment, baseline and target, so a new candidate is assessed again. Returns it, or [status, error].
   */
  releaseStale(floorId: string, by: Who, accountId: string | undefined, body: { env?: unknown; base?: unknown; target?: unknown; reason?: unknown }, stale: string | undefined): DataImpactApproval | [number, string] {
    if (!this.mayApprove(accountId)) return [403, `You don't have the ${PERMISSION} permission. Who has it: ${this.approvers()}`];
    const env = body.env === undefined ? ENV_LIVE : cleanEnv(body.env);
    if (!env) return [400, 'Which environment? (live-preview, candidate:DC-n or external:<branch>)'];
    const held = this.guard.store.get(floorId).holds[env];
    if (!held) return [409, env === ENV_LIVE ? 'Nothing is held on the live preview any more' : `Nothing is held for ${env} any more`];
    if (body.base !== held.base || body.target !== held.target) return [409, `The hold changed: it is now ${short(held.base)} → ${short(held.target)}. Look again`];
    if (!stale) return [409, 'This hold still guards a change that hasn’t reached the live preview: approve it with a recovery step (a database dump, or no data to keep)'];
    const reason = typeof body.reason === 'string' ? fixText(body.reason).replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (reason.length < 3) return [400, 'Say why (a reason is required)'];
    return this.guard.record(floorId, { env, base: held.base, target: held.target, recovery: { kind: 'stale', statement: stale }, reason, by: { name: by.name, ...(by.id ? { id: by.id } : {}) } });
  }

  /** Who besides (or instead of) the office admins holds the permission; admins only, audited. */
  setPolicy(next: DataImpactPolicy, by: Who): DataImpactPolicy {
    const before = this.guard.store.policy();
    const known = new Set(this.ctx.accounts.state(new Set()).accounts.map((a) => a.id));
    const p: DataImpactPolicy = { admins: next.admins !== false, accounts: [...new Set(next.accounts.filter((id) => known.has(id)))] };
    this.guard.store.setPolicy(p);
    audit.record({ action: 'data-impact.policy', actor: human(by.name, by.id), target: { kind: 'settings', id: 'data-impact', label: 'Data-impact approval' }, summary: `Set who holds the ${PERMISSION} permission: ${this.approvers(p)}`, details: { before, after: p }, severity: 'warning' });
    return p;
  }
}

const offices = new WeakMap<object, DataImpact>();

export function dataImpactOf(ctx: Deps): DataImpact {
  let d = offices.get(ctx.cfg);
  if (!d) offices.set(ctx.cfg, (d = new DataImpact(ctx)));
  return d;
}
