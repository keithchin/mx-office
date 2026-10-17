// <data>/design-systems/: the feature's whole state. index.json holds the design systems (their drafts, the
// published versions' status) and the clients' defaults; packages/<id>/v<n>/ holds each published version's
// files, written once into a temporary folder and renamed into place, never written again (immutable). The
// digest is a sha256 over the package's files (sorted path, then bytes), manifest.json aside. No index.json
// → the office behaves as before design systems: deleting the folder is the rollback. Read once
// (asynchronously), written with the acknowledged critical write, changes serialised.

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadJson } from '../durable/read.js';
import { writeJsonCritical } from '../flow/critical-write.js';
import { cleanInput, tokensCss } from '../../shared/design/tokens.js';
import { PATTERNS, patternMarkdown } from '../../shared/design/patterns.js';
import { BRANDED_GAPS, summaryMarkdown } from '../../shared/design/context.js';
import { isDesignId, mintDesignId, PRESET, type Compat, type DesignDefault, type DesignInput, type DesignKind, type DesignOwner, type DesignSystem, type PackageManifest, type VersionEntry } from '../../shared/design/types.js';
import { isPortfolioId } from '../../shared/portfolios.js';

interface IndexFile {
  version: 1;
  systems: DesignSystem[];
  defaults: Record<string, DesignDefault>;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanIndex(raw: unknown): IndexFile {
  const r = (raw ?? {}) as Partial<IndexFile>;
  const systems: DesignSystem[] = [];
  for (const s of Array.isArray(r.systems) ? r.systems : []) {
    if (!s || !isDesignId(s.id)) continue;
    const versions = (Array.isArray(s.versions) ? s.versions : []).filter((v) => v && Number.isInteger(v.n) && v.n > 0 && typeof v.digest === 'string');
    const owner: DesignOwner = isPortfolioId(s.owner?.client) ? { client: s.owner.client } : typeof s.owner?.floor === 'string' ? { floor: s.owner.floor } : {};
    systems.push({ id: s.id, name: str(s.name, 80) || 'Design system', kind: s.kind === 'atlas' ? 'atlas' : 'branded', owner, ...(s.draft ? { draft: cleanInput(s.draft) } : {}), versions, createdAt: Number(s.createdAt) || 0, createdBy: str(s.createdBy, 80) });
  }
  const defaults: Record<string, DesignDefault> = {};
  for (const [k, d] of Object.entries(r.defaults ?? {})) if (isPortfolioId(k) && d && isDesignId(d.systemId) && Number.isInteger(d.n)) defaults[k] = { systemId: d.systemId, n: d.n };
  return { version: 1, systems, defaults };
}

/** The package's files (relative path → text), manifest.json aside: what the digest covers. */
export function packageFiles(name: string, kind: DesignKind, input: DesignInput): Record<string, string> {
  const files: Record<string, string> = { 'input.json': `${JSON.stringify({ kind, ...input }, null, 2)}\n` };
  if (kind === 'branded') files['tokens.css'] = tokensCss(name, input);
  for (const p of PATTERNS) files[`patterns/${p.id}.md`] = patternMarkdown(p);
  return files;
}

export function digestOf(files: Record<string, string>): string {
  const h = createHash('sha256');
  for (const k of Object.keys(files).sort()) h.update(`${k}\0${Buffer.byteLength(files[k])}\0`).update(files[k]);
  return h.digest('hex');
}

/** `acme-3f2a91c0`: lower-case letters and digits from the name, then the digest's first 8 characters. */
export function themeNameOf(name: string, digest: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'design';
  return `${/^[a-z]/.test(slug) ? slug : `ds-${slug}`}-${digest.slice(0, 8)}`;
}

export class DesignStore {
  readonly root: string;
  private loaded?: Promise<IndexFile>;
  private data: IndexFile = { version: 1, systems: [], defaults: {} };
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string, private now: () => number = Date.now) {
    this.root = path.join(dataDir, 'design-systems');
  }

  get file() {
    return path.join(this.root, 'index.json');
  }

  load(): Promise<IndexFile> {
    // Only a missing file is "none"; a locked one rejects and is read again next time (durable/read.ts).
    this.loaded ??= loadJson(this.file, (v) => (v === undefined ? this.data : (this.data = cleanIndex(v))), () => (this.loaded = undefined));
    return this.loaded;
  }

  systems(): readonly DesignSystem[] {
    return this.data.systems;
  }

  get(id: string): DesignSystem | undefined {
    return this.data.systems.find((s) => s.id === id);
  }

  /** The (one) design system an owner has in this increment. */
  ofOwner(owner: DesignOwner): DesignSystem | undefined {
    return this.data.systems.find((s) => (owner.client ? s.owner.client === owner.client : !!owner.floor && s.owner.floor === owner.floor));
  }

  defaultOf(client: string): DesignDefault | undefined {
    return this.data.defaults[client];
  }

