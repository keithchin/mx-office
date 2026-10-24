// The data-impact guard's rules and words (server/data-impact/): what a change of the domain model between
// two revisions may do to data already stored (a removed or renamed persistent entity, attribute or
// association, an attribute type change, a changed delete behaviour, a removed or renamed enumeration value,
// a generalization change), the hold that keeps such a candidate off a running app until someone with the
// `data-impact approval` permission approves it, and the approval's binding: environment, starting baseline,
// target and recovery evidence, all four, so a change to any of them voids it. Pure: the server, the page
// and the tests import it.
//
// Detection is a model diff, nothing more: migration microflows, Java and the runtime's own schema sync are
// not analysed, and every assessment says so. A model that can't be read is `unknown`, which holds.

/** The permission's name, as the policy, the page and the audit say it. */
export const PERMISSION = 'data-impact approval';

/** The one environment the guard applies to today: the project's live preview (server/liveapp/). */
export const ENV_LIVE = 'live-preview';
export type ImpactEnv = typeof ENV_LIVE | `candidate:${string}` | `external:${string}`;

export const UNCERTAINTY = 'Detected from the model diff; migration logic and Java are not analysed.';

/** What else the team can do instead of approving a change that drops or converts data. */
export const ALTERNATIVES: readonly string[] = [
  'Keep the attribute (or entity) and mark it deprecated, and remove it later once nothing reads it',
  'Migrate the data first (copy it into its new place with a microflow), then remove the old element',
  'Apply it in a maintenance window, with a database dump taken just before',
];

export type ImpactKind =
  | 'entity-removed'
  | 'entity-renamed'
  | 'entity-not-persistable'
  | 'attribute-removed'
  | 'attribute-renamed'
  | 'attribute-type'
  | 'attribute-calculated'
  | 'association-removed'
  | 'association-renamed'
  | 'association-storage'
  | 'delete-behaviour'
  | 'enum-value-removed'
  | 'enum-value-renamed'
  | 'generalization';

export interface ImpactFinding {
  kind: ImpactKind;
  /** The unit it is in: "Sales domain model", "enumeration Sales.Status". */
  unit: string;
  /** The element, qualified: Sales.Order.Notes. */
  element: string;
  before?: string;
  after?: string;
  /** One plain line: "may drop data in Sales.Order.Notes". */
  risk: string;
  /** Rows with data there in the live preview's database, when it could be asked (server/data-impact/rows.ts). */
  rows?: number;
}

export type ImpactStatus = 'clear' | 'impact' | 'unknown';

export interface ImpactAssessment {
  base: string;
  target: string;
  status: ImpactStatus;
  findings: ImpactFinding[];
  /** mxcli's own warnings about this change, verbatim, where the office has them (none captured today). */
  warnings: string[];
  uncertainty: string;
  /** Why it is unknown. */
  error?: string;
  at: number;
}

/** A separate fact from merge, execution and verification: main has the target, the environment doesn't run it. */
export interface HeldFact {
  env: ImpactEnv;
  /** The revision applied in that environment now (the starting baseline). */
  base: string;
  target: string;
  status: Exclude<ImpactStatus, 'clear'>;
  reason: string;
  at: number;
}

export type Recovery = { kind: 'dump'; dump: string; path: string; size: number; sha256: string } | { kind: 'none'; statement: string };

/** The words an approver states when there's no data to keep. */
export const NO_DATA_STATEMENT = 'No data to keep: I accept that data in these elements may be lost';

export interface DataImpactApproval {
  id: string;
  env: ImpactEnv;
  base: string;
  target: string;
  recovery: Recovery;
  reason: string;
  by: { name: string; id?: string };
  at: number;
  /** It no longer applies: what changed (the target, the baseline, the environment, or the recovery evidence). */
  void?: { at: number; why: string };
  /** The guard let its candidate through (once); a used approval is kept, never voided afterwards. */
  used?: number;
}

export interface DumpRecord {
  id: string;
  env: ImpactEnv;
  base: string;
  target: string;
  database: string;
  path: string;
  size: number;
  sha256: string;
  /** How it was checked: "pg_restore --list read 214 entries". */
  verified: string;
  by: { name: string; id?: string };
  at: number;
}

export interface DataImpactPolicy {
  /** Office admins hold the permission (the default). */
  admins: boolean;
  /** Accounts (ids) that hold it besides. The project owner is not one unless added here. */
  accounts: string[];
}

export const DEFAULT_POLICY: DataImpactPolicy = { admins: true, accounts: [] };

/** GET /api/data-impact?floor=: what the Live app card and Needs you read. */
export interface DataImpactView {
  floor: string;
  permission: typeof PERMISSION;
  /** Separate from merged/implemented/verified: main has `target`, the live preview runs `base`. */
  held?: HeldFact;
  assessment?: ImpactAssessment;
  /** The approval in force for the hold's binding, if any; the recent ones (void included) below. */
  approval?: DataImpactApproval;
  approvals: DataImpactApproval[];
  /** Dumps taken for the current binding (base → target), newest first. */
  dumps: DumpRecord[];
  /** Whether you hold the permission. */
  canApprove: boolean;
  /** Who does, in words: "office admins (Ada, Grace) and Linus". */
  approvers: string;
  alternatives: readonly string[];
  uncertainty: string;
}

