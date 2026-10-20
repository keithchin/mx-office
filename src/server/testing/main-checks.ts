// Testing release 2: CI on the default branch, so a merge commit can be checked at all (release 1 only
// had runs on PR heads). A bounded look, two gh calls started off the event loop: the newest pr-checks
// runs on the default branch (`gh run list --branch <default>`), and the check runs on the default
// branch's head commit (`gh api …/commits/<branch>/check-runs`). It rides the board's pull-request poll
// (floors.ts pullsChanged) and is never faster than it: once per new PR list, and at most once per
// MIN_MS a floor. Nothing is written to GitHub. In test mode only an injected fake runs: the office's own
// gh is never started for it there (on top of the credential scrubbing every test office gets).

import type { TestRunDraft } from '../../shared/testing/record.js';
import { IMPORTER_VERSION, statusOf } from '../../shared/testing/record.js';
import { ciResultStatus } from '../../shared/ci-conclusion.js';
import { gh } from '../github.js';
import { prShotsOptions } from '../prshots/index.js';
import { testModeOf } from '../testmode.js';

/** The board's pull-request poll (github.ts REFRESH_MS): never more often than that. */
export const MIN_MS = 90_000;
/** How many of the default branch's newest runs are read. */
export const RUNS = 8;

export type GhRun = (args: string[], cwd: string) => Promise<string>;

const SHA = /^[0-9a-f]{40}$/i;

interface RunRow {
  databaseId: number;
  status: string;
  conclusion: string;
  headSha: string;
  url: string;
  createdAt: string;
}

/** A finished pr-checks run on the default branch: its conclusion on its head commit. */
export function draftFromMainRun(repo: string, branch: string, r: RunRow): TestRunDraft | undefined {
  const status = ciResultStatus(r.conclusion) ?? statusOf(r.conclusion);
  if (String(r.status).toLowerCase() !== 'completed' || !SHA.test(r.headSha ?? '') || !status) return undefined;
  return {
    source: 'pr-checks',
    sourceKey: `pr-checks-run:${repo}:${r.databaseId}:${r.conclusion}`,
    suite: 'pr-checks',
    testedRevision: r.headSha,
    definitionRevision: r.headSha,
    evidence: { kind: 'ci-run', revision: `run ${r.databaseId}`, locator: r.url },
    branch,
    startedAt: r.createdAt,
    results: [{ name: 'pr-checks', status, detail: r.conclusion, links: [] }],
    conclusion: status,
    links: [],
    actor: { kind: 'ci', name: 'pr-checks' },
    importer: IMPORTER_VERSION,
  };
}

interface CheckRunRow {
  name: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  html_url?: string;
  completed_at?: string;
}

/** The check runs on the default branch's head, once every one has finished: a rollup run of its own. */
export function draftFromCheckRuns(repo: string, branch: string, runs: readonly CheckRunRow[]): TestRunDraft | undefined {
  const sha = runs[0]?.head_sha;
  if (!sha || !SHA.test(sha) || runs.some((r) => r.head_sha !== sha || String(r.status).toLowerCase() !== 'completed')) return undefined;
  const results = runs.map((r) => ({ name: r.name, status: ciResultStatus(r.conclusion) ?? statusOf(r.conclusion) ?? 'skipped', ...(r.conclusion ? { detail: r.conclusion } : {}), links: [] }));
  const failed = results.some((t) => t.status === 'failed');
  const passed = results.some((t) => t.status === 'passed');
  const last = runs.map((r) => r.completed_at ?? '').sort().at(-1);
  return {
    source: 'pr-checks',
    sourceKey: `main-check-runs:${repo}@${sha}:${results.map((t) => `${t.name}=${t.status}`).sort().join(',')}`,
    suite: `Checks on ${branch} (all check runs)`,
    testedRevision: sha,
    definitionRevision: sha,
    evidence: { kind: 'ci-run', revision: `checks@${sha.slice(0, 12)}`, locator: `https://github.com/${repo}/commit/${sha}/checks` },
    branch,
    ...(last ? { finishedAt: last } : {}),
    results,
    conclusion: failed ? 'failed' : passed ? 'passed' : 'skipped',
    links: [],
    actor: { kind: 'ci', name: 'GitHub checks' },
    importer: IMPORTER_VERSION,
  };
}

export interface MainChecksLook {
  floorId: string;
  dir: string;
  repo?: string;
  /** The default branch's name. */
  branch: string;
  /** When the board's PR list last came back (GhState.fetchedAt), and whether a look is under way. */
  pullsAt: number;
  loading: boolean;
}

export class MainChecks {
  private last = new Map<string, { at: number; pullsAt: number }>();
  private running = new Set<string>();

  /** `runnerFor` gives undefined for a floor: never fetch there (test mode without a fake). */
  constructor(
    private runnerFor: (dir: string) => GhRun | undefined,
    private opts: { workflow: string; minMs: number; now: () => number } = { workflow: prShotsOptions().workflow, minMs: MIN_MS, now: Date.now },
  ) {}

  /** Whether a look now would go ahead (the cadence rule), without starting one. */
  due(l: Omit<MainChecksLook, 'branch'>): boolean {
    if (!this.runnerFor(l.dir) || !l.repo || l.loading || !l.pullsAt || this.running.has(l.floorId)) return false;
    const had = this.last.get(l.floorId);
    if (!had) return true;
    return had.pullsAt !== l.pullsAt && this.opts.now() - had.at >= this.opts.minMs;
  }

  /** The default branch's newest finished runs as drafts, or [] when it isn't due (or gh failed). */
  async poll(l: MainChecksLook): Promise<TestRunDraft[]> {
    if (!this.due(l)) return [];
    const run = this.runnerFor(l.dir)!;
    const repo = l.repo!;
    this.last.set(l.floorId, { at: this.opts.now(), pullsAt: l.pullsAt });
    this.running.add(l.floorId);
    try {
      const [runs, checks] = await Promise.all([
        run(['run', 'list', '-R', repo, '--branch', l.branch, '--workflow', this.opts.workflow, '--limit', String(RUNS), '--json', 'databaseId,status,conclusion,headSha,url,createdAt'], l.dir).catch(() => '[]'),
        run(['api', `repos/${repo}/commits/${encodeURIComponent(l.branch)}/check-runs?per_page=50`, '--jq', '[.check_runs[] | {name, status, conclusion, head_sha, html_url, completed_at}]'], l.dir).catch(() => '[]'),
      ]);
      const out: TestRunDraft[] = [];
      for (const r of parse<RunRow>(runs)) {
        const d = draftFromMainRun(repo, l.branch, r);
        if (d) out.push(d);
      }
      const rollup = draftFromCheckRuns(repo, l.branch, parse<CheckRunRow>(checks));
      if (rollup) out.push(rollup);
      return out;
    } finally {
      this.running.delete(l.floorId);
    }
  }
}

function parse<T>(text: string): T[] {
  try {
    const v = JSON.parse(text || '[]') as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** The office's runner: its own gh, except in test mode, where nothing real is started. */
export function officeRunner(dir: string): GhRun | undefined {
  return testModeOf(dir).on ? undefined : (args, cwd) => gh(args, cwd, 60_000);
}
