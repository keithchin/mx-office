// The Test Mode page's pure rules (server/testlab/): where the throwaway test offices go and when a run
// must not start, the runner's progress lines, the run's files' names, and a run's one-line headline.
// No I/O here beyond what's handed in, so tests/testlab.test.ts can pin every refusal.

import path from 'node:path';
import { isTestPath } from '../testmode.js';
import { SUITE_LABEL, TEST_SUITES, type RunProgress, type RunResult, type RunSummary, type TestSuite } from '../../shared/testlab.js';

export const isSuite = (s: unknown): s is TestSuite => TEST_SUITES.includes(s as TestSuite);

/** The runner says how far it is with a line `@@progress {"done":3,"of":14,"label":"Board"}`. */
export function parseProgress(line: string): RunProgress | undefined {
  const m = /^@@progress\s+(\{.*\})\s*$/.exec(line.trim());
  if (!m) return undefined;
  try {
    const v = JSON.parse(m[1]) as Record<string, unknown>;
    const done = Number(v.done);
    const of = Number(v.of);
    if (!Number.isFinite(done) || !Number.isFinite(of) || of <= 0 || done < 0) return undefined;
    return { done: Math.min(done, of), of, ...(typeof v.label === 'string' ? { label: v.label.slice(0, 80) } : {}) };
  } catch {
    return undefined;
  }
}

/** A file a run left that the page may fetch: a plain name (no folders), a screenshot or the summary. */
export function safeFileName(name: string): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|md)$/.test(name)) return undefined;
  if (name.includes('..')) return undefined;
  return name;
}

/** A run's id: when it started, then a few random letters (sorts by time, safe as a folder name). */
export const newRunId = (now: number, rand: string) => `run-${now.toString(36)}-${rand.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'x'}`;
export const isRunId = (id: string) => /^run-[a-z0-9]+-[a-z0-9]{1,6}$/i.test(id);

/** Whether `child` is `parent` or inside it (case-insensitive on Windows). */
export function inside(child: string, parent: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface RootSearch {
  env?: string;
  /** The office's own checkout: a `scratch/test-offices` folder above it is the usual home of test offices. */
  repoRoot: string;
  tmp: string;
  exists: (p: string) => boolean;
}

/**
 * Where the runs' throwaway test offices go: AGENT_OFFICE_TEST_OFFICES, else `<scratch/test-offices>/perf-guard/runs`
 * from the nearest `scratch/test-offices` above the office's checkout, else `<tmp>/test-offices/agent-office-runs`.
 */
export function resolveRoot(s: RootSearch): string {
  if (s.env?.trim()) return path.resolve(s.env.trim());
  let dir = path.resolve(s.repoRoot);
  for (let i = 0; i < 8; i++) {
    const c = path.join(dir, 'scratch', 'test-offices');
    if (s.exists(c)) return path.join(c, 'perf-guard', 'runs');
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.join(s.tmp, 'test-offices', 'agent-office-runs');
}

export interface RefusalInput {
  root: string;
  dataDir: string;
  floorDirs: readonly string[];
  runner: string;
  runnerExists: boolean;
  running?: boolean;
}

/** Why a run mustn't start now, or undefined when it may: it would never touch the live office or a real floor. */
export function refusalOf(r: RefusalInput): string | undefined {
  if (r.running) return 'A test run is already going: wait for it to finish, or stop it.';
  if (!isTestPath(r.root)) return `Refused: the test offices' folder (${r.root}) isn't a test office's folder (under scratch/test-offices or a test-office… folder), so a run could touch real data. Set AGENT_OFFICE_TEST_OFFICES to one.`;
  if (inside(r.root, r.dataDir) || inside(r.dataDir, r.root)) return `Refused: the test offices' folder (${r.root}) overlaps this office's data folder (${r.dataDir}).`;
  const floor = r.floorDirs.find((d) => inside(r.root, d) || inside(d, r.root));
  if (floor) return `Refused: the test offices' folder (${r.root}) overlaps a floor of this office (${floor}).`;
  if (!r.runnerExists) return `The test runner isn't here (${r.runner}): the office's checkout has no scripts/perf/run.mjs.`;
  return undefined;
}

/** The environment a run gets: none of the live office's own AGENT_OFFICE_* settings (its home, port, agent…), and test mode on. */
export function runEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!/^AGENT_OFFICE_/i.test(k)) out[k] = v;
  out.AGENT_OFFICE_TEST_MODE = '1';
  return out;
}

/** One line for the history: how a finished run went. */
export function headlineOf(r: RunResult | undefined, code: number | null): { status: RunSummary['status']; headline: string } {
  if (!r) return { status: 'error', headline: code === null ? 'Stopped before it wrote a result' : `Ended (exit ${code}) without a result` };
  if (r.error) return { status: 'error', headline: r.error.slice(0, 200) };
  const status = r.ok ? 'pass' : 'fail';
  if (r.views?.length) return { status, headline: `${r.views.filter((v) => v.ok).length}/${r.views.length} views within budget` };
  if (r.steps?.length) return { status, headline: `${r.steps.filter((s) => s.ok).length}/${r.steps.length} steps passed` };
  if (r.counts) return { status, headline: `${r.counts.pass} pass, ${r.counts.fail} fail${r.counts.skip ? `, ${r.counts.skip} skipped` : ''}` };
  return { status, headline: r.ok ? 'Passed' : (r.failures?.[0]?.slice(0, 200) ?? 'Failed') };
}

/** What an incident opened from a failure says: the suite, what failed and the run's page. */
export function incidentDraft(s: RunSummary, r: RunResult | undefined, what: string | undefined): { title: string; summary: string } | string {
  const label = SUITE_LABEL[s.suite];
  const link = `/lite?tab=tests&run=${s.id}`;
  if (what && r?.views) {
    const v = r.views.find((x) => x.id === what);
    if (!v) return 'No such view in that run';
    const top = [...v.longTasks].sort((a, b) => b.ms - a.ms)[0];
    const lines = [`${label}: the ${v.name} view (${v.path}) failed its budgets in test run ${s.id}.`, ...v.failures.map((f) => `- ${f}`)];
    if (top?.stack?.length) lines.push(`Longest task ${top.ms} ms at:`, ...top.stack.slice(0, 5).map((f) => `  ${f}`));
    if (v.pageErrors?.length) lines.push('Page errors:', ...v.pageErrors.slice(0, 3).map((e) => `- ${e}`));
    lines.push(`Details: ${link}`);
    return { title: `Slow view in a test run: ${v.name}`, summary: lines.join('\n') };
  }
  if (what && r?.steps) {
    const st = r.steps.find((x) => x.id === what);
    if (!st) return 'No such step in that run';
    return { title: `Journey step failed in a test run: ${st.name}`, summary: [`${label}: the step “${st.name}” failed in test run ${s.id}.`, st.detail ?? '', `Details: ${link}`].filter(Boolean).join('\n') };
  }
  const fails = r?.failures ?? [];
  return { title: `Test run failed: ${label}`, summary: [`${label} failed in test run ${s.id}${s.headline ? ` (${s.headline})` : ''}.`, ...fails.slice(0, 10).map((f) => `- ${f}`), `Details: ${link}`].join('\n') };
}
