// 🚀 First-run setup (server/first-run/): the /setup page, and its calls. Anyone signed in may read
// whether there's a setup to do (GET /api/setup); everything else is for admins: the prerequisite check
// (GET /api/setup/checks, run when asked), and the changes (POST). Tokens are saved through 🔌
// Connections' own routes; the office password through Connections' code, as its card does.

import path from 'node:path';
import type { Route } from '../router.js';
import { isSecure, readBody, sameOrigin, send } from '../util.js';
import { serveFile } from '../static.js';
import { audit, human } from '../../audit/index.js';
import { saveCredential } from '../../connections/index.js';
import { setPath } from '../../connections/paths.js';
import { updateOfficeSettings } from '../../connections/store.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { cloneToolkit } from '../../first-run/clone.js';
import { finishSetup, firstRunView, rerunSetup, runPrereqs, setDefaultMendix, setMxcli, setOrg, setStep, setupReasons } from '../../first-run/index.js';
import { tildify } from '../../building.js';
import type { CloneEvent } from '../../../shared/first-run.js';

const str = (v: unknown, max = 1024) => (typeof v === 'string' ? v.slice(0, max) : '');
const ADMINS_ONLY = 'Only an admin can run the office’s setup';

export const firstRunRoutes = {
  page: { path: ['/setup', '/setup.html'], auth: 'session', handle: (ctx, { res }) => serveFile(res, path.join(ctx.publicDir, 'setup.html'), false) },
  api: {
    prefix: '/api/setup',
    auth: 'session',
    async handle(ctx, { req, res, path: p, session }) {
      const admin = !!ctx.meOf(session.account?.id).admin;
      if (req.method === 'GET') {
        if (p === '/api/setup') return send(res, 200, firstRunView(ctx, admin));
        // The home page's one look on load (client/first-run/gate.ts): cheap, nothing but whether to come here.
        if (p === '/api/setup/needed') return send(res, 200, { needed: setupReasons(ctx).length > 0, admin });
        if (p === '/api/setup/checks') return admin ? send(res, 200, { rows: await runPrereqs(ctx) }) : send(res, 403, { error: ADMINS_ONLY });
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!admin) return send(res, 403, { error: ADMINS_ONLY });
      if (refuseStale(ctx, req, res)) return;
      let body: Record<string, unknown> = {};
      try {
        const text = await readBody(req, 16 * 1024);
        body = text ? JSON.parse(text) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const named = str(body.by, 60).replace(/[^\p{L}\p{N} ._'-]/gu, '').trim();
      const who = { name: session.account?.name ?? (named || 'an admin'), id: session.account?.id };
      const answer = (err?: string, headers: Record<string, string> = {}) => (err ? send(res, 400, { error: err }) : send(res, 200, firstRunView(ctx, true), headers));

      switch (p) {
        case '/api/setup/password': {
          const err = await saveCredential(ctx, 'password', str(body.password, 300), who);
          // The new shared password signs its sessions out: whoever set it stays signed in.
          return answer(err, !err && !session.account ? { 'set-cookie': ctx.auth.cookie(req, ctx.auth.issue(), isSecure(req, ctx.cfg)) } : {});
        }
        case '/api/setup/step':
          return answer(setStep(body.step, who));
        case '/api/setup/org':
          return answer(setOrg(body.org, who));
        case '/api/setup/mendix':
          return answer(setDefaultMendix(body.version, who));
        case '/api/setup/mxcli':
          return answer(setMxcli(body.path, who));
        case '/api/setup/toolkit':
          return answer(setPath(ctx, 'toolkitDir', str(body.dir), who));
        case '/api/setup/finish':
          finishSetup(who);
          return answer();
        case '/api/setup/rerun':
          rerunSetup(who);
          return answer();
        case '/api/setup/toolkit/clone': {
          // git's progress as it comes, a JSON line each (CloneEvent), then how it ended.
          res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          const emit = (e: CloneEvent) => res.write(`${JSON.stringify(e)}\n`);
          const url = str(body.url, 500).trim();
          const dir = await cloneToolkit(url, str(body.dir), emit);
          if (dir) {
            updateOfficeSettings({ toolkitRepo: url });
            audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'toolkitRepo', label: 'Toolkit clone' }, summary: `${who.name} cloned the toolkit from ${url} into ${tildify(dir)}`, details: { after: { url, dir: tildify(dir) } }, severity: 'notice' });
            const err = setPath(ctx, 'toolkitDir', dir, who);
            if (err) emit({ t: 'line', text: err });
          }
          return res.end();
        }
        default:
          return send(res, 404, { error: 'Not found' });
      }
    },
  },
} satisfies Record<string, Route>;
