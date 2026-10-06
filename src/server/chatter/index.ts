// The team chatter (docs/teams.md, "Team chatter"): the agent-to-agent exchanges on a floor as one
// thread for the 1D Command Center's 💬 Team chatter and the team pages. Two ways in: what the office
// tells it as it happens (bus.ts: relays to the Project Coordinator, nudges, office-workers tell and
// hire, subagent dispatches), and what it reads every few seconds from what the office already keeps
// (sources.ts: escalations, answers, standups, handoffs and reviews off the roster; journal.ts: the
// team journals). Each message gets its speakers' roles, is redacted (Jeff's redaction) and clipped,
// appended to the floor's capped JSONL (store.ts) and sent to the floor's browsers as chatter.new. No
// model calls, and nothing is invented: a message is always something an agent, a person or the office said.

import { randomBytes, createHash } from 'node:crypto';
import { CHATTER_LONG_MAX, CHATTER_TEXT_MAX, chatterOrder, cursorOf, isGroup, matchesFilter, olderThan, parseCursor, type ChatterFilter, type ChatterMessage, type ChatterPage, type ChatterParty, type ChatterTo } from '../../shared/chatter.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import { redact } from '../judge/pure.js';
import type { Roster } from '../roster/index.js';
import type { TeamFloor } from '../roster/types.js';
import { onChatter, workerParty, type ChatterDraft, type ChatterEvent } from './bus.js';
import { journalSource } from './journal.js';
import { BACKFILL_MS, firmSource, registeredSources, rosterSource, type ChatterSource } from './sources.js';
import { ChatterFile } from './store.js';

export { registerChatterSource } from './sources.js';

/** How often the roster is looked at for new messages, and the journals (they're files). */
export const ROSTER_LOOK_MS = 3_000;
export const JOURNAL_LOOK_MS = 15_000;
export const PAGE_MAX = 200;

export interface ChatterDeps {
  dataDir: string;
  roster: Roster;
  floors(): TeamFloor[];
  floor(id: string): TeamFloor | undefined;
  /** The floor a worker is on, for a dispatch its hook reported. */
  floorOfWorker(workerId: string): TeamFloor | undefined;
  now(): number;
  /** Sends a new message to the floor's browsers. */
  broadcast(floor: string, m: ChatterMessage): void;
}

export interface ChatterQuery {
  since?: number;
  limit?: number;
  cursor?: string | null;
  filter?: ChatterFilter;
}

/** The text as it goes in a bubble: one paragraph, secrets out, at most CHATTER_TEXT_MAX characters. */
export function cleanText(text: string): string {
  const one = redact(text.replace(/\r\n?/g, '\n')).replace(/\s+/g, ' ').trim();
  return one.length > CHATTER_TEXT_MAX ? `${one.slice(0, CHATTER_TEXT_MAX - 1).trimEnd()}…` : one;
}

