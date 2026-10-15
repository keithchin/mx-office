// The Questions page's routes (server/questions/): GET /api/questions?floor=<id> is the last collection with
// your answers (signed in); POST /api/questions/refresh collects again now; /answer, /send and /import
// change things (admins, audited); GET /api/questions/draft is Send's preview, and /export the client's
// file (CSV or a printable page). Nothing here writes into a worktree or calls GitHub.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { qFloor, questionsOf } from '../../questions/index.js';
import { csvAnswers, toCsv, toHtml, type ExportWhich } from '../../questions/export.js';
import { ANSWER_KINDS, parsePastedAnswers, type AnswerKind } from '../../../shared/questions.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import type { Session } from '../../auth.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

async function jsonBody(req: http.IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, limit)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return undefined;
  }
}

const byOf = (session: Session, body: Record<string, unknown>) => session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');

/** The checks every change goes through: from this page, an admin, JSON, a fresh sign-in, a floor. */
async function change(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, session: Session, limit?: number) {
  if (!fromUs(req, ctx)) return void send(res, 403, { error: 'Forbidden' });
  if (!ctx.meOf(session.account?.id).admin) return void send(res, 403, { error: 'Only an admin can answer the questions' });
  const body = await jsonBody(req, limit);
  if (!body) return void send(res, 400, { error: 'Send JSON' });
  if (refuseStale(ctx, req, res)) return undefined;
  const floor = ctx.floors.get(String(body.floor ?? ''));
  if (!floor) return void send(res, 404, { error: 'No such floor' });
  return { body, floor: qFloor(floor), by: byOf(session, body), ...(session.account?.id ? { owner: session.account.id } : {}) };
}

export const questionsRoutes = {
  /** GET /api/questions?floor=<id>: the last collection, your answers, who they go to, and whether you may act. */
  view: {
    method: 'GET',
    path: '/api/questions',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, await questionsOf(ctx).view(qFloor(floor), ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/questions/refresh {floor}: collect again now (waits for it). */
  refresh: {
    method: 'POST',
    path: '/api/questions/refresh',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      const body = await jsonBody(req);
      const floor = body && ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such floor' });
      await questionsOf(ctx).collect(qFloor(floor)).catch(() => undefined);
      return send(res, 200, await questionsOf(ctx).view(qFloor(floor), ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/questions/answer {floor, key, kind: answer|accept|ask-client|moot|clear, text?, option?}: admins, audited. */
  answer: {
    method: 'POST',
    path: '/api/questions/answer',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const c = await change(ctx, req, res, session);
      if (!c) return;
      const kind = c.body.kind as AnswerKind | 'clear';
      if (kind !== 'clear' && !ANSWER_KINDS.includes(kind)) return send(res, 400, { error: `kind is one of ${ANSWER_KINDS.join(', ')} or clear` });
      // expectedRev, when the page sends it: a stale answer is a 409 with the current state (server/dispatch/).
      const expectedRev = typeof c.body.expectedRev === 'number' && Number.isInteger(c.body.expectedRev) ? c.body.expectedRev : undefined;
      const failed = await questionsOf(ctx).answerResult(c.floor, String(c.body.key ?? ''), kind, { by: c.by, ...(c.owner ? { owner: c.owner } : {}), ...(typeof c.body.text === 'string' ? { text: c.body.text.slice(0, 4000) } : {}), ...(typeof c.body.option === 'string' ? { option: c.body.option } : {}), ...(expectedRev !== undefined ? { expectedRev } : {}) });
      if (failed) return send(res, failed.status, { error: failed.error, ...(failed.current ? { current: failed.current } : {}) });
      return send(res, 200, await questionsOf(ctx).view(c.floor, true));
    },
  },
  /** GET /api/questions/draft?floor=<id>&to=<name>: the answers ready for them and the message Send would type. */
  draft: {
    method: 'GET',
    path: '/api/questions/draft',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const d = await questionsOf(ctx).draft(qFloor(floor), url.searchParams.get('to') ?? '', session.account?.name ?? url.searchParams.get('by') ?? 'The Project Manager');
      return send(res, 200, { count: d.answers.length, recipient: d.recipient, text: d.text });
    },
  },
  /** POST /api/questions/send {floor, to, when?: 'after'|'now'}: one message to the analyst with every answer ready for them; admins, audited. */
  send: {
    method: 'POST',
    path: '/api/questions/send',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const c = await change(ctx, req, res, session);
      if (!c) return;
      const err = await questionsOf(ctx).send(c.floor, String(c.body.to ?? ''), { by: c.by, ...(c.owner ? { owner: c.owner } : {}), when: c.body.when === 'now' ? 'now' : 'after' });
      if (err) return send(res, 400, { error: err });
      return send(res, 200, await questionsOf(ctx).view(c.floor, true));
    },
  },
  /** POST /api/questions/import {floor, format: 'csv'|'text', text}: the client's answers attached to their ids, ready to send; admins, audited. */
  import: {
    method: 'POST',
    path: '/api/questions/import',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      const c = await change(ctx, req, res, session, 2 * 1024 * 1024);
      if (!c) return;
      const text = typeof c.body.text === 'string' ? c.body.text : '';
      const rows = c.body.format === 'csv' ? csvAnswers(text) : parsePastedAnswers(text);
      if (typeof rows === 'string') return send(res, 400, { error: rows });
      if (!rows.length) return send(res, 400, { error: c.body.format === 'csv' ? 'No answers in the file (fill in the Answer column)' : 'No "ID: answer" lines found' });
      const r = await questionsOf(ctx).importAnswers(c.floor, rows, { by: c.by, ...(c.owner ? { owner: c.owner } : {}), how: c.body.format === 'csv' ? 'file' : 'text' });
      return send(res, 200, { ...r, view: await questionsOf(ctx).view(c.floor, true) });
    },
  },
  /** GET /api/questions/export?floor=<id>&format=csv|html&which=asked|user-only: the questions for the client, to send them. */
  export: {
    method: 'GET',
    path: '/api/questions/export',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const which: ExportWhich = url.searchParams.get('which') === 'user-only' ? 'user-only' : 'asked';
      const rows = await questionsOf(ctx).exportRows(qFloor(floor), which);
      const name = `questions-for-the-client-${floor.id.replace(/[^A-Za-z0-9_-]/g, '_')}-${new Date().toISOString().slice(0, 10)}`;
      if (url.searchParams.get('format') === 'html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return void res.end(toHtml(rows, floor.def.name, Date.now()));
      }
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'no-store' });
      res.end(toCsv(rows));
    },
  },
} satisfies Record<string, Route>;
