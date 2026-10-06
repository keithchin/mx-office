// The phone version (/m, client/m.ts; server/mobile/, server/webpush/): its page, the web app manifest,
// the service worker and the icons (public, so a browser can fetch them before signing in or without
// cookies), and its API: who you are and whether a risky action needs your password, the password typed
// again, an action, the projects' status, and the phone's push subscription.

import { createReadStream } from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { publicFile, serveFile } from '../static.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import type { Session } from '../../auth.js';
import type { Ctx } from '../../office/context.js';
import { actionOf, runAction } from '../../mobile/actions.js';
import { reauthOf, reauthenticate, sessionTokenOf } from '../../mobile/reauth.js';
import { projectStatuses } from '../../mobile/status.js';
import { pushOf } from '../../webpush/index.js';
import { phoneAccessOf } from '../../phone-access/index.js';
import { readerOf } from './phone.js';
import { whoOf } from './notify-teams.js';
import { audit, human } from '../../audit/index.js';

/** The web app manifest: "Add to Home Screen" opens /m full screen, with the office's pixel icon. */
export const MANIFEST = {
  name: 'Agent Office',
  short_name: 'Agent Office',
  description: 'What needs you in the office, from your phone',
  id: '/m',
  start_url: '/m',
  scope: '/m',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#fff1de',
  theme_color: '#2b2d42',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

async function json(req: http.IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, limit)) || '{}');
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** A POST from the office's own page with a JSON body, or undefined once it has answered. */
async function post(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): Promise<Record<string, unknown> | undefined> {
  if (!sameOrigin(req, ctx.cfg)) return void send(res, 403, { error: 'Forbidden' });
  const b = await json(req);
  if (!b) return void send(res, 400, { error: 'Send JSON' });
  return b;
}

const ownerOf = (session: Session, browser: unknown) => readerOf(session, browser);

