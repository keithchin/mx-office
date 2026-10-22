// Where psql usually is on a Mac when it isn't on PATH (liveapp/process.ts pgBinDir): Postgres.app's
// newest version, then Homebrew's keg-only postgresql@<n> formulas (`brew install postgresql@17` doesn't
// link psql onto PATH), newest first, on Apple silicon (/opt/homebrew) and Intel (/usr/local).

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const POSTGRES_APP_BIN = '/Applications/Postgres.app/Contents/Versions/latest/bin';
export const BREW_OPT_DIRS = ['/opt/homebrew/opt', '/usr/local/opt'];

/** The version in a Homebrew formula's folder name: postgresql@17 → 17, plain postgresql → 0 (whatever it links). */
const formulaVersion = (name: string) => Number(/^postgresql(?:@(\d+(?:\.\d+)?))?$/.exec(name)?.[1] ?? 0);

/** The first folder with psql in it, or undefined. */
export function macPgBinDir(d: { exists(p: string): boolean; readdir(p: string): string[] } = { exists: existsSync, readdir: (p) => readdirSync(p) }): string | undefined {
  if (d.exists(path.posix.join(POSTGRES_APP_BIN, 'psql'))) return POSTGRES_APP_BIN;
  for (const opt of BREW_OPT_DIRS) {
    let names: string[] = [];
    try {
      names = d.readdir(opt).filter((n) => /^postgresql(@\d+(\.\d+)?)?$/.test(n));
    } catch {
      continue;
    }
    names.sort((a, b) => formulaVersion(b) - formulaVersion(a));
    for (const n of names) {
      const bin = path.posix.join(opt, n, 'bin');
      if (d.exists(path.posix.join(bin, 'psql'))) return bin;
    }
  }
  return undefined;
}
