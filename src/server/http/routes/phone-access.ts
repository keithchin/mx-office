// Settings → Connections → 📱 Phone access (server/phone-access/): GET its state (anyone signed in may
// see whether it's up; only admins its details); admins POST to switch it on or off, pick the provider,
// set the Cloudflare hostname and start signing in. Every switch is in the audit log, by whom.

import { cleanHostname, isTunnelProvider, type PhoneAccessPatch } from '../../../shared/phone-access.js';
import { audit, human } from '../../audit/index.js';
import { phoneAccessOf } from '../../phone-access/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { whoOf } from './notify-teams.js';
import { refuseStale } from '../../phone-access/reauth.js';

export const phoneAccessRoutes = {
  view: {
    method: 'GET',
    path: '/api/phone-access',
    auth: 'session',
    handle(ctx, { res, session }) {
      const admin = ctx.meOf(session.account?.id).admin;
      const v = phoneAccessOf(ctx).view(admin);
      return send(res, 200, admin ? v : { on: v.on, state: v.state, provider: v.provider, url: v.url, admin: false });
    },
  },
  save: {
    method: 'POST',
    path: '/api/phone-access',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins can change phone access' });
      let body: PhoneAccessPatch & { by?: unknown };
      try {
        body = JSON.parse((await readBody(req, 4096)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      // Through the tunnel itself, changing it needs the password again; switching it off never does.
      const offOnly = body.on === false && body.provider === undefined && body.hostname === undefined && body.signIn !== true;
      if (!offOnly && refuseStale(ctx, req, res)) return;
      const who = whoOf(session.account?.name, body.by);
      const p = phoneAccessOf(ctx);
      const m = p.manager;
      const actor = human(who, session.account?.id);
      if (body.provider !== undefined || body.hostname !== undefined) {
        if (body.provider !== undefined && !isTunnelProvider(body.provider)) return send(res, 400, { error: 'devtunnel, cloudflare or cloudflare-quick' });
        const hostname = body.hostname === undefined ? undefined : body.hostname === '' ? '' : cleanHostname(body.hostname);
        if (hostname === undefined && body.hostname !== undefined) return send(res, 400, { error: 'A hostname like office.example.com' });
        const err = m.configure({ ...(body.provider ? { provider: body.provider } : {}), ...(hostname !== undefined ? { hostname } : {}) });
        if (err) return send(res, 400, { error: err });
        audit.record({ actor, action: 'settings.change', target: { kind: 'setting', id: 'phoneAccess', label: 'Phone access' }, summary: `${who} set phone access to ${m.settings.provider}${m.settings.hostname ? ` (${m.settings.hostname})` : ''}`, details: { after: { provider: m.settings.provider, hostname: m.settings.hostname ?? null } }, severity: 'notice' });
      }
      if (body.on === true || body.signIn === true) {
        if (m.settings.provider === 'cloudflare-quick' && body.acceptRisk !== true && !m.settings.on) return send(res, 400, { error: 'Accept the warning first' });
        const err = m.start({ acceptRisk: body.acceptRisk === true });
        if (err) return send(res, 400, { error: err });
        const quick = m.settings.provider === 'cloudflare-quick';
        audit.record({ actor, action: 'access.tunnel.on', target: { kind: 'tunnel', id: m.settings.provider, label: 'Phone access' }, summary: quick ? `${who} switched on a public quick tunnel for an hour, accepting the warning` : `${who} switched phone access on (${m.settings.provider})`, details: { provider: m.settings.provider, acceptedRisk: quick }, severity: quick ? 'warning' : 'notice' });
      } else if (body.on === false) {
        m.stop(`Switched off by ${who}`);
        audit.record({ actor, action: 'access.tunnel.off', target: { kind: 'tunnel', id: m.settings.provider, label: 'Phone access' }, summary: `${who} switched phone access off`, severity: 'notice' });
      }
      return send(res, 200, p.view(true));
    },
  },
} satisfies Record<string, Route>;