export const mobileRoutes = {
  page: { path: ['/m', '/m.html'], auth: 'session', handle: (ctx, { res }) => serveFile(res, path.join(ctx.publicDir, 'm.html'), false) },
  manifest: {
    path: '/manifest.webmanifest',
    auth: 'public',
    handle: (_ctx, { res }) => void res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }).end(JSON.stringify(MANIFEST)),
  },
  // The service worker: never cached by the browser's HTTP cache, so a new one is picked up at once.
  worker: {
    path: '/sw.js',
    auth: 'public',
    handle(ctx, { res }) {
      const file = publicFile(ctx.publicDir, '/sw.js');
      if (!file) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      createReadStream(file).pipe(res);
    },
  },
  icons: {
    prefix: '/icons/',
    auth: 'public',
    handle(ctx, { res, path: p }) {
      const file = /^\/icons\/[\w-]+\.png$/.test(p) ? publicFile(ctx.publicDir, p) : undefined;
      if (file) return serveFile(res, file, false);
      res.writeHead(404).end();
    },
  },
  /** GET /api/m/me?browser=: admin or not, until when risky actions go through, the push key and this person's phones. */
  me: {
    method: 'GET',
    path: '/api/m/me',
    auth: 'session',
    handle(ctx, { req, res, session, url }) {
      const push = pushOf(ctx);
      const admin = ctx.meOf(session.account?.id).admin;
      const owner = ownerOf(session, url.searchParams.get('browser'));
      return send(res, 200, { admin, account: session.account?.name, reauthUntil: reauthOf(ctx).until(sessionTokenOf(req)), vapidKey: push.keys.current()?.publicKey, phones: push.subs.view(owner, false), tunnel: phoneAccessOf(ctx).manager.url });
    },
  },
  /** POST /api/m/reauth {password}: the password typed again, for risky actions in the next 10 minutes. */
  reauth: {
    method: 'POST',
    path: '/api/m/reauth',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const b = await post(ctx, req, res);
      if (!b) return;
      const ok = await reauthenticate(ctx, req, session, typeof b.password === 'string' ? b.password.slice(0, 512) : '');
      if (ok === undefined) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      if (!ok) return send(res, 401, { error: 'Wrong password' });
      return send(res, 200, { ok: true, reauthUntil: reauthOf(ctx).until(sessionTokenOf(req)) });
    },
  },
  /** POST /api/m/act {do, floor, …}: an action from the phone (risky ones need the fresh sign-in). */
  act: {
    method: 'POST',
    path: '/api/m/act',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const b = await post(ctx, req, res);
      if (!b) return;
      const a = actionOf(b);
      if (typeof a === 'string') return send(res, 400, { error: a });
      const r = await runAction(ctx, a, { name: whoOf(session.account?.name, b.by), id: session.account?.id, admin: ctx.meOf(session.account?.id).admin, fresh: reauthOf(ctx).fresh(sessionTokenOf(req)) });
      return r.ok ? send(res, 200, r) : send(res, r.status, { error: r.error, ...(r.reauth ? { reauth: true } : {}) });
    },
  },
  /** GET /api/m/status: each project's line on the Status tab. */
  status: { method: 'GET', path: '/api/m/status', auth: 'session', handle: async (ctx, { res }) => send(res, 200, { projects: await projectStatuses(ctx) }) },
  /** POST /api/m/push/{subscribe,unsubscribe,alerts,test}: this phone's push notifications. */
  push: {
    method: 'POST',
    prefix: '/api/m/push/',
    auth: 'session',
    async handle(ctx, { req, res, session, path: p }) {
      const b = await post(ctx, req, res);
      if (!b) return;
      const push = pushOf(ctx);
      const owner = ownerOf(session, b.browser);
      if (!owner) return send(res, 400, { error: 'Whose phone?' });
      const admin = ctx.meOf(session.account?.id).admin;
      const name = whoOf(session.account?.name, b.by);
      const id = typeof b.id === 'string' ? b.id : '';
      switch (p) {
        case '/api/m/push/key': {
          // Made once, the first time a phone asks (the private half goes into Connections).
          try {
            return send(res, 200, { vapidKey: (await push.keys.ensure()).publicKey });
          } catch (err) {
            return send(res, 503, { error: (err as Error).message });
          }
        }
        case '/api/m/push/subscribe': {
          await push.keys.ensure();
          const device = typeof b.device === 'string' ? b.device : 'A phone';
          const sub = push.subs.add(b.subscription, owner, name, device, b.alerts);
          if (typeof sub === 'string') return send(res, 400, { error: sub });
          audit.record({ actor: human(name, session.account?.id), action: 'phone.push.subscribe', target: { kind: 'phone', id: sub.id, label: device }, summary: `Turned on push notifications on ${device}`, severity: 'info' });
          return send(res, 200, { id: sub.id, phones: push.subs.view(owner, false) });
        }
        case '/api/m/push/unsubscribe': {
          const s = push.subs.get(id);
          if (!push.subs.remove(id, owner, admin)) return send(res, 404, { error: 'No such phone' });
          audit.record({ actor: human(name, session.account?.id), action: 'phone.push.revoke', target: { kind: 'phone', id, label: s?.device }, summary: `Turned off push notifications on ${s?.device ?? 'a phone'}${s && s.owner !== owner ? ` (${s.name}'s)` : ''}`, severity: 'info' });
          return send(res, 200, { phones: push.subs.view(owner, admin && b.all === true) });
        }
        case '/api/m/push/alerts':
          return push.subs.setAlerts(id, owner, b.alerts) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'No such phone' });
        case '/api/m/push/test': {
          const s = push.subs.get(id);
          if (!s || s.owner !== owner) return send(res, 404, { error: 'No such phone' });
          const err = await push.send(s, { title: '🔔 Agent Office', body: 'Push notifications work on this phone. Red items that need you arrive like this.', tag: 'test', url: '/m' });
          return err ? send(res, 502, { error: err }) : send(res, 200, { ok: true });
        }
        default:
          return send(res, 404, { error: 'Not found' });
      }
    },
  },
  /** GET /api/m/push?all=1&browser=: this person's phones (an admin: everyone's, for Settings). */
  phones: {
    method: 'GET',
    path: '/api/m/push',
    auth: 'session',
    handle(ctx, { res, session, url }) {
      const admin = ctx.meOf(session.account?.id).admin;
      return send(res, 200, { phones: pushOf(ctx).subs.view(ownerOf(session, url.searchParams.get('browser')), admin && url.searchParams.get('all') === '1') });
    },
  },
} satisfies Record<string, Route>;

