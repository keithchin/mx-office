// The Marketplace action's composition (./service.ts): the office's mxcli, its own Mendix token (./token.ts),
// its commit identity, the audit log and the roster's delivery (the agent hears the outcome as the office's
// own message, after its turn, woken when asleep). One service per office (marketplaceOf).

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { officeMxcli } from '../wizard/config.js';
import { officeSettings } from '../connections/store.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { MarketplaceService } from './service.js';
import { marketplaceToken } from './token.js';

const services = new WeakMap<object, MarketplaceService>();

export function marketplaceOf(ctx: Ctx): MarketplaceService {
  let s = services.get(ctx.cfg);
  if (!s) {
    s = new MarketplaceService({
      dataDir: ctx.cfg.dataDir,
      mxcli: () => officeMxcli()?.path,
      token: () => marketplaceToken(),
      floorDir: (id) => ctx.floors.get(id)?.dir,
      floors: () => [...ctx.floors.keys()],
      identity: () => officeSettings().gitIdentity,
      tell: (floorId, workerId, text) => {
        const floor = ctx.floors.get(floorId);
        const w = floor?.workers.get(workerId);
        if (!floor || !w) return false;
        const sent = rosterOf(ctx).delivery.send(teamFloor(ctx, floor), w, text, { origin: 'office', by: 'Marketplace', wake: true });
        return sent.status !== 'refused';
      },
      audit: (floor, action, actor, summary, details, target) => void audit.record({ floor, actor, action, summary, details, target }),
    });
    services.set(ctx.cfg, s);
    // Approved modules waiting for a clean app are tried again every minute (service.ts retryWaiting).
    const svc = s;
    const timer = setInterval(() => void svc.retryWaiting(), 60_000);
    timer.unref?.();
  }
  return s;
}
