// The office's team chatter (chatter/index.ts) made from the real office: its floors as the roster
// sees them, the floor's browsers for chatter.new, and the data dir. Made once, when the floors open
// (office/floors.ts), so nothing said from then on is missed.

import type { ChatterMessage } from '../../shared/chatter.js';
import type { Engagement } from '../../shared/firm/engagement.js';
import { FirmStore } from '../firm/store.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { firmSource } from './firm.js';
import { Chatter, chatterFor } from './index.js';
import { registerChatterSource } from './sources.js';

/** The Firm's engagements are read off disk at most this often (not through firmOf: that would start the Firm). */
const FIRM_READ_MS = 15_000;

export function chatterOf(ctx: Ctx): Chatter {
  return chatterFor(ctx.cfg, () => {
    const team = (id: string | undefined) => {
      const f = id === undefined ? undefined : ctx.floors.get(id);
      return f && teamFloor(ctx, f);
    };
    let firm: { at: number; list: Engagement[] } | undefined;
    registerChatterSource(
      firmSource(() => {
        const now = Date.now();
        if (!firm || now - firm.at > FIRM_READ_MS) firm = { at: now, list: new FirmStore(ctx.cfg.dataDir).engagements() };
        return firm.list;
      }),
    );
    return new Chatter({
      dataDir: ctx.cfg.dataDir,
      roster: rosterOf(ctx),
      floors: () => [...ctx.floors.values()].map((f) => teamFloor(ctx, f)),
      floor: team,
      floorOfWorker: (id) => team(ctx.workerFloor(id)?.id),
      now: () => Date.now(),
      broadcast: (id: string, message: ChatterMessage) => {
        const f = ctx.floors.get(id);
        if (f) ctx.toFloor(f, { t: 'chatter.new', floor: id, message });
      },
    });
  })!;
}
