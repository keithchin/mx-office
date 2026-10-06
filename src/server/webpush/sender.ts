// One push message to one phone: the payload encrypted for its subscription (crypto.ts), a VAPID token for
// its push service, POSTed there. Never waits long (10 s), never throws: it says what happened, and a
// subscription the service no longer knows (404, 410) is reported as gone, for the store to forget.

import { createHash } from 'node:crypto';
import { audienceOf, encryptPayload, vapidAuth, type VapidKeys } from './crypto.js';

/** What the service worker (public/sw.js) shows: the title, the line under it, a tag that replaces an older one, and where a tap goes. */
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export type PushResult = { ok: true; status: number } | { ok: false; gone: boolean; status?: number; error: string };

export type Fetch = (url: string, init: RequestInit) => Promise<{ status: number; text(): Promise<string> }>;

/** The subject VAPID tokens name: someone a push service could write to (RFC 8292). */
export const VAPID_SUBJECT = 'mailto:agent-office@localhost.invalid';

export async function sendPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload, keys: VapidKeys, f: Fetch = fetch as unknown as Fetch, opts: { ttl?: number; urgency?: 'high' | 'normal' } = {}): Promise<PushResult> {
  let body: Buffer;
  try {
    body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub.keys);
  } catch (err) {
    return { ok: false, gone: true, error: (err as Error).message };
  }
  const { header } = vapidAuth(keys, audienceOf(sub.endpoint), VAPID_SUBJECT);
  try {
    const r = await f(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: header,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(opts.ttl ?? 6 * 3600),
        urgency: opts.urgency ?? 'high',
        // The same item replaces its older message on the way (32 url-safe characters at most).
        topic: createHash('sha256').update(payload.tag).digest('base64url').slice(0, 32),
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status };
    const text = (await r.text().catch(() => '')).slice(0, 200);
    return { ok: false, gone: r.status === 404 || r.status === 410, status: r.status, error: `The push service said ${r.status}${text ? `: ${text}` : ''}` };
  } catch (err) {
    return { ok: false, gone: false, error: (err as Error).message };
  }
}
