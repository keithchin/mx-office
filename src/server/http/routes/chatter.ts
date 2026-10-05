// The team chatter (server/chatter/): GET a page of a floor's thread, newest first. New messages
// come over the socket (chatter.new); this is the first page and the older ones.
import type { ChatterFilter, PartyKind } from '../../../shared/chatter.js';
import { chatterOf } from '../../chatter/office.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const KINDS = new Set<PartyKind>(['agent', 'human', 'office', 'jeff', 'reviewer']);

/** `with=agents|me`, or `who=<name>` (with `as=<kind>` to tell a person from an agent of the same name). */
export function chatterFilter(url: URL): ChatterFilter {
  const w = url.searchParams.get('with');
  if (w === 'agents' || w === 'me') return { with: w };
  const who = url.searchParams.get('who')?.trim().slice(0, 64);
  const as = url.searchParams.get('as') as PartyKind | null;
  return who ? { with: 'person', name: who, ...(as && KINDS.has(as) ? { kind: as } : {}) } : { with: 'all' };
}

const num = (v: string | null) => (v !== null && /^\d{1,15}$/.test(v) ? Number(v) : undefined);

export const chatterRoutes = {
  /** GET /api/chatter?floor=<id>&since=<ms>&limit=<n>&cursor=<from the last page>&who=<name>|with=agents|me */
  page: {
    method: 'GET',
    path: '/api/chatter',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const p = url.searchParams;
      return send(res, 200, chatterOf(ctx).page(floor.id, { since: num(p.get('since')), limit: num(p.get('limit')), cursor: p.get('cursor'), filter: chatterFilter(url) }));
    },
  },
} satisfies Record<string, Route>;
