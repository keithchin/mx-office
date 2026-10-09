// The Model tab (server/model/): the floor's Mendix app on main or a branch, read-only. Everyone signed
// in may look, as with the other floor views (the Git tab, the live app).
import { modelOf, type ModelService } from '../../model/index.js';
import { send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';
import { floorParam } from './files.js';
import type { Ctx } from '../../office/context.js';
import type { Floor } from '../../floor.js';

type Answer = (m: ModelService, floor: Floor, q: URLSearchParams) => Promise<unknown>;

function answer(fn: Answer) {
  return async (ctx: Ctx, { res, url }: RouteRequest) => {
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    try {
      return send(res, 200, await fn(modelOf(ctx), floor, url.searchParams));
    } catch (err) {
      return send(res, 502, { error: (err as Error).message });
    }
  };
}

const ref = (q: URLSearchParams) => q.get('ref') || 'main';

export const modelRoutes = {
  /** GET /api/model/refs?floor=<id>: main and the branches the Model tab can show. */
  refs: { method: 'GET', path: '/api/model/refs', auth: 'session', handle: answer((m, f) => m.refs(f)) },
  /** GET /api/model/tree?floor=<id>&ref=<branch>: the app's tree (Studio Pro's App Explorer). */
  tree: { method: 'GET', path: '/api/model/tree', auth: 'session', handle: answer((m, f, q) => m.tree(f, ref(q))) },
  /** GET /api/model/doc?floor=<id>&ref=<branch>&type=<type>&name=<Module.Name>[&compare=1]: one document. */
  doc: {
    method: 'GET',
    path: '/api/model/doc',
    auth: 'session',
    handle: answer((m, f, q) => {
      const type = q.get('type') ?? '';
      const name = q.get('name') ?? '';
      if (!/^[a-z]{2,40}$/.test(type) || !/^[\w.]{1,300}$/.test(name)) return Promise.reject(new Error('type and name, please'));
      return m.doc(f, ref(q), type, name, q.get('compare') === '1');
    }),
  },
  /** GET /api/model/changes?floor=<id>&ref=<branch>: what the branch changed against main. */
  changes: { method: 'GET', path: '/api/model/changes', auth: 'session', handle: answer((m, f, q) => m.changes(f, ref(q))) },
} satisfies Record<string, Route>;
