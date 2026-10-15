// Change answer wired to the office (Slice 1B-3): the service (service.ts) made once per office from what
// the office already keeps (the roster's escalations, members' tasks and dispatcher, Recorded as given's
// findings and targets, the Questions page's book, the model change requests), read and acted on by
// /api/answers/* (http/routes/change-answer.ts). At start it joins the dispatcher's appliers, so a change
// whose dispatch settles later (reconcile, a person's "It went through") moves its decision on then.

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { questionsOf } from '../questions/index.js';
import { followThroughOf } from '../followthrough/index.js';
import { changeRequestsOf } from '../model-change/index.js';
import { ROLES } from '../../shared/roster/roles.js';
import type { TaskLike } from './links.js';
import { ChangeAnswer } from './service.js';

const services = new WeakMap<object, ChangeAnswer>();

/** The office's Change answer: made on first use, then the same one. */
export function changeAnswerOf(ctx: Ctx): ChangeAnswer {
  let s = services.get(ctx.cfg);
  if (s) return s;
  const roster = () => rosterOf(ctx);
  const ft = followThroughOf(ctx);
  s = new ChangeAnswer({
    dataDir: ctx.cfg.dataDir,
    now: () => Date.now(),
    dispatcher: roster().dispatch,
    follow: ft.store,
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
    // The same people a correction goes to (followthrough/index.ts), typed after their turn.
    escTarget: (floorId, e, by) => ft.deps.escTarget(floorId, e, by),
    qTarget: (floorId, key, by) => ft.deps.qTarget(floorId, key, by),
    sources(floorId) {
      const tasks: TaskLike[] = [];
      try {
        const d = roster().data(floorId);
        for (const r of ROLES) {
          const m = d.members[r.id];
          if (m?.task) tasks.push({ member: m.name, text: m.task.text, ...(m.task.pending ? { pending: m.task.pending } : {}), ...(m.task.verify ? { verify: m.task.verify } : {}) });
        }
      } catch {
        // no roster for it
      }
      let changeRequests: { id: string; request: string }[] = [];
      try {
        changeRequests = changeRequestsOf(ctx).list(floorId, true);
      } catch {
        // none
      }
      return { tasks, changeRequests };
    },
    flush: async (floorId) => {
      const floor = ctx.floors.get(floorId);
      if (floor) roster().touch(teamFloor(ctx, floor));
      await roster()
        .file(floorId)
        .flushCritical()
        .catch((err: unknown) => console.error(`agent-office: change-answer: couldn't save the roster: ${(err as Error).message}`));
    },
    record: (e) => audit.record(e),
  });
  services.set(ctx.cfg, s);
  return s;
}

/** Joins the dispatcher's appliers (before the start's reconcile runs); returns what takes it out again. */
export function startChangeAnswer(ctx: Ctx): () => void {
  const s = changeAnswerOf(ctx);
  questionsOf(ctx); // its applier first, so ours wraps it
  const appliers = rosterOf(ctx).dispatch.appliers;
  const before = new Map(['esc', 'q'].map((k) => [k, appliers.get(k)]));
  for (const [k, prev] of before)
    appliers.set(k, async (floorId, r, line) => {
      if (await s.applyLater(floorId, r)) return;
      await prev?.(floorId, r, line);
    });
  return () => {
    for (const [k, prev] of before) if (prev) appliers.set(k, prev);
  };
}
