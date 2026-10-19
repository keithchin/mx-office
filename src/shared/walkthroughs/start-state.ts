// What a test journey needs from the database before it starts, so a batch of walkthroughs can play each one
// on the start state it was written for (./plan.ts). Journeys say it in two ways:
//   * a structured field at the journey's top level (the recommended form):
//       "startState": { "freshDb": true, "after": "<journey id>", "before": ["<journey id>"], "rerunnable": false,
//                       "leavesData": true, "notRunBetween": ["07:30-08:00"], "timeZone": "Europe/Amsterdam" }
//   * prose in `$comment`, as the toolkit's journeys do today ("START STATE: fresh DB with the demo seed only…",
//     "run directly after <id>", "Run BEFORE <id>", "NOT re-runnable", "leaves one draft behind",
//     "Do not run between 07:30-08:00 … in Europe/Amsterdam"). That is read conservatively: what the START
//     STATE line says when there is one, a journey id only when it names a journey of the same commit, and
//     anything unclear means "no particular start state" with a note saying so.
// Scaffolding is no workflow: the toolkit's `example`, `skeleton*`, anything marked broken (a control that
// must fail) and a journey with `"template": true` are templates, listed but never recorded. Pure.

type Json = Record<string, unknown>;

/** A time of day a journey must not run in ("07:30"–"08:00"), in a named time zone (else the office's). */
export interface TimeWindow {
  from: string;
  to: string;
  zone?: string;
}

