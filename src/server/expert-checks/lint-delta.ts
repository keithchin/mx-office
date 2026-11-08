// The lint delta of a background check (shared/expert-checks.ts ProofLint): `mxcli lint --format json` at the
// commit against the project's baseline (.claude/lint-baseline.json, the toolkit's lint gate writes it and the
// readiness check reads it). Read the way the gate reads it (project-bin/lint-gate.sh): a rule that couldn't run
// (module "_rule", a "Starlark rule error") is never a finding; a finding is new when its key
// (rule|module|document|message) occurs more often than the baseline's multiset has it; a baseline with only
// per-rule counts names the newest findings of each rule that rose. Pure.

import { LINT_KEEP, type LintFinding } from '../../shared/expert-checks.js';

export interface Baseline {
  counts: Record<string, number>;
  /** rule|module|document|message → count (newer baselines). */
  findings?: Record<string, number>;
}

/** The baseline file's text read; undefined when it isn't one. */
export function readBaseline(text: string | undefined): Baseline | undefined {
  if (!text) return undefined;
  try {
    const j = JSON.parse(text) as { counts?: unknown; findings?: unknown };
    const nums = (o: unknown) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? (o as Record<string, unknown>) : {}).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));
    if (!j || typeof j !== 'object' || !j.counts || typeof j.counts !== 'object') return undefined;
    const findings = j.findings && typeof j.findings === 'object' && Object.keys(j.findings).length ? nums(j.findings) : undefined;
    return { counts: nums(j.counts), ...(findings ? { findings } : {}) };
  } catch {
    return undefined;
  }
}

interface Violation {
  ruleId?: unknown;
  severity?: unknown;
  module?: unknown;
  document?: unknown;
  message?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const sev = (v: unknown): LintFinding['severity'] => {
  const s = str(v).toLowerCase();
  return s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'info';
};

/** The findings of `mxcli lint --format json` that count (a rule that couldn't run is left out); undefined when it isn't lint's JSON. */
export function lintFindings(text: string): LintFinding[] | undefined {
  let j: { violations?: unknown };
  try {
    const at = text.indexOf('{');
    j = JSON.parse(at > 0 ? text.slice(at) : text) as { violations?: unknown };
  } catch {
    return undefined;
  }
  if (!j || !Array.isArray(j.violations)) return undefined;
  const vs = j.violations as Violation[];
  const crashed = new Set(vs.filter((v) => str(v.message).includes('Starlark rule error')).map((v) => str(v.ruleId)));
  return vs
    .filter((v) => str(v.module) !== '_rule' && !crashed.has(str(v.ruleId)))
    .map((v) => ({ rule: str(v.ruleId) || 'unknown', severity: sev(v.severity), ...(str(v.module) ? { module: str(v.module) } : {}), ...(str(v.document) ? { document: str(v.document) } : {}), message: str(v.message).replace(/\n/g, ' ').slice(0, 300) }));
}

/** The gate's key of a finding. */
export const findingKey = (f: LintFinding) => [f.rule, f.module ?? '', f.document ?? '', f.message].join('|');

export interface LintDelta {
  errors: number;
  warnings: number;
  findings: LintFinding[];
  baseline: boolean;
}

const RANK = { error: 0, warning: 1, info: 2 } as const;

/** The findings new against `base` (none given: every error and warning, counted, none listed). */
export function lintDelta(now: readonly LintFinding[], base: Baseline | undefined): LintDelta {
  let fresh: LintFinding[];
  if (!base) {
    // No baseline: everything reads as new, which says nothing; only the counts of errors are worth showing.
    const errors = now.filter((f) => f.severity === 'error').length;
    return { errors, warnings: now.filter((f) => f.severity === 'warning').length, findings: [], baseline: false };
  }
  if (base.findings) {
    const left = new Map(Object.entries(base.findings));
    fresh = [];
    for (const f of now) {
      const k = findingKey(f);
      const n = left.get(k) ?? 0;
      if (n > 0) left.set(k, n - 1);
      else fresh.push(f);
    }
  } else {
    // Counts only: the rules that rose, and as many of their findings (the last ones in model order) as they rose by.
    const byRule = new Map<string, LintFinding[]>();
    for (const f of now) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
    fresh = [...byRule].flatMap(([rule, fs]) => {
      const rise = fs.length - (base.counts[rule] ?? 0);
      return rise > 0 ? fs.slice(-rise) : [];
    });
  }
  return {
    errors: fresh.filter((f) => f.severity === 'error').length,
    warnings: fresh.filter((f) => f.severity === 'warning').length,
    findings: [...fresh].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.rule.localeCompare(b.rule)).slice(0, LINT_KEEP),
    baseline: true,
  };
}
