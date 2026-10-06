// The incidents in the real office: the store in the office's data dir (incidents/), the seed of
// 2026-10-06 applied once (seed.ts), and the detection rules (rules.ts) fed from the audit log, the
// signals (signals.ts), every worker update (incidentsOnWorker, from office/floors.ts), the workers the
// last office left mid-turn (read from each floor's workers.json before the floors open and restore
// them) and a look at every floor once a minute. Installed by server.ts after the audit log.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { IncidentWorker } from '../../shared/incidents.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { auditLog, onAuditEvent } from '../audit/index.js';
import { floorPause } from '../roster/pause.js';
import { rosterOf } from '../roster/adapter.js';
import { useTestMode } from '../testmode.js';
import { IncidentStore, raise, useIncidents } from './index.js';
import { IncidentDetector, type FloorSnapshot } from './rules.js';
import { onIncidentSignal } from './signals.js';
import { applySeed, wantsSeed } from './seed.js';

const TICK_MS = 60_000;
/** The restored workers are looked at once the floors are open and their names known. */
const RESTORED_AFTER_MS = 15_000;

let detector: IncidentDetector | undefined;

const norm = (p: string) => path.resolve(p).toLowerCase();

/** The workers a floor's workers.json says were mid-turn with no terminal left to carry on in. */
export function interruptedIn(file: string): IncidentWorker[] {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { id?: string; name?: string; kind?: string; midTurn?: boolean; pty?: unknown }[];
    return saved.filter((s) => s.kind === 'agent' && s.midTurn === true && !s.pty && s.name).map((s) => ({ id: s.id, name: s.name! }));
  } catch {
    return [];
  }
}

/** When each of the office's audit events happened, for whether the seed belongs here (seed.ts). */
function* auditTimes(): Generator<number> {
  const log = auditLog();
  if (!log) return;
  for (const key of log.floors()) for (const e of log.events(key)) yield e.at;
}

function snapshot(ctx: Ctx, f: Floor): FloorSnapshot {
  const costs: Record<string, number> = {};
  for (const w of f.workers?.list() ?? []) if (w.usage?.cost) costs[w.id] = w.usage.cost;
  let undelivered: FloorSnapshot['undelivered'] = [];
  try {
    undelivered = rosterOf(ctx)
      .data(f.id)
      .escalations.filter((e) => e.status === 'resolved' && e.resolution && !e.resolution.delivered && e.resolution.verdict !== 'dismiss')
      .map((e) => ({ id: e.id, title: e.title, by: e.by, at: e.resolution!.at }));
  } catch {
    // No team on this floor.
  }
  return { id: f.id, costs, paused: floorPause(f.id), undelivered };
}

export function installIncidents(ctx: Ctx) {
  const { cfg } = ctx;
  useTestMode({ flag: cfg.testMode, officeDir: cfg.dir, agentCmd: cfg.agentCmd, agentExplicit: cfg.agentExplicit });
  const store = new IncidentStore(path.join(cfg.dataDir, 'incidents'));
  useIncidents(store);
  if (!store.exists() && wantsSeed(auditTimes())) {
    const n = applySeed();
    if (n) console.log(`  🚨 Recorded ${n} incidents of 2026-10-06 retrospectively (Audit log → Incidents)`);
  }

  const floorOfDir = (dir: string) => {
    const d = norm(dir);
    for (const f of ctx.floors.values()) {
      const root = norm(f.dir);
      if (d === root || d.startsWith(root + path.sep)) return f.id;
    }
    return undefined;
  };
  detector = new IncidentDetector({
    now: Date.now,
    settings: () => store.settings(),
    raise: (d) => void raise(d),
    floorName: (id) => ctx.floors.get(id)?.def.name ?? id,
    floorOfDir,
    floorOfName: (name) => [...ctx.floors.values()].find((f) => f.def.name === name)?.id,
  });
  const det = detector;
  onAuditEvent((e) => det.onAudit(e));
  onIncidentSignal((s) => det.onSignal(s));

  // Before the floors open (and save their workers again): who the last office stopped mid-turn.
  const dirs = new Set<string>([...ctx.building.list().map((d) => d.dir), ...(cfg.project ? [cfg.project] : [])].map((d) => path.resolve(d)));
  const restored = [...dirs].map((dir) => ({ dir, workers: interruptedIn(path.join(dir, '.agent-office', 'workers.json')) })).filter((r) => r.workers.length);
  const later = setTimeout(() => {
    for (const r of restored) {
      const floor = floorOfDir(r.dir);
      if (floor) det.onRestored(floor, r.workers.map((w) => ({ ...w, floor })));
    }
  }, RESTORED_AFTER_MS);
  const every = setInterval(() => {
    try {
      det.tick([...ctx.floors.values()].map((f) => snapshot(ctx, f)));
    } catch (err) {
      console.error(`agent-office: incident rules: ${(err as Error).message}`);
    }
  }, TICK_MS);
  for (const t of [later, every]) t.unref?.();
}

/** Every worker update on a floor (office/floors.ts). */
export function incidentsOnWorker(floor: Floor, w: WorkerInfo | string) {
  if (typeof w === 'string') detector?.forgetWorker(w);
  else detector?.onWorker(floor.id, w);
}
