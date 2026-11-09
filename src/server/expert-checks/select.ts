// Which microflow tests and journeys a background check runs (shared/expert-checks.ts), at commit `to`:
//   * all: every test file (*.test.mdl / *.test.md) and every journey (tests/** or journeys/**, .journey.json or
//     .journey.js, not the seed journey);
//   * affected: what changed since the last run (`from`; the commit's own change on the first run):
//       - test and journey files that changed themselves;
//       - the MDL scripts the change ran (changed *.mdl files, and the scripts the session's own exec.sh calls named,
//         ./index.ts) go to the toolkit's `bin/affected-tests.sh --no-model` when the project has it (its `unit` and
//         `journey` rows; --no-model so it never opens the .mpr the preview runs), else the fallback: the modules the
//         scripts name (Module.Name), and the test files and journeys that name those modules (or journeys/<M>.journey.json);
//       - the model changed (the .mpr or mprcontents) with no script to say where: every journey, and said so.
// Nothing here writes; git and the toolkit script run off the event loop (the deps).

import { SEED_JOURNEY } from '../../shared/agent-app.js';
import type { CheckScope } from '../../shared/expert-checks.js';
import { testPathsIn } from '../testing/workfolder.js';

export const JOURNEY_PATH = /^(tests|journeys)\/(.+\/)?[^/]+\.journey\.(json|js|cjs)$/i;
const MODEL = /(^|\/)[^/]+\.mpr$|(^|\/)mprcontents\//i;
const SCRIPT = /\.mdl$/i;
const TEST = /\.test\.(mdl|md)$/i;
/** Most journeys one background run plays. */
export const JOURNEY_MAX = 60;

export interface SelectDeps {
  /** The files changed between `from` and `to` (repo-relative, forward slashes); `from` undefined: `to`'s own change. */
  changed(dir: string, from: string | undefined, to: string): Promise<string[]>;
  /** Every file at `sha`. */
  files(dir: string, sha: string): Promise<string[]>;
  /** The texts of some files at `sha`. */
  read(dir: string, sha: string, files: string[]): Promise<Map<string, string>>;
  /** The toolkit's affected-tests.sh on these scripts (paths relative to `dir`), when the project has it; undefined otherwise. */
  toolkit?(dir: string, scripts: string[]): Promise<{ tests: string[]; journeys: string[] } | undefined>;
}

export interface Selection {
  scope: CheckScope;
  tests: string[];
  journeys: string[];
  /** How the set was chosen, in words. */
  how: string;
  notes: string[];
}

export const journeysIn = (files: readonly string[]) =>
  files
    .filter((f) => JOURNEY_PATH.test(f) && f !== SEED_JOURNEY)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .slice(0, 300);

/** The `unit` and `journey` rows of affected-tests.sh's output. */
export function parseAffected(out: string): { tests: string[]; journeys: string[] } {
  const tests: string[] = [];
  const journeys: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    const [kind, file] = line.split('\t').map((s) => s.trim());
    if (!file) continue;
    const f = file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (kind === 'unit' && TEST.test(f)) tests.push(f);
    else if (kind === 'journey' && /\.journey\.(json|js|cjs)$/i.test(f)) journeys.push(f);
  }
  return { tests, journeys };
}

/** The modules an MDL script names (Module.Name in its statements), minus the system ones. */
export function modulesIn(text: string): string[] {
  const out = new Set<string>();
  const body = text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/\b([A-Z][A-Za-z0-9_]{1,60})\.[A-Za-z_][A-Za-z0-9_]*/g)) out.add(m[1]);
  for (const sys of ['System', 'Administration', 'Atlas_Core', 'Atlas_Web_Content', 'NanoflowCommons', 'DataWidgets']) out.delete(sys);
  return [...out].sort();
}

/** A file on the list by path, or one whose path ends with it (the toolkit prints paths from the project's root). */
const pick = (all: readonly string[], want: readonly string[]) => all.filter((f) => want.some((w) => f === w || f.endsWith(`/${w}`) || w.endsWith(`/${f}`)));

export async function selectChecks(d: SelectDeps, dir: string, to: string, o: { from?: string; scope: CheckScope; scripts?: string[] }): Promise<Selection> {
  const files = await d.files(dir, to);
  const allTests = testPathsIn(files);
  const allJourneys = journeysIn(files);
  const notes: string[] = [];
  const cap = (js: string[]) => {
    if (js.length > JOURNEY_MAX) notes.push(`${js.length} journeys selected: the first ${JOURNEY_MAX} run`);
    return js.slice(0, JOURNEY_MAX);
  };
  if (o.scope === 'all') return { scope: 'all', tests: allTests, journeys: cap(allJourneys), how: 'every test and journey', notes };

  const changed = (o.from === to ? [] : await d.changed(dir, o.from, to)).map((f) => f.replace(/\\/g, '/'));
  const tests = new Set(allTests.filter((f) => changed.includes(f)));
  const journeys = new Set(allJourneys.filter((f) => changed.includes(f)));
  const scripts = [...new Set([...changed.filter((f) => SCRIPT.test(f) && !TEST.test(f) && files.includes(f)), ...(o.scripts ?? [])])].slice(0, 40);
  const modelMoved = changed.some((f) => MODEL.test(f));
  let how = o.from ? `changed since ${o.from.slice(0, 7)}` : 'changed in this commit';

  const tk = scripts.length && d.toolkit ? await d.toolkit(dir, scripts).catch(() => undefined) : undefined;
  if (tk) {
    for (const f of pick(allTests, tk.tests)) tests.add(f);
    for (const f of pick(allJourneys, tk.journeys)) journeys.add(f);
    how = `affected by ${scripts.length === 1 ? 'the script' : `${scripts.length} scripts`} (bin/affected-tests.sh)`;
  } else if (scripts.length) {
    const texts = await d.read(dir, to, scripts.filter((s) => files.includes(s)));
    const modules = [...new Set([...texts.values()].flatMap(modulesIn))];
    if (modules.length) {
      const named = await d.read(dir, to, [...allTests, ...allJourneys]);
      const names = (f: string) => modules.some((m) => (named.get(f) ?? '').includes(`${m}.`) || new RegExp(`(^|/)${m}\\.journey\\.(json|js|cjs)$`, 'i').test(f));
      for (const f of allTests.filter(names)) tests.add(f);
      for (const f of allJourneys.filter(names)) journeys.add(f);
      how = `naming the changed module${modules.length === 1 ? '' : 's'} ${modules.slice(0, 4).join(', ')}${modules.length > 4 ? '…' : ''}`;
    }
  } else if (modelMoved) {
    for (const f of allJourneys) journeys.add(f);
    how = 'every journey: the model changed and no script said where';
  }
  if (!allTests.length) notes.push('No microflow tests yet');
  if (!allJourneys.length) notes.push('No journeys yet');
  return { scope: 'affected', tests: [...tests].sort(), journeys: cap([...journeys].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))), how, notes };
}
