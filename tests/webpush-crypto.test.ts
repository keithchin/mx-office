// Web Push's crypto (server/webpush/crypto.ts): RFC 8291's own example, byte for byte, a round trip,
// and a VAPID JWT (RFC 8292) the public key verifies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, verify } from 'node:crypto';
import { audienceOf, b64u, decryptPayload, encryptPayload, generateVapidKeys, publicKeyObject, unb64u, vapidAuth } from '../src/server/webpush/crypto.ts';

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('encrypts RFC 8291 Appendix A exactly', () => {
  const out = encryptPayload(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: unb64u(RFC.salt), ephemeral: { privateKey: unb64u(RFC.asPrivate), publicKey: unb64u(RFC.asPublic) } });
  assert.equal(b64u(out), RFC.body);
});

test('decrypts RFC 8291 Appendix A, and round-trips a fresh payload', () => {
  const ua = { p256dh: RFC.uaPublic, auth: RFC.auth };
  assert.equal(decryptPayload(unb64u(RFC.body), unb64u(RFC.uaPrivate), ua).toString(), RFC.plaintext);
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const sub = { p256dh: b64u(browser.getPublicKey()), auth: b64u(Buffer.alloc(16, 7)) };
  const msg = JSON.stringify({ title: '🚩 Escalation', body: 'Merge order needs you', url: '/m?item=esc-1' });
  const body = encryptPayload(Buffer.from(msg), sub);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(body.readUInt8(20), 65);
  assert.equal(decryptPayload(body, browser.getPrivateKey(), sub).toString(), msg);
});

test('refuses a subscription key that is not a P-256 point', () => {
  assert.throws(() => encryptPayload(Buffer.from('x'), { p256dh: b64u(Buffer.alloc(10)), auth: RFC.auth }));
});

test('a VAPID JWT is ES256, for the push service, and verifies with the public key', () => {
  const keys = generateVapidKeys();
  assert.equal(unb64u(keys.publicKey).length, 65);
  assert.equal(unb64u(keys.privateKey).length, 32);
  const aud = audienceOf('https://web.push.apple.com/QGuQyavXutnMH8:abc');
  assert.equal(aud, 'https://web.push.apple.com');
  const { jwt, header } = vapidAuth(keys, aud, 'mailto:office@example.com', 1_000_000, 3600);
  const [h, b, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(unb64u(h).toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(unb64u(b).toString()), { aud, exp: 1_003_600, sub: 'mailto:office@example.com' });
  assert.equal(unb64u(s).length, 64);
  assert.ok(verify('sha256', Buffer.from(`${h}.${b}`), { key: publicKeyObject(keys.publicKey), dsaEncoding: 'ieee-p1363' }, unb64u(s)));
  assert.equal(header, `vapid t=${jwt}, k=${keys.publicKey}`);
  // Never longer than a day, whatever is asked.
  const long = vapidAuth(keys, aud, 'mailto:x@y.z', 0, 7 * 86400).jwt.split('.')[1];
  assert.equal(JSON.parse(unb64u(long).toString()).exp, 86400);
});
