// Web Push, the protocol, written with node:crypto only (no web-push package): the VAPID keys and the
// signed JWT a push service wants to see (RFC 8292), and the payload encryption a browser decrypts
// (RFC 8291 "aes128gcm", on top of RFC 8188's encrypted content coding). Pure functions of their
// inputs: the salt and the one-off key pair can be handed in, so the tests check RFC 8291's own
// example byte for byte.

import { createCipheriv, createDecipheriv, createECDH, createHmac, createPrivateKey, createPublicKey, randomBytes, sign as signData, type KeyObject } from 'node:crypto';

export const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
export const unb64u = (s: string) => Buffer.from(s.replace(/=+$/, ''), 'base64url');

/** A VAPID key pair: P-256, both halves base64url (public: the 65-byte uncompressed point). */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** A fresh VAPID key pair, made once per office (webpush/keys.ts keeps it). */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(padTo(ecdh.getPrivateKey(), 32)) };
}

function padTo(b: Buffer, n: number): Buffer {
  return b.length >= n ? b : Buffer.concat([Buffer.alloc(n - b.length), b]);
}

/** A raw P-256 key pair as a KeyObject (through JWK, which node takes without ASN.1 by hand). */
function privateKeyObject(keys: VapidKeys): KeyObject {
  const pub = unb64u(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('The VAPID public key is not an uncompressed P-256 point');
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}

export function publicKeyObject(publicKey: string): KeyObject {
  const pub = unb64u(publicKey);
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}

/** The push service's origin, which a VAPID token is for (its `aud`). */
export const audienceOf = (endpoint: string) => new URL(endpoint).origin;

/**
 * A VAPID JWT (ES256) for `audience`, good for `ttlSeconds` (at most 24 h, RFC 8292), and the
 * Authorization header that carries it: `vapid t=<jwt>, k=<public key>`.
 */
export function vapidAuth(keys: VapidKeys, audience: string, subject: string, nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = 12 * 3600): { jwt: string; header: string } {
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud: audience, exp: nowSeconds + Math.min(ttlSeconds, 24 * 3600), sub: subject })));
  const input = `${head}.${body}`;
  // JOSE wants r||s (64 bytes), not DER.
  const sig = signData('sha256', Buffer.from(input), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  const jwt = `${input}.${b64u(sig)}`;
  return { jwt, header: `vapid t=${jwt}, k=${keys.publicKey}` };
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  // One block is enough for everything here (at most 32 bytes).
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/** What a browser's PushSubscription says about where and how to send. */
export interface SubscriptionKeys {
  /** The browser's P-256 public key (65 bytes, base64url). */
  p256dh: string;
  /** Its 16-byte auth secret (base64url). */
  auth: string;
}

export interface EncryptOptions {
  /** 16 random bytes; the tests hand in RFC 8291's. */
  salt?: Buffer;
  /** The application server's one-off key pair (private, public raw); the tests hand in RFC 8291's. */
  ephemeral?: { privateKey: Buffer; publicKey: Buffer };
  /** The record size written in the header (4096 by default, as RFC 8291's example). */
  recordSize?: number;
}

/**
 * RFC 8291: a payload encrypted for one subscription, as the request body (aes128gcm: the RFC 8188
 * header, salt, record size, the server's key, then the single record).
 */
export function encryptPayload(plaintext: Buffer, ua: SubscriptionKeys, opts: EncryptOptions = {}): Buffer {
  const uaPublic = unb64u(ua.p256dh);
  const authSecret = unb64u(ua.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('The subscription key (p256dh) is not a P-256 point');
  if (authSecret.length < 16) throw new Error('The subscription auth secret is too short');
  const salt = opts.salt ?? randomBytes(16);
  const rs = opts.recordSize ?? 4096;
  const ecdh = createECDH('prime256v1');
  if (opts.ephemeral) ecdh.setPrivateKey(opts.ephemeral.privateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  // RFC 8291 §3.3-3.4: the input keying material from the auth secret, then the CEK and nonce from the salt.
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  // One record, the last: the content then the 0x02 delimiter (no padding).
  if (plaintext.length + 1 + 16 > rs) throw new Error('The payload is too long for one record');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(rs, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** The other way (what a browser does): for the tests' round trip. */
export function decryptPayload(body: Buffer, uaPrivate: Buffer, ua: SubscriptionKeys): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = unb64u(ua.p256dh);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = hkdf(unb64u(ua.auth), shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('Not the last record');
  return plain.subarray(0, end);
}
