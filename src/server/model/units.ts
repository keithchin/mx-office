// A commit's model, read straight out of git (blobs.ts) rather than taken out to disk: its .mpr's unit
// table (the .mpr itself, ~100 KB for MPR v2, kept once per version under <data>/model/mpr/ for
// node:sqlite to open) and its units, each known by its git blob hash, which is its content hash. So
// a document that didn't change between two commits has the same hash in both, and everything worked
// out from it (its diagram, its MDL) is found again by that hash (store.ts) instead of read anew.
//
// What each unit's top level says (type, name) is kept by hash too, so indexing a new commit only
// looks at the units it changed; decoded units are kept in a small LRU.

import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { GitBlobs, modelFiles, type BlobsOptions, type ModelFiles } from './blobs.js';
import type { BsonDoc } from './bson.js';
import { indexUnits, readUnitRows, type UnitIndex, type UnitMeta } from './mpr.js';

export interface CommitModel {
  sha: string;
  files: ModelFiles;
  v1: boolean;
  ix: UnitIndex;
  /** The content hash of a document (`${kind}:${qn}`), or '' when there's no such document. */
  hashOf(key: string): string;
  /** A hash of what the App Explorer shows (see `structureOf`): equal for two commits with the same tree. */
  structure: string;
}

const COMMITS_MAX = 8;
const DECODED_MAX = 96;
const MPR_KEEP = 48;
const MPR_MAX_BYTES = 512 * 1024 * 1024;

/**
 * Units whose contents the tree doesn't show (only their name is in it): editing a microflow or a page
 * leaves the tree as it was. Any other unit's contents count (a domain model's entities and
 * associations, module roles, navigation, …), and so does an unknown kind, to be safe.
 */
const LEAF_TYPES = new Set([
  'Microflows$Microflow',
  'Microflows$Nanoflow',
  'Microflows$Rule',
  'Forms$Page',
  'Forms$Snippet',
  'Forms$Layout',
  'Forms$BuildingBlock',
  'Forms$PageTemplate',
  'JavaActions$JavaAction',
  'JavaScriptActions$JavaScriptAction',
  'Constants$Constant',
  'Enumerations$Enumeration',
  'Images$ImageCollection',
  'JsonStructures$JsonStructure',
  'ImportMappings$ImportMapping',
  'ExportMappings$ExportMapping',
  'RegularExpressions$RegularExpression',
  'ScheduledEvents$ScheduledEvent',
  'Workflows$Workflow',
]);

/** The tree's key: every unit's id, container, type and name, and the contents of those that aren't leaves. */
export function structureOf(ix: UnitIndex): string {
  const h = createHash('sha1');
  for (const u of [...ix.units.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) h.update(`${u.id}|${u.container}|${u.type}|${u.name}|${LEAF_TYPES.has(u.type) ? '' : u.hash}\n`);
  return h.digest('hex');
}

export class ModelUnits {
  private meta: UnitMeta = new Map();
  private commits = new Map<string, Promise<CommitModel | null>>();
  private readers = new Map<string, GitBlobs>();
  private decoded = new Map<string, BsonDoc>();
  private writing = new Map<string, Promise<void>>();
  readonly mprDir: string;

  constructor(root: string, private blobOpts: BlobsOptions = {}) {
    this.mprDir = path.join(root, 'mpr');
  }

  /** The object reader of the repository in `dir`. */
  blobs(dir: string): GitBlobs {
    let b = this.readers.get(dir);
    if (!b) this.readers.set(dir, (b = new GitBlobs(dir, this.blobOpts)));
    return b;
  }

  /** The model at commit `sha` of the repository in `dir`; null when the commit has no .mpr or node:sqlite is missing. */
  commit(dir: string, sha: string): Promise<CommitModel | null> {
    const key = `${dir}|${sha}`;
    let c = this.commits.get(key);
    if (c) {
      this.commits.delete(key);
      this.commits.set(key, c);
      return c;
    }
    c = this.load(dir, sha);
    this.commits.set(key, c);
    c.catch(() => this.commits.delete(key));
    while (this.commits.size > COMMITS_MAX) this.commits.delete(this.commits.keys().next().value as string);
    return c;
  }

  /** Lets go of the readers (shutdown, tests). */
  close() {
    for (const b of this.readers.values()) b.close();
    this.readers.clear();
  }

  private async load(dir: string, sha: string): Promise<CommitModel | null> {
    const blobs = this.blobs(dir);
    const files = await modelFiles(blobs, sha);
    if (!files) throw new Error('no Mendix project (.mpr) in this commit');
    const mprFile = await this.mprCopy(blobs, files.mprBlob);
    const table = await readUnitRows(mprFile);
    if (!table) return null;
    const v1 = table.v1;
    const v1Units = new Map(table.rows.filter((r) => r.contents).map((r) => [r.id, r.contents as Uint8Array]));
    const hashOfRow = (r: { id: string; hash: string; contents?: Uint8Array }) => (v1 ? r.hash || (r.contents ? createHash('sha1').update(r.contents).digest('hex') : '') : files.units.get(r.id) ?? '');
    const readRaw = async (id: string) => (v1 ? v1Units.get(id) ?? null : files.units.has(id) ? blobs.blob(files.units.get(id) as string) : null);
    const ix = await indexUnits(table.rows, readRaw, hashOfRow, this.meta);
    const plainRead = ix.read.bind(ix);
    ix.read = async (id: string) => {
      const h = ix.units.get(id)?.hash;
      const known = h ? this.decoded.get(h) : undefined;
      if (known) return known;
      const d = await plainRead(id);
      if (d && h) {
        this.decoded.set(h, d);
        while (this.decoded.size > DECODED_MAX) this.decoded.delete(this.decoded.keys().next().value as string);
      }
      return d;
    };
    return {
      sha,
      files,
      v1,
      ix,
      hashOf: (key) => {
        const id = ix.byName.get(key);
        return (id && ix.units.get(id)?.hash) || '';
      },
      structure: structureOf(ix),
    };
  }

  /** The .mpr with blob `blob`, on disk (written once) for node:sqlite to read. */
  private async mprCopy(blobs: GitBlobs, blob: string): Promise<string> {
    const file = path.join(this.mprDir, `${blob}.mpr`);
    let w = this.writing.get(blob);
    if (!w && existsSync(file)) return file;
    if (!w) {
      w = (async () => {
        const data = await blobs.blob(blob);
        if (!data) throw new Error('the .mpr is missing from git');
        await mkdir(this.mprDir, { recursive: true });
        // Written aside and renamed, so a half-written copy is never opened.
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, data);
        await rename(tmp, file);
        void this.prune();
      })().finally(() => this.writing.delete(blob));
      this.writing.set(blob, w);
    }
    await w;
    return file;
  }

  /** Keeps the newest MPR_KEEP .mpr copies under MPR_MAX_BYTES. */
  async prune(): Promise<void> {
    const names = (await readdir(this.mprDir).catch(() => [] as string[])).filter((n) => n.endsWith('.mpr'));
    const files = (await Promise.all(names.map(async (n) => ({ p: path.join(this.mprDir, n), s: await stat(path.join(this.mprDir, n)).catch(() => null) })))).filter((f) => f.s?.isFile()).sort((a, b) => (b.s?.mtimeMs ?? 0) - (a.s?.mtimeMs ?? 0));
    let total = 0;
    for (const [i, f] of files.entries()) {
      total += f.s?.size ?? 0;
      if (i >= MPR_KEEP || total > MPR_MAX_BYTES) await rm(f.p, { force: true }).catch(() => {});
    }
  }
}
