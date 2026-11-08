// Lock in's step 1: the full checks at one commit, behind a small interface of its own (LockInChecks) so slice 6's
// background runner (runChecks(floor, { scope: 'all', kinds })) can take its place at merge time. The default here
// is built on what the office already runs, each in the office's own work folder at exactly that commit, never in
// the project folder (the session keeps working meanwhile):
//   mx check         the security gate's (merge-check/ ensureCheck: kept per commit, one at a time office-wide)
//   microflow tests  the Testing runner (testing/mxcli-office.ts startMicroflowTests), recorded in the ledger
//   journeys         the journeys at the commit (agent-app/journey-batch.ts journeysAt) against the ledger's
//                    results at that exact commit: one with no result there is due, and shown as not run
//   lint             mxcli lint (testing/mxcli-run.ts runQuality, kept in the quality store) against the
//                    baseline the toolkit committed (.claude/lint-baseline.json at the same commit)
// Every check's verdict also goes into the testing ledger at the commit (source office-check), so the merge
// receipt, the Testing page and the confirm step read the same record.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { IMPORTER_VERSION, sameRevision, type TestRunDraft } from '../../shared/testing/record.js';
import { journeyIdOf, journeysIn } from '../../shared/testing/links.js';
import type { LintSummary } from '../../shared/testing/quality.js';
import { KIND_NAMES, type LockInCheck, type LockInCheckKind } from '../../shared/expert-lockin.js';
import { LINT_BASELINE } from '../../shared/review-gate.js';
import { SESSION_BRANCH } from '../../shared/expert-proof.js';
import { runProofGit } from '../expert/git.js';

export type LockInFloor = Pick<Floor, 'id' | 'dir'> & { workers?: Pick<Floor['workers'], 'list'> };

export interface LockInCheckOpts {
  kinds: readonly LockInCheckKind[];
  /** Who asked (for the records). */
  by: string;
  /** Each check as it changes (running, then its verdict). */
  onProgress(c: LockInCheck): void;
}

/** What runs Lock in's checks at one commit. Slice 6's runChecks plugs in here. */
export interface LockInChecks {
  run(floor: LockInFloor, commit: string, o: LockInCheckOpts): Promise<LockInCheck[]>;
}

const check = (kind: LockInCheckKind, status: LockInCheck['status'], summary: string, more: Partial<LockInCheck> = {}): LockInCheck => ({ kind, name: KIND_NAMES[kind], status, summary, ...more });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Lint against the baseline: new error findings fail, new warnings are worth a look, the rest pass. */
export function lintVerdict(sum: LintSummary | undefined, baseline: { total?: unknown; counts?: unknown } | undefined, errors: readonly string[]): LockInCheck {
  if (!sum) return check('lint', 'not-run', 'Didn’t run', { detail: errors[0] ?? 'mxcli lint gave no usable answer' });
  const counts = baseline && typeof baseline.counts === 'object' && baseline.counts ? (baseline.counts as Record<string, unknown>) : {};
  const was = (rule: string) => (typeof counts[rule] === 'number' ? (counts[rule] as number) : 0);
  const fresh = sum.topRules.map((r) => ({ ...r, extra: Math.max(0, r.count - was(r.ruleId)) })).filter((r) => r.extra > 0);
  const newErrors = fresh.filter((r) => /error/i.test(r.severity)).reduce((n, r) => n + r.extra, 0);
  const newOther = fresh.filter((r) => !/error/i.test(r.severity)).reduce((n, r) => n + r.extra, 0);
  const where = fresh.slice(0, 2).map((r) => `${r.ruleId}${r.example ? ` in ${r.example}` : ''}`).join(', ');
  const base = baseline ? '' : ` (no ${LINT_BASELINE}: every finding counts as new)`;
  const summary = `${plural(sum.bySeverity.errors, 'error')} · ${newErrors + newOther} new`;
  const prompt = fresh.length ? `Fix the new lint findings since the baseline: ${fresh.slice(0, 4).map((r) => `${r.ruleId} (${r.extra})`).join(', ')}. Don't change the baseline.` : undefined;
  if (newErrors) return check('lint', 'failed', summary, { detail: `${plural(newErrors, 'new error')}: ${where}${base}`, ...(prompt ? { prompt } : {}) });
  if (newOther) return check('lint', 'warn', summary, { detail: `${plural(newOther, 'new warning')}: ${where}${base}`, ...(prompt ? { prompt } : {}) });
  return check('lint', 'passed', summary, { detail: `Nothing new against the baseline${base}` });
}

