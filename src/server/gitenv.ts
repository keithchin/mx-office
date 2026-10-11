// Long paths for every git the office starts, whatever any config says. A Mendix app's javascriptsource
// carries npm packages whose paths pass Windows' 260 characters once checked out under a floor's
// .agent-office/worktrees, and git for Windows refuses them ("Filename too long") unless core.longpaths
// is on. Setting it in each repository's own config (longpaths.ts) wasn't enough: a floor cloned before
// that code shipped never got it, because the only place that backfilled it, a worker's worktree, sat
// behind the hire's pause check (equipment-rental, release 21, 2026-10-08..11).
//
// So the setting goes in through the environment: git (2.31 and later) reads GIT_CONFIG_COUNT /
// GIT_CONFIG_KEY_<n> / GIT_CONFIG_VALUE_<n> as command-line config (`git -c`), above every config file.
// The office puts it in its own process.env once, at start (cli.ts imports this module first; the other
// git paths import it too), so every child inherits it: git itself, gh (which runs git for `gh repo
// clone`), the toolkit's bash scripts, and the agents' Claude sessions with the git they run (their
// environment is the office's, workers/env.ts). Off Windows nothing changes.

/** The config this adds: core.longpaths=true. */
export const LONGPATHS_KEY = 'core.longpaths';

const countOf = (env: NodeJS.ProcessEnv): number => {
  const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Whether `env` already hands git core.longpaths=true through GIT_CONFIG_*. */
export function hasLongPathsEnv(env: NodeJS.ProcessEnv): boolean {
  const n = countOf(env);
  for (let i = 0; i < n; i++) if ((env[`GIT_CONFIG_KEY_${i}`] ?? '').toLowerCase() === LONGPATHS_KEY && /^(true|yes|on|1)$/i.test(env[`GIT_CONFIG_VALUE_${i}`] ?? '')) return true;
  return false;
}

/**
 * `env` with core.longpaths=true added to its GIT_CONFIG_* list (after whatever is there, so nothing
 * else it says is lost), on Windows; as it is elsewhere or when it's there already. Changes `env`.
 */
export function withGitLongPaths<E extends Record<string, string | undefined>>(env: E, platform: NodeJS.Platform = process.platform): E {
  if (platform !== 'win32' || hasLongPathsEnv(env)) return env;
  const n = countOf(env);
  const e = env as Record<string, string | undefined>;
  e[`GIT_CONFIG_KEY_${n}`] = LONGPATHS_KEY;
  e[`GIT_CONFIG_VALUE_${n}`] = 'true';
  e.GIT_CONFIG_COUNT = String(n + 1);
  return env;
}

/** Puts it in the office's own environment (once; every child started after inherits it). */
export function installGitLongPaths(platform: NodeJS.Platform = process.platform) {
  withGitLongPaths(process.env, platform);
}

installGitLongPaths();
