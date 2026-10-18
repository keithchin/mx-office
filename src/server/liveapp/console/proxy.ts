// The live app's recording proxy: a small HTTP server of its own, on a port of its own (taken from the
// live apps' range, never the office's port), that passes every request on to the Mendix runtime and
// tells the Console what went by (console/record.ts). The page opens the app through it, so to the app
// it's simply where it lives: its cookies are its own, its pages top-level, its WebSockets spliced through.
//
// It is not the office: nothing here answers for the office or reaches it. It only ever connects to the
// runtime's app port on this machine (whatever the request's Host or URL says), never the admin port.
// The office's own session cookies (ao_session…, which the browser sends to every port of the host:
// cookies ignore ports) are taken off every request before it goes on, and a cookie the app sets
// under the office's name is dropped, so the app can neither read nor replace the office's session.

import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { COOKIE_NAME, withoutOfficeCookies } from '../../auth.js';
import type { LiveNetEntry } from '../../../shared/liveapp/console.js';
import { BodyTap, headerPairs, kindOf, typeOf, xasAction } from './record.js';

const OFFICE_COOKIE = new RegExp(`^${COOKIE_NAME}(?:_\\d+)?$`);
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
const PATH_MAX = 2048;

export interface ProxyDeps {
  /** Where it listens: the office's own bind address. */
  host: string;
  port: number;
  /** The runtime's app port now (it can move with a restart); undefined while there's none. */
  upstream(): number | undefined;
  /** A request started (pending) or ended: the same id again replaces it. */
  record(e: LiveNetEntry): void;
}

/** The path a request asked for (an absolute-form URL counts only for its path: the target is always the runtime). */
export function pathOf(url: string | undefined): string {
  const u = url ?? '/';
  if (u.startsWith('/')) return u;
  try {
    const p = new URL(u);
    return `${p.pathname}${p.search}` || '/';
  } catch {
    return '/';
  }
}

/** The request's headers as they go to the runtime: no hop-by-hop ones, none of the office's cookies. */
export function upstreamHeaders(h: http.IncomingHttpHeaders, keepUpgrade = false): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...h };
  for (const k of HOP) if (!(keepUpgrade && (k === 'connection' || k === 'upgrade'))) delete out[k];
  const cookie = withoutOfficeCookies(h.cookie);
  if (cookie) out.cookie = cookie;
  else delete out.cookie;
  return out;
}

/** The runtime's headers as they go to the browser: no cookie under the office's name, and a redirect to the runtime's own port pointed back here. */
export function downstreamHeaders(h: http.IncomingHttpHeaders, upstreamPort: number, here: string | undefined): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...h };
  for (const k of ['connection', 'keep-alive', 'transfer-encoding']) delete out[k];
  const set = h['set-cookie']?.filter((c) => !OFFICE_COOKIE.test(c.split('=', 1)[0].trim()));
  if (set?.length) out['set-cookie'] = set;
  else delete out['set-cookie'];
  const loc = h.location;
  if (loc && here) out.location = loc.replace(new RegExp(`^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${upstreamPort}(?=/|$)`, 'i'), `http://${here}`);
  return out;
}

export class RecordingProxy {
  private server: http.Server | undefined;
  private sockets = new Set<Duplex>();
  private next = 1;

  constructor(private d: ProxyDeps) {}

  get port() {
    return this.d.port;
  }

