// Reading an app's security at one commit, straight from the commit's units in git (model/units.ts: the
// .mpr's unit table and each unit by blob hash; no checkout, no mxcli, nothing on the event loop but the
// small .mpr's SQLite read the Model tab already does). From the Security$ProjectSecurity unit: the level,
// strict mode, demo users (enabled and how many, never their passwords), guest access and its role, the
// password policy's minimum length and the number of user roles. From each module's domain model (System
// left out): the persistable entities that have no access rule. Kept per commit (the commit is the cache
// key: its units can't change), in memory here and per revision in the project's record (store.ts).

import { doc, list, str, type BsonDoc } from '../model/bson.js';
import { parseDomain } from '../model/domain.js';
import type { CommitModel } from '../model/units.js';
import { levelOf, type SecurityState } from '../../shared/security.js';

/** At most this many entity names in the "no access rule" sample. */
const SAMPLE = 5;

/** The state from a ProjectSecurity unit (and the domain models), or undefined when there's no such unit. */
export function stateFromUnits(sec: BsonDoc | null, domains: { module: string; unit: BsonDoc }[], commit: string, now: number): SecurityState {
  const out: SecurityState = { commit, readAt: now, source: 'model' };
  if (sec) {
    const level = levelOf(str(sec.SecurityLevel));
    if (level) out.level = level;
    if (typeof sec.StrictMode === 'boolean') out.strict = sec.StrictMode;
    if (typeof sec.EnableDemoUsers === 'boolean') out.demoUsers = { enabled: sec.EnableDemoUsers, count: list(sec.DemoUsers).length };
    if (typeof sec.EnableGuestAccess === 'boolean') out.guest = { enabled: sec.EnableGuestAccess, ...(sec.EnableGuestAccess && str(sec.GuestUserRole) ? { role: str(sec.GuestUserRole) } : {}) };
    const min = doc(sec.PasswordPolicySettings)?.MinimumLength;
    if (typeof min === 'number' && Number.isFinite(min)) out.passwordMinLength = min;
    out.userRoles = list(sec.UserRoles).length;
  }
  let total = 0;
  const without: string[] = [];
  for (const d of domains) {
    if (d.module === 'System') continue;
    for (const e of parseDomain(d.module, d.unit).entities) {
      if (e.kind !== 'persistent') continue;
      total++;
      if (!e.access?.length) without.push(`${d.module}.${e.name}`);
    }
  }
  if (domains.length) out.entities = { total, withoutRules: without.length, sample: without.sort().slice(0, SAMPLE) };
  return out;
}

/** The security state of a commit's model. */
export async function readFromCommit(cm: CommitModel, now: number): Promise<SecurityState> {
  let sec: BsonDoc | null = null;
  for (const [id, u] of cm.ix.units) {
    if (u.type === 'Security$ProjectSecurity') {
      sec = await cm.ix.read(id);
      break;
    }
  }
  const domains: { module: string; unit: BsonDoc }[] = [];
  for (const [key, id] of cm.ix.byName) {
    if (!key.startsWith('domainmodel:')) continue;
    const unit = await cm.ix.read(id);
    if (unit) domains.push({ module: key.slice('domainmodel:'.length), unit });
  }
  return stateFromUnits(sec, domains, cm.sha, now);
}

/** The reader the service uses: a commit's model (null when its units can't be read here), kept per commit. */
export class SecurityReader {
  private cache = new Map<string, Promise<SecurityState | null>>();
  constructor(
    private commitOf: (dir: string, sha: string) => Promise<CommitModel | null>,
    private now: () => number = Date.now,
    private max = 32,
  ) {}

  /** The state at `sha`, or null when the units can't be read here (no node:sqlite); rejects when there's no .mpr. */
  read(dir: string, sha: string): Promise<SecurityState | null> {
    const key = `${dir}|${sha}`;
    let p = this.cache.get(key);
    if (p) return p;
    p = this.commitOf(dir, sha).then((cm) => (cm ? readFromCommit(cm, this.now()) : null));
    this.cache.set(key, p);
    p.catch(() => this.cache.delete(key));
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value as string);
    return p;
  }

  /** How many commits are kept (tests). */
  get size(): number {
    return this.cache.size;
  }
}
