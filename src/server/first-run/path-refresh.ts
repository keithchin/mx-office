// After first-run setup installs a program, the office reads PATH again from where Windows keeps it
// (the machine's and the user's, with `reg query`, read only) and adds the folders it didn't have to
// its own, so the new program is found without a restart. Its own folders stay first and none is ever
// taken away. Pure parsing here; the reading is in fix-machine.ts.

/** The value of `reg query <key> /v Path`, undefined when there's none. */
export function parseRegPath(out: string): string | undefined {
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out);
  return m?.[1]?.trim() || undefined;
}

/** %VAR% expanded from `env` (names any case, as Windows does); an unknown one is left as it is. */
export function expandVars(s: string, env: NodeJS.ProcessEnv): string {
  const keys = Object.keys(env);
  return s.replace(/%([^%;]+)%/g, (all, name: string) => {
    const k = keys.find((x) => x.toUpperCase() === name.toUpperCase());
    return k && env[k] !== undefined ? env[k]! : all;
  });
}

const norm = (d: string) => d.replace(/^"|"$/g, '').replace(/[\\/]+$/, '').toLowerCase();

/** `current` with every folder of `fresh` it lacks added at the end: the new value and what was added. */
export function mergePath(current: string, fresh: readonly string[]): { value: string; added: string[] } {
  const have = current.split(';').filter(Boolean);
  const seen = new Set(have.map(norm));
  const added: string[] = [];
  for (const d of fresh.flatMap((f) => f.split(';')).map((x) => x.trim()).filter(Boolean)) {
    if (seen.has(norm(d))) continue;
    seen.add(norm(d));
    added.push(d);
  }
  return { value: [...have, ...added].join(';'), added };
}

export const MACHINE_ENV_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
export const USER_ENV_KEY = 'HKCU\\Environment';
