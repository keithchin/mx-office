// What the Console's Network keeps of a request: its headers with cookies and credentials redacted, the
// first bytes of its bodies as text with passwords and tokens masked (binary ones only noted), what kind
// of request it was, and a Mendix xas/ call's action. Kept in memory only (console/index.ts), never on disk.

import zlib from 'node:zlib';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { BODY_MAX, bytes, type LiveNetKind } from '../../../shared/liveapp/console.js';

/** Headers whose values are never shown: what signs someone in. */
const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-csrf-token', 'x-api-key']);
/** Fields whose values are masked in a body. */
const SECRET_KEY = /pass(word|wd)?|pwd|secret|token|credential|api[-_]?key/i;
const TEXTUAL = /json|xml|^text\/|javascript|ecmascript|x-www-form-urlencoded|graphql/i;

/** A header's value as the Console shows it: a cookie's names without their values, an authorization's scheme only. */
export function redactHeader(name: string, value: string): string {
  const n = name.toLowerCase();
  if (!SECRET_HEADERS.has(n)) return value;
  if (n === 'cookie')
    return value
      .split(';')
      .map((p) => p.trim().split('=', 1)[0])
      .filter(Boolean)
      .map((k) => `${k}=[redacted]`)
      .join('; ');
  if (n === 'set-cookie') {
    const [first, ...attrs] = value.split(';');
    return [`${first.split('=', 1)[0].trim()}=[redacted]`, ...attrs.map((a) => a.trim())].join('; ');
  }
  if (n === 'authorization' || n === 'proxy-authorization') return `${value.split(' ', 1)[0]} [redacted]`;
  return '[redacted]';
}

/** Headers as name/value pairs, redacted. */
export function headerPairs(h: IncomingHttpHeaders | OutgoingHttpHeaders): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) out.push([k, redactHeader(k, String(one))]);
  }
  return out;
}

/** Masks password and token fields in a body: JSON (parsed, or by pattern when cut short) and form fields. */
export function maskSecrets(text: string, type: string): string {
  if (/json/i.test(type) || /^\s*[{[]/.test(text)) {
    try {
      return JSON.stringify(maskValue(JSON.parse(text)));
    } catch {
      return text.replace(/("([^"\\]*)"\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (all, pre: string, key: string) => (SECRET_KEY.test(key) ? `${pre}"***"` : all));
    }
  }
  if (/x-www-form-urlencoded/i.test(type)) return text.replace(/(^|&)([^=&]*)=([^&]*)/g, (all, amp: string, key: string) => (SECRET_KEY.test(decodeKey(key)) ? `${amp}${key}=***` : all));
  return text;
}

const decodeKey = (k: string) => {
  try {
    return decodeURIComponent(k.replace(/\+/g, ' '));
  } catch {
    return k;
  }
};

function maskValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(maskValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && (typeof x === 'string' || typeof x === 'number') ? '***' : maskValue(x)]));
  return v;
}

/** The first BODY_MAX bytes of a body going by, and how many there were. */
export class BodyTap {
  private parts: Buffer[] = [];
  private kept = 0;
  total = 0;

  add(chunk: Buffer) {
    this.total += chunk.length;
    if (this.kept >= BODY_MAX) return;
    const part = chunk.length > BODY_MAX - this.kept ? chunk.subarray(0, BODY_MAX - this.kept) : chunk;
    this.parts.push(part);
    this.kept += part.length;
  }

  /** The body as text, or a note for why not (binary, compressed beyond reading, none). */
  read(type: string, encoding: string | undefined): { text?: string; note?: string } {
    if (!this.total) return {};
    if (!TEXTUAL.test(type)) return { note: `${type || 'binary'} · ${bytes(this.total)} (not shown)` };
    let buf: Buffer = Buffer.concat(this.parts);
    const cut = this.total > this.kept;
    try {
      buf = inflate(buf, (encoding ?? '').toLowerCase());
    } catch {
      return { note: `${encoding} · ${bytes(this.total)} (couldn't read it)` };
    }
    const over = buf.length > BODY_MAX;
    const text = maskSecrets(buf.subarray(0, BODY_MAX).toString('utf8'), type);
    return { text, ...(cut || over ? { note: `the first ${bytes(BODY_MAX)} of ${cut ? bytes(this.total) : 'more'}` } : {}) };
  }
}

/** Decompresses what may be only the start of a body (Z_SYNC_FLUSH reads as far as it goes). */
function inflate(buf: Buffer, encoding: string): Buffer {
  const max = { maxOutputLength: 1024 * 1024 };
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH, ...max });
  if (encoding === 'deflate') return zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH, ...max });
  if (encoding === 'br') return zlib.brotliDecompressSync(buf, { finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH, ...max });
  return buf;
}

/** The content type without its parameters. */
export const typeOf = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : (v ?? '')).split(';')[0].trim().toLowerCase();

/** What kind of request it is, from its path and what the browser said it was for. */
export function kindOf(path: string, h: IncomingHttpHeaders, method: string): LiveNetKind {
  if (/^\/xas\//i.test(path)) return 'xas';
  const dest = String(h['sec-fetch-dest'] ?? '');
  if (dest === 'document' || dest === 'iframe') return 'doc';
  if (dest === 'empty' || h['x-requested-with']) return 'xhr';
  if (dest) return 'asset';
  if (method === 'GET' && /text\/html/.test(String(h.accept ?? ''))) return 'doc';
  return /json/.test(String(h.accept ?? '')) || method !== 'GET' ? 'xhr' : 'asset';
}

/**
 * A Mendix xas/ call's action from its body: "executeaction MyModule.ACT_Save", "retrieve_by_xpath
 * MyModule.Order", "runtimeOperation", "login" (the body is cut at BODY_MAX, so only what's readable).
 */
export function xasAction(body: string | undefined): string | undefined {
  if (!body) return undefined;
  let o: { action?: unknown; operationId?: unknown; params?: Record<string, unknown> };
  try {
    o = JSON.parse(body);
  } catch {
    const m = /"action"\s*:\s*"([\w.-]{1,60})"/.exec(body);
    return m?.[1];
  }
  if (!o || typeof o.action !== 'string') return undefined;
  const p = o.params ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
  const xpath = str(p.xpath);
  const what = str(p.actionname) ?? str(p.name) ?? str(p.objecttype) ?? str(p.entity) ?? (xpath ? /^\/\/([\w.]+)/.exec(xpath)?.[1] : undefined);
  return what ? `${o.action} ${what}` : o.action;
}
