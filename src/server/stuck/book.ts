// A floor's stuck items over time: each raised once under its stable id, updated in place when what it
// says changes, resolved by itself when its detector stops finding it, and raised again (a new round)
// only if it comes back after that. Snoozes and dismissals are kept per item; a dismissal hides the item
// for this round and never resolves it. It also tracks the activity "going in circles" needs: agent time
// since the last progress, and what that progress was. Pure apart from the `changed` callback, which
// the service turns into an audit record and a save: the tests drive it with their own clock.

import type { StuckDraft } from '../../shared/stuck.js';

export interface StuckRecord {
  id: string;
  /** First seen by the office ever (for facts without a date of their own). */
  firstSeen: number;
  raisedAt: number;
  status: 'open' | 'resolved';
  resolvedAt?: number;
  snoozedUntil?: number;
  dismissedAt?: number;
  /** The PM accepted the workaround: quiet until then. */
  acceptedUntil?: number;
  /** Not found by a look whose read of its source failed: kept as it was since then (never resolved on a failed read). */
  unreadAt?: number;
  draft: StuckDraft;
}

export interface Activity {
  lastPollAt?: number;
  lastProgressAt?: number;
  lastProgress?: string;
  /** Agent time since lastProgressAt. */
  activeMs: number;
  /** What progress is measured by: the newest merge, the build plan's row states, the current stage. */
  sig?: { merged?: string; rows?: string; stage?: string };
}

export interface BookData {
  version: 1;
  items: Record<string, StuckRecord>;
  /** Ids seen once and not yet raised (under their threshold): when the office first saw them. */
  seen: Record<string, number>;
  activity: Activity;
}

export const emptyBook = (): BookData => ({ version: 1, items: {}, seen: {}, activity: { activeMs: 0 } });

export type BookEvent = { action: 'raised' | 'updated' | 'resolved'; record: StuckRecord; before?: StuckDraft };

/** What the item says, for "did it change": its age is worked out when shown, so it's left out. */
const sig = (d: StuckDraft) => JSON.stringify({ ...d, since: undefined, evidence: d.evidence.map((e) => e.label), circles: d.circles ? { lastProgress: d.circles.lastProgress } : undefined });

/** A book read back from disk: anything odd starts afresh. */
export function reviveBook(v: unknown): BookData {
  const o = v as Partial<BookData> | undefined;
  if (!o || o.version !== 1 || typeof o.items !== 'object' || !o.items) return emptyBook();
  return { version: 1, items: o.items, seen: o.seen && typeof o.seen === 'object' ? o.seen : {}, activity: o.activity && typeof o.activity === 'object' ? { ...o.activity, activeMs: typeof o.activity.activeMs === 'number' ? o.activity.activeMs : 0 } : { activeMs: 0 } };
}

export class StuckBook {
  constructor(readonly data: BookData = emptyBook()) {}

  firstSeen(id: string, now: number): number {
    return this.data.items[id]?.firstSeen ?? (this.data.seen[id] ??= now);
  }

  /**
   * This look's drafts against what's open: new ones raised, changed ones updated, missing ones resolved,
   * except those `unread` says this look couldn't re-read the source of: those stay open, marked unreadAt.
   */
  reconcile(drafts: readonly StuckDraft[], now: number, unread: (r: StuckRecord) => boolean = () => false): BookEvent[] {
    const events: BookEvent[] = [];
    const found = new Set<string>();
    for (const d of drafts) {
      found.add(d.id);
      const r = this.data.items[d.id];
      if (!r || r.status === 'resolved') {
        const rec: StuckRecord = { id: d.id, firstSeen: r?.firstSeen ?? this.data.seen[d.id] ?? now, raisedAt: now, status: 'open', draft: d };
        this.data.items[d.id] = rec;
        delete this.data.seen[d.id];
        events.push({ action: 'raised', record: rec });
        continue;
      }
      delete r.unreadAt;
      if (sig(r.draft) !== sig(d) || r.draft.since !== d.since) {
        const before = r.draft;
        r.draft = d;
        if (sig(before) !== sig(d)) events.push({ action: 'updated', record: r, before });
      }
    }
    for (const r of Object.values(this.data.items)) {
      if (r.status !== 'open' || found.has(r.id)) continue;
      if (unread(r)) {
        r.unreadAt ??= now;
        continue;
      }
      delete r.unreadAt;
      r.status = 'resolved';
      r.resolvedAt = now;
      delete r.snoozedUntil;
      delete r.dismissedAt;
      delete r.acceptedUntil;
      events.push({ action: 'resolved', record: r });
    }
    // Resolved long ago and not back: forgotten (the audit log keeps the history).
    for (const r of Object.values(this.data.items)) if (r.status === 'resolved' && now - (r.resolvedAt ?? now) > 30 * 24 * 3_600_000) delete this.data.items[r.id];
    return events;
  }

