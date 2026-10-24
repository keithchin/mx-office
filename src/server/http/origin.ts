// Who may change something through the office's signed-in HTTP routes: a request that comes from the
// office's own page (its Origin is the office's address), or a tool that says so explicitly with the office's
// request token for its session (the X-Mx-Office-Csrf header, GET /api/csrf). A request with neither is
// refused, whatever its content type: before this, a JSON request with no Origin at all was let through, so a
// stray script holding a session cookie could press Accept, a merge override or a review by mistake.
//
// What it is: protection against mistakes and drive-by requests (another site's page, a script pointed at the
// wrong office, a copy-pasted curl). What it is NOT: a boundary against an agent running as the same OS user.
// Such an agent can read the browser's cookies or the office's data folder, and send a matching Origin
// itself; docs/site/architecture/trust-and-authority.md says why that boundary needs OS-level separation.
//
// The agents' own routes (the hook port's /office/* endpoints with their bearer token, the MCP server, the
// office-* CLI tools) and the public routes (sign-in) are not session routes, so this never sees them.

import { createHash } from 'node:crypto';
import type http from 'node:http';
import type { Config } from '../config.js';
import { cookieName, parseCookies } from '../auth.js';
import { sameOrigin } from './util.js';

/** The header a tool sends the session's request token in. */
export const CSRF_HEADER = 'x-mx-office-csrf';

/** Methods that only read: never refused here. */
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The request token of a session cookie: tied to that sign-in, useless without it, and not the cookie itself. */
export const csrfTokenOf = (cookie: string): string => createHash('sha256').update(`mx-office-csrf:${cookie}`).digest('hex').slice(0, 40);

/** The request token for the session `req` is signed in with, or undefined without one. */
export function csrfToken(req: http.IncomingMessage): string | undefined {
  const cookie = parseCookies(req.headers.cookie)[cookieName(req)];
  return cookie ? csrfTokenOf(cookie) : undefined;
}

/** Whether `req` carries its session's request token. */
function hasToken(req: http.IncomingMessage): boolean {
  const sent = req.headers[CSRF_HEADER];
  const want = csrfToken(req);
  return typeof sent === 'string' && !!want && sent.length === want.length && sent === want;
}

/** Whether a state-changing request comes from the office's page (matching Origin) or a tool with the session's token. */
export const fromOffice = (req: http.IncomingMessage, cfg: Pick<Config, 'trustProxy'>): boolean => sameOrigin(req, cfg as Config) || hasToken(req);

/** Why a request is refused, for the 403's body: what a tool has to send. */
export const REFUSED = `Forbidden: this request didn't come from the office's page. A tool sends the office's address as its Origin, or the ${CSRF_HEADER} header from GET /api/csrf`;

/** The router's guard for a signed-in route: false (and nothing else to do) when it may go on, true when it answered 403. */
export function refuseForeign(req: http.IncomingMessage, res: http.ServerResponse, cfg: Pick<Config, 'trustProxy'>): boolean {
  if (READS.has((req.method ?? 'GET').toUpperCase()) || fromOffice(req, cfg)) return false;
  res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: REFUSED }));
  return true;
}
