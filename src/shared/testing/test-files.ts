// The microflow test files of a run, read by the office itself (release 82): each file's tests (`@test` names)
// and tags (`@tag smoke, billing`, which mxcli ignores), so that
//   * a run can be a subset: `office-app test --files a.test.mdl,b.test.mdl` and/or `--tag smoke` (mxcli runs
//     whole files, so a tag picks the files that carry it, in any of their comment blocks);
//   * a run stopped at its time limit can say which tests never ran;
//   * the time limit can be sized to the suite (autoLimitMs) unless the project set its own.
// Pure (no Node imports).

import type { TestResult } from './record.js';
import type { RunProgress } from './run-progress.js';
import { idsIn } from './links.js';

export interface TestFile {
  /** Repo-relative path, forward slashes. */
  file: string;
  tests: string[];
  tags: string[];
}

/** The tests and tags in one .test.mdl / .test.md file's text. */
export function readTestFile(file: string, text: string): TestFile {
  const tests: string[] = [];
  const tags = new Set<string>();
  for (const m of text.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    for (const raw of m[1].split(/\r?\n/)) {
      const line = raw.trim().replace(/^\*+\s*/, '');
      let t: RegExpExecArray | null;
      if ((t = /^@test\s+(.+?)\s*$/.exec(line))) tests.push(t[1]);
      else if ((t = /^@tags?\s+(.+?)\s*$/.exec(line))) for (const tag of t[1].split(/[\s,]+/)) if (tag) tags.add(tag.toLowerCase());
    }
  }
  return { file, tests, tags: [...tags] };
}

/** What a run was asked to cover; nothing given: every test file. */
export interface RunSubset {
  files?: string[];
  tags?: string[];
}

export const isSubset = (s: RunSubset | undefined): s is RunSubset => !!(s && (s.files?.length || s.tags?.length));

/** "files a.test.mdl, b.test.mdl; tag smoke": the subset in words. */
export function subsetWords(s: RunSubset | undefined): string {
  if (!isSubset(s)) return 'all test files';
  return [s.files?.length ? `file${s.files.length === 1 ? '' : 's'} ${s.files.join(', ')}` : '', s.tags?.length ? `tag${s.tags.length === 1 ? '' : 's'} ${s.tags.join(', ')}` : ''].filter(Boolean).join('; ');
}

/** A subset as asked (a CLI's comma lists, an API's arrays): trimmed, at most 200 files and 20 tags, or why not. */
export function cleanSubset(files: unknown, tags: unknown): RunSubset | string {
  const list = (v: unknown, max: number) => (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v.flatMap((x) => (typeof x === 'string' ? x.split(',') : [])) : []).map((x) => x.trim()).filter(Boolean).slice(0, max);
  const f = list(files, 200).map((x) => x.replace(/\\/g, '/').replace(/^\.\//, ''));
  const t = list(tags, 20).map((x) => x.replace(/^@/, '').toLowerCase());
  if (f.some((x) => x.length > 300 || x.includes('..'))) return 'A test file is a path in the repository (tests/a.test.mdl), without ..';
  if (t.some((x) => !/^[\w.-]{1,40}$/.test(x))) return 'A tag is a word (letters, digits, - _ .), as written after @tag in the test files';
  return { ...(f.length ? { files: f } : {}), ...(t.length ? { tags: t } : {}) };
}

/**
 * The files to run for `ask` out of every test file at the commit: a named file by its path, by the end of its
 * path, or by its name alone (when that is unique); a tag's files. Both given: the files named and the files
 * tagged. Why not, when a name matches nothing (or several) or nothing is left.
 */
export function pickFiles(all: readonly TestFile[], ask: RunSubset | undefined): { files: TestFile[] } | { why: string } {
  if (!isSubset(ask)) return { files: [...all] };
  const picked = new Set<string>();
  const problems: string[] = [];
  for (const want of ask.files ?? []) {
    const w = want.toLowerCase();
    const exact = all.filter((f) => f.file.toLowerCase() === w);
    const hits = exact.length ? exact : all.filter((f) => f.file.toLowerCase().endsWith(`/${w}`));
    if (hits.length === 1) picked.add(hits[0].file);
    else problems.push(hits.length ? `${want} matches ${hits.map((h) => h.file).join(' and ')}: give its path` : `no test file ${want}`);
  }
  for (const tag of ask.tags ?? []) {
    const hits = all.filter((f) => f.tags.includes(tag));
    if (!hits.length) problems.push(`no test file has @tag ${tag}`);
    for (const h of hits) picked.add(h.file);
  }
  const known = all.length ? ` The test files at this commit: ${all.map((f) => f.file).slice(0, 20).join(', ')}${all.length > 20 ? ', ...' : ''}.` : '';
  if (problems.length) return { why: `${problems.join('; ')}.${known}` };
  return { files: all.filter((f) => picked.has(f.file)) };
}

/** A project's own time limit for its microflow test runs: whole minutes, 5 to 180. */
export const LIMIT_MIN = 5;
export const LIMIT_MAX = 180;
/** Without one, the limit is sized to the suite: 10 min plus 15 s a test, at least 15 and at most 45 min. */
export const AUTO_MIN = 15;
export const AUTO_MAX = 45;

export const autoLimitMinutes = (tests: number) => Math.min(AUTO_MAX, Math.max(AUTO_MIN, Math.ceil(10 + (Math.max(0, tests) * 15) / 60)));

/** A limit as given (minutes), or undefined (no limit of its own: sized to the suite); a string says why not. */
export function cleanLimit(v: unknown): number | undefined | string {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < LIMIT_MIN || n > LIMIT_MAX) return `The time limit is whole minutes from ${LIMIT_MIN} to ${LIMIT_MAX} (or empty: sized to the suite)`;
  return n;
}

/**
 * A run stopped before mxcli wrote its JUnit file: what mxcli said live for each test (verbose), matched to the
 * files' tests in order (mxcli runs them file by file, as given), and every other test as never run. A live ERROR
 * is a harness error, as in the JUnit; a test never run is skipped with why, so it counts neither way.
 */
export function partialResults(files: readonly TestFile[], p: Pick<RunProgress, 'results'>, why: string): TestResult[] {
  const live = p.results.map((r) => ({ ...r, used: false }));
  const out: TestResult[] = [];
  for (const f of files) {
    for (const name of f.tests) {
      const hit = live.find((r) => !r.used && r.name === name);
      const base = { name: `${f.file}#${name}`, links: idsIn(name).map((target) => ({ target, basis: 'inferred' as const, via: `@test name in ${f.file}`, rule: 'UC / BR / AC id in the @test name' })) };
      if (!hit) {
        out.push({ ...base, status: 'skipped', detail: `never ran: ${why}` });
        continue;
      }
      hit.used = true;
      if (hit.status === 'PASS') out.push({ ...base, status: 'passed', detail: 'passed (seen live: the run was stopped before mxcli wrote its JUnit file)' });
      else if (hit.status === 'FAIL') out.push({ ...base, status: 'failed', detail: 'failed (seen live: the run was stopped before mxcli wrote its JUnit file, so its message is not known)' });
      else if (hit.status === 'ERROR') out.push({ ...base, status: 'skipped', harness: true, detail: 'harness error (seen live; its message is not known)' });
      else out.push({ ...base, status: 'skipped', detail: 'skipped (seen live)' });
    }
  }
  return out;
}
