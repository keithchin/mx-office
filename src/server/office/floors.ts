import { existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { FloorDef } from '../building.js';
import { Floor, type FloorContext } from '../floor.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorInfo, ServerMsg } from '../../shared/protocol.js';
import type { Ctx, FloorHelpers, FloorsOpen } from './context.js';
import { SLOW_CLIENT_BYTES, type Client } from './client.js';
import { analysisOf } from '../analysis/index.js';
import { summaryOf } from '../summary/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { phoneOnWorker } from '../phone/office.js';
import { auditGitHub } from '../audit/office.js';
import { chatterOf } from '../chatter/office.js';
import { incidentsOnWorker } from '../incidents/office.js';
import { budgetOf } from '../budget/index.js';
import { forgetWorker, noteWorkerStatus } from '../project-run/turns.js';

/**
 * Tells the project team about a worker, unless the floor is still being built. A floor restores its
 * saved workers while it's constructed, before it has a worker manager to ask, and a team that throws
 * then would take the whole floor down with it (the office came up with no floors at all). So a floor
 * not finished yet is skipped, its team catches up on the next change, and any error stays the team's.
 */
function team(ctx: Ctx, floor: Floor, tell: (t: ReturnType<typeof teamFloor>) => void) {
  if (!floor.workers) return;
  try {
    tell(teamFloor(ctx, floor));
  } catch (err) {
    // The stack's first frames too: a message alone ("Maximum call stack size exceeded") doesn't say where.
    const stack = (err as Error)?.stack?.split('\n').slice(1, 11).join('\n');
    console.error(`  project team on ${floor.id}: ${(err as Error)?.message ?? String(err)}${stack ? `\n${stack}` : ''}`);
  }
}

/** Finding floors, the elevator's list of them, and taking one off the building. */
export function floorHelpers(ctx: Ctx): FloorHelpers {
  const floorOf = (c: Client): Floor | undefined => (c.peer.floor ? ctx.floors.get(c.peer.floor) : undefined);
  /** The floor a worker sits on. Worker ids are unique across the building. */
  const workerFloor = (workerId: string): Floor | undefined => {
    for (const f of ctx.floors.values()) if (f.workers.get(workerId)) return f;
    return undefined;
  };
  const floorInfos = (): FloorInfo[] => [
    ...[...ctx.floors.values()].map((f) => ({ ...f.info(), ...(ctx.building.isLocal(f.id) ? { local: true } : {}) })),
    ...ctx.building.pending().map((d) => ({ id: d.id, name: d.name, repo: d.repo, dir: d.dir, palette: d.palette, addedBy: d.addedBy, addedAt: d.addedAt, cloning: true, clone: ctx.building.cloneProgress(d.id), workers: 0, busy: 0, waiting: 0, people: 0, wing: 0 })),
  ];
  // The elevator's counts change with every worker update; tell everyone at most a few times a second.
  let floorsSent = '';
  let floorsTimer: NodeJS.Timeout | undefined;
  const floorsChanged = () => {
    floorsTimer ??= setTimeout(() => {
      floorsTimer = undefined;
      const list = floorInfos();
      const json = JSON.stringify(list);
      if (json === floorsSent) return;
      floorsSent = json;
      ctx.broadcast({ t: 'floors', floors: list });
    }, 250);
  };
  /** Where someone arriving goes: the floor they asked for, else the first one there is. */
  const arrivalFloor = (wanted: string | null): Floor | undefined => (wanted && ctx.floors.get(wanted)) || ctx.floors.values().next().value;

  /**
   * Takes `floor` off the building (already out of floors.json): everyone on it rides the elevator to
   * the next floor, or out to the lobby if it was the last (the roof goes with it), and its workers stop.
   */
  const closeFloor = (floor: Floor, who: string) => {
    const name = floor.def.name;
    const next = [...ctx.floors.values()].find((f) => f !== floor);
    // The list without it first, so nobody arrives somewhere (the lobby's panel) that still shows it.
    const list = floorInfos().filter((f) => f.id !== floor.id);
    floorsSent = JSON.stringify(list);
    ctx.broadcast({ t: 'floors', floors: list });
    for (const c of ctx.clients.values()) {
      if (c.peer.floor === floor.id || (!next && c.peer.floor === ROOF)) {
        if (next) ctx.goToFloor(c, next);
        else ctx.toLobby(c);
        ctx.sendTo(c, { t: 'toast', text: next ? `🛗 ${who} took ${name} off the building, so you rode the elevator to ${next.def.name}` : `🛗 ${who} took ${name}, the last floor, off the building`, level: 'warn' });
      } else ctx.sendTo(c, { t: 'toast', text: `🛗 ${who} took ${name} off the building`, level: 'info' });
    }
    ctx.floors.delete(floor.id);
    floor.shutdown();
    floorsChanged();
    // Its workers made room under the worker limit.
    ctx.pumpQueues();
  };

  return { floorOf, workerFloor, floorInfos, floorsChanged, cancelFloorsChanged: () => clearTimeout(floorsTimer), arrivalFloor, closeFloor };
}

/**
 * Opens every floor of the building, with what they need of the office (see FloorContext), and waits
 * until the workers still running from the last office are back at their desks.
 */
export async function openFloors(ctx: Ctx, hookPort: number): Promise<FloorsOpen> {
  const { cfg, floors, clients } = ctx;
  const floorContext: FloorContext = {
    agentCmd: cfg.agentCmd,
    agentArgs: cfg.agentArgs,
    dshProfile: cfg.dshProfile,
    hook: { url: `http://127.0.0.1:${hookPort}`, token: '' },
    ledger: ctx.ledger,
    capacity: ctx.machine,
    prompts: ctx.prompts,
    emit: ctx.toFloor,
    toast: ctx.toastFloor,
    termData: (workerId, data, viewers) => {
      const json = JSON.stringify({ t: 'term.data', workerId, data } satisfies ServerMsg);
      for (const id of viewers) {
        const c = clients.get(id);
        if (!c || c.ws.readyState !== WebSocket.OPEN) continue;
        // A viewer on a slow link skips output and gets a fresh snapshot once it catches up,
        // instead of queueing unbounded data in server memory.
        if (c.stale.has(workerId) || c.ws.bufferedAmount > SLOW_CLIENT_BYTES) c.stale.add(workerId);
        else c.ws.send(json);
      }
    },
    changes: (state, ids) => {
      for (const id of ids) {
        const c = clients.get(id);
        if (c) ctx.sendTo(c, { t: 'changes', state });
      }
    },
    workerChanged: (floor, w) => {
      incidentsOnWorker(floor, w); // crash loops (incidents/rules.ts)
      // Every turn counted as it starts, for ⏸ Pause project's handoffs (project-run/turns.ts).
      if (typeof w === 'string') forgetWorker(w);
      else noteWorkerStatus(w);
      if (typeof w === 'string') {
        ctx.webhook.onWorkerGone(w);
        team(ctx, floor, (t) => rosterOf(ctx).onWorkerGone(t, w));
        ctx.pumpQueues(floor);
      } else {
        ctx.webhook.onWorker(w);
        // The Analysis tab records a run when a turn ends; the project summary notes what changed.
        analysisOf(ctx).onWorker(floor, w);
        summaryOf(ctx).onWorker(floor, w);
        // The project's Budget ledger books the same usage delta the office's Ledger just did (budget/).
        budgetOf(ctx).onWorker(floor.id, w);
        // The project team: who's idle (to bench), the standup's answers, the floor's spend against its cap.
        team(ctx, floor, (t) => rosterOf(ctx).onWorker(t, w));
        // The team phone: a reply it's waiting for may be in, now that a turn is over (server/phone/).
        team(ctx, floor, () => phoneOnWorker(ctx, floor, w));
      }
      ctx.machine.workersChanged();
      ctx.floorsChanged();
    },
    people: (floor) => {
      let n = 0;
      for (const c of clients.values()) if (c.peer.floor === floor.id) n++;
      return n;
    },
    peers: (floor) => [...clients.values()].filter((c) => c.peer.floor === floor.id).map((c) => c.peer),
    leaveOnMerge: () => ctx.leaveOnMerge.on,
    team: {
      member: (floor, id) => rosterOf(ctx).isMember(floor.id, id),
      quietDone: (floor, info) => rosterOf(ctx).routineTurn(floor.id, info.id),
      openAsks: (floor, id) => rosterOf(ctx).openAsks(floor.id, id),
    },
    floor: (id) => floors.get(id),
    pullsChanged: (floor) => {
      auditGitHub(floor, 'pulls');
      for (const f of floors.values()) if (f !== floor && worksIn(f, floor)) f.sendLandedHome();
    },
    issuesChanged: (floor) => {
      auditGitHub(floor, 'issues');
      team(ctx, floor, (t) => rosterOf(ctx).onIssues(t, floor.github.issues.items));
    },
    lent: (floor) => [...floors.values()].some((f) => f !== floor && worksIn(f, floor)),
    locksUp: () => !!ctx.maps.plan().sendHome?.keeps,
    runAs: ctx.signins,
    ghAs: (owner) => (owner ? ctx.signins.ghAs(owner) : undefined),
  };
  /** Whether a worker on `from` works in `on`'s project too (see WorkerInfo.repos). */
  const worksIn = (from: Floor, on: Floor) => from.workers.list().some((w) => w.repos?.some((r) => r.floor === on.id));
  const openFloor = (def: FloorDef): Floor | undefined => {
    if (!existsSync(def.dir)) {
      console.error(`agent-office: the ${def.name} floor's checkout is gone (${def.dir}) — it stays closed until it's back`);
      return undefined;
    }
    try {
      const floor = new Floor(def, floorContext);
      floors.set(def.id, floor);
      return floor;
    } catch (err) {
      console.error(`agent-office: couldn't open the ${def.name} floor: ${(err as Error).message}`);
      return undefined;
    }
  };
  // Started in a project: it's a floor too (the one it has always been).
  if (cfg.project) ctx.building.ensureLocal(cfg.project, 'the office');
  for (const def of ctx.building.list()) openFloor(def);
  // Clones keep the elevator's progress up to date, and ones the last office left running carry on.
  ctx.building.watchClones(ctx.floorsChanged);
  ctx.building.resumeClones((r) => {
    ctx.floorsChanged();
    if (typeof r === 'string') {
      console.error(`agent-office: ${r}`);
      return ctx.toastAll(`🛗 ${r}`, 'warn');
    }
    if (!openFloor(r)) return;
    console.log(`  the ${r.name} floor's clone finished (${r.dir})`);
    ctx.toastAll(`🛗 New floor: ${r.name}, added by ${r.addedBy}`);
  });
  // Workers still running from the last office are back at their desks before anyone walks in.
  await Promise.all([...floors.values()].map((f) => f.ready));
  // The project teams' minute clock (benching, the scheduled standup) runs from the start, not from the first worker update.
  rosterOf(ctx);
  // The team chatter listens from the start too (chatter/).
  chatterOf(ctx);
  return { openFloor };
}
