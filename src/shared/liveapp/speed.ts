// How fast the live app follows main, and why (server/liveapp/classify.ts, app.ts). Pure, so the office and
// the page say the same thing.
//
// Before an update touches the running app, what changed between the served commit and the target is
// classified from the model units it touched and the other files:
//   - none: no app files changed (docs, journals, evidence, the team's notes): the build that serves is
//     that commit's app already, so nothing restarts;
//   - hot: only pages, snippets, layouts, microflows, nanoflows, rules, folders, texts or the theme: mxcli's
//     hot reload can apply it in place (`mxcli run --watch`), a few seconds instead of a restart;
//   - restart: anything else (a domain model, an enumeration, security, a module, Java, widgets, resources,
//     a file it doesn't know): stop, build, start, as always. On Windows a restart-type change under
//     --watch fails with a file lock and leaves the app answering 404 (the QB0 measurements), so it never
//     goes that way. Unknown is restart.
// And the words for how the last one went: "Updated in 9 s (hot reload)", "Updated in 41 s (restart: domain
// model changed)", with each phase's time.

import type { LiveTimingPhase, LiveUpdate } from '../protocol/liveapp.js';

export type ChangeKind = 'none' | 'hot' | 'restart';

export interface ChangeClass {
  kind: ChangeKind;
  /** "page and logic changes", "domain model changed", "no app files changed". */
  reason: string;
  /** What it touched, for the log: "page Home", "microflow ACT_Save", "theme/web/main.scss" (at most 8). */
  touched: string[];
}

/** One model unit that differs between the two commits ('+' added, '-' removed, '~' changed). */
export interface UnitChange {
  type: string;
  name: string;
  change: '+' | '-' | '~';
}

/** Units mxcli's hot reload applies in place ("page / microflow / text change → hot reload_model"). */
export const HOT_UNIT_TYPES: Readonly<Record<string, string>> = {
  Forms$Page: 'page',
  Forms$Snippet: 'snippet',
  Forms$Layout: 'layout',
  Forms$BuildingBlock: 'building block',
  Forms$PageTemplate: 'page template',
  Microflows$Microflow: 'microflow',
  Microflows$Nanoflow: 'nanoflow',
  Microflows$Rule: 'rule',
  Projects$Folder: 'folder',
  Texts$SystemTextCollection: 'texts',
};

/** Why a unit type needs a restart, in order of what's said first. */
const RESTART_UNIT_REASONS: [RegExp, string][] = [
  [/^DomainModels\$/, 'domain model changed'],
  [/^Enumerations\$/, 'enumeration changed'],
  [/^Security\$/, 'security changed'],
  [/^Projects\$Module/, 'module changed'],
  [/^Settings\$/, 'project settings changed'],
  [/^Navigation\$/, 'navigation changed'],
  [/^JavaActions\$/, 'Java action changed'],
  [/^JavaScriptActions\$/, 'JavaScript action changed'],
  [/^Workflows\$/, 'workflow changed'],
  [/^Constants\$/, 'constant changed'],
];

/** Folders of a Mendix project that its build reads (besides the .mpr and mprcontents/), by what a change there means. */
const APP_DIRS: Readonly<Record<string, ChangeKind>> = {
  theme: 'hot',
  themesource: 'hot',
  javasource: 'restart',
  javascriptsource: 'restart',
  widgets: 'restart',
  userlib: 'restart',
  vendorlib: 'restart',
  resources: 'restart',
};
const DIR_REASONS: Readonly<Record<string, string>> = {
  javasource: 'Java code changed',
  javascriptsource: 'JavaScript actions changed',
  widgets: 'widgets changed',
  userlib: 'libraries changed',
  vendorlib: 'libraries changed',
  resources: 'resources changed',
};

/** Folders and files that are never part of the app: what the team writes beside it. */
const NOT_APP_DIRS = new Set(['docs', 'doc', '.claude', '.github', '.vscode', '.devcontainer', '.agents', 'journals', 'evidence', 'tests', 'test-results', 'walkthroughs', 'design']);
const NOT_APP_FILE = /\.(md|markdown|png|jpe?g|gif|webp|svg|pdf)$/i;

/** What a path (from the repository's top) is to the app whose .mpr is in `prefix` ('' or 'App/'). */
export function pathKind(file: string, prefix: string): { kind: ChangeKind | 'model'; reason?: string } {
  const p = file.replaceAll('\\', '/');
  if (prefix && !p.startsWith(prefix)) return NOT_APP_DIRS.has(p.split('/')[0]) || NOT_APP_FILE.test(p) || !p.includes('/') ? { kind: 'none' } : { kind: 'restart', reason: `other files changed (${p})` };
  const rel = p.slice(prefix.length);
  const top = rel.split('/')[0];
  if (rel.includes('/') && top === 'mprcontents') return { kind: 'model' };
  if (!rel.includes('/') && /\.mpr$/i.test(rel)) return { kind: 'model' };
  if (rel.includes('/') && top in APP_DIRS) return { kind: APP_DIRS[top], ...(DIR_REASONS[top] ? { reason: DIR_REASONS[top] } : {}) };
  if ((rel.includes('/') && NOT_APP_DIRS.has(top)) || NOT_APP_FILE.test(rel)) return { kind: 'none' };
  return { kind: 'restart', reason: `other files changed (${rel})` };
}

