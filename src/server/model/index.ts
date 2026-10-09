// The Model tab's server side: the floor's Mendix app as Studio Pro shows it, on main or on any
// branch. Asked for only when someone opens the tab (GET /api/model/…, http/routes/model.ts).
//
// A ref (main, or a branch) is turned into a commit with the Git tab's graph (which also fetches
// origin, at most once a minute). The commit's model is read straight out of git (units.ts: its unit
// table and each unit by blob hash, no copy of the commit on disk), and a microflow, nanoflow or domain
// model is drawn from its units (read.ts), in milliseconds and without mxcli. Each answer is kept by
// the content hashes it was read from (store.ts), so a document a new commit left alone is answered at
// once. mxcli (mxcli.ts) is left for what only it gives: the tree when the app's structure changed, a
// flow's MDL (asked for after the diagram, GET /api/model/mdl), the documents shown as MDL, and
// projects the units can't be read from (MPR without node:sqlite); it reads a commit from a folder
// that moves from commit to commit by the files that differ (workdir.ts). Opening a document reads
// the rest of its module ahead, and main moving while the tab was in use reads what changed
// (prefetch.ts).

import { gitGraphsOf, type GraphFloor } from '../gitgraph/index.js';
import { modelFiles, type BlobsOptions, type ModelFiles } from './blobs.js';
import { changesFrom, diffUnits, DOC_TYPES, treeDiff } from './diff.js';
import { domainFromElk, entityPositions, type ElkDomain } from './domain.js';
import { parseFlow, type ElkFlow } from './flow.js';
import { diffIndexes } from './mpr.js';
import { findMxcli, Limiter, mxRunner, parseJsonOut, stripNoise, type MxRun } from './mxcli.js';
import { Prefetcher, type Task } from './prefetch.js';
import { mdlOf, readDomain, readFlow, withMdl, type FlowMdl } from './read.js';
import { gitOff, keyOf, ModelStore, type GitRun } from './store.js';
import { parseTree } from './tree.js';
import { ModelUnits, type CommitModel } from './units.js';
import { WorkDirs } from './workdir.js';
import type { GitGraph } from '../../shared/gitgraph.js';
import type { DmAnnotation, DomainDoc, FlowDoc, ModelChanges, ModelDoc, ModelDocResponse, ModelMdlResponse, ModelRef, ModelRefs, ModelTree, ModelTreeNode } from '../../shared/model.js';

/** mxcli processes at once, office-wide. */
export const MX_PARALLEL = 2;
/** Bumped when what's kept changes shape, so answers worked out by an older office are worked out again. */
export const CACHE_VERSION = 2;
/** Main moving reads ahead only when someone used the tab this recently. */
export const WARM_WINDOW_MS = 15 * 60_000;

/** Types `mxcli describe` takes, for documents shown as their MDL. */
const DESCRIBE = new Set(['enumeration', 'constant', 'workflow', 'page', 'snippet', 'buildingblock', 'layout', 'javaaction', 'jsonstructure', 'importmapping', 'exportmapping', 'restclient', 'odataclient', 'odataservice', 'imagecollection', 'menu', 'queue', 'scheduledevent', 'regularexpression', 'modulerole', 'userrole', 'projectsecurity', 'settings', 'demouser', 'navigation', 'module', 'association', 'entity', 'businesseventservice', 'databaseconnection']);
const FLOW = new Set(['microflow', 'nanoflow']);

/** A branch name we'll hand to git: no options, no ranges, nothing odd. */
export const REF_OK = /^(?!-)(?!.*\.\.)[\w./@+-]{1,200}$/;

export interface ModelDeps {
  git?: GitRun;
  /** mxcli, or null when there's none; looked up on first use when left out. */
  mx?: MxRun | null;
  graph?: (floor: GraphFloor) => Promise<GitGraph>;
  blobs?: BlobsOptions;
}

export class ModelService {
  readonly store: ModelStore;
  readonly units: ModelUnits;
  readonly work: WorkDirs;
  readonly prefetch = new Prefetcher();
  private git: GitRun;
  private mxRun: MxRun | null | undefined;
  private graphOf: (floor: GraphFloor) => Promise<GitGraph>;
  /** Per floor: main's commit when last seen, and when the tab was last used. */
  private mainSeen = new Map<string, string>();
  private usedAt = new Map<string, number>();
  private legacyDropped = false;

