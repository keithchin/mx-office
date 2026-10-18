// Walkthrough videos' routes (server/walkthroughs/). Watching is for anyone signed in on the office; every
// change (Record, Cancel, Save to repo, the switch, Delete) is an admin's, checked here, from the office's own
// page, and audited. Nothing here calls a model.
//   GET  /api/walkthroughs?floor=                 the project's Walkthroughs section
//   GET  /api/walkthroughs/file?floor=&id=&name=  a recording's file (video with ranges, VTT, PNG, manifest)
//   POST /api/walkthroughs/action                 {action: record|tour|cancel|save|settings|delete, floor, …}
import type http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Ctx } from '../../office/context.js';
import { audit, human } from '../../audit/index.js';
import { walkthroughsOf } from '../../walkthroughs/office.js';
import { isRecId } from '../../../shared/walkthroughs/types.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));
const TYPES: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', vtt: 'text/vtt; charset=utf-8', png: 'image/png', json: 'application/json; charset=utf-8' };

/** Sends a file, honouring one Range (a video player seeks with them). */
async function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  const st = await stat(file).catch(() => undefined);
  if (!st?.isFile()) return send(res, 404, { error: 'No such file' });
  const type = TYPES[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
  const head = { 'content-type': type, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return void res.end();
    }
    start = Math.max(0, start);
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(end - start + 1) });
    return void createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'content-length': String(st.size) });
  createReadStream(file).pipe(res);
}

export const walkthroughRoutes = {
  view: {
    method: 'GET',
    path: '/api/walkthroughs',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await walkthroughsOf(ctx).view(floor.id, ctx.meOf(session.account?.id).admin));
    },
  },
  file: {
    method: 'GET',
    path: '/api/walkthroughs/file',
    auth: 'session',
    async handle(ctx, { req, res, url }) {
      const floor = floorParam(ctx, url);
      const id = url.searchParams.get('id');
      const file = floor && isRecId(id) ? walkthroughsOf(ctx).store.file(floor.id, id, url.searchParams.get('name') ?? '') : undefined;
      if (!file) return send(res, 404, { error: 'No such file' });
      return sendFile(req, res, file);
    },
  },
  act: {
    method: 'POST',
    path: '/api/walkthroughs/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can record or save walkthroughs' });
      let b: Record<string, unknown>;
      try {
        b = JSON.parse((await readBody(req, 16 * 1024)) || '{}') ?? {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof b.floor === 'string' ? ctx.floors.get(b.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      const by = session.account?.name ?? 'The Project Manager';
      const w = walkthroughsOf(ctx);
      const id = isRecId(b.id) ? b.id : undefined;
      const log = (action: string, summary: string, details?: Record<string, unknown>) => audit.record({ floor: floor.id, actor: human(by, session.account?.id), action: `liveapp.walkthrough.${action}`, target: { kind: 'liveapp', id: id ?? floor.id, label: 'Walkthroughs' }, summary, ...(details ? { details } : {}) });
      try {
        switch (b.action) {
          case 'record': {
            if (typeof b.journey !== 'string' || !b.journey) return send(res, 400, { error: 'Say which journey' });
            const job = await w.record(floor.id, b.journey, { by, ...(typeof b.narrate === 'boolean' ? { narrate: b.narrate } : {}) });
            log('record', `Started recording the walkthrough of ${b.journey}`, { journey: b.journey });
            return send(res, 200, { ok: true, job });
          }
          case 'tour': {
            const job = await w.tour(floor.id, by);
            log('tour', 'Started making the guided tour');
            return send(res, 200, { ok: true, job });
          }
          case 'cancel':
            return typeof b.job === 'string' && w.cancel(floor.id, b.job) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'No such recording running' });
          case 'save': {
            if (!id) return send(res, 400, { error: 'Say which recording' });
            const m = await w.save(floor.id, id, by);
            log('save', `Opened a pull request with the walkthrough “${m.journey.title}”${m.saved?.url ? `: ${m.saved.url}` : ''}`, { branch: m.saved?.branch, pr: m.saved?.pr });
            return send(res, 200, { ok: true, saved: m.saved });
          }
          case 'settings': {
            const s = await w.setSettings(floor.id, {
              ...(typeof b.autoRecord === 'boolean' ? { autoRecord: b.autoRecord } : {}),
              ...(typeof b.narrate === 'boolean' ? { narrate: b.narrate } : {}),
              ...(typeof b.demoUser === 'string' ? { demoUser: b.demoUser } : {}),
              ...(typeof b.demoPassword === 'string' ? { demoPassword: b.demoPassword } : {}),
            });
            log('settings', `Walkthroughs: auto-record ${s.autoRecord ? 'on' : 'off'}, narration ${s.narrate ? 'on' : 'off'}, demo user ${s.demoUser}`);
            return send(res, 200, { ok: true });
          }
          case 'delete':
            if (!id) return send(res, 400, { error: 'Say which recording' });
            if (!(await w.remove(floor.id, id))) return send(res, 409, { error: 'It is being recorded: cancel it first' });
            log('delete', 'Deleted a walkthrough recording');
            return send(res, 200, { ok: true });
          default:
            return send(res, 400, { error: 'action is one of record, tour, cancel, save, settings, delete' });
        }
      } catch (err) {
        return send(res, 400, { error: (err as Error).message.slice(0, 300) });
      }
    },
  },
} satisfies Record<string, Route>;