export interface StartState {
  /** It needs a database with only the demo seed: it starts a group of its own (a fresh database). */
  freshDb: boolean;
  /** It runs directly after this journey, on the same database (that journey's data is its precondition). */
  after?: string;
  /** On a shared database it must run before these. */
  before?: string[];
  /** A second run on the same database fails (it finds its own data). */
  notRerunnable?: boolean;
  /** It leaves data behind that other journeys would trip over: last in its group. */
  leavesData?: boolean;
  /** Scaffolding, not a workflow: never recorded. */
  template?: boolean;
  /** Why it's a template, in words. */
  templateWhy?: string;
  /** Times it must not run in. */
  windows?: TimeWindow[];
  /** Where this came from. */
  from: 'field' | 'comment' | 'none';
  /** What was read, guessed or ignored, for the page and the manifest. */
  notes: string[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const commentLines = (j: Json): string[] =>
  (Array.isArray(j.$comment) ? j.$comment : [j.$comment])
    .filter((x): x is string => typeof x === 'string')
    .flatMap((l) => l.split(/\r?\n/))
    .map((l) => l.trim())
    .filter(Boolean);

/** A journey file's stem: tests/e2e/new-request.journey.json → new-request. */
export const stemOf = (file: string) => file.split('/').pop()!.replace(/\.journey\.json$/i, '');

/** Why a journey is scaffolding rather than a workflow, or undefined. */
export function templateWhy(id: string, file: string, j: Json): string | undefined {
  const stem = stemOf(file);
  if (j.template === true) return 'marked as a template ("template": true)';
  if (j.broken === true || /broken/i.test(id) || /broken/i.test(stem)) return 'a deliberately broken control (it must fail)';
  if (/^example$/i.test(stem) || /^example$/i.test(id)) return 'the toolkit’s worked example';
  if (/^skeleton/i.test(stem) || /^skeleton/i.test(id)) return 'the walking-skeleton template';
  return undefined;
}

const REF = /[`'"“”‘’]?([A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\.journey\.json)?[`'"“”‘’]?(?=[\s.,;:)!?]|$)/;
const ref = (s: string): string | undefined => REF.exec(s.trim())?.[1]?.replace(/[.]+$/, '');
const ZONE = /\b((?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?|UTC)\b/;
const HHMM = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|–|—|to|until)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
const two = (h: string) => h.padStart(2, '0');

/** "Do not run between 07:30-08:00 or 19:30-20:00 … Europe/Amsterdam" → the windows. */
export function windowsIn(line: string): TimeWindow[] {
  const m = /\b(?:do not|don['’]t|never)\s+run\s+(?:between|from|during)\b/i.exec(line);
  if (!m) return [];
  const zone = ZONE.exec(line)?.[1];
  const tail = line.slice(m.index);
  return [...tail.matchAll(HHMM)].map((x) => ({ from: `${two(x[1])}:${x[2]}`, to: `${two(x[3])}:${x[4]}`, ...(zone ? { zone } : {}) }));
}

/** The structured `startState` field, or undefined when there's none. */
function fromField(v: unknown, notes: string[]): Omit<StartState, 'from' | 'notes' | 'template' | 'templateWhy'> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const f = v as Json;
  const before = (Array.isArray(f.before) ? f.before : typeof f.before === 'string' ? [f.before] : []).map(str).filter((x): x is string => !!x);
  const zone = str(f.timeZone);
  const windows = (Array.isArray(f.notRunBetween) ? f.notRunBetween : typeof f.notRunBetween === 'string' ? [f.notRunBetween] : []).flatMap((w) => (typeof w === 'string' ? windowsIn(`do not run between ${w}${zone ? ` ${zone}` : ''}`) : []));
  if (f.freshDb !== undefined && typeof f.freshDb !== 'boolean') notes.push('startState.freshDb isn’t true or false: read as false');
  return {
    freshDb: f.freshDb === true,
    ...(str(f.after) ? { after: str(f.after) } : {}),
    ...(before.length ? { before } : {}),
    ...(f.rerunnable === false ? { notRerunnable: true } : {}),
    ...(f.leavesData === true ? { leavesData: true } : {}),
    ...(windows.length ? { windows } : {}),
  };
}

/**
 * A journey's start state as the file says it; `after` and `before` are as written (journey ids or file
 * stems), resolved against the commit's journeys by resolveStartStates.
 */
export function readStartState(id: string, file: string, j: Json): StartState {
  const notes: string[] = [];
  const tw = templateWhy(id, file, j);
  const tpl = tw ? { template: true, templateWhy: tw } : {};
  const lines = commentLines(j);
  const windows = lines.flatMap(windowsIn);
  const field = fromField(j.startState, notes);
  if (field) {
    if (!field.windows && windows.length) field.windows = windows;
    return { ...field, ...tpl, from: 'field', notes };
  }
  const starts = lines.filter((l) => /\b(start state|pre-?conditions?)\s*:/i.test(l));
  const scope = starts.length ? starts : lines;
  let freshDb = false;
  for (const l of scope) {
    // What the START STATE line says first ("fresh DB with…", "any DB with…"); without one, any line.
    const head = starts.length ? (l.split(/\b(?:start state|pre-?conditions?)\s*:/i)[1] ?? l).split(/[.;(]/)[0] : l;
    if (/\b(fresh|clean|empty|new)\s+(db|database)\b/i.test(head) && !/\bany\s+(db|database)\b/i.test(head)) freshDb = true;
  }
  if (freshDb && !starts.length) notes.push('no START STATE line: “fresh DB” read off the rest of the comment');
  let after: string | undefined;
  const before: string[] = [];
  for (const l of scope) {
    const a = /\brun\s+(?:it\s+|this\s+)?(?:directly\s+|right\s+|immediately\s+|straight\s+)?after\s+(.+)/i.exec(l);
    if (a && !after) after = ref(a[1]);
    for (const b of l.matchAll(/\brun\s+(?:it\s+|this\s+)?before\s+(.+?)(?=$|\brun\b)/gi)) {
      const r = ref(b[1]);
      if (r && !before.includes(r)) before.push(r);
    }
  }
  const all = lines.join(' \n ');
  const notRerunnable = /\bnot\s+re-?runnable\b|\bcan(?:not|['’]t)\s+be\s+(?:re-?run|run\s+twice)\b/i.test(all);
  const leavesData = /\bleaves\s+(?!no\b|nothing\b)[^.\n]*?\bbehind\b/i.test(all);
  const said = freshDb || after || before.length || notRerunnable || leavesData;
  if (!said && !tw) notes.push(starts.length ? 'its START STATE line names no fresh database and no journey to run after: shares a database' : 'says nothing about its start state: shares a database');
  return {
    freshDb,
    ...(after ? { after } : {}),
    ...(before.length ? { before } : {}),
    ...(notRerunnable ? { notRerunnable } : {}),
    ...(leavesData ? { leavesData } : {}),
    ...(windows.length ? { windows } : {}),
    ...tpl,
    from: said || windows.length ? 'comment' : 'none',
    notes,
  };
}

/**
 * `after` / `before` resolved to the ids of the commit's journeys (by id or file stem, any case). A name
 * that is no journey there, the journey itself, or a template is dropped with a note. Returns new objects.
 */
export function resolveStartStates<T extends { journey: string; file: string; start?: StartState }>(list: readonly T[]): Map<string, StartState> {
  const byKey = new Map<string, string>();
  for (const s of list) {
    if (s.start?.template) continue;
    byKey.set(s.journey.toLowerCase(), s.journey);
    if (!byKey.has(stemOf(s.file).toLowerCase())) byKey.set(stemOf(s.file).toLowerCase(), s.journey);
  }
  const out = new Map<string, StartState>();
  for (const s of list) {
    const st: StartState = s.start ? { ...s.start, notes: [...s.start.notes] } : { freshDb: false, from: 'none', notes: ['says nothing about its start state: shares a database'] };
    const look = (r: string, how: string): string | undefined => {
      const id = byKey.get(r.toLowerCase());
      if (!id) st.notes.push(`says ${how} “${r}”, but no journey of this commit is called that: ignored`);
      else if (id === s.journey) st.notes.push(`says ${how} itself: ignored`);
      else return id;
      return undefined;
    };
    if (st.after) {
      const id = look(st.after, 'it runs after');
      if (id) st.after = id;
      else delete st.after;
    }
    if (st.before) {
      const ids = st.before.map((b) => look(b, 'it runs before')).filter((x): x is string => !!x);
      if (ids.length) st.before = [...new Set(ids)];
      else delete st.before;
    }
    out.set(s.journey, st);
  }
  return out;
}

/** The time of day in `zone` (HH:MM, 24 h), or undefined for a zone this runtime doesn't know. */
export function clockIn(zone: string | undefined, now: Date): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(zone ? { timeZone: zone } : {}) }).formatToParts(now);
    const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${hh}:${mm}`;
  } catch {
    return undefined;
  }
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The window `now` is in (or will be within `aheadMin` minutes: a recording takes a while), with the
 * clock there; undefined when it's clear. A window across midnight (23:00–01:00) is understood.
 */
export function windowNow(windows: readonly TimeWindow[] | undefined, now: Date, aheadMin = 5): { w: TimeWindow; clock: string; zoneUnknown?: boolean } | undefined {
  for (const w of windows ?? []) {
    let clock = clockIn(w.zone, now);
    let zoneUnknown = false;
    if (!clock) {
      clock = clockIn(undefined, now)!;
      zoneUnknown = true;
    }
    const t = mins(clock);
    const a = mins(w.from);
    const b = mins(w.to);
    const inside = (x: number) => (a <= b ? x >= a && x < b : x >= a || x < b);
    for (let d = 0; d <= aheadMin; d++) if (inside((t + d) % 1440)) return { w, clock, ...(zoneUnknown ? { zoneUnknown } : {}) };
  }
  return undefined;
}

/** A window in words: "07:30–08:00 Europe/Amsterdam". */
export const windowWords = (w: TimeWindow) => `${w.from}–${w.to}${w.zone ? ` ${w.zone}` : ''}`;
