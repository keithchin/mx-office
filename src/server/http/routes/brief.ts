// The New project flow's brief (server/wizard/planner/): whether the Chief Analyst can draft now and what
// it costs, a person's drafts (start, attach files, draft, change items, chat, approve, discard), polled by
// the page while the Chief Analyst works. Planning spends office money and the drafts hold client
// documents, so it's for admins only, from the office's own pages, and each draft is its owner's.

import type { Route } from '../router.js';
import { readBody, readBytes, sameOrigin, send } from '../util.js';
import { plannerOf, type Who } from '../../wizard/planner/index.js';
import { draftView } from '../../wizard/planner/drafts.js';
import { ATTACH_MAX_BYTES, SECTION_IDS, type ItemOp, type SectionId } from '../../../shared/brief.js';

/** An item change from the page, checked for its shape (applyOp checks the rest). */
function itemOp(b: Record<string, unknown>): ItemOp | undefined {
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const id = s(b.id) ?? '';
  switch (b.op) {
    case 'confirm':
    case 'remove':
      return id ? { op: b.op, id } : undefined;
    case 'edit':
      return id ? { op: 'edit', id, text: s(b.text), name: s(b.name), when: s(b.when) } : undefined;
    case 'add':
      return (SECTION_IDS as readonly unknown[]).includes(b.section) ? { op: 'add', section: b.section as SectionId, text: s(b.text) ?? '', name: s(b.name), when: s(b.when), side: b.side === 'out' ? 'out' : 'in' } : undefined;
    case 'title':
      return { op: 'title', text: s(b.text) ?? '' };
    default:
      return undefined;
  }
}

export const briefRoutes = {
  brief: {
    prefix: '/api/brief/',
    auth: 'session',
    async handle(ctx, { req, res, url, path: p, session }) {
      const admin = ctx.meOf(session.account?.id).admin;
      if (!admin) return send(res, 403, { error: 'Only admins (operators) can set up projects' });
      const planner = plannerOf(ctx);
      // Who it's by: the account, or on the shared password the name on the page's profile (only ever shown, never trusted for anything), as the wizard does.
      const named = (url.searchParams.get('by') ?? '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60);
      const who: Who = { id: session.account?.id ?? 'shared', name: session.account?.name ?? (named || 'an admin') };
      const id = url.searchParams.get('id') ?? '';
      if (req.method === 'GET') {
        if (p === '/api/brief/status') return send(res, 200, planner.status());
        if (p === '/api/brief/latest') {
          const d = planner.drafts.latest(who.id);
          return send(res, 200, { draft: d ? draftView(d) : null });
        }
        if (p === '/api/brief/draft') {
          const d = planner.get(id, who);
          return d ? send(res, 200, draftView(d)) : send(res, 404, { error: 'No such draft' });
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (p === '/api/brief/file') {
        const d = planner.get(id, who);
        if (!d) return send(res, 404, { error: 'No such draft' });
        let bytes: Buffer;
        try {
          bytes = await readBytes(req, ATTACH_MAX_BYTES + 1);
        } catch {
          return send(res, 413, { error: `At most ${ATTACH_MAX_BYTES / 1024 / 1024} MB each` });
        }
        const name = decodeURIComponent(url.searchParams.get('name') ?? '');
        const bad = planner.addFile(d, name, bytes);
        return bad ? send(res, 400, { error: bad }) : send(res, 200, draftView(d));
      }
      let body: Record<string, unknown> = {};
      try {
        const text = await readBody(req, 64 * 1024);
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      if (p === '/api/brief/new') {
        const d = planner.create(who, body);
        return send(res, 200, draftView(d));
      }
      const d = planner.get(id, who);
      if (!d) return send(res, 404, { error: 'No such draft' });
      let bad: string | undefined;
      if (p === '/api/brief/update') planner.update(d, body);
      else if (p === '/api/brief/unfile') planner.removeFile(d, typeof body.name === 'string' ? body.name : '');
      else if (p === '/api/brief/draft') bad = planner.draft(d, who);
      else if (p === '/api/brief/manual') planner.manual(d);
      else if (p === '/api/brief/item') {
        const op = itemOp(body);
        bad = op ? planner.op(d, op, who) : 'Bad request';
      } else if (p === '/api/brief/chat') bad = planner.chat(d, typeof body.text === 'string' ? body.text : '', who);
      else if (p === '/api/brief/approve') bad = planner.approve(d, who);
      else if (p === '/api/brief/discard') {
        planner.drafts.remove(d.id);
        return send(res, 200, { ok: true });
      } else return send(res, 404, { error: 'Not found' });
      // Refused (busy, capped, unavailable): 409 with why, and the draft as it is.
      return bad ? send(res, 409, { error: bad, draft: draftView(d) }) : send(res, 200, draftView(d));
    },
  },
} satisfies Record<string, Route>;
