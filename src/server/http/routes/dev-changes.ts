// Developer changes (server/dev-changes/): GET a project's changes with their four facts and the revision strip;
// the lifecycle's person actions, each by whoever asked for the change or an admin, from the office's own pages
// only, audited:
//
//   POST /api/dev-changes/cancel     {floor, id}            cancel (before it starts, or while the team has it:
//                                                           its worker stopped or isolated first)
//   POST /api/dev-changes/supersede  {floor, id}            the correction `id` marks the change it corrects superseded
//   POST /api/dev-changes/retry      {floor, id}            hand a change that needs attention to the lead again
//   POST /api/dev-changes/link       {floor, id, sha, verdict: confirmed|dismissed}   a possibly related commit
//   POST /api/dev-changes/policy     {floor, correctionsFirst?, waitForReview?}       admins only
//
// A new change is made through the change requests' POST (C4's entry, http/routes/change-requests.ts). These
// checks protect against mistakes by people and agents using the office's pages; they are not a security boundary
// against an agent running as the office's own OS user (docs/site/architecture/trust-and-authority.md).
import type { Route } from '../router.js';
import type { Ctx } from '../../office/context.js';
import { changesView, devChangesOf } from '../../dev-changes/index.js';
import { audit } from '../../audit/index.js';
import type { Who } from '../../dev-changes/service.js';
import type { Floor } from '../../floor.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';

const ID = /^DC-\d{1,7}$/;
const SHA = /^[0-9a-f]{40}$/;

type Session = { account?: { id?: string; name?: string } };

const whoOf = (ctx: Ctx, session: Session): Who => {
  const id = session.account?.id;
  return { name: session.account?.name ?? 'The Project Manager', ...(id ? { id } : {}), admin: ctx.meOf(id).admin };
};

/** The body of a same-origin POST naming a project: the project, the body and who's asking; or the answer already sent. */
async function bodyOf(ctx: Ctx, req: IncomingMessage, res: ServerResponse, session: Session): Promise<{ floor: Floor; body: Record<string, unknown>; who: Who } | undefined> {
  if (!sameOrigin(req, ctx.cfg)) return void send(res, 403, { error: 'Forbidden' });
  let body: Record<string, unknown>;
  try {
    const v = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
    body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return void send(res, 400, { error: 'Send JSON' });
  }
  const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
  if (!floor) return void send(res, 404, { error: 'No such project' });
  return { floor, body, who: whoOf(ctx, session) };
}

/** An action on one change: its answer, 403 for a permission refusal, 400 otherwise. */
function changeAction(path: string, act: (ctx: Ctx, floor: Floor, id: string, who: Who) => Promise<unknown>): Route {
  return {
    method: 'POST',
    path,
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const b = await bodyOf(ctx, req, res, session);
      if (!b) return;
      if (typeof b.body.id !== 'string' || !ID.test(b.body.id)) return send(res, 400, { error: 'Say which change' });
      const r = await act(ctx, b.floor, b.body.id, b.who);
      if (typeof r === 'string') return send(res, /^Only /.test(r) ? 403 : 400, { error: r });
      return send(res, 200, { change: r });
    },
  };
}

export const devChangeRoutes = {
  /** GET /api/dev-changes?floor=<id>: the changes with their state and four facts (newest first), the current one, the strip, the policy. */
  list: {
    method: 'GET',
    path: '/api/dev-changes',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await changesView(ctx, floor, whoOf(ctx, session)));
    },
  },
  cancel: changeAction('/api/dev-changes/cancel', (ctx, floor, id, who) => devChangesOf(ctx).changes.cancel(floor.id, id, who)),
  supersede: changeAction('/api/dev-changes/supersede', (ctx, floor, id, who) => devChangesOf(ctx).changes.supersede(floor.id, id, who)),
  retry: changeAction('/api/dev-changes/retry', (ctx, floor, id, who) => devChangesOf(ctx).changes.retry(floor.id, id, who)),
  /** POST /api/dev-changes/link {floor, id, sha, verdict}: confirms or dismisses a commit possibly related to a change; audited. */
  link: {
    method: 'POST',
    path: '/api/dev-changes/link',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const b = await bodyOf(ctx, req, res, session);
      if (!b) return;
      const { id, sha, verdict } = b.body;
      if (typeof id !== 'string' || !ID.test(id)) return send(res, 400, { error: 'Say which change' });
      if (typeof sha !== 'string' || !SHA.test(sha)) return send(res, 400, { error: 'Say which commit (a full commit id)' });
      if (verdict !== 'confirmed' && verdict !== 'dismissed') return send(res, 400, { error: 'verdict: confirmed or dismissed' });
      const { store } = devChangesOf(ctx);
      const c = await store.get(b.floor.id, id);
      if (!c) return send(res, 400, { error: 'No such change' });
      if (!b.who.admin && !(c.owner && c.owner === b.who.id)) return send(res, 403, { error: 'Only whoever asked for it, or an admin, can confirm or dismiss a link' });
      const r = c.related?.find((x) => x.sha === sha);
      if (!r) return send(res, 400, { error: 'That commit isn’t listed as possibly related to this change' });
      if (r.explicit) return send(res, 400, { error: 'That commit names the change itself: it’s linked already' });
      await store.event(b.floor.id, id, { type: 'link', at: Date.now(), sha, verdict, by: b.who.name, ...(b.who.id ? { byId: b.who.id } : {}) });
      audit.record({ floor: b.floor.id, actor: { kind: 'human', name: b.who.name, ...(b.who.id ? { id: b.who.id } : {}) }, action: verdict === 'confirmed' ? 'dev-change.link-confirmed' : 'dev-change.link-dismissed', target: { kind: 'commit', id: sha, label: `${id} ↔ ${sha.slice(0, 7)}` }, summary: `${verdict === 'confirmed' ? 'Confirmed' : 'Dismissed'} commit ${sha.slice(0, 7)} as related to ${id} (“${r.subject}”); it doesn’t change whether ${id} is implemented`, details: { id, sha, verdict, docs: r.docs } });
      return send(res, 200, { change: await store.get(b.floor.id, id) });
    },
  },
  /** POST /api/dev-changes/policy {floor, correctionsFirst?, waitForReview?}: the project's queue policy; admins only, audited. */
  policy: {
    method: 'POST',
    path: '/api/dev-changes/policy',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const b = await bodyOf(ctx, req, res, session);
      if (!b) return;
      if (!b.who.admin) return send(res, 403, { error: 'Only an admin can change the queue policy' });
      const { policies, changes } = devChangesOf(ctx);
      const before = policies.get(b.floor.id);
      const after = policies.set(b.floor.id, { ...(typeof b.body.correctionsFirst === 'boolean' ? { correctionsFirst: b.body.correctionsFirst } : {}), ...(typeof b.body.waitForReview === 'boolean' ? { waitForReview: b.body.waitForReview } : {}) });
      audit.record({ floor: b.floor.id, actor: { kind: 'human', name: b.who.name, ...(b.who.id ? { id: b.who.id } : {}) }, action: 'dev-change.policy', target: { kind: 'project', id: b.floor.id, label: 'Developer change queue' }, summary: `Queue policy: corrections ${after.correctionsFirst ? 'first' : 'in order'}; overlapping untried work ${after.waitForReview ? 'waits for its review' : 'proceeds with a note'}`, details: { before, after } });
      void changes.advance(b.floor.id).catch(() => undefined);
      return send(res, 200, { policy: after });
    },
  },
} satisfies Record<string, Route>;