// ---- The model, as the diff needs it -------------------------------------------------------------------

export interface SnapAttr {
  id: string;
  name: string;
  /** "String(200)", "Integer", "Enumeration(Sales.Status)", …; "AutoNumber". */
  type: string;
  /** Stored in the database (not a calculated value). */
  stored: boolean;
}

export interface SnapEntity {
  id: string;
  /** Module.Name */
  qn: string;
  module: string;
  persistable: boolean;
  /** The generalization's qualified name, '' for none. */
  generalization: string;
  attrs: SnapAttr[];
}

export interface SnapAssoc {
  id: string;
  /** Module.Name */
  qn: string;
  module: string;
  /** "Reference" or "ReferenceSet", with the owner: "Reference/Default". */
  storage: string;
  /** "parent: …; child: …" as the model says it. */
  deleteBehaviour: string;
  /** Both ends persistable: it is stored. */
  persistable: boolean;
}

export interface SnapEnum {
  id: string;
  qn: string;
  values: { id: string; name: string }[];
}

export interface ModelSnapshot {
  entities: SnapEntity[];
  associations: SnapAssoc[];
  enums: SnapEnum[];
}

const dm = (module: string) => `${module} domain model`;

/** Whether a string attribute only got longer (or unlimited, length 0): no data can be cut. */
function widened(before: string, after: string): boolean {
  const a = /^String\((\d+)\)$/.exec(before);
  const b = /^String\((\d+)\)$/.exec(after);
  if (!a || !b) return false;
  const [x, y] = [Number(a[1]), Number(b[1])];
  return y === 0 || (x !== 0 && y >= x);
}

/** What changing from `before` to `after` may do to stored data, as findings; empty when nothing stored is touched. */
export function diffSnapshots(before: ModelSnapshot, after: ModelSnapshot): ImpactFinding[] {
  const out: ImpactFinding[] = [];
  const nextE = new Map(after.entities.map((e) => [e.id, e]));
  for (const e of before.entities) {
    if (!e.persistable) continue;
    const n = nextE.get(e.id);
    if (!n) {
      const stored = e.attrs.filter((a) => a.stored).length;
      out.push({ kind: 'entity-removed', unit: dm(e.module), element: e.qn, risk: `may drop data in ${e.qn} (the entity is removed: its table${stored ? ` and ${stored} attribute${stored === 1 ? '' : 's'}` : ''})` });
      continue;
    }
    if (!n.persistable) {
      out.push({ kind: 'entity-not-persistable', unit: dm(n.module), element: e.qn, risk: `may drop data in ${e.qn} (no longer persistable: its table goes)` });
      continue;
    }
    if (n.qn !== e.qn) out.push({ kind: 'entity-renamed', unit: dm(n.module), element: e.qn, before: e.qn, after: n.qn, risk: `renamed ${e.qn} → ${n.qn}: the runtime keeps rows by the entity's id, but anything outside the model that names ${e.qn} (integrations, exports, OQL, Java) breaks` });
    if (n.generalization !== e.generalization) out.push({ kind: 'generalization', unit: dm(n.module), element: n.qn, before: e.generalization || 'none', after: n.generalization || 'none', risk: `may convert or drop data in ${n.qn} (generalization ${e.generalization || 'none'} → ${n.generalization || 'none'})` });
    const nextA = new Map(n.attrs.map((a) => [a.id, a]));
    for (const a of e.attrs) {
      if (!a.stored) continue;
      const qn = `${e.qn}.${a.name}`;
      const b = nextA.get(a.id);
      if (!b) {
        out.push({ kind: 'attribute-removed', unit: dm(n.module), element: qn, risk: `may drop data in ${qn}` });
        continue;
      }
      const nqn = `${n.qn}.${b.name}`;
      if (!b.stored) out.push({ kind: 'attribute-calculated', unit: dm(n.module), element: qn, risk: `may drop data in ${qn} (no longer stored: it becomes a calculated value)` });
      else if (b.type !== a.type && !widened(a.type, b.type)) out.push({ kind: 'attribute-type', unit: dm(n.module), element: nqn, before: a.type, after: b.type, risk: `may drop or convert data in ${nqn} (${a.type} → ${b.type})` });
      if (b.name !== a.name) out.push({ kind: 'attribute-renamed', unit: dm(n.module), element: qn, before: qn, after: nqn, risk: `renamed ${qn} → ${nqn}: the runtime keeps the column's data by the attribute's id, but anything outside the model that names ${a.name} breaks` });
    }
  }
  const nextS = new Map(after.associations.map((a) => [a.id, a]));
  for (const a of before.associations) {
    if (!a.persistable) continue;
    const n = nextS.get(a.id);
    if (!n || !n.persistable) {
      out.push({ kind: 'association-removed', unit: dm(a.module), element: a.qn, risk: `may drop data in ${a.qn} (the links between records)` });
      continue;
    }
    if (n.qn !== a.qn) out.push({ kind: 'association-renamed', unit: dm(n.module), element: a.qn, before: a.qn, after: n.qn, risk: `renamed ${a.qn} → ${n.qn}: the links are kept by the association's id, but anything outside the model that names it breaks` });
    if (n.storage !== a.storage) out.push({ kind: 'association-storage', unit: dm(n.module), element: n.qn, before: a.storage, after: n.storage, risk: `may drop or convert data in ${n.qn} (${a.storage} → ${n.storage}: the links are stored differently)` });
    if (n.deleteBehaviour !== a.deleteBehaviour) out.push({ kind: 'delete-behaviour', unit: dm(n.module), element: n.qn, before: a.deleteBehaviour, after: n.deleteBehaviour, risk: `changes which data goes when a record is deleted: ${n.qn} (${a.deleteBehaviour} → ${n.deleteBehaviour})` });
  }
  // Enumeration values are stored by name: a value that goes, or is renamed, leaves rows holding a name the model no longer has.
  const users = new Map<string, string[]>();
  for (const e of before.entities) for (const a of e.attrs) {
    const m = /^Enumeration\((.+)\)$/.exec(a.type);
    if (m && e.persistable && a.stored) users.set(m[1], [...(users.get(m[1]) ?? []), `${e.qn}.${a.name}`]);
  }
  const nextN = new Map(after.enums.map((x) => [x.id, x]));
  for (const en of before.enums) {
    const used = users.get(en.qn);
    if (!used?.length) continue;
    const n = nextN.get(en.id);
    const vals = new Map((n?.values ?? []).map((v) => [v.id, v]));
    const names = new Set((n?.values ?? []).map((v) => v.name));
    const where = used.length === 1 ? used[0] : `${used[0]} and ${used.length - 1} more`;
    for (const v of en.values) {
      const w = vals.get(v.id);
      if (!w && !names.has(v.name)) out.push({ kind: 'enum-value-removed', unit: `enumeration ${en.qn}`, element: `${en.qn}.${v.name}`, risk: `may drop or convert data in ${where} (value ${v.name} removed from ${en.qn})` });
      else if (w && w.name !== v.name) out.push({ kind: 'enum-value-renamed', unit: `enumeration ${en.qn}`, element: `${en.qn}.${v.name}`, before: v.name, after: w.name, risk: `may drop or convert data in ${where} (value ${v.name} renamed to ${w.name}: stored rows keep ${v.name})` });
    }
  }
  return out;
}