  /** Open and not snoozed, dismissed or quieted by an accepted workaround. */
  visible(now: number): StuckRecord[] {
    return Object.values(this.data.items)
      .filter((r) => r.status === 'open' && !r.dismissedAt && !(r.snoozedUntil && r.snoozedUntil > now) && !(r.acceptedUntil && r.acceptedUntil > now))
      .sort((a, b) => a.draft.since - b.draft.since);
  }

  open(): StuckRecord[] {
    return Object.values(this.data.items).filter((r) => r.status === 'open');
  }

  /** Open and dismissed: hidden, not resolved (Needs you shows them as "hidden (N)"). */
  dismissed(): StuckRecord[] {
    return this.open().filter((r) => !!r.dismissedAt).sort((a, b) => a.draft.since - b.draft.since);
  }

  snooze(id: string, until: number): StuckRecord | undefined {
    const r = this.data.items[id];
    if (!r || r.status !== 'open') return undefined;
    r.snoozedUntil = until;
    return r;
  }

  dismiss(id: string, now: number): StuckRecord | undefined {
    const r = this.data.items[id];
    if (!r || r.status !== 'open') return undefined;
    r.dismissedAt = now;
    return r;
  }

  accept(id: string, until: number): StuckRecord | undefined {
    const r = this.data.items[id];
    if (!r || r.status !== 'open') return undefined;
    r.acceptedUntil = until;
    return r;
  }

  /**
   * One look at the team's activity: agent time adds up while someone is working (a gap longer than
   * `maxGap` counts as `maxGap`, so an office that was off adds nothing), and a change in what progress
   * is measured by starts the window again. `firstProgress` is the best guess at the last progress the
   * first time round (the newest merge or build-plan commit).
   */
  track(now: number, working: boolean, s: NonNullable<Activity['sig']>, whats: Partial<Record<keyof NonNullable<Activity['sig']>, string>>, maxGap: number, firstProgress?: { at: number; what: string }): Activity {
    const a = this.data.activity;
    if (a.lastProgressAt === undefined || !a.sig) {
      a.lastProgressAt = Math.min(now, firstProgress?.at ?? now);
      a.lastProgress = firstProgress?.what;
      a.activeMs = 0;
      a.sig = s;
      a.lastPollAt = now;
      return a;
    }
    if (working && a.lastPollAt !== undefined) a.activeMs += Math.min(Math.max(0, now - a.lastPollAt), maxGap);
    a.lastPollAt = now;
    // A file that couldn't be read this time (undefined) is no change; a first merge ever is.
    const was = a.sig;
    const moved = (['merged', 'rows', 'stage'] as const).find((k) => s[k] !== undefined && (was[k] !== undefined ? s[k] !== was[k] : k === 'merged'));
    if (moved) {
      a.lastProgressAt = now;
      a.lastProgress = whats[moved] ?? (moved === 'merged' ? 'a pull request merged' : moved === 'rows' ? 'a build-plan row changed' : 'the stage changed');
      a.activeMs = 0;
    }
    a.sig = { ...a.sig, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) };
    return a;
  }
}
