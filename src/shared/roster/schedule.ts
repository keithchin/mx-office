// When the daily standup is due: weekdays at 09:00 Asia/Singapore unless the CTO sets another time,
// and only when the floor had activity since the last one, so a quiet project costs nothing. Pure
// (Intl only, no Node), so the tests can drive it with any clock.

export interface StandupSchedule {
  enabled: boolean;
  /** Local time of day, HH:MM (24 h). */
  time: string;
  /** An IANA time zone. */
  timeZone: string;
  /** Days of the week it runs on, 0 = Sunday … 6 = Saturday. */
  days: number[];
}

export const DEFAULT_SCHEDULE: StandupSchedule = { enabled: true, time: '09:00', timeZone: 'Asia/Singapore', days: [1, 2, 3, 4, 5] };

/** A schedule from what was saved or sent, with anything malformed put back to the default. */
export function cleanSchedule(v: unknown): StandupSchedule {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<StandupSchedule>;
  const time = typeof s.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : DEFAULT_SCHEDULE.time;
  const timeZone = typeof s.timeZone === 'string' && validZone(s.timeZone) ? s.timeZone : DEFAULT_SCHEDULE.timeZone;
  const days = Array.isArray(s.days) ? [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_SCHEDULE.days;
  return { enabled: s.enabled !== false, time, timeZone, days };
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock parts of `at` in `tz`. */
function partsIn(at: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(at))) p[x.type] = x.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, wd };
}

/** The moment it's `hh:mm` on y-m-d in `tz` (two passes cover a DST change). */
function zoned(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(t, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    t += Date.UTC(y, m - 1, d, hh, mm) - shown;
  }
  return t;
}

/** The date (YYYY-MM-DD) it is at `at` in `tz`: what a standup page is named after. */
export function dayIn(at: number, tz: string): string {
  const p = partsIn(at, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** The latest scheduled slot at or before `now`, within the last week; undefined when there's none. */
export function lastSlot(now: number, s: StandupSchedule): number | undefined {
  if (!s.days.length) return undefined;
  const [hh, mm] = s.time.split(':').map(Number);
  for (let back = 0; back <= 7; back++) {
    const p = partsIn(now - back * 86_400_000, s.timeZone);
    if (!s.days.includes(p.wd)) continue;
    const slot = zoned(p.y, p.m, p.d, hh, mm, s.timeZone);
    if (slot <= now) return slot;
  }
  return undefined;
}

/** The first scheduled slot after `now`, within the next week. */
export function nextSlot(now: number, s: StandupSchedule): number | undefined {
  if (!s.enabled || !s.days.length) return undefined;
  const [hh, mm] = s.time.split(':').map(Number);
  for (let ahead = 0; ahead <= 8; ahead++) {
    const p = partsIn(now + ahead * 86_400_000, s.timeZone);
    if (!s.days.includes(p.wd)) continue;
    const slot = zoned(p.y, p.m, p.d, hh, mm, s.timeZone);
    if (slot > now) return slot;
  }
  return undefined;
}

export type StandupCheck = 'run' | 'skip-no-activity' | 'not-due' | 'off';

/**
 * Whether the scheduled standup should run now. It runs once per slot: not before the slot, not when
 * one ran since, and — so a quiet floor spends nothing — only when there was activity since the last
 * standup (or ever, for the first). A slot more than `graceMs` old (the office was down all day) is let go.
 */
export function standupDue(now: number, s: StandupSchedule, lastRunAt: number | undefined, lastActivityAt: number | undefined, graceMs = 12 * 3_600_000): StandupCheck {
  if (!s.enabled) return 'off';
  const slot = lastSlot(now, s);
  if (slot === undefined || now - slot > graceMs) return 'not-due';
  if (lastRunAt !== undefined && lastRunAt >= slot) return 'not-due';
  if (lastActivityAt === undefined || (lastRunAt !== undefined && lastActivityAt <= lastRunAt)) return 'skip-no-activity';
  return 'run';
}

/** The ISO week a date falls in (2026-W40), for the Chief Analyst's weekly insight memo. */
export function isoWeek(at: number, tz: string): string {
  const p = partsIn(at, tz);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}