const short = (sha: string) => sha.slice(0, 7);

/** The hold in one line, as the live app's state and Needs you say it. */
export function holdReason(status: 'impact' | 'unknown', target: string, error?: string): string {
  return status === 'unknown'
    ? `Update held: data impact unknown at ${short(target)}${error ? ` (${error})` : ''}; needs data-impact approval`
    : `Update held: possible data impact at ${short(target)}; needs data-impact approval`;
}

/** "merged on main at abc1234; not applied to the live preview: data-impact hold". */
export const heldFactLine = (branch: string, target: string) => `merged on ${branch} at ${short(target)}; not applied to the live preview: data-impact hold`;

/** Whether an approval still covers the hold: same environment, baseline and target (recovery evidence is checked by the server). */
export const binds = (a: Pick<DataImpactApproval, 'env' | 'base' | 'target'>, h: Pick<HeldFact, 'env' | 'base' | 'target'>) => a.env === h.env && a.base === h.base && a.target === h.target;

/** Why an approval no longer applies to `h`, or '' when it does. */
export function voidWhy(a: Pick<DataImpactApproval, 'env' | 'base' | 'target'>, h: Pick<HeldFact, 'env' | 'base' | 'target'>): string {
  if (a.env !== h.env) return `the environment changed (${a.env} → ${h.env})`;
  if (a.target !== h.target) return `the candidate changed (${short(a.target)} → ${short(h.target)})`;
  if (a.base !== h.base) return `the starting baseline changed (${short(a.base)} → ${short(h.base)})`;
  return '';
}

/** The recovery step in words, for the record and the audit. */
export function recoveryWords(r: Recovery): string {
  return r.kind === 'dump' ? `database dump ${r.path} (${r.size} bytes, sha256 ${r.sha256.slice(0, 12)}…)` : `"${r.statement}"`;
}

/** Who holds the permission, in words. */
export function approversWords(admins: string[] | null, others: string[]): string {
  const a = admins === null ? '' : admins.length ? `office admins (${admins.join(', ')})` : 'office admins';
  const o = others.join(', ');
  return [a, o].filter(Boolean).join(' and ') || 'nobody (an admin can grant it in the policy)';
}
