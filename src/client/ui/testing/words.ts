// The Testing tab's words and tones: every state has a word (colour never carries a meaning alone),
// and coverage, result and freshness each keep their own. Pure (no DOM), so the tests read it.

import { shortRev, UNKNOWN, type Link, type Revision } from '../../../shared/testing/record';
import type { Coverage, Freshness, ResultState, UcCoverage } from '../../../shared/testing/view';

export type Tone = 'good' | 'warn' | 'bad' | 'muted' | 'info';

export const COVERAGE: Record<Coverage, { word: string; tone: Tone }> = {
  linked: { word: 'Linked', tone: 'good' },
  inferred: { word: 'Inferred only', tone: 'info' },
  none: { word: 'No linked test', tone: 'warn' },
};

export const UC_COVERAGE: Record<UcCoverage, { word: string; tone: Tone }> = {
  full: { word: 'Full', tone: 'good' },
  partial: { word: 'Partial', tone: 'warn' },
  inferred: { word: 'Inferred only', tone: 'info' },
  none: { word: 'None', tone: 'warn' },
};

export const RESULT: Record<ResultState, { word: string; tone: Tone }> = {
  passed: { word: 'Passed', tone: 'good' },
  failed: { word: 'Failed', tone: 'bad' },
  skipped: { word: 'Not run (skipped)', tone: 'muted' },
  none: { word: 'No result', tone: 'muted' },
};

export const FRESHNESS: Record<Freshness, { word: string; tone: Tone }> = {
  current: { word: 'Current', tone: 'good' },
  stale: { word: 'Stale', tone: 'warn' },
  unknown: { word: 'Revision unknown', tone: 'muted' },
  none: { word: 'No run', tone: 'muted' },
};

export const SOURCE_WORD: Record<string, string> = { 'pr-checks': 'CI (pr-checks)', 'report-file': 'Report file', 'gate-check': 'Office gate-check' };

/** A revision as people read it: 7 characters of a sha, "unknown" spelled out. */
export const rev = (r: Revision | undefined) => (r && r !== UNKNOWN ? shortRev(r) : 'unknown');

/** "recorded" / "inferred (business rule id in the PR title)". */
export const linkWord = (l: Pick<Link, 'basis' | 'rule'>) => (l.basis === 'recorded' ? 'recorded' : `inferred${l.rule ? ` (${l.rule})` : ''}`);

/** "3 passed · 1 failed" (zeroes left out; "no results" when all are). */
export function countLine(c: { passed: number; failed: number; skipped: number }): string {
  const parts = [c.passed ? `${c.passed} passed` : '', c.failed ? `${c.failed} failed` : '', c.skipped ? `${c.skipped} skipped` : ''].filter(Boolean);
  return parts.join(' · ') || 'no results';
}

/** A count group's line: "2 linked · 1 inferred only · 1 no linked test", with zero groups kept so nothing hides. */
export function countsOf<K extends string>(counts: Record<K, number>, words: Record<K, { word: string }>): { key: K; n: number; word: string }[] {
  return (Object.keys(words) as K[]).map((key) => ({ key, n: counts[key] ?? 0, word: words[key].word }));
}

/** An ISO time as "12 Oct 14:05" (the browser's zone); '' when there's none. */
export function when(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