/** The journeys' verdict from the journeys at the commit and the ledger's results at exactly that commit. */
export function journeysVerdict(ids: readonly string[], results: ReadonlyMap<string, 'passed' | 'failed' | 'skipped'>): LockInCheck {
  if (!ids.length) return check('journeys', 'warn', 'None in this app', { detail: 'No journeys under tests/ at this commit', prompt: 'Add journeys for the main user flows under tests/ (the toolkit’s journey format), one per use case.' });
  const failed = ids.filter((j) => results.get(j) === 'failed');
  const due = ids.filter((j) => results.get(j) !== 'passed' && results.get(j) !== 'failed');
  const passed = ids.length - failed.length - due.length;
  const summary = `${passed} of ${ids.length} passed`;
  if (failed.length) return check('journeys', 'failed', summary, { detail: `Failed at this commit: ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? ', …' : ''}${due.length ? `; ${due.length} due` : ''}`, prompt: `Journey${failed.length === 1 ? '' : 's'} ${failed.slice(0, 4).join(', ')} failed. Find out why and fix the app, not the journey.` });
  if (due.length) return check('journeys', 'not-run', summary, { detail: `${plural(due.length, 'journey')} due, no result at this commit: ${due.slice(0, 4).join(', ')}${due.length > 4 ? ', …' : ''}. Run them in the session (office-app journey) or let the background tests run them`, prompt: `Run the journeys that have no result at the current commit: ${due.slice(0, 6).join(', ')}.` });
  return check('journeys', 'passed', summary);
}

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

const POLL_MS = 3000;
const MX_CHECK_MAX_MS = 40 * 60_000;

