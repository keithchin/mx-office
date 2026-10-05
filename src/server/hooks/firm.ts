// /office/firm/*: `office-workers firm` (bin/office-firm.js). A reviewer's own calls (ask, report,
// evidence, status, done) carry its AGENT_OFFICE_FIRM_REVIEWER as ?reviewer= and its
// AGENT_OFFICE_FIRM_TOKEN as the bearer token; a project worker answering a question (answer) carries
// its own worker id and hook token, as for office-workers.

import type http from 'node:http';
import { firmOf } from '../firm/adapter.js';
import { readBody, send } from '../http/util.js';
import type { Ctx } from '../office/context.js';

export async function officeFirm(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const action = url.pathname.slice('/office/firm/'.length);
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const firm = firmOf(ctx);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      body = JSON.parse((await readBody(req, 2 * 1024 * 1024)) || '{}');
    } catch {
      return send(res, 400, { error: 'Send JSON' });
    }
  }
  if (action === 'answer') {
    const workerId = url.searchParams.get('worker') ?? '';
    const me = ctx.workerFloor(workerId)?.workers.authenticate(workerId, token);
    if (!me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
    const r = firm.desk.answer(me.id, body.question, body.text);
    return typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, { ok: true, ...r });
  }
  const who = firm.authenticate(url.searchParams.get('reviewer') ?? '', token);
  if (!who) return send(res, 401, { error: 'Only a reviewer of the Firm, mid-engagement, can do that (AGENT_OFFICE_FIRM_REVIEWER and AGENT_OFFICE_FIRM_TOKEN)' });
  const { e, r } = who;
  if (req.method === 'GET' && action === 'status') return send(res, 200, firm.desk.status(e, r));
  if (req.method === 'GET' && action === 'evidence') {
    const got = await firm.desk.evidence(e, r, url.searchParams.get('name'));
    return typeof got === 'string' ? send(res, 400, { error: got }) : send(res, 200, got);
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET status|evidence, POST ask|report|done|answer' });
  if (action === 'ask') {
    const got = await firm.desk.ask(e, r, body.team, body.text);
    return typeof got === 'string' ? send(res, 400, { error: got }) : send(res, 200, { ok: true, id: got.question.id, status: got.question.status, note: got.note });
  }
  if (action === 'report') {
    const got = firm.desk.submit(e, r, body.section, body.data);
    return typeof got === 'string' ? send(res, 400, { error: got }) : send(res, 200, { ok: true, ...got });
  }
  if (action === 'done') {
    const err = firm.desk.done(e, r, body.note);
    return err ? send(res, 400, { error: err }) : send(res, 200, { ok: true, note: 'Released once this turn ends. Thank you.' });
  }
  return send(res, 404, { error: 'Unknown: ask, answer, report, evidence, status, done' });
}