  constructor(private dataDir: string, deps: ModelDeps = {}) {
    this.git = deps.git ?? gitOff;
    this.store = new ModelStore(dataDir);
    this.units = new ModelUnits(this.store.root, deps.blobs);
    this.work = new WorkDirs(this.store.root);
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

  /** Runs mxcli with `args(mpr)` on commit `sha`, from a work folder at that commit. */
  private async mxAt(floor: GraphFloor, sha: string, args: (mpr: string) => string[]): Promise<string> {
    const mx = this.mx;
    if (!mx) throw new Error('mxcli isn\'t on this machine (set AGENT_OFFICE_LIVE_MXCLI or AGENT_OFFICE_MXCLI)');
    const files = await this.filesAt(floor, sha);
    return this.work.use(this.units.blobs(floor.dir), sha, files, (mpr, cwd) => mx(args(mpr), { cwd }));
  }

  private async filesAt(floor: GraphFloor, sha: string): Promise<ModelFiles> {
    const files = await modelFiles(this.units.blobs(floor.dir), sha);
    if (!files) throw new Error('no Mendix project (.mpr) in this commit');
    return files;
  }

  /** The commit's model from its units, or null when they can't be read here (no node:sqlite). */
  private commit(floor: GraphFloor, sha: string): Promise<CommitModel | null> {
    if (!this.legacyDropped) {
      this.legacyDropped = true;
      void this.store.dropLegacy();
    }
    return this.units.commit(floor.dir, sha);
  }

  /** Main and the branches worth looking at (workers' and open pull requests'), newest first. */
  async refs(floor: GraphFloor): Promise<ModelRefs> {
    const g = await this.graphOf(floor);
    const main: ModelRef = { ref: 'main', label: g.defaultBranch, kind: 'main', sha: g.history[0]?.sha };
    if (main.sha) this.sawMain(floor, main.sha);
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
      this.sawMain(floor, sha);
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

  /**
   * The tree at `ref`. When the app's structure changed and mxcli hasn't given the new tree yet, the
   * floor's last tree comes back at once (`stale`) while the new one is worked out; `fresh` waits for it.
   */
  async tree(floor: GraphFloor, ref: string, fresh = false): Promise<ModelTree> {
    this.usedAt.set(floor.id, Date.now());
    const { sha } = await this.resolve(floor, ref);
    const key = await this.treeKey(floor, sha);
    if (!fresh && !(await this.store.peek(key))) {
      const last = await this.store.peek<ModelTreeNode[]>(this.lastTreeKey(floor));
      if (last) {
        void this.treeAt(floor, sha).catch(() => {});
        return { sha, ref, nodes: last, stale: true };
      }
    }
    const nodes = await this.treeAt(floor, sha);
    return { sha, ref, nodes };
  }

  private lastTreeKey(floor: GraphFloor): string {
    return keyOf(`v${CACHE_VERSION}`, 'last-tree', floor.dir);
  }

  /** The tree's key: the app's structure (units.ts structureOf), so a commit that only changed documents' insides has its parent's. */
  private async treeKey(floor: GraphFloor, sha: string): Promise<string> {
    const cm = await this.commit(floor, sha).catch(() => null);
    return cm ? keyOf(`v${CACHE_VERSION}`, 'tree', cm.structure) : keyOf(`v${CACHE_VERSION}`, 'tree@', floor.dir, sha);
  }

  private async treeAt(floor: GraphFloor, sha: string): Promise<ModelTreeNode[]> {
    return this.store.cached(await this.treeKey(floor, sha), async () => {
      const nodes = parseTree(parseJsonOut(await this.mxAt(floor, sha, (mpr) => ['project-tree', '-p', mpr])));
      await this.store.put(this.lastTreeKey(floor), nodes);
      return nodes;
    });
  }

  async doc(floor: GraphFloor, ref: string, type: string, qn: string, compare = false): Promise<ModelDocResponse> {
    this.usedAt.set(floor.id, Date.now());
    const { sha, base } = await this.resolve(floor, ref);
    const cm = await this.commit(floor, sha);
    let d = await this.docAt(floor, sha, cm, type, qn);
    if (d.kind !== 'text' && d.kind !== 'domainmodel' && d.mdlLater && cm) {
      // The MDL too, when it was worked out before (on this commit or any with the same flow).
      const m = await this.store.peek<FlowMdl>(this.mdlKey(cm, type, qn));
      if (m) d = withMdl(d, m);
    }
    const out: ModelDocResponse = { sha, doc: d };
    if (compare && base && base !== sha && (type === 'domainmodel' || FLOW.has(type))) {
      const bm = await this.commit(floor, base);
      if (bm && cm) {
        const key = `${type}:${qn}`;
        const unitOf = (m: CommitModel) => {
          const id = m.ix.byName.get(key);
          return id ? m.ix.read(id) : Promise.resolve(null);
        };
        out.diff = diffUnits(type, await unitOf(bm), await unitOf(cm));
      }
    }
    if (cm) this.readAhead(floor, sha, cm, type, qn);
    return out;
  }

  private async docAt(floor: GraphFloor, sha: string, cm: CommitModel | null, type: string, qn: string): Promise<ModelDoc> {
    if (cm && FLOW.has(type)) {
      const r = await readFlow(cm, type as 'microflow' | 'nanoflow', qn);
      if (r) return this.store.cached(r.key, async () => ({ ...r.build(), mdlLater: true }));
    }
    if (cm && type === 'domainmodel') {
      const r = await readDomain(cm, qn);
      if (r) return this.store.cached(r.key, async () => r.build());
    }
    // A document shown as its MDL: kept by its unit's hash when it has one, else by commit.
    const unitHash = cm?.hashOf(`${type}:${qn}`) ?? '';
    const key = unitHash ? keyOf(`v${CACHE_VERSION}`, 'doc', type, qn, unitHash) : keyOf(`v${CACHE_VERSION}`, 'doc@', floor.dir, sha, type, qn);
    return this.store.cached(key, async (): Promise<ModelDoc> => {
      if (FLOW.has(type)) return this.flowFromMx(floor, sha, type as 'microflow' | 'nanoflow', qn);
      if (type === 'domainmodel') return this.domainFromMx(floor, sha, qn);
      const dtype = type === 'navprofile' ? 'navigation' : type;
      if (!DESCRIBE.has(dtype)) return { kind: 'text', type, name: qn, mdl: '' };
      const mdl = stripNoise(await this.mxAt(floor, sha, (mpr) => ['describe', '-p', mpr, dtype, qn])).replace(/^mdl 1;\n?/, '');
      return { kind: 'text', type, name: qn, mdl };
    });
  }

  private mdlKey(cm: CommitModel, type: string, qn: string): string {
    return keyOf(`v${CACHE_VERSION}`, 'mdl', type, qn, cm.hashOf(`${type}:${qn}`));
  }

  /** A flow's MDL and each element's lines in it: mxcli's elk description, kept by the flow's hash. */
  async mdl(floor: GraphFloor, ref: string, type: string, qn: string): Promise<ModelMdlResponse> {
    if (!FLOW.has(type)) throw new Error('only microflows and nanoflows have their MDL asked for apart');
    const { sha } = await this.resolve(floor, ref);
    const cm = await this.commit(floor, sha);
    const key = cm && cm.hashOf(`${type}:${qn}`) ? this.mdlKey(cm, type, qn) : keyOf(`v${CACHE_VERSION}`, 'mdl@', floor.dir, sha, type, qn);
    const m = await this.store.cached(key, async () => mdlOf(parseJsonOut<ElkFlow>(await this.mxAt(floor, sha, (mpr) => ['describe', '-p', mpr, '--format', 'elk', type, qn]))));
    return { sha, ...m };
  }

  /** Without the units: the flow from mxcli's elk description and MDL alone. */
  private async flowFromMx(floor: GraphFloor, sha: string, type: 'microflow' | 'nanoflow', qn: string): Promise<FlowDoc> {
    const elk = parseJsonOut<ElkFlow>(await this.mxAt(floor, sha, (mpr) => ['describe', '-p', mpr, '--format', 'elk', type, qn]));
    return parseFlow(type, qn, elk, null);
  }

  /** Without the units: mxcli's elk view of the module, each entity's MDL for its position. */
  private async domainFromMx(floor: GraphFloor, sha: string, module: string): Promise<DomainDoc> {
    const tree = await this.treeAt(floor, sha);
    const mod = tree.find((n) => n.type === 'module' && n.qn === module);
    const dmNode = mod?.children?.find((c) => c.type === 'domainmodel');
    const entities = (dmNode?.children ?? []).filter((c) => c.type === 'entity' && c.qn).map((c) => c.qn as string);
    if (!entities.length) return { kind: 'domainmodel', module, entities: [], associations: [], annotations: [], source: 'mdl' };
    const elk = parseJsonOut<ElkDomain>(await this.mxAt(floor, sha, (mpr) => ['describe', '-p', mpr, '--format', 'elk', 'entity', entities[0]]));
    const mdl = await this.mxAt(floor, sha, (mpr) => ['-p', mpr, '--continue-on-error', '-c', entities.map((e) => `describe entity ${e};`).join(' ')]).catch((e: Error) => e.message);
    const owners = new Map<string, string>();
    const assoc = await this.mxAt(floor, sha, (mpr) => ['-p', mpr, '--json', '-c', `list associations in ${module}`]).catch(() => '[]');
    for (const a of parseJsonOut<Record<string, string>[]>(assoc)) owners.set(String(a.Name), String(a.Owner));
    const notes = await this.mxAt(floor, sha, (mpr) => ['-p', mpr, '--json', '-c', 'show annotations']).catch(() => '[]');
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
    const [bm, hm] = await Promise.all([this.commit(floor, base), this.commit(floor, sha)]);
    if (bm && hm) return { base, head: sha, docs: changesFrom(diffIndexes(bm.ix, hm.ix)).filter((c) => DOC_TYPES.has(c.type)) };
    const [bt, ht] = await Promise.all([this.treeAt(floor, base), this.treeAt(floor, sha)]);
    return { base, head: sha, docs: treeDiff(bt, ht) };
  }

  /** A diagram worked out (and kept) for the read-ahead, if it isn't already. */
  private warmTask(floor: GraphFloor, sha: string, key: string): Task {
    const [kind, qn] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    return async () => {
      const cm = await this.commit(floor, sha);
      if (cm) await this.docAt(floor, sha, cm, kind, qn);
    };
  }

  /** After a document opens: the rest of its module's diagrams (its domain model first), read ahead. */
  private readAhead(floor: GraphFloor, sha: string, cm: CommitModel, type: string, qn: string) {
    const module = type === 'domainmodel' ? qn : qn.slice(0, qn.indexOf('.'));
    const keys = [...cm.ix.byName.keys()].filter((k) => k !== `${type}:${qn}` && (k === `domainmodel:${module}` || (/^(microflow|nanoflow):/.test(k) && k.slice(k.indexOf(':') + 1).startsWith(`${module}.`))));
    keys.sort((a, b) => Number(b.startsWith('domainmodel:')) - Number(a.startsWith('domainmodel:')) || a.localeCompare(b));
    void this.prefetch.run(floor.id, keys.map((k) => this.warmTask(floor, sha, k)));
  }

  /** Main is at `sha`: if it moved and someone used the tab lately, read the tree and the changed diagrams ahead. */
  private sawMain(floor: GraphFloor, sha: string) {
    const was = this.mainSeen.get(floor.id);
    this.mainSeen.set(floor.id, sha);
    if (!was || was === sha || Date.now() - (this.usedAt.get(floor.id) ?? 0) > WARM_WINDOW_MS) return;
    void this.warmMove(floor, was, sha).catch(() => {});
  }

  /** Reading ahead after main moved from `was` to `sha`; resolves when it's done (tests wait on it). */
  async warmMove(floor: GraphFloor, was: string, sha: string): Promise<number> {
    const [bm, hm] = await Promise.all([this.commit(floor, was).catch(() => null), this.commit(floor, sha)]);
    if (!hm) return 0;
    const d = bm ? diffIndexes(bm.ix, hm.ix) : { added: [], changed: [...hm.ix.byName.keys()], removed: [] };
    const keys = [...d.changed, ...d.added].filter((k) => /^(microflow|nanoflow|domainmodel):/.test(k));
    const tasks: Task[] = [() => this.treeAt(floor, sha), ...keys.map((k) => this.warmTask(floor, sha, k))];
    return this.prefetch.run(`${floor.id}:main`, tasks);
  }
}

const offices = new WeakMap<object, ModelService>();

/** The office's one ModelService. */
export function modelOf(ctx: { cfg: { dataDir: string } }): ModelService {
  let m = offices.get(ctx.cfg);
  if (!m) offices.set(ctx.cfg, (m = new ModelService(ctx.cfg.dataDir, { graph: (f) => gitGraphsOf(ctx).graph(f) })));
  return m;
}
