// The Roadmap timeline's geometry, pure: the date range the lanes cover (Discovery's end to Cutover's end, with
// today inside it), the weekly ticks on its axis, where a date falls in percent, and the overlap bands (a later
// phase started early while the one before it still runs). The page (ui/roadmap/timeline.ts) draws them.

import type { PhaseLine, PhasesView } from './view.js';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "30 Oct" for a time. */
export const dayWord = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export interface Range {
  from: number;
  to: number;
}

/** The days the lanes cover: from a little before the first bar to the end of Cutover, today included. */
export function rangeOf(v: Pick<PhasesView, 'phases' | 'discovery' | 'cutover' | 'now'>): Range {
  const starts = v.phases.map((l) => l.span.earlyFrom ?? l.span.start);
  const from = Math.min(v.now, ...(starts.length ? starts : [v.now])) - 4 * DAY;
  const to = Math.max(v.now + 2 * DAY, v.cutover.end, ...v.phases.map((l) => l.span.end));
  return { from: Math.floor(from / DAY) * DAY, to: Math.ceil(to / DAY) * DAY };
}

/** Where `t` falls, 0–100. */
export const pct = (r: Range, t: number) => Math.max(0, Math.min(100, ((t - r.from) / Math.max(DAY, r.to - r.from)) * 100));

/** The axis's ticks: every Monday in the range (every other one past 10 weeks), with their words. */
export function ticks(r: Range): { at: number; label: string }[] {
  const out: { at: number; label: string }[] = [];
  const d = new Date(r.from);
  d.setHours(0, 0, 0, 0);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  const weeks = (r.to - d.getTime()) / (7 * DAY);
  const step = weeks > 10 ? 14 : 7;
  for (let t = d.getTime(); t <= r.to; ) {
    out.push({ at: t, label: dayWord(t) });
    const n = new Date(t);
    n.setDate(n.getDate() + step);
    t = n.getTime();
  }
  return out;
}

export interface Band {
  /** The two lanes' places (3, 4). */
  a: number;
  b: number;
  from: number;
  to: number;
  label: string;
}

/** The overlaps to draw: a phase with early work, against each running phase it overlaps, while both ran. */
export function bands(lines: readonly PhaseLine[]): Band[] {
  const out: Band[] = [];
  for (const l of lines) {
    if (l.span.earlyFrom === undefined) continue;
    for (const o of l.overlaps) {
      const other = lines[o - 1];
      if (!other || other.order >= l.order) continue;
      const from = l.span.earlyFrom;
      const to = Math.max(from + DAY, Math.min(other.span.end, l.span.start));
      out.push({ a: other.order, b: l.order, from, to, label: `Overlap ${other.order} ↔ ${l.order} · ${dayWord(from)} – ${dayWord(to)}` });
    }
  }
  return out;
}
