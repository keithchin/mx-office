// The Test Mode page's pure parts (ui/testlab/): words for times and sizes, the key that says whether a
// poll brought anything new (so the page draws only then), the rows a chart gets, and the axis's ticks.
// No DOM here: tests/testlab.test.ts runs it in Node.

import type { RunResult, RunSummary, TestLabView, ViewResult } from '../../../shared/testlab';

/** Rows drawn at most in any list on the page (the history, a run's views and steps, its log lines). */
export const MAX_ROWS = 60;
/** Lines of a run's log kept on screen while it runs. */
export const LOG_LINES = 400;

export const ms = (v: number | null | undefined) => (v == null ? '–' : v >= 10_000 ? `${(v / 1000).toFixed(0)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%`);
export const mb = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(1)} MB`);
export const duration = (v: number | undefined) => (v == null ? '–' : v >= 60_000 ? `${Math.floor(v / 60_000)} min ${Math.round((v % 60_000) / 1000)} s` : ms(v));

export const STATUS_WORD: Record<RunSummary['status'], string> = { running: 'Running', pass: 'Pass', fail: 'Fail', error: 'Error' };

/** What the page shows of the view, as one string: the same string, nothing to draw again. */
export function viewKey(v: TestLabView | undefined): string {
  if (!v) return '';
  const r = v.running;
  return JSON.stringify([v.testMode.on, v.refusal ?? '', r ? [r.id, r.progress?.done, r.progress?.of, r.progress?.label] : 0, v.history.slice(0, MAX_ROWS).map((h) => [h.id, h.status, h.finishedAt ?? 0, h.headline ?? '', h.incidents ? Object.keys(h.incidents).length : 0])]);
}

/** One bar of a chart: a view's name, its value, and whether it went over its budget. */
export interface Bar {
  id: string;
  label: string;
  value: number;
  over: boolean;
  tip: string;
}

/** A chart's rows from a pages run: the longest task per view, or the time to usable. */
export function barsOf(r: RunResult, what: 'longest' | 'ttu', budget: number): Bar[] {
  return (r.views ?? []).slice(0, MAX_ROWS).map((v: ViewResult) => {
    const value = what === 'longest' ? v.longestTaskMs : (v.ttuMs ?? 0);
    const over = what === 'ttu' && v.ttuMs == null ? true : value > budget;
    const tip = what === 'longest' ? `${v.name}: longest task ${ms(v.longestTaskMs)} (${v.longTasks.length} long task${v.longTasks.length === 1 ? '' : 's'}), budget ${ms(budget)}` : `${v.name}: usable after ${v.ttuMs == null ? 'never (timed out)' : ms(v.ttuMs)}, budget ${ms(budget)}`;
    return { id: v.id, label: v.name, value, over, tip };
  });
}

/** Round ticks from 0 up to at least `max` (and the budget), three to five of them. */
export function ticksFor(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** The last `n` lines of a log that keeps growing (what's kept on screen). */
export function tailLines(text: string, n = LOG_LINES): string {
  const lines = text.split('\n');
  return lines.length <= n ? text : lines.slice(-n).join('\n');
}

/** The heap's growth over the soak as a word: within budget or over it. */
export const heapWord = (v: ViewResult, limitPct: number) => (v.heapGrowthPct == null ? '–' : `${pct(v.heapGrowthPct)}${v.heapGrowthPct > limitPct ? ' (over)' : ''}`);
