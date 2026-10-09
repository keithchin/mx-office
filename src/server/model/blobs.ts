// Reading objects straight out of the floor's git history for the Model tab, without taking a whole
// commit out first: one `git cat-file --batch` per repository, started off the event loop (spawnOff)
// on first use and let go after a minute idle, answers every "give me this object" in a few
// milliseconds. Objects never change (their name is their content's hash), so what was read is kept
// in a small LRU, and a tree read once is kept parsed.
//
// A commit's model is then found by walking its trees (`modelFiles`): the .mpr at the top or one
// folder down (as store.ts's mprIn) and each unit under mprcontents/, by unit id and blob hash. That
// blob hash is the unit's content hash: the same document in two commits has the same one.

import { spawnOff, type OffChild } from '../offloop/exec.js';

export interface GitObject {
  type: string;
  data: Uint8Array;
}

export interface TreeEntry {
  mode: string;
  name: string;
  sha: string;
}

export interface BlobsOptions {
  /** Starts `git cat-file --batch` in `cwd` (tests pass their own). */
  start?: (cwd: string) => OffChild;
  idleMs?: number;
  /** Bytes of object contents kept in memory. */
  cacheBytes?: number;
}

const IDLE_MS = 60_000;
const CACHE_BYTES = 48 * 1024 * 1024;
const TREES_MAX = 4000;
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const EMPTY = new Uint8Array(0);
const NAME_OK = /^[0-9a-f]{7,64}(\^\{(tree|commit)\})?$/;

const startCatFile = (cwd: string) => spawnOff('git', ['-c', 'core.longpaths=true', 'cat-file', '--batch'], { cwd, env: GIT_ENV, stdin: true, binary: true });

interface Ask {
  name: string;
  done: (o: GitObject | null) => void;
  fail: (e: Error) => void;
}

/** One repository's object reader. */
export class GitBlobs {
  private child: OffChild | null = null;
  private asks: Ask[] = [];
  private chunks: Uint8Array[] = [];
  private have = 0;
  private head: { type: string; size: number } | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private cache = new Map<string, GitObject>();
  private bytes = 0;
  private trees = new Map<string, TreeEntry[]>();
  private start: (cwd: string) => OffChild;
  private idleMs: number;
  private cacheBytes: number;
  /** Objects read from git (not from the LRU), for tests and the perf script. */
  reads = 0;

  constructor(readonly dir: string, opts: BlobsOptions = {}) {
    this.start = opts.start ?? startCatFile;
    this.idleMs = opts.idleMs ?? IDLE_MS;
    this.cacheBytes = opts.cacheBytes ?? CACHE_BYTES;
  }

  /** The object called `name` (a hash, or `<hash>^{tree}`), or null when there's none. */
  read(name: string): Promise<GitObject | null> {
    if (!NAME_OK.test(name)) return Promise.reject(new Error(`not an object name: ${name}`));
    const hit = this.cache.get(name);
    if (hit) {
      this.cache.delete(name);
      this.cache.set(name, hit);
      return Promise.resolve(hit);
    }
    return new Promise((done, fail) => {
      const child = this.ensure();
      this.asks.push({ name, done, fail });
      child.write(`${name}\n`);
    });
  }

  /** A blob's bytes, or null. */
  async blob(sha: string): Promise<Uint8Array | null> {
    const o = await this.read(sha);
    return o && o.type === 'blob' ? o.data : null;
  }

  /** A tree's entries (of a tree hash, or a commit's `<sha>^{tree}`), kept parsed. */
  async tree(name: string): Promise<TreeEntry[] | null> {
    const known = this.trees.get(name);
    if (known) return known;
    const o = await this.read(name);
    if (!o || o.type !== 'tree') return null;
    const entries = parseTree(o.data, name.replace(/\^.*$/, '').length > 40 ? 32 : 20);
    if (this.trees.size >= TREES_MAX) this.trees.clear();
    this.trees.set(name, entries);
    return entries;
  }

  /** Stops the reader (the next read starts another). */
  close() {
    clearTimeout(this.idle);
    const c = this.child;
    this.child = null;
    if (c) {
      c.end();
      c.kill();
    }
    this.failAll(new Error('the reader was closed'));
  }

  private ensure(): OffChild {
    clearTimeout(this.idle);
    if (this.child && !this.child.closed) return this.child;
    [this.chunks, this.have, this.head] = [[], 0, null];
    const c = this.start(this.dir);
    this.child = c;
    c.on('stdout', (d: Uint8Array | string) => this.take(typeof d === 'string' ? new TextEncoder().encode(d) : d));
    // Only the reader in use fails what's asked of it (a closed one already did).
    c.on('error', (e: Error) => {
      if (this.child !== c) return;
      this.child = null;
      this.failAll(e);
    });
    let said = '';
    c.on('stderr', (d: string) => (said = `${said}${d}`.slice(-500)));
    c.on('close', () => {
      if (this.child !== c) return;
      this.child = null;
      this.failAll(new Error(said.trim().split(/\r?\n/).pop() || 'git cat-file stopped'));
    });
    return c;
  }

  private failAll(e: Error) {
    const asks = this.asks;
    this.asks = [];
    for (const a of asks) a.fail(e);
  }

