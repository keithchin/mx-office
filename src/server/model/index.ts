// The Model tab's server side: the floor's Mendix app as Studio Pro shows it, on main or on any
// branch. Asked for only when someone opens the tab (GET /api/model/…, http/routes/model.ts).
//
// A ref (main, or a branch) is turned into a commit with the Git tab's graph (which also fetches
// origin, at most once a minute); that commit is taken out of the floor's history into the data
// folder (store.ts) and read there by mxcli (mxcli.ts) and from its units (mpr.ts). Every answer is
// kept per commit, so a commit is read once, and two people opening the same diagram share one read.

import { gitGraphsOf, type GraphFloor } from '../gitgraph/index.js';
import { doc, list, str } from './bson.js';
import { changesFrom, diffUnits, DOC_TYPES, treeDiff } from './diff.js';
import { domainFromElk, entityPositions, parseDomain, systemPersistable, type ElkDomain } from './domain.js';
import { short } from './flow-actions.js';
import { parseFlow, type ElkFlow } from './flow.js';
import { diffIndexes, openIndex, type UnitIndex } from './mpr.js';
import { findMxcli, Limiter, mxRunner, parseJsonOut, stripNoise, type MxRun } from './mxcli.js';
import { gitOff, ModelStore, type GitRun, type Snapshot } from './store.js';
import { parseTree } from './tree.js';
import type { GitGraph } from '../../shared/gitgraph.js';
import type { DmAnnotation, DomainDoc, ModelChanges, ModelDoc, ModelDocResponse, ModelRef, ModelRefs, ModelTree, ModelTreeNode } from '../../shared/model.js';

/** mxcli processes at once, office-wide. */
export const MX_PARALLEL = 2;
const INDEX_MAX = 4;
/** Bumped when what's kept per commit changes shape, so answers worked out by an older office are worked out again. */
export const CACHE_VERSION = 1;

/** Types `mxcli describe` takes, for documents shown as their MDL. */
const DESCRIBE = new Set(['enumeration', 'constant', 'workflow', 'page', 'snippet', 'buildingblock', 'layout', 'javaaction', 'jsonstructure', 'importmapping', 'exportmapping', 'restclient', 'odataclient', 'odataservice', 'imagecollection', 'menu', 'queue', 'scheduledevent', 'regularexpression', 'modulerole', 'userrole', 'projectsecurity', 'settings', 'demouser', 'navigation', 'module', 'association', 'entity', 'businesseventservice', 'databaseconnection']);

/** A branch name we'll hand to git: no options, no ranges, nothing odd. */
export const REF_OK = /^(?!-)(?!.*\.\.)[\w./@+-]{1,200}$/;

export interface ModelDeps {
  git?: GitRun;
  /** mxcli, or null when there's none; looked up on first use when left out. */
  mx?: MxRun | null;
  graph?: (floor: GraphFloor) => Promise<GitGraph>;
}

export class ModelService {
  readonly store: ModelStore;
  private git: GitRun;
  private mxRun: MxRun | null | undefined;
  private graphOf: (floor: GraphFloor) => Promise<GitGraph>;
  private indexes = new Map<string, Promise<UnitIndex | null>>();

  constructor(private dataDir: string, deps: ModelDeps = {}) {
    this.git = deps.git ?? gitOff;
    this.store = new ModelStore(dataDir, this.git);
    this.mxRun = deps.mx;
    this.graphOf = deps.graph ?? ((f) => gitGraphsOf({ cfg: this }).graph(f));
  }

  private get mx(): MxRun | null {
    if (this.mxRun === undefined) {
      const bin = findMxcli(this.dataDir);
      this.mxRun = bin ? mxRunner(bin, new Limiter(MX_PARALLEL)) : null;
    }
    return this.mxRun;
  }

  private needMx(): MxRun {
    const mx = this.mx;
    if (!mx) throw new Error('mxcli isn\'t on this machine (set AGENT_OFFICE_LIVE_MXCLI or AGENT_OFFICE_MXCLI)');
    return mx;
  }

  /** Main and the branches worth looking at (workers' and open pull requests'), newest first. */
  async refs(floor: GraphFloor): Promise<ModelRefs> {
    const g = await this.graphOf(floor);
    const main: ModelRef = { ref: 'main', label: g.defaultBranch, kind: 'main', sha: g.history[0]?.sha };
    const branches: ModelRef[] = g.branches
      .filter((b) => !b.merged && (b.worker || (b.pr && b.pr.state === 'OPEN') || b.ahead > 0))
      .map((b) => ({ ref: b.name, label: b.name, kind: 'branch', sha: b.sha, worker: b.worker?.name, pr: b.pr?.number, prUrl: b.pr?.url }));
    return { refs: [main, ...branches], problem: this.mx ? undefined : 'mxcli isn\'t on this machine, so the app can\'t be read.' };
  }