/** The office's checks: the existing runners, at exactly `commit`. */
export function officeLockInChecks(ctx: Ctx): LockInChecks {
  const dataDir = ctx.cfg.dataDir;

  async function mxCheck(floor: LockInFloor, commit: string, by: string): Promise<LockInCheck> {
    const { ensureCheck, officeDeps } = await import('../merge-check/index.js');
    const d = await officeDeps(ctx);
    let v = await ensureCheck(d, floor, commit, `Mx Office (Lock in by ${by})`);
    const end = Date.now() + MX_CHECK_MAX_MS;
    while (v.status === 'running' && Date.now() < end) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const had = await d.checkAt(floor.id, commit).catch(() => undefined);
      if (had) {
        const { viewOf } = await import('../merge-check/index.js');
        v = viewOf(had);
      } else if (d.runningOn(floor.id)?.commit !== commit) v = await ensureCheck(d, floor, commit, `Mx Office (Lock in by ${by})`);
    }
    if (v.status === 'pass') return check('mx-check', 'passed', '0 errors');
    if (v.status === 'fail') return check('mx-check', 'failed', `${plural(v.errors ?? 1, 'error')}`, { detail: v.codes?.length ? `Codes: ${v.codes.join(', ')}` : undefined, prompt: `mx check finds ${plural(v.errors ?? 1, 'error')}${v.codes?.length ? ` (${v.codes.join(', ')})` : ''}. Fix them in the model.` });
    if (v.status === 'no-app') return check('mx-check', 'not-run', 'No app at this commit', { detail: 'There is no .mpr at the commit' });
    if (v.status === 'running') return check('mx-check', 'not-run', 'Took too long', { detail: `Stopped waiting after ${MX_CHECK_MAX_MS / 60_000} minutes` });
    return check('mx-check', 'not-run', 'Didn’t run', { detail: v.why ?? 'The check gave no verdict' });
  }

  async function tests(floor: LockInFloor, commit: string, by: string): Promise<LockInCheck> {
    const { startMicroflowTests, testRunOf } = await import('../testing/mxcli-office.js');
    const started = await startMicroflowTests(dataDir, floor, { name: `${by} (Lock in)`, commit });
    if (typeof started === 'string') {
      if (/no (microflow )?tests?|no test files/i.test(started)) return check('microflow-tests', 'warn', 'None in this app', { detail: started, prompt: 'Add microflow tests for the main business rules (the toolkit’s test format), at least a smoke set.' });
      return check('microflow-tests', 'not-run', 'Didn’t run', { detail: started });
    }
    await started.done;
    const slot = testRunOf(floor.id);
    const recId = slot.record;
    if (!recId) {
      if (/no (microflow )?tests?|no test files/i.test(slot.last ?? '')) return check('microflow-tests', 'warn', 'None in this app', { detail: slot.last, prompt: 'Add microflow tests for the main business rules (the toolkit’s test format), at least a smoke set.' });
      return check('microflow-tests', 'not-run', 'Didn’t run', { detail: slot.last ?? 'The run left no record' });
    }
    const { testingStore } = await import('../testing/index.js');
    const rec = (await testingStore(dataDir, floor.id).all()).find((r) => r.id === recId);
    if (!rec || rec.harnessError) return check('microflow-tests', 'not-run', 'Couldn’t run', { detail: rec?.harnessError ?? slot.last, record: recId });
    const failed = rec.results.filter((t) => t.status === 'failed');
    const passed = rec.results.filter((t) => t.status === 'passed').length;
    const summary = `${passed} of ${rec.results.length} passed`;
    if (failed.length) return check('microflow-tests', 'failed', summary, { detail: failed.slice(0, 3).map((t) => t.name).join(', '), record: recId, prompt: `Microflow test${failed.length === 1 ? '' : 's'} ${failed.slice(0, 3).map((t) => t.name).join(', ')} failed. Fix the microflows, not the tests.` });
    if (!rec.results.length) return check('microflow-tests', 'warn', 'None in this app', { record: recId });
    return check('microflow-tests', 'passed', summary, { record: recId });
  }

  async function journeys(floor: LockInFloor, commit: string): Promise<LockInCheck> {
    const { journeysAt } = await import('../agent-app/journey-batch.js');
    const ids = [...(await journeysAt(floor.dir, commit).catch(() => new Map<string, string>())).keys()];
    const { testingStore } = await import('../testing/index.js');
    const results = new Map<string, 'passed' | 'failed' | 'skipped'>();
    for (const r of await testingStore(dataDir, floor.id).all()) {
      if (!sameRevision(r.testedRevision, commit)) continue;
      for (const x of r.results) {
        const j = journeyIdOf(x.name) ?? journeysIn(x.name)[0];
        if (j) results.set(j, x.status);
      }
    }
    return journeysVerdict(ids, results);
  }

  async function lint(floor: LockInFloor, commit: string, by: string): Promise<LockInCheck> {
    const [{ mxcliFor }, { runQuality }, { qualityStore }] = await Promise.all([import('../testing/mxcli-tool.js'), import('../testing/mxcli-run.js'), import('../testing/mxcli-office.js')]);
    const tool = await mxcliFor(dataDir, floor.dir);
    if ('why' in tool) return check('lint', 'not-run', 'Didn’t run', { detail: tool.why });
    const draft = await runQuality({ dataDir, floorId: floor.id, floorDir: floor.dir, bin: tool.bin, mxcliVersion: tool.version, sha: commit, branch: SESSION_BRANCH, trigger: `${by} (Lock in)` });
    await qualityStore(dataDir, floor.id).ingest(draft).catch(() => undefined);
    const text = await runProofGit(['show', `${commit}:${LINT_BASELINE}`], floor.dir).catch(() => '');
    let baseline: { total?: unknown; counts?: unknown } | undefined;
    try {
      baseline = text ? JSON.parse(text) : undefined;
    } catch {
      baseline = undefined;
    }
    return lintVerdict(draft.lint, baseline, draft.errors);
  }

  return {
    async run(floor, commit, o) {
      const out: LockInCheck[] = [];
      for (const kind of o.kinds) {
        o.onProgress(check(kind, 'running', 'Running'));
        let c: LockInCheck;
        try {
          c = kind === 'mx-check' ? await mxCheck(floor, commit, o.by) : kind === 'microflow-tests' ? await tests(floor, commit, o.by) : kind === 'journeys' ? await journeys(floor, commit) : await lint(floor, commit, o.by);
        } catch (err) {
          c = check(kind, 'not-run', 'Didn’t run', { detail: (err as Error).message.slice(0, 300) });
        }
        out.push(c);
        o.onProgress(c);
      }
      return out;
    },
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
