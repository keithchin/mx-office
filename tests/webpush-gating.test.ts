// Web Push's subscriptions and gating (server/webpush/): one per person and device, revocable, only real
// push services; only red items, never an office-started turn, each pushed once; each phone's Do not
// disturb and digest; a gone subscription forgotten; the VAPID keys made once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createECDH } from 'node:crypto';
import type { NeedItem } from '../src/shared/needsyou.ts';
import { PushNotifier, pushItemsOf } from '../src/server/webpush/notifier.ts';
import { PushSubscriptions, checkEndpoint, type PushSub } from '../src/server/webpush/store.ts';
import { sendPush, type PushPayload } from '../src/server/webpush/sender.ts';
import { VapidStore } from '../src/server/webpush/keys.ts';
import { b64u, decryptPayload, generateVapidKeys, publicKeyObject, unb64u } from '../src/server/webpush/crypto.ts';
import { verify } from 'node:crypto';

const browser = () => {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { e, keys: { p256dh: b64u(e.getPublicKey()), auth: b64u(Buffer.alloc(16, 3)) } };
};
const APPLE = 'https://web.push.apple.com/QGuQyavXutnMH8abc';

const need = (o: Partial<NeedItem> & Pick<NeedItem, 'key' | 'kind'>): NeedItem => ({ icon: '🚩', text: 'Something', level: 'block', action: 'Go', target: { to: 'approvals' }, ...o });

test('subscriptions: per person and device, refreshed in place, revocable by owner or admin, kept on disk', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-push-'));
  const file = path.join(dir, 'push-subscriptions.json');
  const subs = new PushSubscriptions(file, () => 5);
  const a = subs.add({ endpoint: APPLE, keys: browser().keys }, 'a:pm', 'Pat', 'iPhone · Safari');
  assert.equal(typeof a, 'object');
  const again = subs.add({ endpoint: APPLE, keys: browser().keys }, 'a:pm', 'Pat', 'iPhone · Safari', { dndUntil: 'on' });
  assert.equal(subs.list().length, 1, 'same endpoint, same phone');
  assert.equal((again as PushSub).alerts.dndUntil, Infinity);
  subs.add({ endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: browser().keys }, 'b:browser-key-1', 'Sam', 'Android');
  assert.deepEqual(subs.view('a:pm', false).map((s) => s.device), ['iPhone · Safari']);
  assert.equal(subs.view(undefined, true).length, 2);
  assert.equal(subs.remove((a as PushSub).id, 'b:browser-key-1', false), false, "not someone else's");
  const reread = new PushSubscriptions(file);
  assert.equal(reread.list().length, 2);
  assert.equal(reread.list()[0].alerts.dndUntil, Infinity, 'Do not disturb survives (stored as "on")');
  assert.equal(reread.remove((a as PushSub).id, undefined, true), true, 'an admin can revoke anyone’s');
  assert.equal(new PushSubscriptions(file).list().length, 1);
});

