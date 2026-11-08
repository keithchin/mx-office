// The readiness check's look at the app's model in the folder as it is now (committed or not): the Mendix
// version it was saved with, its size (app modules only) and whether demo users are on. The .mpr is copied to
// a temporary folder first and opened there read-only, so nothing (no SQLite journal, no lock) ever lands in the
// project folder; MPR v2's units are read from its mprcontents/ in place (plain file reads). Names and counts
// only: never a demo user's password.

import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { list, str, type BsonDoc } from '../model/bson.js';
import { indexUnits, readUnitRows, unitFile } from '../model/mpr.js';
import { marketplaceOf } from '../app-explorer/business.js';
import type { ReadyModelStats } from '../../shared/expert-ready.js';

/** An .mpr bigger than this (an MPR v1 with every unit inside) isn't copied: version only from the original. */
const COPY_MAX = 300 * 1024 * 1024;

export interface ModelLook {
  version?: string;
  stats?: ReadyModelStats;
  /** Undefined when the project security couldn't be read. */
  demo?: { on: boolean; count: number };
  /** Why the model couldn't be read, when it couldn't. */
  problem?: string;
}

const require = createRequire(import.meta.url);

function versionOf(file: string): string | undefined {
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const row = db.prepare('SELECT _ProductVersion AS v FROM _MetaData LIMIT 1').get() as { v?: unknown } | undefined;
      return typeof row?.v === 'string' && /^\d+(\.\d+)+$/.test(row.v) ? row.v : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** Reads the model of the project whose .mpr is `mpr`. Never throws, never writes beside it. */
export async function lookAtModel(mpr: string): Promise<ModelLook> {
  let size = 0;
  try {
    size = (await stat(mpr)).size;
  } catch {
    return { problem: 'The .mpr file could not be read' };
  }
  if (size > COPY_MAX) return { problem: 'The .mpr file is too big to read here' };
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mx-ready-'));
  try {
    const copy = path.join(tmp, 'app.mpr');
    await copyFile(mpr, copy);
    const out: ModelLook = {};
    const version = versionOf(copy);
    if (version) out.version = version;
    const table = await readUnitRows(copy).catch(() => null);
    if (!table) return { ...out, problem: 'The model could not be read (node:sqlite is missing or the file is not a Mendix project)' };
    const projectDir = path.dirname(mpr);
    const inside = new Map(table.rows.filter((r) => r.contents).map((r) => [r.id, r.contents as Uint8Array]));
    const readRaw = async (id: string): Promise<Uint8Array | null> => (table.v1 ? inside.get(id) ?? null : readFile(unitFile(projectDir, id)).catch(() => null));
    const ix = await indexUnits(table.rows, readRaw);
    // App modules: not System, not from the Marketplace (their own flag, never their name).
    const modules = new Map<string, boolean>();
    for (const u of ix.units.values()) {
      if (u.type !== 'Projects$ModuleImpl' && u.type !== 'Projects$Module') continue;
      if (u.name === 'System') continue;
      modules.set(u.id, !marketplaceOf(await ix.read(u.id)).addon);
    }
    const moduleOf = (id: string): string | undefined => {
      let cur = ix.units.get(id);
      for (let i = 0; cur && i < 64; i++) {
        if (modules.has(cur.id)) return cur.id;
        if (!cur.container || cur.container === cur.id) return undefined;
        cur = ix.units.get(cur.container);
      }
      return undefined;
    };
    const stats: ReadyModelStats = { modules: [...modules.values()].filter(Boolean).length, entities: 0, microflows: 0, pages: 0 };
    let security: BsonDoc | null = null;
    for (const u of ix.units.values()) {
      if (u.type === 'Security$ProjectSecurity') {
        security = await ix.read(u.id);
        continue;
      }
      const m = moduleOf(u.id);
      if (!m || !modules.get(m)) continue;
      if (u.type === 'Microflows$Microflow') stats.microflows++;
      else if (u.type === 'Forms$Page') stats.pages++;
      else if (u.type === 'DomainModels$DomainModel') stats.entities += list((await ix.read(u.id))?.Entities).length;
    }
    out.stats = stats;
    if (security && typeof security.EnableDemoUsers === 'boolean') out.demo = { on: security.EnableDemoUsers, count: list(security.DemoUsers).filter((d) => str(d.UserName)).length };
    return out;
  } catch (err) {
    return { problem: `The model could not be read: ${(err as Error).message.slice(0, 160)}` };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
