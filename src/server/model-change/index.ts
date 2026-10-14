// The Model tab's change requests wired to the office (service.ts): the floor's team from the roster,
// the task typed through the roster's delivery (and recorded as the member's task once it goes in, as
// the Board's ✨ New task does), the PR list the floor already polls, and the audit log. Made once per office.

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { ROLES } from '../../shared/roster/roles.js';
import { ChangeRequests, deliveryOpts, type ChangeMember } from './service.js';

const services = new WeakMap<object, ChangeRequests>();

export function changeRequestsOf(ctx: Ctx): ChangeRequests {
  let s = services.get(ctx.cfg);
  if (s) return s;
  const floorOf = (id: string) => ctx.floors.get(id);
  s = new ChangeRequests({
    dataDir: ctx.cfg.dataDir,
    now: () => Date.now(),
    members(floorId) {
      const floor = floorOf(floorId);
      if (!floor) return [];
      const roster = rosterOf(ctx);
      const tf = teamFloor(ctx, floor);
      const d = roster.data(floorId);
      return ROLES.map((r): ChangeMember => {
        const m = d.members[r.id];
        const w = roster.workerOf(tf, m);
        return { role: r.id, name: m.name, ...(w ? { workerId: w.id } : {}), atWork: !!w && m.phase === 'active' };
      });
    },
    deliver(floorId, m, text, o) {
      const floor = floorOf(floorId);
      if (!floor || !m.workerId) return { status: 'refused', why: 'No such project' };
      const roster = rosterOf(ctx);
      const tf = teamFloor(ctx, floor);
      const w = tf.worker(m.workerId);
      if (!w) return { status: 'refused', why: `${m.name} isn't at work` };
      // Once it's typed it's the member's task (roster/resume.ts), as a prompt from the Board's New task is.
      const onSent = () => (o.onSent(), roster.tasks.assign(tf, w.id, text, o.by));
      return roster.delivery.send(tf, w, text, deliveryOpts(o.when, o.by, o.id, onSent));
    },
    pulls: (floorId) => floorOf(floorId)?.github.pulls.items ?? [],
    worker: (floorId, id) => floorOf(floorId)?.workers.get(id),
    record: (e) => audit.record(e),
  });
  services.set(ctx.cfg, s);
  return s;
}