test('only real push services are accepted as endpoints', () => {
  assert.equal(checkEndpoint(APPLE), undefined);
  assert.equal(checkEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'), undefined);
  assert.match(checkEndpoint('https://evil.example.com/push') ?? '', /isn't a push service/);
  assert.match(checkEndpoint('http://web.push.apple.com/x') ?? '', /https/);
  assert.match(checkEndpoint('https://169.254.169.254/latest') ?? '', /isn't a push service/);
});

test('red items only, never an office-started turn, each with a link to /m on it', () => {
  const needs = [
    need({ key: 'ask-w1', kind: 'asking', text: 'Ada is asking: may I push?', target: { to: 'worker', id: 'w1' }, since: 100 }),
    need({ key: 'ask-w2', kind: 'asking', text: 'Bo is asking: rm -rf?', target: { to: 'worker', id: 'w2' }, since: 200 }),
    need({ key: 'done-w3', kind: 'finished', level: 'warn', target: { to: 'worker', id: 'w3' } }),
    need({ key: 'esc-e1', kind: 'escalation', tag: 'URGENT', text: 'Lin escalated: merge order', target: { to: 'escalation', id: 'e1' } }),
    need({ key: 'appr-p1', kind: 'approval', level: 'warn' }),
    need({ key: 'setup-stale', kind: 'setup', level: 'warn' }),
  ];
  const items = pushItemsOf({ id: 'f1', name: 'Shop' }, needs, (id) => id === 'w2');
  assert.deepEqual(items.map((i) => i.id), ['f1:ask-w1@100', 'f1:esc-e1']);
  assert.equal(items[1].payload.url, '/m?floor=f1&item=esc-e1');
  assert.equal(items[1].payload.body, 'URGENT: Lin escalated: merge order');
  assert.equal(items[1].payload.title, '🚩 Shop');
});

function notifierWith(subs: PushSub[], now: { t: number }) {
  const sent: { sub: string; payload: PushPayload }[] = [];
  const n = new PushNotifier({ now: () => now.t, subs: () => subs, send: async (s, p) => void sent.push({ sub: s.id, payload: p }) });
  return { n, sent };
}
const sub = (id: string, alerts: Partial<PushSub['alerts']> = {}): PushSub => ({ id, endpoint: APPLE, keys: browser().keys, owner: `a:${id}`, name: id, device: 'iPhone', createdAt: 0, alerts: { dndUntil: 0, digestMinutes: 0, sound: true, ...alerts } });
const item = (id: string, urgent = true) => ({ id, floor: 'f1', urgent, payload: { title: 't', body: id, tag: id, url: '/m' } });

test('each item once; Do not disturb drops it; the digest bundles what isn’t blocking', async () => {
  const now = { t: 1_000_000 };
  const subs = [sub('plain'), sub('quiet', { dndUntil: Infinity }), sub('digest', { digestMinutes: 15 })];
  const { n, sent } = notifierWith(subs, now);
  await n.observe('f1', [item('f1:esc-1'), item('f1:pr-2', false)]);
  assert.deepEqual(sent.map((s) => `${s.sub}:${s.payload.body}`), ['plain:f1:esc-1', 'digest:f1:esc-1', 'plain:f1:pr-2']);
  await n.observe('f1', [item('f1:esc-1'), item('f1:pr-2', false)]);
  assert.equal(sent.length, 3, 'never twice');
  assert.equal(n.waiting('digest'), 1);
  await n.tick();
  assert.equal(sent.length, 3, 'the digest waits its minutes');
  now.t += 15 * 60_000;
  await n.tick();
  assert.equal(sent.length, 4);
  assert.equal(sent[3].sub, 'digest');
  assert.match(sent[3].payload.title, /1 update from the office/);
  assert.equal(n.waiting('digest'), 0);
});

test('a push goes encrypted with a VAPID token; a 410 says the phone is gone', async () => {
  const keys = generateVapidKeys();
  const b = browser();
  let got: { url: string; init: RequestInit } | undefined;
  const ok = await sendPush({ endpoint: APPLE, keys: b.keys }, { title: 'T', body: 'B', tag: 'x', url: '/m' }, keys, async (url, init) => ((got = { url, init }), { status: 201, text: async () => '' }));
  assert.deepEqual(ok, { ok: true, status: 201 });
  const h = got!.init.headers as Record<string, string>;
  assert.equal(h['content-encoding'], 'aes128gcm');
  assert.equal(h.urgency, 'high');
  assert.ok(Number(h.ttl) > 0);
  const jwt = /^vapid t=([^,]+), k=(.+)$/.exec(h.authorization)!;
  assert.equal(jwt[2], keys.publicKey);
  const [hh, bb, ss] = jwt[1].split('.');
  assert.equal(JSON.parse(unb64u(bb).toString()).aud, 'https://web.push.apple.com');
  assert.ok(verify('sha256', Buffer.from(`${hh}.${bb}`), { key: publicKeyObject(keys.publicKey), dsaEncoding: 'ieee-p1363' }, unb64u(ss)));
  const plain = decryptPayload(Buffer.from(got!.init.body as Uint8Array), b.e.getPrivateKey(), b.keys);
  assert.deepEqual(JSON.parse(plain.toString()), { title: 'T', body: 'B', tag: 'x', url: '/m' });
  const gone = await sendPush({ endpoint: APPLE, keys: b.keys }, { title: 'T', body: 'B', tag: 'x', url: '/m' }, keys, async () => ({ status: 410, text: async () => 'expired' }));
  assert.equal(gone.ok, false);
  assert.equal(!gone.ok && gone.gone, true);
});

test('the VAPID keys are made once, even when asked twice at the same time', async () => {
  let priv: string | undefined;
  let pub: string | undefined;
  let made = 0;
  const store = new VapidStore({ getPrivate: () => priv, setPrivate: async (v) => void ((priv = v), made++), getPublic: () => pub, setPublic: (v) => void (pub = v) });
  assert.equal(store.current(), undefined);
  const [a, b] = await Promise.all([store.ensure(), store.ensure()]);
  assert.equal(made, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(store.current(), a);
  pub = generateVapidKeys().publicKey;
  assert.equal(store.current(), undefined, 'a public key that doesn’t match is no pair');
});
