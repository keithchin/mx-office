// The team journals as chatter (docs/team/<team>.md, read like the Team tab does: the hired Lead's
// worktree first, then the checkout, roster/journal-io.ts). Each entry the chatter hasn't read yet is
// a message from the team's Lead; its lines that name another member ("I handed the specs to Anita")
// are said to that member, and lines naming the Project Manager to them. Incremental: each team's
// cursor is the entries already read, so an entry is one message however often it's looked at.

import type { ChatterParty, ChatterTo } from '../../shared/chatter.js';
import { parseJournal, type JournalEntry } from '../../shared/roster/journal.js';
import { journalPath, ROLES, type RoleDef } from '../../shared/roster/roles.js';
import { excerpt, readJournalSoon } from '../roster/journal-io.js';
import type { RosterData } from '../roster/store.js';
import type { TeamFloor } from '../roster/types.js';
import type { ChatterDraft } from './bus.js';
import { BACKFILL_MS, type ChatterSource } from './sources.js';

/** A team's cursor remembers this many entries; older ones are below the backfill line anyway. */
const CURSOR_KEPT = 300;
/** On the first look at a journal, at most this many of its latest entries become messages. */
const FIRST_LOOK = 3;

/** Each entry's key: date|heading, and #n for the nth entry with that same heading. */
export function entryKeys(entries: JournalEntry[]): string[] {
  const n = new Map<string, number>();
  return entries.map((e) => {
    const k = `${e.date}|${e.heading}`;
    const i = (n.get(k) ?? 0) + 1;
    n.set(k, i);
    return `${k}#${i}`;
  });
}

/** Milliseconds `tz` is ahead of UTC at `at`. */
function offsetIn(tz: string, at: number): number {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(at / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** When an entry was written, from its heading's `YYYY-MM-DD HH:MM` (the office stamps headings in the schedule's time zone); undefined without a time. */
export function headingTime(e: JournalEntry, tz: string): number | undefined {
  const m = new RegExp(`${e.date}[ T](\\d{1,2}):(\\d{2})`).exec(e.heading);
  if (!m) return undefined;
  const [y, mo, d] = e.date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, +m[1], +m[2]);
  return guess - offsetIn(tz, guess);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The mention key of the Project Manager (the person; the Coordinator's role id is pm). */
export const PM = '@pm';

/** The entry's lines that name someone, by who they name (PM for the Project Manager). */
export function mentions(body: string, names: { key: string; name: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const res = names.map((n) => ({ key: n.key, re: n.key === PM ? /\b(Project Manager|the PM)\b/ : new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(n.name)}(?![\\p{L}\\p{N}_])`, 'u') }));
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').replace(/\*\*|__|`/g, '').trim();
    if (!line || /^#/.test(line)) continue;
    for (const { key, re } of res) if (re.test(line)) out.set(key, [...(out.get(key) ?? []), line]);
  }
  return out;
}

/** One entry as drafts: one per person its lines name, else one to the team. */
export function entryDrafts(d: RosterData, r: RoleDef, e: JournalEntry, key: string, at: number): ChatterDraft[] {
  const m = d.members[r.id];
  const from: ChatterParty = { name: m.name, kind: 'agent', roleId: r.id, ...(m.workerId ? { workerId: m.workerId } : {}) };
  const ref = { journal: `${journalPath(r.team)}#${e.heading}` };
  const others = ROLES.filter((x) => x.id !== r.id).map((x) => ({ key: x.id as string, name: d.members[x.id].name }));
  const said = mentions(e.body, [...others, { key: PM, name: 'Project Manager' }]);
  const base = { kind: 'journal' as const, from, at, ref };
  if (!said.size) return [{ ...base, to: { group: 'team' }, text: `${title(e)}: ${flat(e.body)}`, key: `j:${r.team}:${key}` }];
  return [...said].map(([who, lines]) => {
    const to: ChatterTo = who === PM ? { group: 'pm' } : { name: d.members[who as RoleDef['id']].name, kind: 'agent', roleId: who as RoleDef['id'], ...(d.members[who as RoleDef['id']].workerId ? { workerId: d.members[who as RoleDef['id']].workerId } : {}) };
    return { ...base, to, text: lines.join(' '), key: `j:${r.team}:${key}:${who}` };
  });
}

/** An entry's body in a line: `### Done` as "Done:", list markers gone. */
export function flat(body: string, n = 360): string {
  return excerpt(body.replace(/^###+\s*(.+?)\s*$/gm, '$1:').replace(/^\s*(?:[-*]|\d+\.)\s+/gm, ''), n);
}

/** The heading without its date and time: "Standup", "Handing over". */
export function title(e: Pick<JournalEntry, 'heading' | 'date'>): string {
  return e.heading.replace(e.date, '').replace(/^[\s—–:-]*(\d{1,2}:\d{2})?[\s—–:-]*/, '').trim() || e.heading;
}

/** What the journal source reads a file with: the real one reads the disk (journal-io.ts); the tests hand it text. */
export type JournalReader = (floor: TeamFloor, r: RoleDef, d: RosterData) => JournalEntry[];

const diskReader: JournalReader = (floor, r, d) => {
  const id = d.members[r.id].workerId;
  // From what was last read in the background: a look never waits on the disk (journal-io.ts).
  return readJournalSoon(floor, id ? floor.worker(id) : undefined, r.team);
};

export const textReader = (text: string): JournalEntry[] => parseJournal(text);

export function journalSource(read: JournalReader = diskReader): ChatterSource {
  return {
    id: 'journal',
    collect(floor, { roster, now, state }) {
      const d = roster.data(floor.id);
      const tz = d.settings.schedule.timeZone;
      const out: ChatterDraft[] = [];
      for (const r of ROLES) {
        const entries = read(floor, r, d);
        if (!entries.length) continue;
        const keys = entryKeys(entries);
        const had = state.journals[r.team];
        const seen = new Set(had ?? []);
        // First look: only the latest few, and only if they're recent; the rest are history.
        const fresh = entries.map((e, i) => ({ e, key: keys[i] })).filter((x) => !seen.has(x.key));
        const take = had ? fresh : fresh.slice(-FIRST_LOOK);
        for (const { e, key } of take) {
          const stamped = headingTime(e, tz);
          const at = Math.min(now, stamped ?? (had ? now : Date.parse(`${e.date}T12:00:00Z`)));
          if (!had && now - at > BACKFILL_MS) continue;
          out.push(...entryDrafts(d, r, e, key, at));
        }
        state.journals[r.team] = [...(had ?? []), ...fresh.map((x) => x.key)].slice(-CURSOR_KEPT);
      }
      return out;
    },
  };
}