  /** The commit a ref is at, and (for a branch) where it left main. */
  async resolve(floor: GraphFloor, ref: string): Promise<{ sha: string; base?: string }> {
    const g = await this.graphOf(floor);
    if (!ref || ref === 'main' || ref === g.defaultBranch) {
      const sha = g.history[0]?.sha;
      if (!sha) throw new Error('the floor has no main branch yet');
      return { sha };
    }
    if (!REF_OK.test(ref)) throw new Error('not a branch name');
    const b = g.branches.find((x) => x.name === ref);
    if (b) return { sha: b.sha, base: b.fork };
    for (const r of [`refs/heads/${ref}`, `refs/remotes/origin/${ref}`]) {
      const sha = (await this.git(['rev-parse', '--verify', '--quiet', `${r}^{commit}`], floor.dir).catch(() => '')).trim();
      if (sha) {
        const base = (await this.git(['merge-base', g.defaultRef, sha], floor.dir).catch(() => '')).trim();
        return { sha, base: base || undefined };
      }
    }
    throw new Error(`no branch ${ref}`);
  }

  private snap(floor: GraphFloor, sha: string): Promise<Snapshot> {
    return this.store.snapshot(floor.dir, sha);
  }

  /** The units of a commit (null when they can't be read here), a few commits kept in memory. */
  private index(floor: GraphFloor, sha: string): Promise<UnitIndex | null> {
    let ix = this.indexes.get(sha);
    if (!ix) {
      ix = this.snap(floor, sha).then((s) => openIndex(s.mpr).catch(() => null));
      this.indexes.set(sha, ix);
      ix.catch(() => this.indexes.delete(sha));
      while (this.indexes.size > INDEX_MAX) this.indexes.delete(this.indexes.keys().next().value as string);
    }
    return ix;
  }

  async tree(floor: GraphFloor, ref: string): Promise<ModelTree> {
    const { sha } = await this.resolve(floor, ref);
    const nodes = await this.treeAt(floor, sha);
    return { sha, ref, nodes };
  }

  private treeAt(floor: GraphFloor, sha: string): Promise<ModelTreeNode[]> {
    return this.store.cached(sha, `v${CACHE_VERSION}:tree`, async () => {
      const s = await this.snap(floor, sha);
      return parseTree(parseJsonOut(await this.needMx()(['project-tree', '-p', s.mpr], { cwd: s.dir })));
    });
  }

  async doc(floor: GraphFloor, ref: string, type: string, qn: string, compare = false): Promise<ModelDocResponse> {
    const { sha, base } = await this.resolve(floor, ref);
    const d = await this.docAt(floor, sha, type, qn);
    const out: ModelDocResponse = { sha, doc: d };
    if (compare && base && base !== sha && (type === 'domainmodel' || type === 'microflow' || type === 'nanoflow')) {
      const [bi, hi] = await Promise.all([this.index(floor, base), this.index(floor, sha)]);
      if (bi && hi) {
        const key = `${type}:${qn}`;
        const unitOf = (ix: UnitIndex) => {
          const id = ix.byName.get(key);
          return id ? ix.read(id) : Promise.resolve(null);
        };
        out.diff = diffUnits(type, await unitOf(bi), await unitOf(hi));
      }
    }
    return out;
  }

  private docAt(floor: GraphFloor, sha: string, type: string, qn: string): Promise<ModelDoc> {
    return this.store.cached(sha, `v${CACHE_VERSION}:doc:${type}:${qn}`, async () => {
      if (type === 'microflow' || type === 'nanoflow') return this.flowAt(floor, sha, type, qn);
      if (type === 'domainmodel') return this.domainAt(floor, sha, qn);
      const dtype = type === 'navprofile' ? 'navigation' : type;
      if (!DESCRIBE.has(dtype)) return { kind: 'text', type, name: qn, mdl: '' };
      const s = await this.snap(floor, sha);
      const mdl = stripNoise(await this.needMx()(['describe', '-p', s.mpr, dtype, qn], { cwd: s.dir })).replace(/^mdl 1;\n?/, '');
      return { kind: 'text', type, name: qn, mdl };
    });
  }

  private async flowAt(floor: GraphFloor, sha: string, type: 'microflow' | 'nanoflow', qn: string): Promise<ModelDoc> {
    const s = await this.snap(floor, sha);
    const [elk, ix] = await Promise.all([
      this.needMx()(['describe', '-p', s.mpr, '--format', 'elk', type, qn], { cwd: s.dir }).then((o) => parseJsonOut<ElkFlow>(o)),
      this.index(floor, sha),
    ]);
    const id = ix?.byName.get(`${type}:${qn}`);
    const unit = id && ix ? await ix.read(id) : null;
    const targets = new Map<string, string>();
    if (unit && ix) {
      // Retrieves over an association: which entity each association leads to, from its module's domain model.
      const assocs = new Set<string>();
      JSON.stringify(unit, (k, v) => (k === 'AssociationId' && typeof v === 'string' && v && assocs.add(v), v));
      for (const a of assocs) {
        const mod = a.slice(0, a.indexOf('.'));
        const dm = ix.byName.get(`domainmodel:${mod}`);
        const u = dm ? await ix.read(dm) : null;
        const found = list(u?.Associations).find((x) => str(x.Name) === short(a));
        const child = list(u?.Entities).find((e) => str(e.$ID) === str(found?.ChildPointer));
        if (child) targets.set(a, `${mod}.${str(child.Name)}`);
      }
    }
    return parseFlow(type, qn, elk, unit, (a) => targets.get(a));
  }

