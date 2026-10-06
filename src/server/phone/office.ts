// The office's team phone (phone/index.ts) made from the real office: its floors as the roster sees
// them, the roster's delivery and escalations, the team chatter, and each worker's transcript. Made the
// first time it's used, keyed like the roster by the office's config.

import path from 'node:path';
import { findTranscript } from '../analysis/transcript.js';
import { chatterOf } from '../chatter/office.js';
import { notedTranscript } from '../convo/index.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { Phone } from './index.js';
import { PhoneReadStore } from './reads.js';

const offices = new WeakMap<object, { phone: Phone; reads: PhoneReadStore }>();

function make(ctx: Ctx) {
  let o = offices.get(ctx.cfg);
  if (!o) {
    const phone = new Phone({
      roster: rosterOf(ctx),
      chatter: chatterOf(ctx),
      floor: (id) => {
        const f = ctx.floors.get(id);
        return f && teamFloor(ctx, f);
      },
      transcript: (floor, w) => notedTranscript(w.id) ?? findTranscript(w.sessionId, w.worktree ? path.resolve(floor.dir, w.worktree.path) : floor.dir),
      now: () => Date.now(),
    });
    o = { phone, reads: new PhoneReadStore(ctx.cfg.dataDir) };
    offices.set(ctx.cfg, o);
  }
  return o;
}

export const phoneOf = (ctx: Ctx): Phone => make(ctx).phone;
export const phoneReadsOf = (ctx: Ctx): PhoneReadStore => make(ctx).reads;

/** Every worker update (office/floors.ts): a reply the phone is waiting for may be in. Only once the phone has been used. */
export function phoneOnWorker(ctx: Ctx, floor: Floor, w: Parameters<Phone['onWorker']>[1]) {
  const o = offices.get(ctx.cfg);
  if (o?.phone.pending.length) o.phone.onWorker(teamFloor(ctx, floor), w);
}
