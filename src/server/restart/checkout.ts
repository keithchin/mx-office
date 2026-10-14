// The office's own checkout (the one `npm run build` builds), and the commit it's at: what 🔁 Restart
// safely builds from (office.ts) and what stands in for a build-info.json that isn't there (build.ts).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headSha as fastHead } from '../gitfiles.js';

let app: string | undefined;

/** The folder with the office's package.json, above this module. */
export function appDir(): string {
  if (app) return app;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return (app = dir);
    } catch {
      // keep looking
    }
  }
  return (app = process.cwd());
}

/** The checkout's HEAD: read from its files when they settle it (gitfiles.ts), else from git. */
export function headSha(dir = appDir()): string | undefined {
  const fast = fastHead(dir);
  if (fast !== null) return fast;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() || undefined;
  } catch {
    return undefined;
  }
}