  start(): Promise<void> {
    const server = http.createServer((req, res) => this.request(req, res));
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    server.on('connection', (s) => {
      this.sockets.add(s);
      s.once('close', () => this.sockets.delete(s));
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.d.port, this.d.host, () => {
        server.off('error', reject);
        server.on('error', (err) => console.error('agent-office: live app proxy', err));
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = undefined;
    if (!s) return;
    for (const sock of this.sockets) sock.destroy();
    this.sockets.clear();
    await new Promise<void>((r) => s.close(() => r()));
  }

  private request(req: http.IncomingMessage, res: http.ServerResponse) {
    const at = Date.now();
    const method = req.method ?? 'GET';
    const path = pathOf(req.url);
    const headers = upstreamHeaders(req.headers);
    const kind = kindOf(path, req.headers, method);
    const entry: LiveNetEntry = { id: this.next++, at, method, path: path.slice(0, PATH_MAX), kind, reqHeaders: headerPairs(headers), pending: true };
    this.d.record({ ...entry });
    const reqTap = new BodyTap();
    const resTap = new BodyTap();
    const reqType = typeOf(req.headers['content-type']);
    let done = false;
    const finish = (patch: Partial<LiveNetEntry>) => {
      if (done) return;
      done = true;
      const rb = reqTap.read(reqType, String(req.headers['content-encoding'] ?? '') || undefined);
      const out: LiveNetEntry = { ...entry, ...patch, ms: Date.now() - at };
      delete out.pending;
      if (rb.text !== undefined) out.reqBody = rb.text;
      if (rb.note) out.reqNote = rb.note;
      if (kind === 'xas') {
        const a = xasAction(rb.text);
        if (a) out.action = a;
      }
      this.d.record(out);
    };

    const port = this.d.upstream();
    if (!port) {
      req.resume();
      starting(res, req);
      return finish({ status: 503, error: "The app isn't answering yet (starting or updating)" });
    }
    const up = http.request({ host: '127.0.0.1', port, method, path, headers }, (ur) => {
      const status = ur.statusCode ?? 502;
      const type = typeOf(ur.headers['content-type']);
      const down = downstreamHeaders(ur.headers, port, req.headers.host);
      res.writeHead(status, ur.statusMessage, down);
      ur.on('data', (c: Buffer) => resTap.add(c));
      ur.pipe(res);
      const end = (error?: string) => {
        // Bodies the Console has a use for: the app's calls, and what an error said.
        const keep = kind === 'xas' || kind === 'xhr' || status >= 400;
        const body = keep ? resTap.read(type, String(ur.headers['content-encoding'] ?? '') || undefined) : resTap.total ? { note: `${type || 'body'} · not recorded (only the app's calls and errors are)` } : {};
        finish({ status, ...(type ? { type } : {}), size: resTap.total, resHeaders: headerPairs(down), ...(body.text !== undefined ? { resBody: body.text } : {}), ...(body.note ? { resNote: body.note } : {}), ...(error ? { error } : {}) });
      };
      ur.once('end', () => end());
      ur.once('error', (err) => end(err.message));
      res.once('close', () => !res.writableFinished && end('closed before the answer was complete'));
    });
    up.on('error', (err) => {
      if (!res.headersSent) starting(res, req);
      else res.destroy();
      finish({ status: 0, error: err.message });
    });
    res.once('close', () => {
      if (!res.writableFinished) up.destroy();
    });
    req.on('data', (c: Buffer) => reqTap.add(c));
    req.pipe(up);
  }

  /** WebSockets: the handshake replayed to the runtime (without the office's cookies), then the sockets spliced. */
  private upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const at = Date.now();
    const path = pathOf(req.url);
    const headers = upstreamHeaders(req.headers, true);
    const entry: LiveNetEntry = { id: this.next++, at, method: req.method ?? 'GET', path: path.slice(0, PATH_MAX), kind: 'ws', reqHeaders: headerPairs(headers), pending: true };
    this.d.record({ ...entry });
    const port = this.d.upstream();
    if (!port) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      this.d.record({ ...entry, pending: undefined, status: 503, ms: 0, error: "The app isn't answering yet" });
      return;
    }
    this.sockets.add(socket);
    const up = net.connect(port, '127.0.0.1');
    this.sockets.add(up);
    const lines = [`${entry.method} ${path} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) lines.push(`${k}: ${one}`);
    let status = 0;
    let first = true;
    up.on('connect', () => {
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up);
    });
    up.on('data', (c: Buffer) => {
      if (first) {
        first = false;
        status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(c.subarray(0, 32).toString('latin1'))?.[1] ?? 0);
        const open: LiveNetEntry = { ...entry, status };
        if (status !== 101) delete open.pending;
        this.d.record(open);
      }
      socket.write(c);
    });
    let closed = false;
    const close = (err?: Error) => {
      if (closed) return;
      closed = true;
      up.destroy();
      socket.destroy();
      this.sockets.delete(up);
      this.sockets.delete(socket);
      const out: LiveNetEntry = { ...entry, status, ms: Date.now() - at, ...(err && !status ? { error: err.message } : {}) };
      delete out.pending;
      this.d.record(out);
    };
    up.on('error', close);
    socket.on('error', close);
    up.on('close', () => close());
    socket.on('close', () => close());
  }
}

/** What a page load gets while the runtime isn't answering: a note that reloads itself; anything else, a plain 503. */
function starting(res: http.ServerResponse, req: http.IncomingMessage) {
  const html = /text\/html/.test(String(req.headers.accept ?? ''));
  res.writeHead(503, { 'content-type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '3' });
  res.end(
    html
      ? '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Live app: starting</title><body style="font:16px system-ui,sans-serif;margin:40px;color:#333"><h1 style="font-size:20px">The live app isn’t answering yet</h1><p>It’s starting or updating to a newer main. This page tries again every few seconds.</p></body>'
      : "The live app isn't answering yet (starting or updating).\n",
  );
}
