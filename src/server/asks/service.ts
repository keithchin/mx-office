// The surfaced asks' service ("nothing waits on the PM unseen", 2026-10-13): every few minutes, and soon
// after a bench, a pause or a turn ends, one look per floor at where the team's words are (sources.ts:
// the floor's folder, the agents' worktrees, the local branch heads; off the event loop). AWAITING-PM
// items become escalations (awaiting.ts); the rest (work not on main, assumptions without consent, gate
// advisories, what's ready for review: detect.ts) is a cached view Needs you reads through GET /api/asks.
// Its buttons come here: a message to whoever covers Management through the team's own tell (after their
// turn), or "seen", which hides an item until it changes. Never a write to the repo, never a fetch, never
// a GitHub call.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditInput } from '../../shared/audit.js';
import type { AskAct, AskItem, AsksView, BranchStandup } from '../../shared/asks.js';
import type { Escalation, EscalationAsk } from '../../shared/roster/escalation.js';
import type { RoleId, TeamId } from '../../shared/roster/roles.js';
import { journalPath, ROLES } from '../../shared/roster/roles.js';
import { awaitingAsk, awaitingKey, newestWaits, planAwaiting } from './awaiting.js';
import { anyFailed, placesOf, readEverywhere, type AskPerson, type Read } from './sources.js';
import { actMessage, detectAsks, DETECT_FILES, type DetectInput } from './detect.js';

/** How often each floor is looked at. */
export const LOOK_MS = 5 * 60_000;
/** A look asked for soon (a bench, a pause, a turn's end) waits this long, so a burst is one look. */
export const SOON_MS = 20_000;
/** And comes no sooner than this after the floor's last look: turns end every minute on a busy team. */
export const SOON_GAP_MS = 2 * 60_000;

export interface AsksFloor {
  id: string;
  name: string;
  dir: string;
  /** Its workers with their worktrees, and the team members (for their names and roles). */
  people(): AskPerson[];
}

export interface AsksDeps {
  dataDir: string;
  floors(): Iterable<AsksFloor>;
  now(): number;
  /** The member who writes `team`'s journal on the floor (its own Lead, or whoever covers it), when there's a team. */
  writerOf(floor: AsksFloor, team: TeamId): { role: RoleId; name: string } | undefined;
  escalations(floor: AsksFloor): readonly Escalation[];
  /** Files one on the member's behalf (never FYI), marked as from an AWAITING-PM item. */
  raise(floor: AsksFloor, role: RoleId, ask: EscalationAsk, key: string): void;
  /** Its AWAITING-PM line is gone (`what` says so), or back (undefined): never settled by itself. */
  markGone(floor: AsksFloor, id: string, what: string | undefined): void;
  /** What the rest of the detectors read of main and the floor (detect.ts). */
  detectInput(floor: AsksFloor, reads: readonly Read[]): Promise<Omit<DetectInput, 'reads' | 'now'>>;
  /** Whoever covers Management, and the team's tell to them as the Project Manager (an error, or undefined once sent or held). */
  lead(floor: AsksFloor): { name: string } | undefined;
  tell(floor: AsksFloor, text: string, by: string, owner?: string): string | undefined | Promise<string | undefined>;
  record(e: AuditInput): void;
}

interface FloorState {
  items: AskItem[];
  standup?: BranchStandup;
  at?: number;
  /** Items marked seen: id → when. */
  seen: Record<string, number>;
  /** When the last look couldn't read the team's files: the items are kept from the look before. */
  unreadAt?: number;
}

const ACTOR = { kind: 'office' as const, name: 'Surfaced asks' };

export class AsksService {
  private state = new Map<string, Promise<FloorState>>();
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private soonTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;
  private looking = new Set<string>();
  private lastLook = new Map<string, number>();

  constructor(private readonly deps: AsksDeps) {}

