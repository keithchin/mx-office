// Lock in's step 1: the full checks at one commit, behind a small interface of its own (LockInChecks). The office's
// implementation is ./bg-checks.ts, on slice 6's background runner (expert-checks/ runChecks, scope 'all'). Every
// check's verdict also goes into the testing ledger at the commit (source office-check) when the runner wrote no
// record of its own (the mx check, a check that couldn't run), so the merge receipt, the Testing page and the
// confirm step read the same records. A test office can script the checks (scriptedLockInChecks).

import type { Floor } from '../floor.js';
import { IMPORTER_VERSION, type TestRunDraft } from '../../shared/testing/record.js';
import { KIND_NAMES, type LockInCheck, type LockInCheckKind } from '../../shared/expert-lockin.js';
import { SESSION_BRANCH } from '../../shared/expert-proof.js';

export type LockInFloor = Pick<Floor, 'id' | 'dir'> & { workers?: Pick<Floor['workers'], 'list'> };

export interface LockInCheckOpts {
  kinds: readonly LockInCheckKind[];
  /** Who asked (for the records). */
  by: string;
  /** Each check as it changes (running, then its verdict). */
  onProgress(c: LockInCheck): void;
  /** The commit the checks actually ran at, when the runner says (it reads HEAD itself). */
  onCommit?(commit: string): void;
}

/** What runs Lock in's checks at one commit. Slice 6's runChecks plugs in here. */
export interface LockInChecks {
  run(floor: LockInFloor, commit: string, o: LockInCheckOpts): Promise<LockInCheck[]>;
}

const check = (kind: LockInCheckKind, status: LockInCheck['status'], summary: string, more: Partial<LockInCheck> = {}): LockInCheck => ({ kind, name: KIND_NAMES[kind], status, summary, ...more });

/** The ledger's record of one Lock in check at the commit (source office-check). */
export function ledgerDraft(c: LockInCheck, commit: string, runId: string, now: number): TestRunDraft {
  const iso = new Date(now).toISOString();
  const status = c.status === 'passed' || c.status === 'warn' ? 'passed' : c.status === 'failed' ? 'failed' : 'skipped';
  return {
    source: 'office-check',
    sourceKey: `lockin:${runId}:${c.kind}`,
    suite: `Lock in: ${c.name}`,
    testedRevision: commit.toLowerCase(),
    definitionRevision: commit.toLowerCase(),
    evidence: { kind: 'office', revision: `office@${iso}`, locator: `office:expert-lockin:${runId}` },
    branch: SESSION_BRANCH,
    finishedAt: iso,
    results: [{ name: `${c.name}: ${c.summary}`, status, ...(c.detail ? { detail: c.detail.slice(0, 300) } : {}), links: [] }],
    conclusion: status,
    links: [],
    actor: { kind: 'office', name: 'Lock in (the office)' },
    importer: IMPORTER_VERSION,
    ...(c.status === 'not-run' ? { harnessError: c.detail ?? 'did not run' } : {}),
  };
}

/**
 * A test office's stand-in (screenshots, the docs): the verdicts a JSON file names ({ "mx-check": "passed", … }
 * or a full check object), each after `delayMs`. Only ever used in test mode (index.ts checks).
 */
export function scriptedLockInChecks(script: Partial<Record<LockInCheckKind, string | Partial<LockInCheck>>>, delayMs = 600): LockInChecks {
  return {
    async run(_floor, _commit, o) {
      const out: LockInCheck[] = [];
      for (const kind of o.kinds) {
        o.onProgress(check(kind, 'running', 'Running'));
        await new Promise((r) => setTimeout(r, delayMs));
        const s = script[kind] ?? 'passed';
        const c = typeof s === 'string' ? check(kind, s as LockInCheck['status'], s === 'passed' ? 'Passed' : s) : check(kind, s.status ?? 'passed', s.summary ?? 'Passed', s);
        out.push(c);
        o.onProgress(c);
      }
      return out;
    },
  };
}
