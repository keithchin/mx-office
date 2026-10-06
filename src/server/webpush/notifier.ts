// Which phones hear about what, and when. Only red Needs-you items (shared/notify-teams.ts isRedNeed, the
// same rule as the Teams cards), never one from a turn the office started itself, each pushed once (the
// ids are saved, so a restart doesn't push them again). Each phone's own Do not disturb drops it and its
// digest bundles the ones that aren't blocking, exactly as the desktop alerts do (shared/phone.ts
// alertPlan, digestDue).

import { existsSync, readFileSync } from 'node:fs';
import { mobileItemUrl } from '../../shared/mobile.js';
import type { NeedItem } from '../../shared/needsyou.js';
import { isRedNeed } from '../../shared/notify-teams.js';
import { alertPlan, digestDue } from '../../shared/phone.js';
import { writeJsonAtomic } from '../flow/store.js';
import type { PushPayload } from './sender.js';
import type { PushSub } from './store.js';

/** One red item, ready to push. */
export interface PushItem {
  /** Stable: the floor, the Needs-you key, and an agent's question also by when it started. */
  id: string;
  floor: string;
  urgent: boolean;
  payload: PushPayload;
}

/** A floor's Needs-you items that may buzz a phone: red, and not from a turn the office started. */
export function pushItemsOf(floor: { id: string; name: string }, needs: readonly NeedItem[], officeTurn: (workerId: string) => boolean): PushItem[] {
  const out: PushItem[] = [];
  for (const n of needs) {
    if (!isRedNeed(n)) continue;
    if (n.kind === 'asking' && n.target.to === 'worker' && officeTurn(n.target.id)) continue;
    const id = `${floor.id}:${n.key}${n.kind === 'asking' && n.since ? `@${n.since}` : ''}`;
    out.push({ id, floor: floor.id, urgent: n.level === 'block', payload: { title: `${n.icon} ${floor.name}`, body: `${n.tag ? `${n.tag}: ` : ''}${n.text}`, tag: id, url: mobileItemUrl(floor.id, n.key) } });
  }
  return out;
}

interface State {
  sent: Record<string, number>;
  /** Per phone, what waits for its digest, and when its last digest went. */
  digest: Record<string, { lines: string[]; lastAt: number }>;
}

export interface PushNotifierDeps {
  now(): number;
  subs(): readonly PushSub[];
  /** Sends; resolves once it's done (the sender never throws). */
  send(sub: PushSub, payload: PushPayload, urgent: boolean): Promise<void>;
  file?: string;
}

/** Ids not seen again for this long are forgotten (and may push again if they come back). */
const FORGET_MS = 3 * 24 * 3_600_000;

export class PushNotifier {
  private state: State = { sent: {}, digest: {} };
  private current = new Map<string, PushItem>();

  constructor(private readonly deps: PushNotifierDeps) {
    this.restore();
  }

  /** A floor's items now; the new ones go to every phone (or its digest). */
  async observe(floor: string, items: readonly PushItem[]): Promise<void> {
    const now = this.deps.now();
    for (const [id, it] of this.current) if (it.floor === floor && !items.some((x) => x.id === id)) this.current.delete(id);
    const fresh = items.filter((it) => !this.state.sent[it.id]);
    for (const it of items) {
      this.current.set(it.id, it);
      this.state.sent[it.id] = now;
    }
    for (const it of fresh) {
      for (const sub of this.deps.subs()) {
        const plan = alertPlan(it.urgent, sub.alerts, now);
        if (plan === 'drop') continue;
        if (plan === 'digest') {
          const d = (this.state.digest[sub.id] ??= { lines: [], lastAt: now });
          d.lines.push(`${it.payload.title}: ${it.payload.body}`.slice(0, 160));
          continue;
        }
        await this.deps.send(sub, it.payload, it.urgent);
      }
    }
    if (fresh.length) this.save();
  }

  /** Digests that are due, and old ids forgotten. */
  async tick(): Promise<void> {
    const now = this.deps.now();
    let dirty = false;
    for (const sub of this.deps.subs()) {
      const d = this.state.digest[sub.id];
      if (!d || !digestDue(sub.alerts, d.lines.length, d.lastAt, now)) continue;
      const lines = d.lines.splice(0);
      d.lastAt = now;
      dirty = true;
      if (alertPlan(false, { ...sub.alerts, digestMinutes: 0 }, now) === 'drop') continue;
      const more = lines.length > 4 ? `\n…and ${lines.length - 4} more` : '';
      await this.deps.send(sub, { title: `🔔 ${lines.length} update${lines.length === 1 ? '' : 's'} from the office`, body: lines.slice(0, 4).join('\n') + more, tag: 'digest', url: '/m' }, false);
    }
    for (const [id, at] of Object.entries(this.state.sent)) {
      if (!this.current.has(id) && now - at > FORGET_MS) ((delete this.state.sent[id]), (dirty = true));
    }
    const known = new Set(this.deps.subs().map((s) => s.id));
    for (const id of Object.keys(this.state.digest)) if (!known.has(id)) ((delete this.state.digest[id]), (dirty = true));
    if (dirty) this.save();
  }

  /** How many items wait in a phone's digest. */
  waiting(subId: string): number {
    return this.state.digest[subId]?.lines.length ?? 0;
  }

  private save() {
    if (!this.deps.file) return;
    try {
      writeJsonAtomic(this.deps.file, this.state);
    } catch (err) {
      console.error(`agent-office: push: couldn't save what it pushed: ${(err as Error).message}`);
    }
  }

  private restore() {
    const f = this.deps.file;
    if (!f || !existsSync(f)) return;
    try {
      const s = JSON.parse(readFileSync(f, 'utf8')) as Partial<State>;
      if (s.sent && typeof s.sent === 'object') this.state.sent = s.sent;
      if (s.digest && typeof s.digest === 'object') this.state.digest = s.digest;
    } catch {
      // start over
    }
  }
}
