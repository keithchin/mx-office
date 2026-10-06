// A toolkit project's machine-local settings (<floor>/.claude/toolkit.env: MXBUILD_PATH, MXCLI_VERSION,
// PYTHON and so on), put into the environment of what the office starts for that floor. The
// mxcli-project-toolkit's scripts let a variable already in the environment win over the project's
// file, so an MXBUILD_PATH the office itself was started with (pointing at another Studio Pro, say)
// would otherwise build every project with that one mxbuild. The file is git-ignored, so a worker's
// worktree never has it: it's always read from the floor's own checkout.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The file, relative to a floor's checkout. */
export const TOOLKIT_ENV_FILE = path.join('.claude', 'toolkit.env');

/** Keys the file never replaces: the office's own PATH and its own settings. */
const KEPT = (key: string) => key.toUpperCase() === 'PATH' || key.startsWith('AGENT_OFFICE_');

/**
 * KEY=VALUE lines, read as the toolkit's _common.sh reads them: blank lines and # comments skipped,
 * an `export ` in front allowed, the value trimmed and one pair of surrounding quotes taken off.
 * Values stay as written (Windows paths too: the toolkit turns them into Git Bash's form itself).
 * A key with an empty value is left out, so it never blanks out what the environment has.
 */
export function parseToolkitEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || KEPT(key)) continue;
    let val = line.slice(line.indexOf('=') + 1).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) val = val.slice(1, -1).trim();
    if (val) out[key] = val;
  }
  return out;
}

/** What a floor's toolkit.env sets; nothing when the floor has no such file (not a toolkit project, or not set up on this machine). */
export function floorToolkitEnv(floorDir: string): Record<string, string> {
  try {
    return parseToolkitEnv(readFileSync(path.join(floorDir, TOOLKIT_ENV_FILE), 'utf8'));
  } catch {
    return {};
  }
}

/** `env` with the floor's toolkit.env laid over it (its keys win over the inherited ones); `env` itself is left as it is. */
export function withFloorToolkitEnv<T extends Record<string, string | undefined>>(floorDir: string, env: T, win = process.platform === 'win32'): T {
  const over = floorToolkitEnv(floorDir);
  const keys = Object.keys(over);
  const out: Record<string, string | undefined> = { ...env };
  // Windows spells a variable in any case (Path, Mxbuild_Path), and a child handed two spellings gets either one.
  if (win) for (const k of Object.keys(out)) if (!(k in over) && keys.some((o) => o.toUpperCase() === k.toUpperCase())) delete out[k];
  return Object.assign(out, over) as T;
}
