// Requests that came in through 📱 Phone access's tunnel. The tunnel's CLI runs on this machine, so they
// reach the office from loopback, for the tunnel's own host (in Host, or in X-Forwarded-Host when the
// CLI rewrites Host to localhost). For those, and only those, the office trusts the forwarded headers
// its own tunnel added: the client's address (so login attempts are rate-limited per phone, not for
// everyone at once), https (so the session cookie is Secure) and the host a page was loaded from
// (so the socket's same-origin check passes). http/util.ts asks through `useTunnelOrigin`.

import type http from 'node:http';
import { useTunnelOrigin } from '../http/util.js';

let host: string | undefined;

const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;

/** The tunnel's host now (undefined while it's down). */
export const tunnelHost = () => host;

/** Whether `req` came through the tunnel. */
export function viaTunnel(req: http.IncomingMessage): boolean {
  if (!host || !LOOPBACK.test(req.socket.remoteAddress ?? '')) return false;
  const fwd = typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'].split(',')[0].trim().toLowerCase() : undefined;
  return (req.headers.host ?? '').toLowerCase() === host || fwd === host;
}

/** The tunnel is up at `url` (or down: undefined). */
export function setTunnelUrl(url: string | undefined) {
  host = url ? new URL(url).host.toLowerCase() : undefined;
}

useTunnelOrigin({ via: viaTunnel, host: () => host });
