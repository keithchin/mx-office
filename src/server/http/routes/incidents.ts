// The Incidents sub-tab of the 🧾 Audit log (server/incidents/): everyone signed in reads them; admins
// open one (from scratch or from an audit event), change it, add timeline notes, resolve it with a root
// cause and tune the detection rules. Test mode's state for the TEST MODE badge is here too.

import { countIncidents, filterIncidents, isIncidentStatus, isSeverity, normalizeSettings, sortIncidents, type IncidentList } from '../../../shared/incidents.js';
import { addNote, createIncident, incidentStore, updateIncident } from '../../incidents/index.js';
import { cleanPatch } from '../../incidents/edit.js';
import { audit, human } from '../../audit/index.js';
import { testModeOf } from '../../testmode.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';

const isAdmin = (ctx: Ctx, session: Session) => ctx.meOf(session.account?.id).admin;
const actorOf = (session: Session) => human(session.account?.name ?? 'An admin', session.account?.id);
const list = (v: string | null) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** A POST an admin may make: same origin, an admin, a store, and its JSON body; or the answer already sent. */
async function adminBody(ctx: Ctx, r: RouteRequest & { session: Session }): Promise<Record<string, unknown> | undefined> {
  if (!sameOrigin(r.req, ctx.cfg)) return void send(r.res, 403, { error: 'Forbidden' });
  if (!isAdmin(ctx, r.session)) return void send(r.res, 403, { error: 'Only admins can change incidents' });
  if (!incidentStore()) return void send(r.res, 503, { error: 'Incidents are off' });
  try {
    const body = JSON.parse((await readBody(r.req, 64 * 1024)) || '{}');
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // below
  }
  return void send(r.res, 400, { error: 'Send JSON' });
}

export const incidentRoutes = {
  /** GET /api/incidents?floor=<id>|all|_office&status=open,mitigated&severity=sev1,sev2&q= */
  list: {
    method: 'GET',
    path: '/api/incidents',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const store = incidentStore();
      const all = store?.list() ?? [];
      const p = url.searchParams;
      const shown = filterIncidents(all, { floor: p.get('floor') ?? undefined, status: list(p.get('status')).filter(isIncidentStatus), severity: list(p.get('severity')).filter(isSeverity), q: p.get('q')?.slice(0, 200) });
      const body: IncidentList = { incidents: sortIncidents(shown), counts: countIncidents(filterIncidents(all, { floor: p.get('floor') ?? undefined })), chain: store?.verify() ?? { ok: true }, admin: isAdmin(ctx, session), settings: store?.settings() ?? normalizeSettings(undefined) };
      return send(res, 200, body);
    },
  },
  /** POST /api/incidents {title, severity, summary?, floors?, impact?, linkAudit?, workers?}: a new one. Admins only. */
  create: {
    method: 'POST',
    path: '/api/incidents',
    auth: 'session',
    async handle(ctx, r) {
      const body = await adminBody(ctx, r);
      if (!body) return;
      const p = cleanPatch(body);
      if (typeof p === 'string') return send(r.res, 400, { error: p });
      if (!p.title) return send(r.res, 400, { error: 'An incident needs a title' });
      const i = createIncident({ title: p.title, severity: p.severity ?? 'sev3', summary: p.summary, floors: p.floors, impact: p.impact, rootCause: p.rootCause, auditIds: p.linkAudit, workers: p.workers, actions: p.actions, detectedAt: p.detectedAt }, actorOf(r.session));
      return send(r.res, 200, { incident: i });
    },
  },
  /** GET and POST /api/incidents/settings {rules, dedupeHours}: the detection rules. Changing them is for admins. */
  settings: {
    path: '/api/incidents/settings',
    auth: 'session',
    async handle(ctx, r) {
      const store = incidentStore();
      if (!store) return send(r.res, 503, { error: 'Incidents are off' });
      if (r.req.method !== 'POST') return send(r.res, 200, store.settings());
      const body = await adminBody(ctx, r);
      if (!body) return;
      const before = store.settings();
      const after = store.setSettings(body);
      if (JSON.stringify(before) !== JSON.stringify(after)) audit.record({ actor: actorOf(r.session), action: 'settings.change', target: { kind: 'setting', id: 'incidents.rules', label: 'Incident detection rules' }, summary: 'Changed the incident detection rules', details: { before, after }, severity: 'notice' });
      return send(r.res, 200, after);
    },
  },
  /**
   * GET /api/incidents/<id>: one incident. POST /api/incidents/<id> {fields…}: changes it (resolving
   * needs a root cause). POST /api/incidents/<id>/note {text}: a note on its timeline. Admins only.
   */
  one: {
    prefix: '/api/incidents/',
    auth: 'session',
    async handle(ctx, r) {
      const [id, sub] = r.path.slice('/api/incidents/'.length).split('/');
      const store = incidentStore();
      const i = id ? store?.get(id) : undefined;
      if (!i) return send(r.res, 404, { error: 'No such incident' });
      if (r.req.method === 'GET' && !sub) return send(r.res, 200, { incident: i });
      if (r.req.method !== 'POST') return send(r.res, 405, { error: 'Method not allowed' });
      const body = await adminBody(ctx, r);
      if (!body) return;
      if (sub === 'note') {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) return send(r.res, 400, { error: 'A note needs some words' });
        return send(r.res, 200, { incident: addNote(i.id, text, actorOf(r.session)) });
      }
      if (sub) return send(r.res, 404, { error: 'No such action' });
      const p = cleanPatch(body);
      if (typeof p === 'string') return send(r.res, 400, { error: p });
      if (p.status === 'resolved' && i.status !== 'resolved' && !(p.rootCause ?? i.rootCause)?.trim()) return send(r.res, 400, { error: 'Say what the root cause was to resolve it' });
      // Through Phone access, resolving one needs the password again.
      if (p.status === 'resolved' && i.status !== 'resolved' && refuseStale(ctx, r.req, r.res)) return;
      return send(r.res, 200, { incident: updateIncident(i.id, p, actorOf(r.session)) });
    },
  },
  /** GET /api/test-mode: whether the office runs in test mode, for the TEST MODE badge. */
  testMode: {
    method: 'GET',
    path: '/api/test-mode',
    auth: 'session',
    handle(_ctx, { res }) {
      return send(res, 200, testModeOf());
    },
  },
} satisfies Record<string, Route>;
