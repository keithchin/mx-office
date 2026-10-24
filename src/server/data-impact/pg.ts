// The guard's two touches of the live preview's database, both read-only: a dump (pg_dump, custom format)
// into the office's data folder before a held change is approved, checked by pg_restore --list reading it
// back, with its size and sha256 recorded; and, best effort, how many rows have data in what a finding
// names. Only the project's own database (liveapp/config.ts databaseName), with the live apps' settings.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ImpactFinding } from '../../shared/data-impact.js';

export interface PgTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Where psql, pg_dump and pg_restore are (liveapp/process.ts pgBinDir); PATH when undefined. */
  bin?: string;
}

const tool = (pg: PgTarget, name: string) => (pg.bin ? path.join(pg.bin, process.platform === 'win32' ? `${name}.exe` : name) : name);

function run(pg: PgTarget, name: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(tool(pg, name), ['-h', pg.host, '-p', String(pg.port), '-U', pg.user, ...args], { env: { ...process.env, PGPASSWORD: pg.password, PGCONNECT_TIMEOUT: '5' }, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(`${name}: ${(String(stderr).trim() || err.message).split('\n')[0].slice(0, 200)}`)) : resolve(String(stdout)),
    );
  });
}

export function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Dumps `pg.database` to `file` and checks it: pg_restore must read its table of contents back. */
export async function takeDump(pg: PgTarget, file: string): Promise<{ size: number; sha256: string; verified: string }> {
  mkdirSync(path.dirname(file), { recursive: true });
  await run(pg, 'pg_dump', ['-Fc', '--no-password', '-f', file, '-d', pg.database], 30 * 60_000);
  const size = existsSync(file) ? statSync(file).size : 0;
  if (!size) throw new Error('pg_dump wrote nothing');
  const list = await new Promise<string>((resolve, reject) =>
    execFile(tool(pg, 'pg_restore'), ['--list', file], { timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out, e) => (err ? reject(new Error(`pg_restore --list: ${(String(e).trim() || err.message).split('\n')[0]}`)) : resolve(String(out)))),
  );
  const entries = list.split('\n').filter((l) => l.trim() && !l.startsWith(';')).length;
  if (!entries) throw new Error('pg_restore --list found nothing in the dump');
  return { size, sha256: await sha256Of(file), verified: `pg_restore --list read ${entries} entries` };
}

/** Whether a dump on disk is still the one recorded (same size and sha256): any change voids an approval that relies on it. */
export async function dumpStillThere(file: string, size: number, sha256: string): Promise<string> {
  try {
    if (!existsSync(file)) return 'the database dump is gone';
    if (statSync(file).size !== size) return 'the database dump changed (size)';
    if ((await sha256Of(file)) !== sha256) return 'the database dump changed (sha256)';
    return '';
  } catch (err) {
    return `the database dump can't be read (${(err as Error).message})`;
  }
}

const ID = /^[A-Za-z0-9_]+$/;

/** The query that counts the rows with data in what a finding names, or undefined (enumeration values, odd names). */
export function countQuery(f: ImpactFinding): string | undefined {
  const parts = f.element.split('.');
  if (!parts.every((p) => ID.test(p))) return undefined;
  const table = (m: string, e: string) => `"${`${m}$${e}`.toLowerCase()}"`;
  if (f.kind.startsWith('entity-') || f.kind === 'generalization') return parts.length === 2 ? `select count(*) from ${table(parts[0], parts[1])}` : undefined;
  if (f.kind.startsWith('attribute-')) return parts.length === 3 ? `select count(*) from ${table(parts[0], parts[1])} where "${parts[2].toLowerCase()}" is not null` : undefined;
  if (f.kind.startsWith('association-') || f.kind === 'delete-behaviour') return parts.length === 2 ? `select count(*) from ${table(parts[0], parts[1])}` : undefined;
  return undefined;
}

/** Fills each finding's `rows` where the database answers; quietly leaves it out where it doesn't. */
export async function countRows(pg: PgTarget, findings: ImpactFinding[]): Promise<void> {
  const todo = findings.slice(0, 24).filter((f) => countQuery(f));
  for (let i = 0; i < todo.length; i += 4)
    await Promise.all(
      todo.slice(i, i + 4).map(async (f) => {
        try {
          const n = Number((await run(pg, 'psql', ['-d', pg.database, '-At', '--no-password', '-c', countQuery(f)!], 15_000)).trim());
          if (Number.isFinite(n)) f.rows = n;
        } catch {
          // No such table or column (already gone, never synced), or no database: no count.
        }
      }),
    );
}