  private async domainAt(floor: GraphFloor, sha: string, module: string): Promise<DomainDoc> {
    const ix = await this.index(floor, sha);
    const id = ix?.byName.get(`domainmodel:${module}`);
    const unit = id && ix ? await ix.read(id) : null;
    if (ix && unit) {
      const persistable = new Map<string, boolean>();
      for (const e of list(unit.Entities)) {
        const g = str(doc(e.MaybeGeneralization)?.Generalization);
        if (!g || g.startsWith(`${module}.`) || g.startsWith('System.')) continue;
        const other = ix.byName.get(`domainmodel:${g.slice(0, g.indexOf('.'))}`);
        const ou = other ? await ix.read(other) : null;
        const pe = ou ? parseDomain(g.slice(0, g.indexOf('.')), ou).entities.find((x) => x.name === short(g)) : undefined;
        if (pe) persistable.set(g, pe.kind === 'persistent');
      }
      return parseDomain(module, unit, (qn) => persistable.get(qn) ?? systemPersistable(qn));
    }
    return this.domainFromMx(floor, sha, module);
  }

  /** Without the units: mxcli's elk view of the module, each entity's MDL for its position. */
  private async domainFromMx(floor: GraphFloor, sha: string, module: string): Promise<DomainDoc> {
    const mx = this.needMx();
    const s = await this.snap(floor, sha);
    const tree = await this.treeAt(floor, sha);
    const mod = tree.find((n) => n.type === 'module' && n.qn === module);
    const dmNode = mod?.children?.find((c) => c.type === 'domainmodel');
    const entities = (dmNode?.children ?? []).filter((c) => c.type === 'entity' && c.qn).map((c) => c.qn as string);
    if (!entities.length) return { kind: 'domainmodel', module, entities: [], associations: [], annotations: [], source: 'mdl' };
    const elk = parseJsonOut<ElkDomain>(await mx(['describe', '-p', s.mpr, '--format', 'elk', 'entity', entities[0]], { cwd: s.dir }));
    const mdl = await mx(['-p', s.mpr, '--continue-on-error', '-c', entities.map((e) => `describe entity ${e};`).join(' ')], { cwd: s.dir }).catch((e: Error) => e.message);
    const owners = new Map<string, string>();
    const assoc = await mx(['-p', s.mpr, '--json', '-c', `list associations in ${module}`], { cwd: s.dir }).catch(() => '[]');
    for (const a of parseJsonOut<Record<string, string>[]>(assoc)) owners.set(String(a.Name), String(a.Owner));
    const notes = await mx(['-p', s.mpr, '--json', '-c', 'show annotations'], { cwd: s.dir }).catch(() => '[]');
    const annotations: DmAnnotation[] = parseJsonOut<Record<string, unknown>[]>(notes)
      .filter((a) => a.Module === module)
      .map((a, i) => {
        const [x, y] = String(a.Position).replace(/[()\s]/g, '').split(',').map(Number);
        return { id: `note-${i}`, text: String(a.Title), x: x || 0, y: y || 0, w: Number(a.Width) || 200 };
      });
    return domainFromElk(elk, entityPositions(mdl), owners, annotations);
  }

  /** What `ref` changed against where it left main. */
  async changes(floor: GraphFloor, ref: string): Promise<ModelChanges> {
    const { sha, base } = await this.resolve(floor, ref);
    if (!base || base === sha) return { base: base ?? sha, head: sha, docs: [] };
    return this.store.cached(sha, `v${CACHE_VERSION}:changes:${base}`, async () => {
      const [bi, hi] = await Promise.all([this.index(floor, base), this.index(floor, sha)]);
      if (bi && hi) return { base, head: sha, docs: changesFrom(diffIndexes(bi, hi)).filter((c) => DOC_TYPES.has(c.type)) };
      const [bt, ht] = await Promise.all([this.treeAt(floor, base), this.treeAt(floor, sha)]);
      return { base, head: sha, docs: treeDiff(bt, ht) };
    });
  }
}

const offices = new WeakMap<object, ModelService>();

/** The office's one ModelService. */
export function modelOf(ctx: { cfg: { dataDir: string } }): ModelService {
  let m = offices.get(ctx.cfg);
  if (!m) offices.set(ctx.cfg, (m = new ModelService(ctx.cfg.dataDir, { graph: (f) => gitGraphsOf(ctx).graph(f) })));
  return m;
}


