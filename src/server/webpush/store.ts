// The phones that asked for push notifications: one subscription per person and device, in
// <office data>/push-subscriptions.json (mode 0600), each with its own Do not disturb and digest (the
// same AlertSettings as the team phone's alerts). Revocable from the phone itself and from Settings by
// an admin. Only real push services are accepted as endpoints, so a signed-in browser can't make the
// office send requests anywhere else.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cleanAlerts, storedAlerts, type AlertSettings } from '../../shared/phone.js';
import { writeJsonAtomic } from '../flow/store.js';

export interface PushSub {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Whose: `a:<account id>`, or `b:<browser key>` on the shared password. */
  owner: string;
  /** Their name then, and the device ("iPhone · Safari"). */
  name: string;
  device: string;
  createdAt: number;
  lastOkAt?: number;
  lastError?: string;
  alerts: AlertSettings;
}

/** What the page and Settings see: no keys, no endpoint. */
export interface PushSubView {
  id: string;
  name: string;
  device: string;
  createdAt: number;
  lastOkAt?: number;
  lastError?: string;
  mine: boolean;
}

/** The push services browsers use (Apple, Google, Mozilla, Microsoft). */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export function checkEndpoint(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 1000) return 'No push endpoint';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return 'Push endpoints are https';
    if (!PUSH_HOSTS.some((h) => h.test(u.hostname))) return `${u.hostname} isn't a push service the office knows`;
    return undefined;
  } catch {
    return 'No push endpoint';
  }
}

const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
export const subIdOf = (endpoint: string) => createHash('sha256').update(endpoint).digest('base64url').slice(0, 22);

/** A PushSubscription's JSON from the browser, checked. */
export function cleanSubscription(v: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | string {
  const s = (v && typeof v === 'object' ? v : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const bad = checkEndpoint(s.endpoint);
  if (bad) return bad;
  const { p256dh, auth } = s.keys ?? {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !B64U.test(p256dh) || !B64U.test(auth) || p256dh.length > 200 || auth.length > 100) return 'The subscription has no keys';
  return { endpoint: s.endpoint as string, keys: { p256dh, auth } };
}

export class PushSubscriptions {
  private subs: PushSub[] = [];

  constructor(
    private readonly file?: string,
    private readonly now: () => number = Date.now,
  ) {
    this.restore();
  }

  list(): readonly PushSub[] {
    return this.subs;
  }

  get(id: string) {
    return this.subs.find((s) => s.id === id);
  }

  /** Adds a phone, or refreshes the same one (same endpoint). */
  add(raw: unknown, owner: string, name: string, device: string, alerts?: unknown): PushSub | string {
    const c = cleanSubscription(raw);
    if (typeof c === 'string') return c;
    const id = subIdOf(c.endpoint);
    const had = this.get(id);
    const sub: PushSub = { id, ...c, owner, name: name.slice(0, 60), device: device.slice(0, 60), createdAt: had?.createdAt ?? this.now(), alerts: cleanAlerts(alerts ?? (had ? storedAlerts(had.alerts) : undefined)) };
    this.subs = [...this.subs.filter((s) => s.id !== id), sub].slice(-200);
    this.save();
    return sub;
  }

  /** Takes a phone off: its owner, or (`admin`) anyone's. */
  remove(id: string, owner: string | undefined, admin: boolean): boolean {
    const s = this.get(id);
    if (!s || (!admin && s.owner !== owner)) return false;
    this.subs = this.subs.filter((x) => x.id !== id);
    this.save();
    return true;
  }

  /** A push service said the subscription is gone (404 / 410). */
  drop(id: string) {
    const before = this.subs.length;
    this.subs = this.subs.filter((x) => x.id !== id);
    if (this.subs.length !== before) this.save();
  }

  setAlerts(id: string, owner: string, alerts: unknown): PushSub | undefined {
    const s = this.get(id);
    if (!s || s.owner !== owner) return undefined;
    s.alerts = cleanAlerts(alerts);
    this.save();
    return s;
  }

  noteResult(id: string, error?: string) {
    const s = this.get(id);
    if (!s) return;
    if (error) s.lastError = error;
    else ((s.lastOkAt = this.now()), delete s.lastError);
    this.save();
  }

  view(owner: string | undefined, admin: boolean): PushSubView[] {
    return this.subs
      .filter((s) => admin || s.owner === owner)
      .map((s) => ({ id: s.id, name: s.name, device: s.device, createdAt: s.createdAt, ...(s.lastOkAt ? { lastOkAt: s.lastOkAt } : {}), ...(s.lastError ? { lastError: s.lastError } : {}), mine: s.owner === owner }));
  }

  private save() {
    if (!this.file) return;
    try {
      writeJsonAtomic(this.file, this.subs.map((s) => ({ ...s, alerts: storedAlerts(s.alerts) })));
    } catch (err) {
      console.error(`agent-office: push: couldn't save the subscriptions: ${(err as Error).message}`);
    }
  }

  private restore() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown[];
      for (const r of Array.isArray(raw) ? raw : []) {
        const s = r as Partial<PushSub>;
        const c = cleanSubscription(s);
        if (typeof c === 'string' || typeof s.owner !== 'string') continue;
        this.subs.push({ id: subIdOf(c.endpoint), ...c, owner: s.owner, name: String(s.name ?? ''), device: String(s.device ?? ''), createdAt: Number(s.createdAt) || 0, ...(typeof s.lastOkAt === 'number' ? { lastOkAt: s.lastOkAt } : {}), alerts: cleanAlerts(s.alerts) });
      }
    } catch {
      // a broken file: nobody is subscribed until they turn it on again
    }
  }
}
