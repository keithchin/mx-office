// Risky actions from the phone (shared/mobile.ts isRisky: merge, hire, raise the cap, approve a merge-order
// escalation) need a fresh sign-in: the session signed in within the last 10 minutes, or the password
// typed again on the phone within them. Kept per session (a hash of its cookie, never the cookie), in
// memory: a restart asks again. A re-typed password counts against the same rate limit as a sign-in.

import { createHash } from 'node:crypto';
import type http from 'node:http';
import { REAUTH_MS, freshAuth } from '../../shared/mobile.js';
import { SESSION_TTL_MS, cookieName, parseCookies, type Session } from '../auth.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { clientIp } from '../http/util.js';

/** The session cookie's value this request carries. */
export const sessionTokenOf = (req: http.IncomingMessage): string | undefined => parseCookies(req.headers.cookie)[cookieName(req)];

/** When a session cookie was issued (its expiry less its lifetime); the cookie was already verified. */
export function issuedAtOf(token: string | undefined): number | undefined {
  if (!token) return undefined;
  try {
    const exp = JSON.parse(Buffer.from(token.slice(0, token.indexOf('.')), 'base64url').toString('utf8'))?.exp;
    return typeof exp === 'number' ? exp - SESSION_TTL_MS : undefined;
  } catch {
    return undefined;
  }
}

const keyOf = (token: string) => createHash('sha256').update(`reauth:${token}`).digest('hex');

export class ReauthBook {
  private at = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  mark(token: string) {
    const now = this.now();
    for (const [k, t] of this.at) if (now - t > REAUTH_MS) this.at.delete(k);
    this.at.set(keyOf(token), now);
  }

  /** Whether this session may take a risky action now. */
  fresh(token: string | undefined): boolean {
    if (!token) return false;
    return freshAuth(this.now(), this.at.get(keyOf(token)), issuedAtOf(token));
  }

  /** Until when it stays fresh (0: it isn't). */
  until(token: string | undefined): number {
    if (!token || !this.fresh(token)) return 0;
    return Math.max(this.at.get(keyOf(token)) ?? 0, issuedAtOf(token) ?? 0) + REAUTH_MS;
  }
}

const books = new WeakMap<object, ReauthBook>();
export function reauthOf(ctx: Pick<Ctx, 'cfg'>): ReauthBook {
  let b = books.get(ctx.cfg);
  if (!b) books.set(ctx.cfg, (b = new ReauthBook()));
  return b;
}

/** The password typed again: the account's own, or the shared office password. Undefined: rate limited. */
export async function reauthenticate(ctx: Ctx, req: http.IncomingMessage, session: Session, password: string): Promise<boolean | undefined> {
  const ip = clientIp(req, ctx.cfg.trustProxy);
  if (!ctx.auth.allowAttempt(ip)) return undefined;
  const acct = session.account;
  const ok = acct ? (await ctx.accounts.check(acct.name, password))?.id === acct.id : ctx.accounts.sharedPassword && (await ctx.auth.checkPassword(password));
  audit.record({ actor: human(acct?.name ?? 'Shared password', acct?.id), action: ok ? 'login.reauth.ok' : 'login.reauth.fail', target: { kind: 'office', label: 'Phone version' }, summary: ok ? 'Confirmed their password on the phone for a risky action' : 'Typed a wrong password on the phone for a risky action', details: { ip }, severity: ok ? 'info' : 'warning' });
  if (!ok) return false;
  ctx.auth.recordSuccess(ip);
  const token = sessionTokenOf(req);
  if (token) reauthOf(ctx).mark(token);
  return true;
}
