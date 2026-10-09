// Made-up Mendix projects for the Model tab's tests: a small BSON writer for units, and an MPR v2
// project (the unit table in an SQLite .mpr, each unit's BSON in mprcontents/) on disk.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { guidOf } from '../../src/server/model/bson.js';

export type V = string | number | boolean | null | V[] | { [k: string]: V } | Uint8Array;

export function bson(doc: Record<string, V>): Buffer {
  const parts: Buffer[] = [];
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
  for (const [k, v] of Object.entries(doc)) {
    if (v instanceof Uint8Array) {
      const len = Buffer.alloc(4);
      len.writeInt32LE(v.length);
      parts.push(Buffer.from([0x05]), cstr(k), len, Buffer.from([0]), Buffer.from(v));
    } else if (typeof v === 'string') {
      const s = Buffer.from(v, 'utf8');
      const len = Buffer.alloc(4);
      len.writeInt32LE(s.length + 1);
      parts.push(Buffer.from([0x02]), cstr(k), len, s, Buffer.from([0]));
    } else if (typeof v === 'number') {
      const b = Buffer.alloc(4);
      b.writeInt32LE(v);
      parts.push(Buffer.from([0x10]), cstr(k), b);
    } else if (typeof v === 'boolean') parts.push(Buffer.from([0x08]), cstr(k), Buffer.from([v ? 1 : 0]));
    else if (v === null) parts.push(Buffer.from([0x0a]), cstr(k));
    else if (Array.isArray(v)) parts.push(Buffer.from([0x04]), cstr(k), bson(Object.fromEntries(v.map((x, i) => [String(i), x]))));
    else parts.push(Buffer.from([0x03]), cstr(k), bson(v as Record<string, V>));
  }
  const body = Buffer.concat(parts);
  const len = Buffer.alloc(4);
  len.writeInt32LE(body.length + 5);
  return Buffer.concat([len, body, Buffer.from([0])]);
}

export const guidBytes = (n: number) => {
  const b = new Uint8Array(16);
  b[0] = n;
  b[15] = 0xab;
  return b;
};

export const guid = (n: number) => guidOf(guidBytes(n));

export interface MadeUnit {
  n: number;
  container: number;
  hash: string;
  doc: Record<string, V>;
}

export async function hasSqlite(): Promise<boolean> {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/** A made-up MPR v2 project in `dir` (App.mpr and mprcontents/); `dir` is cleared of old units first by the caller. */
export async function project(dir: string, units: MadeUnit[]): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'App.mpr'));
  db.exec('DROP TABLE IF EXISTS Unit');
  db.exec('CREATE TABLE Unit (UnitID BLOB PRIMARY KEY NOT NULL, ContainerID BLOB, ContainmentName TEXT, TreeConflict LONG, ContentsHash TEXT, ContentsConflicts TEXT)');
  const ins = db.prepare('INSERT INTO Unit VALUES (?, ?, ?, 0, ?, ?)');
  for (const u of units) {
    ins.run(guidBytes(u.n), guidBytes(u.container), '', u.hash, '');
    const id = guid(u.n);
    const f = path.join(dir, 'mprcontents', id.slice(0, 2), id.slice(2, 4), `${id}.mxunit`);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, bson(u.doc));
  }
  db.close();
  return path.join(dir, 'App.mpr');
}
