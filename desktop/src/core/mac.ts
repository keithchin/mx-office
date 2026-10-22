// The desktop app on macOS (preview). An app opened from Finder or the Dock gets launchd's PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so the system Node from Homebrew, nvm or Volta, and the git, gh and
// claude the office starts, wouldn't be found. Before it looks for Node the app asks the user's login
// shell for its PATH once ($SHELL -ilc, as a terminal would have it, with a time limit) and adds what's
// missing, then Homebrew's usual folders in case the shell said nothing. Node only, no Electron.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Where macOS programs usually are: Homebrew on Apple silicon, Homebrew on Intel / other installers, Claude Code's own. */
export const macPathDirs = (home: string): string[] => ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', path.posix.join(home, '.local', 'bin')];

/** `current` with each folder of `more` it lacks added at the end (':'-separated, order kept). */
export function mergePath(current: string, more: readonly string[]): string {
  const have = current.split(':').filter(Boolean);
  for (const d of more) if (d && !have.includes(d)) have.push(d);
  return have.join(':');
}

/** The PATH between the markers in a login shell's output (rc files may print other things), or undefined. */
export function parseShellPath(out: string): string | undefined {
  const m = /__MXO_PATH__(.*?)__MXO_END__/s.exec(out);
  const p = m?.[1]?.trim();
  return p && p.includes('/') ? p : undefined;
}

/** The login shell's PATH: `$SHELL -ilc` printing it between markers; undefined when it can't be had in time. */
export function loginShellPath(shell: string | undefined, run: (file: string, args: string[]) => string = (f, a) => execFileSync(f, a, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })): string | undefined {
  try {
    return parseShellPath(run(shell || '/bin/zsh', ['-ilc', 'printf "__MXO_PATH__%s__MXO_END__" "$PATH"']));
  } catch {
    return undefined;
  }
}

/** The PATH the app (and the office it starts) should have on macOS; anywhere else `env.PATH` as it is. */
export function appPath(env: Record<string, string | undefined>, platform: string, home: string, o: { shellPath?: (shell: string | undefined) => string | undefined; exists?: (p: string) => boolean } = {}): string | undefined {
  if (platform !== 'darwin') return env.PATH;
  const shell = (o.shellPath ?? loginShellPath)(env.SHELL);
  const exists = o.exists ?? existsSync;
  const fromShell = shell ? shell.split(':') : [];
  return mergePath(mergePath(env.PATH ?? '', fromShell), macPathDirs(home).filter((d) => exists(d)));
}
