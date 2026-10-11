// 📦 Deliverables (server/deliverables/): GET the floor's list (a team's, with ?team=), one file to view
// or download from wherever the scan found it (?src=main|wt:<worker>|ref:<branch>), and a CSV's first
// rows as a table; and the page that draws the viewer's Mermaid diagrams. Anyone signed in may read
// them; only catalog or extra paths, only places the scan listed, never past the caps
// (deliverables/serve.ts).

import { isCardTeam } from '../../../shared/roster/card-team.js';
import { deliverablesOf, sourceOf } from '../../deliverables/index.js';
import { fileAnswer, mermaidFrameAnswer, tableAnswer } from '../../deliverables/serve.js';
import { str } from '../../office/input.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const deliverableRoutes = {
  deliverables: {
    method: 'GET',
    prefix: '/api/deliverables',
    auth: 'session',
    async handle(ctx, { res, url, path: p }) {
      if (p === '/api/deliverables/mermaid') {
        // The viewer's diagram drawer (no floor: the office's own Mermaid in a sandboxed frame).
        const a = await mermaidFrameAnswer();
        res.writeHead(a.status, a.headers);
        return res.end(a.body);
      }
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (p === '/api/deliverables') {
        const view = await deliverablesOf(ctx, floor, url.searchParams.get('fresh') === '1');
        const team = url.searchParams.get('team');
        if (team === null) return send(res, 200, view);
        if (!isCardTeam(team) || team === 'unassigned') return send(res, 400, { error: 'Which team?' });
        return send(res, 200, { ...view, items: view.items.filter((i) => i.team === team) });
      }
      if (p !== '/api/deliverables/file' && p !== '/api/deliverables/table') return send(res, 404, { error: 'Not found' });
      const file = str(url.searchParams.get('path'), 1024);
      if (!file) return send(res, 400, { error: 'Which file?' });
      const source = await sourceOf(ctx, floor, str(url.searchParams.get('src'), 256) || 'main');
      if (!source) return send(res, 404, { error: 'That branch or worktree is not one the office scanned' });
      const a = p === '/api/deliverables/table' ? await tableAnswer(source, file) : await fileAnswer(source, file, url.searchParams.get('download') === '1');
      res.writeHead(a.status, a.headers);
      res.end(a.body);
    },
  },
} satisfies Record<string, Route>;
