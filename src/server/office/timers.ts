import type { Ctx } from './context.js';
import { SLOW_CLIENT_BYTES } from './client.js';
import { startStudioMode } from '../studio/index.js';
import { startNotifyTeams } from '../notify-teams/index.js';
import { startKeepAwake } from '../keep-awake/index.js';

/** The office's own clocks: terminals re-sent to viewers who fell behind, the heartbeat, Studio mode's look at the Mendix floors, Teams notifications and keep-awake. Returns what stops them. */
export function startTimers(ctx: Ctx): () => void {
  const { clients } = ctx;
  const resync = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.stale.size || c.ws.bufferedAmount > SLOW_CLIENT_BYTES / 8) continue;
      for (const wid of c.stale) {
        const snap = c.attached.has(wid) ? ctx.workerFloor(wid)?.workers.attach(wid, c.id, c.peer.name) : undefined;
        if (snap) ctx.sendTo(c, { t: 'term.snapshot', workerId: wid, ...snap });
      }
      c.stale.clear();
    }
  }, 1000);

  // Drop dead connections so ghosts don't linger in the office.
  // Also signs out anyone `agent-office accounts` revoked, and passes on role changes made there.
  const heartbeat = setInterval(() => {
    let accountsMoved = false;
    for (const c of clients.values()) {
      if (!c.isAlive) {
        c.ws.terminate();
        continue;
      }
      if (!c.out && (!ctx.stillIn(c) || c.admin !== ctx.meOf(c.accountId).admin)) accountsMoved = true;
      c.isAlive = false;
      c.ws.ping();
    }
    if (accountsMoved) ctx.accountsChanged();
  }, 20_000);

  // Studio Pro open on a floor's project pauses that floor's agents' mxcli writes (studio/watch.ts).
  const stopStudio = startStudioMode(ctx);
  // What needs a person goes to a Teams channel (notify-teams/); the computer stays awake while agents work (keep-awake/).
  const stopTeams = startNotifyTeams(ctx);
  const stopAwake = startKeepAwake(ctx);

  return () => {
    stopStudio();
    stopTeams();
    stopAwake();
    clearInterval(heartbeat);
    clearInterval(resync);
  };
}
