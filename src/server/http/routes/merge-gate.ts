// The merge gate's routes (server/merge-gate/): a pull request's review status for its current head, a
// person's review of the revision they saw (a fresh sign-in: their password within the last 10 minutes,
// wherever they are), and an admin's override of the office's Merge button with a typed reason. Both
// writes are audited; the review is posted on GitHub as the mx-office/review status.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { audit, human } from '../../audit/index.js';
import { reauthOf, sessionTokenOf } from '../../mobile/reauth.js';
import { asksAgain, clearReviewed, gateFloorOf, mergeGateOf } from '../../merge-gate/index.js';
import { short } from '../../../shared/merge-gate.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const FRESH_NEEDED = 'Type your password again: a review or an override in the office needs a sign-in from the last 10 minutes.';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

async function body(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const b = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return b && typeof b === 'object' ? b : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const prOf = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);

export const mergeGateRoutes = {
  /** GET /api/merge-gate?floor=&pr=: the PR's review status for its head, the gate's decision, and branch protection. */
  view: {
    method: 'GET',
    path: '/api/merge-gate',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      const pr = prOf(url.searchParams.get('pr'));
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!pr) return send(res, 400, { error: 'Which PR?' });
      try {
        const { facts: _facts, ...view } = await mergeGateOf(ctx).evaluate(gateFloorOf(ctx, floor), pr);
        asksAgain(ctx, floor.id);
        return send(res, 200, { ...view, admin: ctx.meOf(session.account?.id).admin });
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
    },
  },
  /** POST /api/merge-gate/review {floor, pr, sha, verdict: approve|changes, note?}: your review of that exact head. */
  review: {
    method: 'POST',
    path: '/api/merge-gate/review',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      const b = await body(req);
      if (!b) return send(res, 400, { error: 'Send JSON' });
      const floor = ctx.floors.get(str(b.floor, 80));
      const pr = prOf(b.pr);
      const verdict = b.verdict === 'approve' || b.verdict === 'changes' ? b.verdict : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!pr || !verdict) return send(res, 400, { error: 'Send pr, sha and verdict (approve or changes)' });
      if (!reauthOf(ctx).fresh(sessionTokenOf(req))) return send(res, 401, { error: FRESH_NEEDED, reauth: true });
      const name = session.account?.name ?? 'Project Manager';
      const r = await mergeGateOf(ctx)
        .recordReview(gateFloorOf(ctx, floor), pr, { sha: str(b.sha, 64), verdict, by: { kind: 'person', name, ...(session.account?.id ? { id: session.account.id } : {}) }, note: str(b.note, 2000) || undefined })
        .catch((err: Error) => ({ error: `The office couldn’t read PR #${pr} from GitHub: ${err.message}`, record: undefined, view: undefined }));
      if (!r.record) return send(res, 409, { error: r.error });
      const words = verdict === 'approve' ? 'Reviewed and approved' : 'Requested changes on';
      audit.record({ floor: floor.id, actor: human(name, session.account?.id), action: 'pr.review.record', target: { kind: 'pr', id: `#${pr}`, label: `PR #${pr}` }, summary: `${words} PR #${pr} at ${short(r.record.sha)}`, details: { sha: r.record.sha, verdict, note: r.record.note }, severity: 'notice' });
      ctx.toastFloor(floor, `${verdict === 'approve' ? '✅' : '✋'} ${name}: ${words.toLowerCase()} PR #${pr} at ${short(r.record.sha)}`);
      void clearReviewed(ctx, floor).catch(() => undefined);
      if (!r.view?.error) asksAgain(ctx, floor.id);
      return send(res, 200, { record: r.record, view: r.view && { ...r.view, facts: undefined, admin: ctx.meOf(session.account?.id).admin } });
    },
  },
  /** POST /api/merge-gate/override {floor, pr, sha, reason}: admins only; lets the office's Merge button through for that head for 30 minutes. */
  override: {
    method: 'POST',
    path: '/api/merge-gate/override',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can override the merge gate' });
      const b = await body(req);
      if (!b) return send(res, 400, { error: 'Send JSON' });
      const floor = ctx.floors.get(str(b.floor, 80));
      const pr = prOf(b.pr);
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!pr) return send(res, 400, { error: 'Which PR?' });
      if (!reauthOf(ctx).fresh(sessionTokenOf(req))) return send(res, 401, { error: FRESH_NEEDED, reauth: true });
      const name = session.account?.name ?? 'An admin';
      const r = await mergeGateOf(ctx)
        .override(gateFloorOf(ctx, floor), pr, { sha: str(b.sha, 64), reason: str(b.reason, 2000), by: { name, ...(session.account?.id ? { id: session.account.id } : {}) } })
        .catch((err: Error) => ({ error: `The office couldn’t read PR #${pr} from GitHub: ${err.message}`, override: undefined, view: undefined }));
      if (!r.override) return send(res, 400, { error: r.error });
      audit.record({ floor: floor.id, actor: human(name, session.account?.id), action: 'pr.gate.override', target: { kind: 'pr', id: `#${pr}`, label: `PR #${pr}` }, summary: `Overrode the merge gate for PR #${pr} at ${short(r.override.sha)}: ${r.override.reason}`, details: { sha: r.override.sha, reason: r.override.reason, review: r.view?.review.text }, severity: 'warning' });
      return send(res, 200, { override: r.override, view: r.view && { ...r.view, facts: undefined, admin: true } });
    },
  },
} satisfies Record<string, Route>;
