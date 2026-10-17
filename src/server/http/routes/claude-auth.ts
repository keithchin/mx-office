// 🔑 Claude for agents (server/claude-auth/): where the agents' Claude Code gets its credentials. Reading is
// for anyone signed in (Needs you shows its alert and decision); changing it is an admin's, from the office's
// own page, and audited. A key comes in once, in a POST body, and never goes back out.
//   GET  /api/claude-auth           the view (an admin's with the keys' last 4)
//   POST /api/claude-auth           {mode: login|key|gateway|env, baseUrl?, key?}
//   POST /api/claude-auth/restart   restarts every agent on the office's Claude credentials, with them as they are now
//   POST /api/claude-auth/test      🧪 Test the gateway: one GET of its models list with its key (never a model call)
import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { claudeAuthView, restartAgents, setClaudeAuth, testGateway } from '../../claude-auth/index.js';
import { refuseStale } from '../../phone-access/reauth.js';

const NO_STORE = { 'cache-control': 'no-store' };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export const claudeAuthRoutes = {
  view: {
    method: 'GET',
    path: '/api/claude-auth',
    auth: 'session',
    handle(ctx, { res, session }) {
      return send(res, 200, claudeAuthView(ctx.meOf(session.account?.id).admin), NO_STORE);
    },
  },
  change: {
    method: 'POST',
    prefix: '/api/claude-auth',
    auth: 'session',
    async handle(ctx, { req, res, path: p, session }) {
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins (operators) can change where the agents’ Claude credentials come from' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (refuseStale(ctx, req, res)) return;
      let body: Record<string, unknown> = {};
      try {
        const text = await readBody(req, 16 * 1024);
        body = text ? JSON.parse(text) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      // On the shared password, the name on the page's profile (only ever shown, never trusted).
      const named = str(body.by, 60).replace(/[^\p{L}\p{N} ._'-]/gu, '').trim();
      const who = { name: session.account?.name ?? (named || 'an admin'), id: session.account?.id };
      if (p === '/api/claude-auth/restart') {
        const { restarted, names } = await restartAgents(ctx, who);
        return send(res, 200, { ...claudeAuthView(true), restarted, names }, NO_STORE);
      }
      if (p === '/api/claude-auth/test') return send(res, 200, { ...claudeAuthView(true), check: await testGateway() }, NO_STORE);
      if (p !== '/api/claude-auth') return send(res, 404, { error: 'Not found' });
      const err = await setClaudeAuth({ mode: body.mode, baseUrl: body.baseUrl, key: body.key }, who);
      return err ? send(res, 400, { error: err }) : send(res, 200, claudeAuthView(true), NO_STORE);
    },
  },
} satisfies Record<string, Route>;