/**
 * Which way an update can go, from the files that differ between the served commit and the target
 * (`paths`, from the repository's top) and the model units that differ (`units`; null when the model
 * couldn't be read, which makes any model change a restart).
 */
export function classifyChange(input: { paths: readonly string[]; prefix: string; units: readonly UnitChange[] | null }): ChangeClass {
  const touched: string[] = [];
  const restart: string[] = [];
  let hot = false;
  let model = false;
  let mpr = false;
  for (const f of input.paths) {
    const k = pathKind(f, input.prefix);
    if (k.kind === 'model') {
      model = true;
      if (/\.mpr$/i.test(f)) mpr = true;
    } else if (k.kind === 'hot') {
      hot = true;
      touched.push(f);
    } else if (k.kind === 'restart') restart.push(k.reason ?? `other files changed (${f})`);
  }
  if (model) {
    if (!input.units) restart.unshift("the model couldn't be read");
    else if (!input.units.length && mpr) restart.push('project file changed');
    for (const u of input.units ?? []) {
      const word = HOT_UNIT_TYPES[u.type];
      if (word) {
        hot = true;
        touched.push(`${word}${u.name ? ` ${u.name}` : ''}${u.change === '+' ? ' (new)' : u.change === '-' ? ' (removed)' : ''}`);
        continue;
      }
      const why = RESTART_UNIT_REASONS.find(([re]) => re.test(u.type))?.[1] ?? `${u.type.split('$')[1] ?? u.type} changed`;
      restart.push(why);
      touched.push(`${u.type}${u.name ? ` ${u.name}` : ''}`);
    }
  }
  const cut = touched.slice(0, 8);
  if (restart.length) {
    // The most telling reason first: a domain model before a constant before a stray file.
    const rank = (r: string) => {
      const i = RESTART_UNIT_REASONS.findIndex(([, w]) => w === r);
      return r === "the model couldn't be read" ? -1 : i >= 0 ? i : RESTART_UNIT_REASONS.length;
    };
    return { kind: 'restart', reason: [...restart].sort((a, b) => rank(a) - rank(b))[0], touched: cut };
  }
  if (hot) return { kind: 'hot', reason: 'page and logic changes', touched: cut };
  return { kind: 'none', reason: 'no app files changed', touched: [] };
}

/** "9 s", "1 min 12 s", "0.4 s". */
export function secs(ms: number): string {
  if (ms < 1_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const PHASE_WORDS: Record<LiveTimingPhase, string> = { fetch: 'fetch', classify: 'classify', stop: 'stop', build: 'build', apply: 'apply', start: 'runtime start', answer: 'first answer' };
const MODE_WORDS: Record<LiveUpdate['mode'], string> = { cold: 'cold start', restart: 'restart', hot: 'hot reload', none: 'no restart' };

/**
 * How the last one went, in one line: "Updated in 9 s (hot reload)", "Updated in 41 s (restart: domain model
 * changed)", "Updated in 1.2 s (no restart: no app files changed)", "Started in 1 min 2 s (cold start)",
 * "Update failed after 40 s (restart: hot reload failed)". Grouped merges say so: "… · 3 merges in one go".
 */
export function updateLine(u: LiveUpdate | undefined): string {
  if (!u) return '';
  const verb = u.mode === 'cold' ? 'Started' : u.mode === 'restart' && u.reason === 'restart asked for' ? 'Restarted' : 'Updated';
  const why = u.mode === 'hot' || u.mode === 'cold' ? MODE_WORDS[u.mode] : u.mode === 'restart' && u.reason === 'restart asked for' ? 'restart asked for' : `${MODE_WORDS[u.mode]}: ${u.fallback ? `hot reload didn't confirm (${u.fallback}), so it restarted` : u.reason}`;
  const head = u.ok ? `${verb} in ${secs(u.totalMs)} (${why})` : `${u.mode === 'cold' ? 'Start' : verb === 'Restarted' ? 'Restart' : 'Update'} failed after ${secs(u.totalMs)} (${why})`;
  return (u.commits ?? 0) > 1 ? `${head} · ${u.commits} commits in one go` : head;
}

/** Each phase's time: "fetch 0.3 s · classify 0.1 s · apply 7.9 s · first answer 0.2 s". */
export const phaseLine = (u: LiveUpdate | undefined): string => (u ? u.phases.map((p) => `${PHASE_WORDS[p.name]} ${secs(p.ms)}`).join(' · ') : '');
