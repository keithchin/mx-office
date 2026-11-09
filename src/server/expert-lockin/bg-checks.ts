// Lock in's checks on slice 6's runner (expert-checks/ runChecks with scope 'all'): every microflow test and every
// journey at the commit (journeys played on the preview, so Lock in runs the due ones itself), lint against the
// baseline and a full mx check. The runner waits for a background run under way (one run per project), and the
// session's turns never cancel a Lock in run. Its progress is read off the strip's cells while it runs; the result
// is mapped to Lock in's rows, each naming the testing ledger record the runner wrote at the commit.

import type { Ctx } from '../office/context.js';
import type { CheckFailure, CheckKind, ProofLint, ProofTests } from '../../shared/expert-checks.js';
import { KIND_NAMES, type LockInCheck, type LockInCheckKind } from '../../shared/expert-lockin.js';
import type { BackgroundChecks, ChecksResult } from '../expert-checks/runner.js';
import type { LockInChecks } from './checks.js';

const KIND: Record<LockInCheckKind, CheckKind> = { 'mx-check': 'mxcheck', 'microflow-tests': 'tests', journeys: 'journeys', lint: 'lint' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const check = (kind: LockInCheckKind, status: LockInCheck['status'], summary: string, more: Partial<LockInCheck> = {}): LockInCheck => ({ kind, name: KIND_NAMES[kind], status, summary, ...more });
const FIRST_LINT = 'First lint run, may take a few minutes';

type Counts = ProofTests['journeys'];

/** One kind of tests (journeys or microflow tests) of a finished run, as a Lock in row. */
export function testsRow(kind: 'journeys' | 'microflow-tests', c: Counts, selected: number, failures: readonly CheckFailure[], notes: readonly string[]): LockInCheck {
  const what = kind === 'journeys' ? 'journey' : 'microflow';
  const failed = failures.filter((f) => f.kind === what);
  const summary = `${c.passed} of ${c.total} passed`;
  if (!selected || !c.total) {
    const prompt = kind === 'journeys' ? 'Add journeys for the main user flows under tests/ (the toolkit’s journey format), one per use case.' : 'Add microflow tests for the main business rules (the toolkit’s test format), at least a smoke set.';
    return check(kind, 'warn', 'None in this app', { prompt });
  }
  if (c.failed) {
    const reg = failed.filter((f) => f.passedAt);
    const names = failed.slice(0, 4).map((f) => `${f.id}${f.passedAt ? ' (regressed)' : ''}${f.detail ? `: ${f.detail.slice(0, 80)}` : ''}`);
    return check(kind, 'failed', summary, { detail: `Failed at this commit: ${names.join('; ')}`, prompt: `${kind === 'journeys' ? 'Journey' : 'Microflow test'}${failed.length === 1 ? '' : 's'} ${failed.slice(0, 4).map((f) => f.id).join(', ')} failed${reg.length ? ' (passed before)' : ''}. Find out why and fix the app, not the test.` });
  }
  const why = notes.find((n) => (kind === 'journeys' ? /journey|preview/i : /microflow/i).test(n));
  if (c.notRun) return check(kind, 'not-run', summary, { detail: `${plural(c.notRun, kind === 'journeys' ? 'journey' : 'test')} didn’t run${why ? `: ${why}` : ''}` });
  return check(kind, 'passed', summary);
}

export function lintRow(l: ProofLint | null): LockInCheck {
  if (!l || l.state === 'skipped' || l.state === 'cancelled') return check('lint', 'not-run', 'Didn’t run', { detail: l?.note ?? 'Lint gave no answer' });
  const summary = `${plural(l.errors, 'new error')} · ${plural(l.warnings, 'new warning')}`;
  const where = l.findings.slice(0, 2).map((f) => `${f.rule}${f.document ? ` in ${[f.module, f.document].filter(Boolean).join('.')}` : ''}`).join(', ');
  const base = l.baseline ? '' : ' (no lint baseline: every finding counts)';
  const prompt = l.errors + l.warnings ? `Fix the new lint findings since the baseline: ${l.findings.slice(0, 4).map((f) => `${f.rule}${f.document ? ` in ${f.document}` : ''}`).join(', ')}. Don't change the baseline.` : undefined;
  if (l.errors) return check('lint', 'failed', summary, { detail: `${where}${base}`, ...(prompt ? { prompt } : {}) });
  if (l.warnings) return check('lint', 'warn', summary, { detail: `${where}${base}`, ...(prompt ? { prompt } : {}) });
  return check('lint', 'passed', summary, { detail: `Nothing new against the baseline${base}` });
}

export function mxRow(m: ChecksResult['mxcheck']): LockInCheck {
  if (!m) return check('mx-check', 'not-run', 'Didn’t run', { detail: 'The check gave no verdict' });
  if (m.status === 'pass') return check('mx-check', 'passed', '0 errors', m.warnings ? { detail: plural(m.warnings, 'warning') } : {});
  if (m.status === 'fail') return check('mx-check', 'failed', plural(m.errors ?? 1, 'error'), { prompt: `mx check finds ${plural(m.errors ?? 1, 'error')}. Fix them in the model.` });
  return check('mx-check', 'not-run', 'Didn’t run', { detail: m.why ?? 'The check gave no verdict' });
}

/** The finished run as Lock in's rows, in Lock in's order, each with its ledger record when the runner wrote one. */
export function rowsOf(r: ChecksResult, sources: ReadonlyMap<string, { source: string; sourceKey: string }>): LockInCheck[] {
  if (r.why) return (['mx-check', 'microflow-tests', 'journeys', 'lint'] as const).map((k) => check(k, 'not-run', 'Didn’t run', { detail: r.why }));
  const t = r.tests;
  const zero = { passed: 0, failed: 0, notRun: 0, total: 0 };
  const rec = (want: (s: { source: string; sourceKey: string }) => boolean) => r.records.find((id) => {
    const s = sources.get(id);
    return !!s && want(s);
  });
  const withRec = (c: LockInCheck, id: string | undefined) => (id ? { ...c, record: id } : c);
  return [
    mxRow(r.mxcheck),
    withRec(testsRow('microflow-tests', t?.microflow ?? zero, r.selection?.tests.length ?? 0, t?.failures ?? [], t?.notes ?? []), rec((s) => s.source === 'mxcli-test')),
    withRec(testsRow('journeys', t?.journeys ?? zero, r.selection?.journeys.length ?? 0, t?.failures ?? [], t?.notes ?? []), rec((s) => s.source === 'office-journey')),
    withRec(lintRow(r.lint), rec((s) => s.sourceKey.startsWith('expert-lint:'))),
  ];
}

/** Lock in's checks on slice 6's runner (`runner`: the office's one unless a test hands one in). */
export function backgroundLockInChecks(ctx: Pick<Ctx, 'cfg'> & Partial<Ctx>, runner?: () => BackgroundChecks, pollMs = 1000): LockInChecks {
  return {
    async run(floor, _commit, o) {
      const bg = runner ? runner() : (await import('../expert-checks/index.js')).backgroundChecksOf(ctx as Ctx);
      const kinds = o.kinds.map((k) => KIND[k]);
      const before = bg.runningOn(floor.id);
      if (before) for (const k of o.kinds) o.onProgress(check(k, 'waiting', 'Waiting for the background run to end'));
      const lintFirst = !!bg.d.lintFirst?.(floor.id);
      const p = bg.runChecks(floor.id, floor.dir, { scope: 'all', kinds });
      let done = false;
      void p.finally(() => (done = true));
      const sent = new Map<LockInCheckKind, string>();
      const say = (c: LockInCheck) => {
        const key = `${c.status}|${c.summary}|${c.detail ?? ''}`;
        if (sent.get(c.kind) === key) return;
        sent.set(c.kind, key);
        o.onProgress(c);
      };
      // Progress, read off the strip's cells while this (not a background) run is the one under way.
      while (!done) {
        await new Promise((r) => setTimeout(r, pollMs));
        const now = bg.runningOn(floor.id);
        if (!now || now.background) continue;
        const { tests: t, lint: l } = bg.proof(floor.id);
        const lintDone = !o.kinds.includes('lint') || (l?.commit === now.commit && l.state !== 'running');
        if (o.kinds.includes('lint') && l?.commit === now.commit) say(l.state === 'running' ? check('lint', 'running', lintFirst ? FIRST_LINT : 'Running') : lintRow(l));
        if (!t || t.commit !== now.commit || !lintDone) continue;
        const journeysDone = t.journeys.total > 0 || t.state !== 'running';
        if (o.kinds.includes('journeys')) say(journeysDone ? testsRow('journeys', t.journeys, t.journeys.total, t.failures, t.notes) : check('journeys', 'running', t.now ? `Running · ${t.now}` : 'Running'));
        if (journeysDone && o.kinds.includes('microflow-tests')) say(t.state === 'running' ? check('microflow-tests', 'running', t.now ? `Running · ${t.now}` : 'Running') : testsRow('microflow-tests', t.microflow, t.microflow.total, t.failures, t.notes));
        if (t.state !== 'running' && o.kinds.includes('mx-check')) say(check('mx-check', 'running', 'Running'));
      }
      const r = await p;
      if (r.commit) o.onCommit?.(r.commit);
      const { testingStore } = await import('../testing/index.js');
      const sources = new Map((await testingStore(ctx.cfg.dataDir, floor.id).all()).filter((x) => r.records.includes(x.id)).map((x) => [x.id, { source: x.source, sourceKey: x.sourceKey }] as const));
      return rowsOf(r, sources).filter((c) => o.kinds.includes(c.kind));
    },
  };
}
