// The 🧾 Audit log tabs (server/audit/): GET a page of events with its counts and whether the chain
// holds; admins export the matching events (CSV or JSONL) and switch logging prompt text on or off.

import type http from 'node:http';
import { AUDIT_ACTOR_KINDS, type AuditActorKind } from '../../../shared/audit.js';
import { audit, auditLog, human, promptTextLogged, readAudit, setPromptTextLogged, type AuditQuery } from '../../audit/index.js';
import { csvHeader, csvRow } from '../../audit/query.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';

/** A time from the query: milliseconds, or anything Date can read. */
const time = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  const t = Number.isFinite(n) ? n : Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
};
const list = (v: string | null) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);

/** The query the URL asks for (the cursor and the limit included). */
export function auditQuery(url: URL): AuditQuery {
  const p = url.searchParams;
  const actors = list(p.get('actor')).filter((k): k is AuditActorKind => AUDIT_ACTOR_KINDS.includes(k as AuditActorKind));
  return {
    floor: p.get('floor')?.slice(0, 64) || 'all',
    since: time(p.get('since')),
    until: time(p.get('until')),
    ...(actors.length ? { actorKind: actors } : {}),
    ...(p.get('action') ? { actions: list(p.get('action')) } : {}),
    q: p.get('q')?.slice(0, 200) || undefined,
    limit: Number(p.get('limit')) || 100,
    cursor: p.get('cursor') || undefined,
    bucket: Number(p.get('bucket')) || undefined,
  };
}

const isAdmin = (ctx: Ctx, session: Session) => ctx.meOf(session.account?.id).admin;

function exportTo(res: http.ServerResponse, q: AuditQuery, format: 'csv' | 'jsonl') {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.writeHead(200, {
    'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
    'content-disposition': `attachment; filename="audit-${(q.floor ?? 'all').replace(/[^A-Za-z0-9_-]/g, '_')}-${stamp}.${format}"`,
    'cache-control': 'no-store',
  });
  if (format === 'csv') res.write(`${csvHeader()}\n`);
  let cursor: string | undefined;
  do {
    const page = readAudit({ ...q, limit: 1000, cursor, bucket: undefined });
    res.write(page.events.map((e) => (format === 'csv' ? csvRow(e) : JSON.stringify(e))).join('\n') + (page.events.length ? '\n' : ''));
    cursor = page.nextCursor;
  } while (cursor);
  res.end();
}

export const auditRoutes = {
  /** GET /api/audit?floor=<id>|all|_office&since=&until=&actor=human,agent&action=worker.hire,github&q=&limit=&cursor= */
  page: {
    method: 'GET',
    path: '/api/audit',
    auth: 'session',
    handle(_ctx, { res, url }) {
      return send(res, 200, readAudit(auditQuery(url)));
    },
  },
  /** GET /api/audit/export?…&format=csv|jsonl: every matching event, as a download. Admins only. */
  export: {
    method: 'GET',
    path: '/api/audit/export',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      if (!isAdmin(ctx, session)) return send(res, 403, { error: 'Only admins can export the audit log' });
      const format = url.searchParams.get('format') === 'jsonl' ? 'jsonl' : 'csv';
      const q = auditQuery(url);
      audit.record({ actor: human(session.account?.name ?? 'An admin', session.account?.id), action: 'audit.export', target: { kind: 'audit', id: q.floor, label: q.floor === 'all' ? 'every floor' : q.floor }, summary: `Exported the audit log as ${format.toUpperCase()}`, details: { format, ...q, cursor: undefined, limit: undefined } });
      return exportTo(res, q, format);
    },
  },
  /** POST /api/audit/settings {promptText}: whether prompts are logged with their first 80 characters. Admins only. */
  settings: {
    method: 'POST',
    path: '/api/audit/settings',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!isAdmin(ctx, session)) return send(res, 403, { error: 'Only admins can change what the audit log keeps' });
      if (!auditLog()) return send(res, 503, { error: 'The audit log is off' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 4096)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const before = promptTextLogged();
      const after = body.promptText === true;
      if (before !== after) {
        setPromptTextLogged(after);
        audit.record({ actor: human(session.account?.name ?? 'An admin', session.account?.id), action: 'settings.change', target: { kind: 'setting', id: 'audit.promptText', label: 'Audit: log prompt text' }, summary: after ? 'Turned on logging the first 80 characters of prompts' : 'Turned off logging prompt text', details: { before: { promptText: before }, after: { promptText: after } }, severity: 'notice' });
      }
      return send(res, 200, { promptText: after });
    },
  },
} satisfies Record<string, Route>;
