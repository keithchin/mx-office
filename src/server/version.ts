import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout this server runs from: the folder with the office's package.json. */
function findAppDir(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return dir;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/**
 * What the running server is: its commit, or the package version outside a git checkout. Pages
 * compare it after a reconnect, so a restart onto a new build (git pull, `npm run build`, Restart
 * safely) loads the new client.
 */
export function officeVersion(): string {
  const dir = findAppDir() ?? process.cwd();
  if (existsSync(path.join(dir, '.git'))) {
    try {
      const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (sha) return sha;
    } catch {
      // not a usable checkout: fall back to the package version
    }
  }
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
