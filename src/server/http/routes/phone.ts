// The team phone (server/phone/): POST a person's message to the agents (or an answer to an escalation
// in its thread), GET the replies a floor is waiting for, and GET / POST what the person has read. New
// messages and replies reach the browsers as team chatter (chatter.new).
import type { PhonePlace } from '../../../shared/phone.js';
import { isEscalationVerdict } from '../../../shared/roster/escalation.js';
import { phoneOf, phoneReadsOf } from '../../phone/office.js';
import type { Session } from '../../auth.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';
import { floorParam } from './files.js';

const ID = /^[\w.:-]{1,120}$/;

/** Where the message was written, from what the browser sent. */
export function placeOf(v: unknown): PhonePlace | undefined {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (p.in === 'channel') return { in: 'channel' };
  if (p.in === 'dm' && typeof p.workerId === 'string' && ID.test(p.workerId)) return { in: 'dm', workerId: p.workerId };
  // The thread's agents and escalation are the office's to work out (Phone.place), not the browser's to say.
  if (p.in === 'thread' && typeof p.thread === 'string' && ID.test(p.thread)) return { in: 'thread', thread: p.thread, agents: [] };
  return undefined;
}

/** Whose read state it is: their account, else (on the shared password) their browser's own key. */
export function readerOf(session: Session, browser: unknown): string | undefined {
  if (session.account?.id) return `a:${session.account.id}`;
  return typeof browser === 'string' && /^[\w-]{8,40}$/.test(browser) ? `b:${browser}` : undefined;
}

async function json(req: RouteRequest['req']): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

export const phoneRoutes = {
  /** POST /api/phone/send {floor, text, place, verdict?}: to the Coordinator, an @agent, @team, a DM or a thread. */
  send: {
    method: 'POST',
    path: '/api/phone/send',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const body = await json(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const place = placeOf(body.place);
      if (!place) return send(res, 400, { error: 'Where was it written?' });
      if (body.verdict !== undefined && !isEscalationVerdict(body.verdict)) return send(res, 400, { error: 'reply, approve or reject' });
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      const r = phoneOf(ctx).send({ floor: floor.id, text: typeof body.text === 'string' ? body.text : '', place, by, admin: ctx.meOf(session.account?.id).admin, ...(body.verdict ? { verdict: body.verdict as 'reply' } : {}) });
      return r.ok ? send(res, 200, r) : send(res, r.status, { error: r.why });
    },
  },
  /** GET /api/phone/state?floor=<id>: the replies the floor is waiting for. */
  state: {
    method: 'GET',
    path: '/api/phone/state',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, { floor: floor.id, pending: phoneOf(ctx).pendingOn(floor.id) });
    },
  },
  /** GET /api/phone/reads?browser=<key>: what this person has read, per channel. */
  reads: {
    method: 'GET',
    path: '/api/phone/reads',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const who = readerOf(session, url.searchParams.get('browser'));
      if (!who) return send(res, 400, { error: 'Whose?' });
      return send(res, 200, { reads: phoneReadsOf(ctx).get(who) });
    },
  },
  /** POST /api/phone/reads {browser, reads}: marks channels read (a later read wins). */
  markRead: {
    method: 'POST',
    path: '/api/phone/reads',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const body = await json(req);
      const who = body && readerOf(session, body.browser);
      if (!body || !who) return send(res, 400, { error: 'Whose?' });
      return send(res, 200, { reads: phoneReadsOf(ctx).mark(who, body.reads as Record<string, number>) });
    },
  },
} satisfies Record<string, Route>;
