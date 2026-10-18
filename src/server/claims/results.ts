// What a committed result file says, for the claims check (check.ts): how many passed and how many failed,
// read with the parsers Testing already uses (testing/import-reports.ts for the checks scripts' and the
// journey runner's JSON and the toolkit's report.json, shared/testing/junit.ts for JUnit XML), plus the
// counts a test-report page prints ("69 passed · 6 failed") and the summaries common runners write. And
// whether a path is git-ignored by a .gitignore's rules (the evidence of a run kept only in an ignored
// folder is no evidence anyone else can read). Pure.

import { parseJUnit } from '../../shared/testing/junit.js';
import { parseReport } from '../testing/import-reports.js';

export interface ResultCounts {
  passed: number;
  failed: number;
}

/** A file that could hold test results: JSON, JUnit XML or an HTML report, never a journey's own definition or a dependency. */
export function isResultFile(f: string): boolean {
  if (!/\.(json|xml|html?)$/i.test(f) || /(^|\/)node_modules\//.test(f)) return false;
  if (/\.journey\.json$/i.test(f) || /(^|\/)(package(-lock)?|tsconfig|composer)\.json$/i.test(f)) return false;
  return true;
}

/** A result file by its path: under a reports, results, verification or artifacts folder, or named so. */
export const looksLikeResult = (f: string) => isResultFile(f) && /(report|result|junit|findings|verification|regression|test-?run|journey-run|TEST-)/i.test(f);

/** What a result file is named for: "order-submit" for "order-submit.json", "order-submit-findings.json", "TEST-order-submit.xml". */
export function resultName(f: string): string {
  return (f.split('/').pop() ?? f)
    .replace(/\.(json|xml|html?)$/i, '')
    .replace(/^TEST-/i, '')
    .replace(/[-_.](findings|results?|report|junit|run)$/i, '')
    .toLowerCase();
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** A runner's own summary: { passed, failed }, { summary: { … } }, mocha's stats.passes/failures, jest's numPassedTests/numFailedTests. */
function summaryCounts(d: Obj): ResultCounts | undefined {
  for (const s of [d, obj(d.summary), obj(d.totals), obj(d.stats)]) {
    if (!s) continue;
    const passed = n(s.passed) ?? n(s.passes) ?? n(s.numPassedTests) ?? n(s.expected);
    const failed = n(s.failed) ?? n(s.failures) ?? n(s.numFailedTests) ?? n(s.unexpected);
    if (passed !== undefined && failed !== undefined) return { passed, failed };
  }
  return undefined;
}

/** How many passed and failed in a result file, or undefined when it isn't one this can read. */
export function resultCounts(file: string, text: string): ResultCounts | undefined {
  if (/\.json$/i.test(file)) {
    const parsed = parseReport(file, text, []);
    if (parsed?.results.length) {
      const failed = parsed.results.filter((r) => r.status === 'failed').length;
      return { passed: parsed.results.filter((r) => r.status === 'passed').length, failed };
    }
    try {
      const d = obj(JSON.parse(text.replace(/^﻿/, '')));
      return d ? summaryCounts(d) : undefined;
    } catch {
      return undefined;
    }
  }
  if (/\.xml$/i.test(file)) {
    const run = parseJUnit(text);
    if (!run?.cases.length) return undefined;
    return { passed: run.cases.filter((c) => c.status === 'passed').length, failed: run.cases.filter((c) => c.status === 'failed' || c.status === 'error').length };
  }
  if (/\.html?$/i.test(file)) {
    const flat = text.replace(/<[^>]+>/g, ' ');
    const p = /(\d+)\s+passed\b/i.exec(flat);
    const f = /(\d+)\s+failed\b/i.exec(flat);
    return p && f ? { passed: Number(p[1]), failed: Number(f[1]) } : undefined;
  }
  return undefined;
}

// ---- .gitignore ---------------------------------------------------------------------------------------

interface Rule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globRe(glob: string, anchored: boolean): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}$`, 'i');
}

/** A root .gitignore's rules (the common subset: comments, negation, anchoring, directory-only, *, ?, **). */
export function ignoreRules(text: string | undefined): Rule[] {
  const out: Rule[] = [];
  for (const raw of (text ?? '').replace(/\r/g, '').split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.replace(/\/+$/, '');
    const anchored = line.startsWith('/') || line.includes('/');
    line = line.replace(/^\//, '');
    if (line) out.push({ re: globRe(line, anchored), negate, dirOnly });
  }
  return out;
}

/** Whether `path` (a file, or a folder written with a trailing "/") is ignored: it or a folder above it matches, the last matching rule deciding. */
export function isIgnored(rules: readonly Rule[], path: string): boolean {
  const parts = path.replace(/^\.?\//, '').replace(/\/+$/, '').split('/').filter(Boolean);
  const isDir = path.endsWith('/');
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('/');
    const dir = i < parts.length || isDir;
    let hit: boolean | undefined;
    for (const r of rules) if ((!r.dirOnly || dir) && r.re.test(p)) hit = !r.negate;
    // A folder that is ignored hides everything under it: git can't re-include a file below it.
    if (hit && (dir || i === parts.length)) return true;
  }
  return false;
}
