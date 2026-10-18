// The database of an office-run app instance (./index.ts): a name of its own for every run, never the live
// app's (`<project>_live`, liveapp/config.ts databaseName), made by `mxcli run --ensure-db` on the first
// start and dropped again when the instance stops. Leftovers of a run the office never finished (a crash,
// a kill) are dropped before the next one of the same purpose starts. psql runs off the event loop with
// PGPASSWORD in its environment, never on its command line; nothing here prints the password.

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { execFileOffP, type OffError } from '../offloop/exec.js';
import { databaseName } from '../liveapp/config.js';
import { pgBinDir } from '../liveapp/process.js';

export interface DbConn {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Runs one SQL statement against the server's `postgres` database; gives back stdout (unaligned, tuples only). */
export type Psql = (sql: string, db: DbConn) => Promise<string>;

/** A name PostgreSQL takes as it is (so it can be quoted safely): lower case, digits, underscores. */
const SAFE = /^[a-z_][a-z0-9_]{0,62}$/;

/** The stem every run of one purpose of one project shares: `<project>_<purpose>_`. */
export function instanceDbStem(floorId: string, purpose: string): string {
  const live = databaseName(floorId).replace(/_live$/, '');
  const p = purpose.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 8) || 'run';
  return `${live.slice(0, 63 - p.length - 8)}_${p}_`;
}

/** A fresh database name for one run: `<project>_<purpose>_<6 random>`, never the live app's. */
export function instanceDbName(floorId: string, purpose: string, rand = () => randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6)): string {
  const name = `${instanceDbStem(floorId, purpose)}${rand()}`;
  if (!SAFE.test(name) || name === databaseName(floorId)) throw new Error(`not a safe database name: ${name}`);
  return name;
}

/** The real psql (PostgreSQL's bin folder found the way the live app finds it). */
export const realPsql: Psql = async (sql, db) => {
  const bin = pgBinDir();
  const exe = bin ? path.join(bin, process.platform === 'win32' ? 'psql.exe' : 'psql') : 'psql';
  try {
    const { stdout } = await execFileOffP(exe, ['-h', db.host, '-p', String(db.port), '-U', db.user, '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      env: { ...process.env, PGPASSWORD: db.password, PGCONNECT_TIMEOUT: '10' },
      timeout: 60_000,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as OffError;
    throw new Error(`psql: ${(e.stderr || e.message || '').trim().split('\n').slice(-1)[0]?.replaceAll(db.password, '***') ?? 'failed'}`);
  }
};

/** Drops a database the instance made (and nothing else: only names of the instance shape). */
export async function dropDb(psql: Psql, db: DbConn, name: string): Promise<void> {
  if (!SAFE.test(name)) throw new Error(`not a safe database name: ${name}`);
  try {
    await psql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`, db);
  } catch (err) {
    // PostgreSQL before 13 has no FORCE.
    if (!/syntax error|FORCE/i.test((err as Error).message)) throw err;
    await psql(`DROP DATABASE IF EXISTS "${name}"`, db);
  }
}

/** Drops what earlier runs of this stem left behind (best effort); never `keep`. Returns what it dropped. */
export async function dropLeftovers(psql: Psql, db: DbConn, stem: string, keep?: string): Promise<string[]> {
  if (!SAFE.test(`${stem}x`)) return [];
  const like = stem.replace(/_/g, '\\_');
  const out = await psql(`SELECT datname FROM pg_database WHERE datname LIKE '${like}%'`, db).catch(() => '');
  const shape = new RegExp(`^${stem}[a-z0-9]{6}$`);
  const names = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((n) => shape.test(n) && n !== keep);
  const dropped: string[] = [];
  for (const n of names) if (await dropDb(psql, db, n).then(() => true, () => false)) dropped.push(n);
  return dropped;
}
