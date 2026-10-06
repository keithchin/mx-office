// 🔌 Connections (server/connections/): the office's credentials, its git / gh check, its folders and
// its worktree cleanup. Admins (operators) only, from the office's own pages. Values come in once, in a
// POST body, and never go back out: every answer is the page's view, statuses and masked tails only.

import type { Route } from '../router.js';
import { isSecure, readBody, sameOrigin, send } from '../util.js';
import { isCredentialId } from '../../../shared/connections.js';
import { connectionsView, importFromFiles, removeCredential, saveCredential, setMendixFloor, testSaved } from '../../connections/index.js';
import { setPath } from '../../connections/paths.js';
import { credential } from '../../connections/resolve.js';
import { updateOfficeSettings } from '../../connections/store.js';
import { checkTools, cleanIdentity } from '../../connections/tools.js';
import { audit, human } from '../../audit/index.js';
import { runSweep, setSweep } from '../../worktree-sweep/index.js';
import { refuseStale } from '../../phone-access/reauth.js';

const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : '');

export const connectionsRoutes = {
  connections: {
    prefix: '/api/connections',
    auth: 'session',
    async handle(ctx, { req, res, path: p, session }) {
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins (operators) can see and change the office’s connections' });
      // Never cached anywhere: it says which credentials the office has.
      const noStore = { 'cache-control': 'no-store' };
      if (req.method === 'GET') {
        if (p === '/api/connections') return send(res, 200, connectionsView(ctx), noStore);
        if (p === '/api/connections/tools') return send(res, 200, await checkTools(credential('github-agents')), noStore);
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      // Through Phone access, changing them needs the password again (testing one doesn't).
      if (p !== '/api/connections/test' && refuseStale(ctx, req, res)) return;
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
      const answer = (err?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
        err ? send(res, 400, { error: err }) : send(res, 200, { ...connectionsView(ctx), ...extra }, { ...noStore, ...headers });
      const id = body.id;

      switch (p) {
        case '/api/connections/save': {
          if (!isCredentialId(id)) return answer('No such connection');
          const err = await saveCredential(ctx, id, str(body.value), who);
          // A new shared password signs its sessions out: whoever changed it on it stays signed in.
          const keep = !err && id === 'password' && !session.account ? { 'set-cookie': ctx.auth.cookie(req, ctx.auth.issue(), isSecure(req, ctx.cfg)) } : ({} as Record<string, string>);
          return answer(err, {}, keep);
        }
        case '/api/connections/remove':
          return isCredentialId(id) ? answer(removeCredential(ctx, id, who)) : answer('No such connection');
        case '/api/connections/test': {
          if (!isCredentialId(id)) return answer('No such connection');
          const r = await testSaved(ctx, id);
          return answer(typeof r === 'string' ? r : undefined);
        }
        case '/api/connections/import': {
          const r = await importFromFiles(ctx, who);
          return answer(undefined, { imported: r });
        }
        case '/api/connections/mendix-floor':
          return answer(setMendixFloor(ctx, str(body.floor, 200), body.on === true, who));
        case '/api/connections/paths': {
          const which = body.which === 'projectsDir' || body.which === 'toolkitDir' ? body.which : undefined;
          return which ? answer(setPath(ctx, which, str(body.dir, 1024), who)) : answer('Which folder?');
        }
        case '/api/connections/git-identity': {
          if (body.clear === true) {
            updateOfficeSettings({ gitIdentity: undefined });
            audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'gitIdentity', label: 'Commit identity' }, summary: `${who.name} cleared the office’s commit identity`, severity: 'notice' });
            return answer();
          }
          const ident = cleanIdentity(body);
          if (typeof ident === 'string') return answer(ident);
          updateOfficeSettings({ gitIdentity: ident });
          audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'gitIdentity', label: 'Commit identity' }, summary: `${who.name} set the workers’ commit identity to ${ident.name} <${ident.email}>`, details: { after: ident }, severity: 'notice' });
          return answer();
        }
        case '/api/connections/sweep':
          setSweep(body.on === true, who);
          return answer();
        case '/api/connections/sweep/run':
          await runSweep(ctx, who);
          return answer();
        default:
          return send(res, 404, { error: 'Not found' });
      }
    },
  },
} satisfies Record<string, Route>;
