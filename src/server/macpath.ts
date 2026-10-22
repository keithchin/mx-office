// The usual program folders on the office's PATH on macOS. A Mac program started from Finder, the Dock or
// the desktop app (not from a terminal) gets launchd's PATH, /usr/bin:/bin:/usr/sbin:/sbin, without
// Homebrew's folders, where git, node, gh, jq, a newer bash and PostgreSQL usually are, nor Claude Code's
// ~/.local/bin. The office puts the ones that exist at the end of its own PATH once, at start (cli.ts
// imports this module first, like gitenv.ts), so every program it and its agents start finds them; what
// was already on PATH stays first. Off macOS nothing changes.

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where macOS programs usually are, in order: Homebrew on Apple silicon, Homebrew on Intel / other installers, Claude Code's own. */
export const macPathDirs = (home: string): string[] => ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', path.posix.join(home, '.local', 'bin')];

/** `env` with each of macPathDirs that exists and isn't on its PATH added at the end, on macOS. Changes `env`. */
export function withMacPath<E extends Record<string, string | undefined>>(env: E, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync, home: string = os.homedir()): E {
  if (platform !== 'darwin') return env;
  const e = env as Record<string, string | undefined>;
  const have = (e.PATH ?? '').split(':').filter(Boolean);
  const add = macPathDirs(home).filter((d) => !have.includes(d) && exists(d));
  if (add.length) e.PATH = [...have, ...add].join(':');
  return env;
}

withMacPath(process.env);
