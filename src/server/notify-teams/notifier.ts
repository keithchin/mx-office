// What goes out to Teams, and when. Each poll hands over every posting floor's red items (gather.ts);
// this keeps one card per item, ever: the ids it posted are saved (.agent-office/notify-teams-state.json),
// so a restart doesn't post them again. Items raised within a minute of each other go out in one card;
// one handled before its card left never goes. While quiet hours or a pause hold them back they're kept
// (saved too), and once the hold lifts one catch-up card says what came up and what still needs you.
// A failed post is retried a few minutes later; nothing here ever waits on Teams to carry on.

import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from '../flow/store.js';
import { catchUpCard, needsCard, type RedItem, type TeamsMessage } from './cards.js';

/** Items raised within this long of the first go out in one card. */
export const BATCH_MS = 60_000;
/** After a post failed for good, the next try waits this long. */
export const COOLDOWN_MS = 5 * 60_000;
/** A posted item gone from its floor this long (while the office watched it) may post again if it comes back. */
export const FORGET_MS = 30 * 60_000;
/** A posted id is kept no longer than this, whatever happens. */
export const KEEP_MS = 14 * 24 * 3_600_000;

interface SentMark {
  floor: string;
  at: number;
  /** Last poll it was still open. */
  seen: number;
}

interface Held {
  item: RedItem;
  /** It went away while held. */
  resolved?: boolean;
}

export interface NotifierState {
  sent: Record<string, SentMark>;
  held: Held[];
  /** Per floor, the standup slot its last digest was for. */
  digests: Record<string, number>;
}

export interface NotifierDeps {
  now(): number;
  /** Posts; resolves to why it didn't get through, if it didn't. `kind` and `items` are for the audit log. */
  post(msg: TeamsMessage, what: { kind: 'needs' | 'catch-up' | 'digest' | 'test'; items: number; floors: string[] }): Promise<string | undefined>;
  /** Why posting is held back right now ("quiet hours", "paused"), or undefined. */
  holdReason(): string | undefined;
  /** The office's public address for a catch-up card's button. */
  home?(): string | undefined;
  /** Where the state is saved; undefined keeps it in memory (tests). */
  file?: string;
}

export class TeamsNotifier {
  readonly state: NotifierState = { sent: {}, held: [], digests: {} };
  /** Every posting floor's open red items, as of its last poll. */
  private current = new Map<string, RedItem>();
  /** Raised but not posted yet: when each was first seen. */
  private pending = new Map<string, number>();
  /** When this office first polled each floor. */
  private watching = new Map<string, number>();
  private cooldownUntil = 0;
  private busy = false;
  private holdWhy?: string;

  constructor(private readonly deps: NotifierDeps) {
    this.restore();
  }

  get pendingCount() {
    return this.pending.size;
  }
  get heldCount() {
    return this.state.held.filter((h) => !h.resolved).length;
  }

  /** A floor's red items as they are now. */
  observe(floor: string, items: readonly RedItem[]) {
    const now = this.deps.now();
    if (!this.watching.has(floor)) this.watching.set(floor, now);
    const ids = new Set(items.map((i) => i.id));
    for (const [id, it] of this.current) if (it.floor === floor && !ids.has(id)) this.gone(id);
    let dirty = false;
    for (const it of items) {
      this.current.set(it.id, it);
      const sent = this.state.sent[it.id];
      if (sent) {
        sent.seen = now;
        continue;
      }
      const held = this.state.held.find((h) => h.item.id === it.id);
      if (held) {
        if (held.resolved) ((held.resolved = false), (dirty = true));
        held.item = it;
        continue;
      }
      if (!this.pending.has(it.id)) this.pending.set(it.id, now);
    }
    // Held from before a restart and gone now: handled while the office was off.
    for (const h of this.state.held) if (h.item.floor === floor && !h.resolved && !ids.has(h.item.id)) ((h.resolved = true), (dirty = true));
    if (dirty) this.save();
  }

  /** A floor that stopped posting (or closed): what it had raised is dropped. */
  dropFloor(floor: string) {
    for (const [id, it] of this.current) if (it.floor === floor) this.gone(id);
    this.watching.delete(floor);
    const before = this.state.held.length;
    this.state.held = this.state.held.filter((h) => h.item.floor !== floor);
    if (before !== this.state.held.length) this.save();
  }

