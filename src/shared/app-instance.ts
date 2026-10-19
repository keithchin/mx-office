// How an office-run app instance (server/app-instance/) comes up, in words both the server and the pages use:
// its boot phases in order, what each is called, and the timing a start leaves behind (a walkthrough's
// manifest keeps it). Pure: no Node imports.

/**
 * A start's phases: waiting for a live app that is building (two cold builds at once starve each other),
 * preparing the recording workspace (kept between runs so mxcli's build and bundle stay warm), the database,
 * mxbuild's build, bundling the web client, and the Mendix runtime coming up.
 */
export type BootPhase = 'waiting' | 'workspace' | 'database' | 'building' | 'bundling' | 'runtime';

export const BOOT_PHASES: readonly BootPhase[] = ['waiting', 'workspace', 'database', 'building', 'bundling', 'runtime'];

/** What the page says while a phase runs ("Bundling the web client"). */
export const BOOT_PHASE_TITLE: Record<BootPhase, string> = {
  waiting: 'Waiting for the live app to finish building',
  workspace: 'Updating the recording workspace',
  database: 'Making a fresh database',
  building: 'Building the app',
  bundling: 'Bundling the web client',
  runtime: 'Starting the Mendix runtime',
};

/** How the workspace was got ready: a first copy, the same files kept, or updated in place to a new commit. */
export type WorkspaceHow = 'fresh' | 'reused' | 'updated';

/** What one start of an instance took. */
export interface BootTiming {
  /** From asking to answering. */
  ms: number;
  workspace?: WorkspaceHow;
  /** Milliseconds spent in each phase (a retried start adds both tries). */
  phases: Partial<Record<BootPhase, number>>;
  /** What mxcli itself said the web client bundle took ("Web client bundled in 1m38.9s"). */
  bundleMs?: number;
  /** Why the first try failed when it was tried once more ("bundling the web client timed out after 5m0s"). */
  retried?: string;
}

/** "45 s", "2 min 5 s": a duration as the pages say it. */
export function durationWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
}

/** A Go duration as mxcli prints it ("1m38.933s", "9.05s", "250ms", "1h2m3s") in milliseconds; undefined when it isn't one. */
export function goDurationMs(s: string): number | undefined {
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?$|^(\d+(?:\.\d+)?)ms$/.exec(s.trim());
  if (!m || !s.trim()) return undefined;
  if (m[4] !== undefined) return Math.round(Number(m[4]));
  return Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000);
}

/**
 * What the page says while an instance starts: its phase with the time it has taken ("Bundling the web
 * client · 1 min 12 s (2 min 40 s in all)"). `line` is the start's last word: which live app it waits for,
 * or that it failed once and is trying again.
 */
export function bootProgress(boot: { phase: BootPhase; phaseMs: number; ms: number }, line = ''): string {
  const title = boot.phase === 'waiting' && /^Waiting for/i.test(line) ? line.replace(/:.*$/, '') : BOOT_PHASE_TITLE[boot.phase];
  const retry = /failed to start once/i.test(line) ? ` · ${line}` : '';
  return `${title} · ${durationWords(boot.phaseMs)} (${durationWords(boot.ms)} in all)${retry}`;
}