  packageDir(id: string, n: number): string {
    return path.join(this.root, 'packages', id, `v${n}`);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      await this.load();
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private save(): Promise<void> {
    return writeJsonCritical(this.file, this.data);
  }

  /** Saves the owner's draft (making its design system the first time). Never touches a published version. */
  saveDraft(owner: DesignOwner, kind: DesignKind, input: DesignInput, by: string): Promise<DesignSystem | string> {
    return this.serial(async () => {
      if (!owner.client && !owner.floor) return 'Say which client or project owns it';
      const clean = cleanInput(input);
      let s = this.ofOwner(owner);
      if (!s) {
        s = { id: mintDesignId(this.now()), name: clean.name || 'Design system', kind, owner, versions: [], createdAt: this.now(), createdBy: str(by, 80) };
        this.data.systems.push(s);
      }
      s.kind = kind;
      if (clean.name) s.name = clean.name;
      s.draft = { ...clean, name: clean.name || s.name };
      await this.save();
      return s;
    });
  }

  /**
   * Publishes the draft as the next version: its files written once (a temporary folder renamed into place),
   * the digest over them, status draft until approved. The draft goes; editing again starts a new one.
   */
  publish(id: string, by: string, compat: Compat): Promise<{ system: DesignSystem; manifest: PackageManifest } | string> {
    return this.serial(async () => {
      const s = this.get(id);
      if (!s) return 'No such design system';
      if (!s.draft) return 'Nothing to publish: save a draft first';
      const n = Math.max(0, ...s.versions.map((v) => v.n)) + 1;
      const files = packageFiles(s.name, s.kind, s.draft);
      const digest = digestOf(files);
      const themeName = s.kind === 'branded' ? themeNameOf(s.name, digest) : undefined;
      const manifest: PackageManifest = {
        id: s.id,
        name: s.name,
        kind: s.kind,
        version: n,
        digest,
        owner: s.owner,
        preset: PRESET,
        compat,
        ...(themeName ? { themeName } : {}),
        patterns: PATTERNS.map((p) => ({ id: p.id, version: p.version, file: `patterns/${p.id}.md` })),
        gaps: s.kind === 'branded' ? BRANDED_GAPS : ['Atlas defaults: no brand colours, type or density are applied.'],
        publishedAt: this.now(),
        by: str(by, 80),
      };
      const all = { ...files, 'summary.md': summaryMarkdown(manifest), 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` };
      const dir = this.packageDir(s.id, n);
      if (await stat(dir).then(() => true, () => false)) return `Version ${n} is already there and is never written again`;
      const tmp = `${dir}.${process.pid}.tmp`;
      await rm(tmp, { recursive: true, force: true });
      for (const [rel, text] of Object.entries(all)) {
        const f = path.join(tmp, ...rel.split('/'));
        await mkdir(path.dirname(f), { recursive: true });
        await writeFile(f, text);
      }
      await rename(tmp, dir);
      const entry: VersionEntry = { n, digest, status: 'draft', publishedAt: manifest.publishedAt, by: manifest.by };
      s.versions.push(entry);
      delete s.draft;
      await this.save();
      return { system: s, manifest };
    });
  }

  /** Approves a published version; the one approved before it is superseded. */
  approve(id: string, n: number, by: string): Promise<VersionEntry | string> {
    return this.serial(async () => {
      const s = this.get(id);
      const v = s?.versions.find((x) => x.n === n);
      if (!s || !v) return 'No such version';
      for (const o of s.versions) if (o !== v && o.status === 'approved') o.status = 'superseded';
      v.status = 'approved';
      v.approvedBy = str(by, 80);
      v.approvedAt = this.now();
      await this.save();
      return v;
    });
  }

  /** A published version's form (its input.json), when it's there. */
  async inputOf(id: string, n: number): Promise<DesignInput | undefined> {
    const raw = await readFile(path.join(this.packageDir(id, n), 'input.json'), 'utf8').catch(() => '');
    return raw ? cleanInput(JSON.parse(raw)) : undefined;
  }

  /** Starts a draft from a published version's form (editing a published version never changes it). */
  editFrom(id: string, n: number): Promise<DesignSystem | string> {
    return this.serial(async () => {
      const s = this.get(id);
      if (!s?.versions.some((v) => v.n === n)) return 'No such version';
      const raw = await readFile(path.join(this.packageDir(id, n), 'input.json'), 'utf8').catch(() => '');
      if (!raw) return 'That version’s files are missing';
      s.draft = cleanInput(JSON.parse(raw));
      await this.save();
      return s;
    });
  }

  /** Sets (or clears) a client's default version: an approved one only. New selections only; bindings never move. */
  setDefault(client: string, d: DesignDefault | undefined): Promise<string | undefined> {
    return this.serial(async () => {
      if (!isPortfolioId(client)) return 'No such client';
      if (d) {
        const v = this.get(d.systemId)?.versions.find((x) => x.n === d.n);
        if (!v) return 'No such version';
        if (v.status !== 'approved') return 'Approve the version before making it the default';
        this.data.defaults[client] = { systemId: d.systemId, n: d.n };
      } else delete this.data.defaults[client];
      await this.save();
      return undefined;
    });
  }

  /** A published version's manifest, read from its frozen folder. */
  async manifest(id: string, n: number): Promise<PackageManifest | undefined> {
    try {
      return JSON.parse(await readFile(path.join(this.packageDir(id, n), 'manifest.json'), 'utf8')) as PackageManifest;
    } catch {
      return undefined;
    }
  }

  /** Re-computes a version's digest from its files: the same as published, or the package was changed on disk. */
  async verify(id: string, n: number): Promise<boolean> {
    const dir = this.packageDir(id, n);
    const files: Record<string, string> = {};
    const walk = async (rel: string): Promise<void> => {
      for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(r);
        else if (r !== 'manifest.json' && r !== 'summary.md') files[r] = await readFile(path.join(dir, ...r.split('/')), 'utf8');
      }
    };
    try {
      await walk('');
    } catch {
      return false;
    }
    const v = this.get(id)?.versions.find((x) => x.n === n);
    return !!v && digestOf(files) === v.digest;
  }
}