/** A team phone message as it's kept: its lines and Markdown, secrets out, at most CHATTER_LONG_MAX characters. */
export function cleanLong(text: string): string {
  const t = redact(text.replace(/\r\n?/g, '\n')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > CHATTER_LONG_MAX ? `${t.slice(0, CHATTER_LONG_MAX - 1).trimEnd()}…` : t;
}

const idOf = (key: string) => createHash('sha1').update(key).digest('base64url').slice(0, 14);

export class Chatter {
  private files = new Map<string, ChatterFile>();
  private journalAt = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private off: () => void;
  private sources: { roster: ChatterSource; journal: ChatterSource };

  constructor(readonly deps: ChatterDeps, opts: { lookMs?: number; journal?: ChatterSource } = {}) {
    this.sources = { roster: rosterSource, journal: opts.journal ?? journalSource() };
    this.off = onChatter((ev) => this.onEvent(ev));
    const ms = opts.lookMs ?? ROSTER_LOOK_MS;
    if (ms > 0) {
      this.timer = setInterval(() => this.lookAll(), ms);
      this.timer.unref?.();
    }
  }

  stop() {
    clearInterval(this.timer);
    this.off();
  }

  file(floor: string): ChatterFile {
    let f = this.files.get(floor);
    if (!f) {
      f = new ChatterFile(this.deps.dataDir, floor);
      this.files.set(floor, f);
    }
    return f;
  }

  /** A role title and team for a speaker the office knows only by worker or role. */
  private party(floor: TeamFloor, p: ChatterParty): ChatterParty {
    const out = { ...p };
    if (out.kind === 'agent' && !out.roleId && out.workerId) {
      const role = this.deps.roster.roleOf(floor, out.workerId);
      if (role) out.roleId = role;
    }
    const def = out.roleId ? ROLE_BY_ID.get(out.roleId) : undefined;
    if (def) {
      out.role ??= def.title;
      out.team ??= def.team;
    }
    return out;
  }

  private to(floor: TeamFloor, t: ChatterTo): ChatterTo {
    return isGroup(t) ? t : this.party(floor, t);
  }

  /** Normalises a draft into the floor's thread; the message, or undefined when its key was already in. */
  add(floorId: string, draft: ChatterDraft, save = true): ChatterMessage | undefined {
    const floor = this.deps.floor(floorId);
    const f = this.file(floorId);
    const st = f.state();
    if (draft.key && st.seen[draft.key] !== undefined) return undefined;
    const now = this.deps.now();
    const text = draft.long ? cleanLong(draft.text) : cleanText(draft.text);
    if (!text) return undefined;
    const m: ChatterMessage = {
      id: draft.key ? idOf(`${floorId}:${draft.key}`) : randomBytes(7).toString('base64url'),
      at: Math.min(now, draft.at ?? now),
      floor: floorId,
      from: floor ? this.party(floor, draft.from) : draft.from,
      to: floor ? this.to(floor, draft.to) : draft.to,
      kind: draft.kind,
      text,
      ...(draft.ref ? { ref: draft.ref } : {}),
    };
    if (draft.key) st.seen[draft.key] = m.at;
    f.add(m);
    if (draft.key && save) f.saveState(now);
    this.deps.broadcast(floorId, m);
    return m;
  }

  private onEvent(ev: ChatterEvent) {
    if (ev.t === 'msg') return void this.add(ev.floor, ev.draft);
    const floor = this.deps.floorOfWorker(ev.workerId);
    const w = floor?.worker(ev.workerId);
    if (!floor || !w) return;
    const role = this.deps.roster.roleOf(floor, ev.workerId);
    this.add(floor.id, { kind: 'dispatch', from: workerParty(w), to: { name: ev.agent, kind: 'agent', role: `${w.name}'s subagent`, ...(role ? { team: ROLE_BY_ID.get(role)!.team } : {}) }, text: ev.task, at: ev.at, ref: { subagent: ev.agent } });
  }

  /** Reads every source for one floor; what's new goes in, oldest first. `journals` false skips the files. */
  look(floor: TeamFloor, journals = true): ChatterMessage[] {
    const now = this.deps.now();
    const f = this.file(floor.id);
    const ctx = { roster: this.deps.roster, now, state: f.state() };
    const list: ChatterSource[] = [this.sources.roster, firmSource, ...registeredSources()];
    if (journals) list.push(this.sources.journal);
    const drafts: ChatterDraft[] = [];
    for (const s of list) {
      try {
        drafts.push(...s.collect(floor, ctx));
      } catch (err) {
        console.error(`agent-office: the ${s.id} chatter source on ${floor.id}: ${(err as Error)?.message ?? err}`);
      }
    }
    const added: ChatterMessage[] = [];
    for (const d of drafts.filter((x) => !x.key || ctx.state.seen[x.key] === undefined).sort((a, b) => (a.at ?? now) - (b.at ?? now))) {
      if (d.at !== undefined && now - d.at > BACKFILL_MS) continue;
      const m = this.add(floor.id, d, false);
      if (m) added.push(m);
    }
    if (journals || added.length) f.saveState(now);
    return added;
  }

  lookAll() {
    const now = this.deps.now();
    for (const floor of this.deps.floors()) {
      const journals = now - (this.journalAt.get(floor.id) ?? 0) >= JOURNAL_LOOK_MS;
      if (journals) this.journalAt.set(floor.id, now);
      this.look(floor, journals);
    }
  }

  /** GET /api/chatter: a page of the floor's thread, newest first. */
  page(floorId: string, q: ChatterQuery = {}): ChatterPage {
    const limit = Math.max(1, Math.min(PAGE_MAX, Math.floor(q.limit ?? 50)));
    const cur = parseCursor(q.cursor);
    const filter = q.filter ?? { with: 'all' };
    const all = this.file(floorId)
      .messages()
      .filter((m) => (q.since === undefined || m.at > q.since) && (!cur || olderThan(m, cur)) && matchesFilter(m, filter))
      .sort(chatterOrder);
    const messages = all.slice(0, limit);
    return { floor: floorId, messages, ...(all.length > limit ? { cursor: cursorOf(messages[messages.length - 1]) } : {}) };
  }
}

const offices = new WeakMap<object, Chatter>();

/** The office's chatter, keyed like the roster by the office's config; `make` builds it the first time. */
export function chatterFor(key: object, make?: () => Chatter): Chatter | undefined {
  let c = offices.get(key);
  if (!c && make) {
    c = make();
    offices.set(key, c);
  }
  return c;
}
