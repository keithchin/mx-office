// The "Folder name case" check (shared/path-case.ts) on a commit: the commit's file list read with one
// `git ls-tree -r` started off the event loop (never a checkout, nothing written to the repository), and the
// finding, when there is one, recorded as a failed test run at that commit (source `office-check`), so it shows where the checks at
// a commit already show: a Developer change's receipt, the local merge's confirm step and App Insights › Testing.
// Asked for the commits people look at (a change's candidates and merge commit, main's head on the Testing page),
// never on a clock. Each commit is read once per office run (a commit's files never change); a commit the folder
// doesn't have yet (a PR head not fetched) is tried again after RETRY_MS. At most PER_LOOK new commits a look.

import { MAX_FINDINGS, pathCaseFindings, pathCaseHeadline } from '../../shared/path-case.js';
import { IMPORTER_VERSION, type TestResult, type TestRunDraft } from '../../shared/testing/record.js';
import { git } from '../testing/repo.js';
import type { TestRunStore } from '../testing/store.js';

export const SUITE = 'Folder name case (Linux build)';
export const RETRY_MS = 5 * 60_000;
export const PER_LOOK = 6;
const SHA = /^[0-9a-f]{40}$/i;
const KEPT = 500;

/** The files at `sha`, or undefined when the folder doesn't have the commit. */
export async function treeAt(dir: string, sha: string): Promise<string[] | undefined> {
  if (!SHA.test(sha)) return undefined;
  const out = await git(['-c', 'core.quotepath=off', 'ls-tree', '-r', '-z', '--name-only', sha], dir);
  return out === undefined ? undefined : out.split('\0').filter(Boolean);
}

/**
 * The check's record for commit `sha` with files `files`, or undefined when nothing is wrong: only a finding is
 * recorded (a passing row on every commit would crowd the Testing page and every receipt).
 */
export function draftFromTree(sha: string, files: readonly string[], at: number, branch?: string): TestRunDraft | undefined {
  const { findings, more } = pathCaseFindings(files);
  if (!findings.length) return undefined;
  const iso = new Date(at).toISOString();
  const results: TestResult[] = findings.map((f) => ({ name: f.path, status: 'failed' as const, detail: f.message.slice(0, 300), links: [] }));
  if (more) results.push({ name: `${more} more`, status: 'failed', detail: `Only the first ${MAX_FINDINGS} are listed.`, links: [] });
  return {
    source: 'office-check',
    sourceKey: `path-case:${sha.toLowerCase()}`,
    // The receipt and the merge dialog show a check by its name only, so the name says what is wrong.
    suite: `${SUITE}: ${pathCaseHeadline(findings, more)}`,
    testedRevision: sha.toLowerCase(),
    definitionRevision: sha.toLowerCase(),
    evidence: { kind: 'office', revision: `office@${iso}`, locator: `office:path-case:${sha.toLowerCase()}` },
    ...(branch ? { branch } : {}),
    finishedAt: iso,
    results,
    conclusion: 'failed',
    links: [],
    actor: { kind: 'office', name: 'folder name check (the office)' },
    importer: IMPORTER_VERSION,
  };
}

/** Per folder and commit: done, or when a read last failed. */
const looked = new Map<string, { done: true } | { failedAt: number }>();

export interface PathCaseDeps {
  tree?: typeof treeAt;
  now?: () => number;
}

/**
 * Checks the commits not checked yet (newest last in `shas`; at most PER_LOOK of them, the newest) and records
 * each as a test run at that commit. Never throws; resolves once the records are in.
 */
export async function checkCommits(store: Pick<TestRunStore, 'all' | 'ingest'>, dir: string, shas: Iterable<string>, deps: PathCaseDeps = {}): Promise<void> {
  const tree = deps.tree ?? treeAt;
  const now = deps.now ?? Date.now;
  const todo = [...new Set([...shas].map((s) => s.toLowerCase()))]
    .filter((s) => {
      if (!SHA.test(s)) return false;
      const had = looked.get(`${dir}|${s}`);
      return !had || ('failedAt' in had && now() - had.failedAt >= RETRY_MS);
    })
    .slice(-PER_LOOK);
  if (!todo.length) return;
  try {
    const known = new Set((await store.all()).filter((r) => r.source === 'office-check').map((r) => r.sourceKey));
    const drafts: TestRunDraft[] = [];
    await Promise.all(
      todo.map(async (sha) => {
        const key = `${dir}|${sha}`;
        if (known.has(`path-case:${sha}`)) return void looked.set(key, { done: true });
        const files = await tree(dir, sha).catch(() => undefined);
        if (!files) return void looked.set(key, { failedAt: now() });
        looked.set(key, { done: true });
        const d = draftFromTree(sha, files, now());
        if (d) drafts.push(d);
      }),
    );
    while (looked.size > KEPT) looked.delete(looked.keys().next().value!);
    if (drafts.length) await store.ingest(drafts);
  } catch {
    /* no record this time: nothing is claimed */
  }
}

/** Forgets what was looked at (tests). */
export function resetPathCase(): void {
  looked.clear();
}