  private gone(id: string) {
    this.current.delete(id);
    this.pending.delete(id);
    const h = this.state.held.find((x) => x.item.id === id);
    if (h && !h.resolved) {
      h.resolved = true;
      this.save();
    }
  }

  /** Called every poll: hold, catch up, or post the batch whose minute is up. */
  async tick(): Promise<void> {
    if (this.busy) return;
    const now = this.deps.now();
    this.prune(now);
    const hold = this.deps.holdReason();
    if (hold) {
      this.holdWhy = hold;
      if (this.pending.size) {
        for (const id of this.pending.keys()) {
          const it = this.current.get(id);
          if (it) this.state.held.push({ item: it });
        }
        this.pending.clear();
        this.save();
      }
      return;
    }
    if (now < this.cooldownUntil) return;
    this.busy = true;
    try {
      if (this.state.held.length) return await this.catchUp(now);
      if (!this.pending.size) return;
      const first = Math.min(...this.pending.values());
      if (now - first < BATCH_MS) return;
      const ids = [...this.pending.keys()].filter((id) => this.current.has(id));
      if (!ids.length) return void this.pending.clear();
      const items = ids.map((id) => this.current.get(id)!);
      const err = await this.deps.post(needsCard(items, now), { kind: 'needs', items: items.length, floors: [...new Set(items.map((i) => i.floor))] });
      if (err) return void (this.cooldownUntil = this.deps.now() + COOLDOWN_MS);
      for (const it of items) {
        this.pending.delete(it.id);
        this.state.sent[it.id] = { floor: it.floor, at: now, seen: now };
      }
      this.save();
    } finally {
      this.busy = false;
    }
  }

  private async catchUp(now: number) {
    const held = this.state.held;
    const still = held.filter((h) => !h.resolved).map((h) => this.current.get(h.item.id) ?? h.item);
    const resolved = held.length - still.length;
    const err = await this.deps.post(catchUpCard(still, resolved, this.holdWhy ?? 'held back', now, this.deps.home?.()), { kind: 'catch-up', items: held.length, floors: [...new Set(held.map((h) => h.item.floor))] });
    if (err) return void (this.cooldownUntil = this.deps.now() + COOLDOWN_MS);
    for (const h of held) this.state.sent[h.item.id] = { floor: h.item.floor, at: now, seen: now };
    // Anything raised while that was on its way is still pending, for the next batch.
    this.state.held = this.state.held.filter((h) => !held.includes(h));
    this.holdWhy = undefined;
    this.save();
  }

  /** Forgets posted ids gone from a floor the office has watched for a while, and very old ones. */
  private prune(now: number) {
    let dirty = false;
    for (const [id, m] of Object.entries(this.state.sent)) {
      if (this.current.has(id)) continue;
      const since = this.watching.get(m.floor);
      const watchedLong = since !== undefined && now - since > FORGET_MS;
      if ((watchedLong && now - m.seen > FORGET_MS) || now - m.at > KEEP_MS) {
        delete this.state.sent[id];
        dirty = true;
      }
    }
    if (dirty) this.save();
  }

  /** Saves the state (also after a digest went out). */
  save() {
    if (!this.deps.file) return;
    try {
      writeJsonAtomic(this.deps.file, this.state);
    } catch (err) {
      console.error(`agent-office: notify-teams: couldn't save what it posted: ${(err as Error).message}`);
    }
  }

  private restore() {
    const f = this.deps.file;
    if (!f || !existsSync(f)) return;
    try {
      const s = JSON.parse(readFileSync(f, 'utf8')) as Partial<NotifierState>;
      if (s.sent && typeof s.sent === 'object') this.state.sent = s.sent;
      if (Array.isArray(s.held)) this.state.held = s.held.filter((h) => h && typeof h.item?.id === 'string');
      if (s.digests && typeof s.digests === 'object') this.state.digests = s.digests;
    } catch {
      // a broken file: start over (at worst an item posts twice)
    }
  }
}
