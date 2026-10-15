// Recorded as given wired to the office (Slice 1B-2): the service (service.ts) made once per office from
// what the office already keeps (the roster's escalations and its dispatcher, the Questions page's book),
// fed by the asks look's reads (asks/readers.ts: the floor's folder, the agents' worktrees and the branch
// heads, already read off the event loop every few minutes and soon after a turn ends), asked by stuck
// detection whether a CONFIRMED decision with an answer revision is really settled (stuck/sources.ts), and
// read by GET /api/followthrough (http/routes/followthrough.ts). No polling of its own, no GitHub call.

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { typeTarget } from '../roster/dispatch-send.js';
import { registerAsksReader } from '../asks/readers.js';
import { registerSettledSource } from '../stuck/sources.js';
import { questionsOf, qFloor, sendOpts } from '../questions/index.js';
import { FollowThrough } from './service.js';
import { taskLinksOf } from '../tasks/links.js';

const services = new WeakMap<object, FollowThrough>();

/** The office's Recorded as given: made on first use, then the same one. */
export function followThroughOf(ctx: Ctx): FollowThrough {
  let s = services.get(ctx.cfg);
  if (s) return s;
  const roster = () => rosterOf(ctx);
  s = new FollowThrough({
    dataDir: ctx.cfg.dataDir,
    now: () => Date.now(),
    dispatcher: roster().dispatch,
    escalations: (floorId) => {
      try {
        return roster().data(floorId).escalations;
      } catch {
        return [];
      }
    },
    questions: () => {
      const q = questionsOf(ctx);
      return { book: (id) => q.book(id), commit: (id) => q.commit(id) };
    },
    escTarget(floorId, e, by) {
      const floor = ctx.floors.get(floorId);
      if (!floor) return 'No such project';
      const r = roster();
      const tf = teamFloor(ctx, floor);
      const member = e.role ? r.data(floorId).members[e.role] : undefined;
      const w = tf.worker(e.workerId) ?? (member ? r.workerOf(tf, member) : undefined);
      if (!w || w.kind !== 'agent') return `${e.by} isn't on the project now: the correction can't be typed to them`;
      // As the person's words, after the agent's turn (it goes back to its task afterwards).
      return (text) => typeTarget(r, tf, w, text, sendOpts(by, 'after'));
    },
    async qTarget(floorId, key, by) {
      const floor = ctx.floors.get(floorId);
      if (!floor) return 'No such project';
      const who = await questionsOf(ctx).recipient(qFloor(floor), key);
      const w = who ? floor.workers.get(who.workerId) : undefined;
      if (!w) return 'Nobody is at work to record it (no analyst on the team)';
      const r = roster();
      const tf = teamFloor(ctx, floor);
      return (text) => typeTarget(r, tf, w, text, sendOpts(by, 'after'));
    },
    flush: (floorId) =>
      roster()
        .file(floorId)
        .flushCritical()
        .catch((err: unknown) => console.error(`agent-office: followthrough: couldn't save the roster: ${(err as Error).message}`)),
    record: (e) => audit.record(e),
    // Slice 1B-4: each item's task links, peeked (never waited on): worked out in the background when old.
    taskLinks: (floorId, decision, rev) => taskLinksOf(ctx).peek(floorId, decision, rev),
  });
  services.set(ctx.cfg, s);
  return s;
}

/** Joins the asks look and stuck detection; returns what takes it out again. */
export function startFollowThrough(ctx: Ctx): () => void {
  const s = followThroughOf(ctx);
  const offReader = registerAsksReader((floor, reads) => s.scan(floor, reads));
  const offSettled = registerSettledSource((floor) => s.settledFor(floor.id));
  return () => {
    offReader();
    offSettled();
  };
}