  private take(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.have += chunk.length;
    for (;;) {
      const ask = this.asks[0];
      if (!ask || !this.chunks.length) break;
      if (!this.head) {
        // The header line ("<hash> <type> <size>" or "<name> missing") is short: join chunks only until it's whole.
        let nl = this.chunks[0].indexOf(10);
        while (nl < 0 && this.chunks.length > 1) {
          this.chunks.splice(0, 2, join(this.chunks[0], this.chunks[1]));
          nl = this.chunks[0].indexOf(10);
        }
        if (nl < 0) break;
        const parts = new TextDecoder().decode(this.chunks[0].subarray(0, nl)).split(' ');
        this.cut(nl + 1);
        if (parts.length < 3) {
          this.asks.shift();
          ask.done(null);
          continue;
        }
        this.head = { type: parts[1], size: Number(parts[2]) };
      }
      // Its contents and a newline; gathered once they're all here, so a big blob is copied once.
      if (this.have < this.head.size + 1) break;
      const data = this.cut(this.head.size, true);
      this.cut(1);
      const o = { type: this.head.type, data };
      this.head = null;
      this.asks.shift();
      this.reads++;
      this.keep(ask.name, o);
      ask.done(o);
    }
    if (!this.asks.length) {
      clearTimeout(this.idle);
      this.idle = setTimeout(() => this.close(), this.idleMs);
      this.idle.unref?.();
    }
  }

  /** Takes the first `n` bytes off what's come in (a copy of them when `keep`). */
  private cut(n: number, keep = false): Uint8Array {
    const out = keep ? new Uint8Array(n) : EMPTY;
    let at = 0;
    while (at < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - at);
      if (keep) out.set(c.subarray(0, k), at);
      at += k;
      if (k === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(k);
    }
    this.have -= n;
    return out;
  }

  private keep(name: string, o: GitObject) {
    if (o.data.length > this.cacheBytes / 4) return;
    this.cache.set(name, o);
    this.bytes += o.data.length;
    while (this.bytes > this.cacheBytes) {
      const [k, v] = this.cache.entries().next().value as [string, GitObject];
      this.cache.delete(k);
      this.bytes -= v.data.length;
    }
  }
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** A git tree object's entries: `<mode> <name>\0<hash bytes>` one after another. */
export function parseTree(data: Uint8Array, hashLen = 20): TreeEntry[] {
  const out: TreeEntry[] = [];
  const dec = new TextDecoder();
  let p = 0;
  while (p < data.length) {
    const sp = data.indexOf(32, p);
    const nul = data.indexOf(0, sp);
    if (sp < 0 || nul < 0 || nul + 1 + hashLen > data.length) break;
    const mode = dec.decode(data.subarray(p, sp));
    const name = dec.decode(data.subarray(sp + 1, nul));
    const sha = Array.from(data.subarray(nul + 1, nul + 1 + hashLen), (b) => b.toString(16).padStart(2, '0')).join('');
    out.push({ mode, name, sha });
    p = nul + 1 + hashLen;
  }
  return out;
}

export interface ModelFiles {
  /** The .mpr's path in the commit, and its blob. */
  mpr: string;
  mprBlob: string;
  /** Unit id → blob hash, for an MPR v2 project's mprcontents/ (empty for v1). */
  units: Map<string, string>;
}

const isDir = (e: TreeEntry) => e.mode === '40000' || e.mode === '040000';
const isMpr = (e: TreeEntry) => !isDir(e) && /\.mpr$/i.test(e.name) && !e.name.startsWith('.');

/** The model in commit `sha`: its .mpr (at the top, or one folder down) and its units, or null when there's no .mpr. */
export async function modelFiles(blobs: GitBlobs, sha: string): Promise<ModelFiles | null> {
  const top = await blobs.tree(`${sha}^{tree}`);
  if (!top) throw new Error(`no commit ${sha.slice(0, 12)} in this repository`);
  let base: TreeEntry[] = top;
  let prefix = '';
  let mpr = top.filter(isMpr).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!mpr) {
    for (const d of top.filter((e) => isDir(e) && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
      const sub = await blobs.tree(d.sha);
      const m = sub?.filter(isMpr).sort((a, b) => a.name.localeCompare(b.name))[0];
      if (sub && m) {
        [base, prefix, mpr] = [sub, `${d.name}/`, m];
        break;
      }
    }
  }
  if (!mpr) return null;
  const units = new Map<string, string>();
  const contents = base.find((e) => isDir(e) && e.name === 'mprcontents');
  if (contents) {
    // mprcontents/<2>/<2>/<id>.mxunit; the folders' trees are kept, so a commit that changed one
    // document reads only the trees on that document's path.
    const l1 = (await blobs.tree(contents.sha)) ?? [];
    const l2 = await Promise.all(l1.filter(isDir).map((d) => blobs.tree(d.sha)));
    const l3 = await Promise.all(l2.flatMap((t) => (t ?? []).filter(isDir)).map((d) => blobs.tree(d.sha)));
    for (const t of l3) for (const f of t ?? []) if (!isDir(f) && f.name.endsWith('.mxunit')) units.set(f.name.slice(0, -'.mxunit'.length), f.sha);
  }
  return { mpr: `${prefix}${mpr.name}`, mprBlob: mpr.sha, units };
}