  start() {
    this.stopped = false;
    const first = (this.first = setTimeout(() => void this.lookAll(), 45_000));
    first.unref?.();
    this.timer = setInterval(() => void this.lookAll(), LOOK_MS);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.first);
    clearInterval(this.timer);
    for (const t of this.soonTimers.values()) clearTimeout(t);
    this.soonTimers.clear();
  }

  private file(floorId: string) {
    return path.join(this.deps.dataDir, 'asks', `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  /** The floor's state: what was seen read from disk the first time (asynchronously). */
  private stateOf(floorId: string): Promise<FloorState> {
    let p = this.state.get(floorId);
    if (!p) {
      p = readFile(this.file(floorId), 'utf8').then(
        (t) => ({ items: [], seen: (JSON.parse(t) as { seen?: Record<string, number> }).seen ?? {} }),
        () => ({ items: [], seen: {} }),
      );
      this.state.set(floorId, p);
    }
    return p;
  }

  private async save(floorId: string, s: FloorState) {
    if (this.stopped) return;
    const f = this.file(floorId);
    try {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(`${f}.tmp`, JSON.stringify({ seen: s.seen }));
      await rename(`${f}.tmp`, f);
    } catch (err) {
      console.error(`agent-office: asks: couldn't save ${floorId}: ${(err as Error).message}`);
    }
  }

  /** A look at `floorId` soon: after a bench, a pause or a turn's end (a burst is one look). */
  soon(floorId: string, why = 'soon after the turn') {
    if (this.stopped) return;
    clearTimeout(this.soonTimers.get(floorId));
    const wait = Math.max(SOON_MS, (this.lastLook.get(floorId) ?? 0) + SOON_GAP_MS - this.deps.now());
    const t = setTimeout(() => {
      this.soonTimers.delete(floorId);
      const f = [...this.deps.floors()].find((x) => x.id === floorId);
      if (f) void this.look(f, why).catch((err: unknown) => console.error(`agent-office: asks: couldn't look at ${floorId}: ${(err as Error)?.message ?? err}`));
    }, wait);
    t.unref?.();
    this.soonTimers.set(floorId, t);
  }

  /** Every floor, one after another; never throws. */
  async lookAll(): Promise<void> {
    if (this.stopped) return;
    for (const f of this.deps.floors()) {
      try {
        await this.look(f, 'in its regular look');
      } catch (err) {
        console.error(`agent-office: asks: couldn't look at ${f.id}: ${(err as Error).message}`);
      }
    }
  }

  /** One look at a floor: escalate and settle AWAITING-PM items, and work out the rest of the view. Never overlaps itself per floor. */
  async look(floor: AsksFloor, why: string): Promise<void> {
    if (this.stopped || this.looking.has(floor.id)) return;
    this.looking.add(floor.id);
    this.lastLook.set(floor.id, this.deps.now());
    try {
      const people = floor.people();
      const places = await placesOf(floor.dir, people);
      const journals = [...new Set(ROLES.map((r) => journalPath(r.team)))];
      const reads = await readEverywhere(floor.dir, places, [...journals, ...DETECT_FILES]);
      this.awaiting(floor, reads, why);
      const s = await this.stateOf(floor.id);
      const now = this.deps.now();
      // A failed read keeps what the last look found, marked as not re-read (nothing settles on a failed read).
      if (anyFailed(reads, DETECT_FILES)) {
        s.unreadAt = now;
        s.at = now;
        return;
      }
      delete s.unreadAt;
      const found = detectAsks({ ...(await this.deps.detectInput(floor, reads)), reads, now });
      s.items = found.items;
      s.standup = found.standup;
      s.at = now;
      // What was marked seen is forgotten once its item is gone (a new set of artifacts is a new id).
      const ids = new Set(found.items.map((i) => i.id));
      for (const id of Object.keys(s.seen)) if (!ids.has(id)) delete s.seen[id];
      await this.save(floor.id, s);
    } finally {
      this.looking.delete(floor.id);
    }
  }

  private awaiting(floor: AsksFloor, reads: readonly Read[], why: string) {
    const waits = newestWaits(reads);
    const writer = (team: TeamId) => this.deps.writerOf(floor, team);
    const plan = planAwaiting(waits, (team) => writer(team)?.role, this.deps.escalations(floor), reads);
    for (const r of plan.raise) {
      const name = writer(r.waits.team)?.name ?? r.role;
      this.deps.raise(floor, r.role, awaitingAsk(name, r.item, r.waits, why), awaitingKey(r.role, r.item));
    }
    for (const e of plan.gone) this.deps.markGone(floor, e.id, `The AWAITING-PM line is gone from ${e.by}'s newest entry`);
    for (const e of plan.back) this.deps.markGone(floor, e.id, undefined);
  }

  /** What Needs you shows: the items not marked seen. */
  async view(floor: AsksFloor, admin: boolean): Promise<AsksView> {
    const s = await this.stateOf(floor.id);
    return { floor: floor.id, items: s.items.filter((i) => !s.seen[i.id]), ...(s.standup ? { standup: s.standup } : {}), ...(s.at ? { at: s.at } : {}), ...(s.unreadAt ? { unreadAt: s.unreadAt } : {}), admin };
  }

  /** The newest standup's "Blocked on you" off the lead's branch, labelled, for the standup page. */
  async blockedLines(floor: AsksFloor): Promise<string[]> {
    const s = await this.stateOf(floor.id);
    return s.standup ? s.standup.blocked.map((b) => `${b} (from ${s.standup!.who}'s branch, not on main yet)`) : [];
  }

  /** A button on an item: the error, or undefined when it's done. */
  async act(floor: AsksFloor, id: string, act: AskAct, o: { by: string; owner?: string }): Promise<string | undefined> {
    const s = await this.stateOf(floor.id);
    const it = s.items.find((i) => i.id === id);
    if (!it) return 'That item is no longer there';
    if (!it.acts.some((a) => a.act === act)) return `"${act}" isn't an action of this item`;
    const base = { floor: floor.id, actor: { kind: 'human' as const, name: o.by, ...(o.owner ? { id: o.owner } : {}) }, target: { kind: 'ask', id, label: it.text.slice(0, 80) } };
    if (act === 'seen' || act === 'documents') {
      if (act === 'seen') {
        s.seen[id] = this.deps.now();
        this.deps.record({ ...base, action: 'asks.seen', summary: `Marked as seen: ${it.text}` });
        await this.save(floor.id, s);
      }
      return undefined;
    }
    const msg = actMessage(act, it, o.by, this.deps.now());
    if (!msg) return 'Nothing to send';
    const lead = this.deps.lead(floor);
    if (!lead) return 'This project has no team lead to ask';
    const err = await this.deps.tell(floor, msg, o.by, o.owner);
    if (err) return err;
    this.deps.record({ ...base, action: `asks.${act}`, summary: `Asked ${lead.name} (after their turn): ${it.text}`, details: { act, lead: lead.name } });
    if (act === 'agree' || act === 'docs-pr') s.seen[id] = this.deps.now();
    await this.save(floor.id, s);
    return undefined;
  }
}

export { ACTOR as ASKS_ACTOR };
