// The office's worktree cleanup: every hour (and once ten minutes after start), each floor's
// worktrees that no worker has any more and whose work is merged are removed (sweep.ts), each removal in
// the audit log; what's kept, and worktrees agents made outside .agent-office/worktrees/, are reported
// on 🔌 Connections. On unless an admin switches it off there (office-settings.json).

import path from 'node:path';
import type { SweepItem, SweepView } from '../../shared/connections.js';
import type { Ctx } from '../office/context.js';
import { audit, human, office } from '../audit/index.js';
import { officeSettings, updateOfficeSettings } from '../connections/store.js';
import { samePath, sweepRepo, within } from './sweep.js';

const HOUR = 60 * 60_000;
const FIRST_MS = 10 * 60_000;

let running = false;
let lastRun: SweepView['lastRun'];

export const sweepOn = () => officeSettings().sweep !== false;
export const sweepView = (): SweepView => ({ on: sweepOn(), running, lastRun });

/** Every folder a worker of the office works in: its worktree, its other repositories' worktrees and the workspace they're in. */
function ownedPaths(ctx: Ctx): { trees: string[]; workspaces: string[] } {
  const trees: string[] = [];
  const workspaces: string[] = [];
  for (const f of ctx.floors.values()) {
    for (const w of f.workers.list()) {
      if (!w.worktree) continue;
      trees.push(path.resolve(f.dir, w.worktree.path));
      if (w.repos?.length) {
        workspaces.push(path.resolve(f.dir, path.dirname(w.worktree.path)));
        for (const r of w.repos) trees.push(path.resolve(f.dir, r.path));
      }
    }
  }
  return { trees, workspaces };
}

/** One sweep over every floor. `by` someone from the page, or the office's clock. */
export async function runSweep(ctx: Ctx, by?: { name: string; id?: string }): Promise<SweepItem[]> {
  if (running) return lastRun?.items ?? [];
  running = true;
  try {
    const { trees, workspaces } = ownedPaths(ctx);
    const owned = (abs: string) => trees.some((t) => samePath(t, abs)) || workspaces.some((w) => samePath(w, abs) || within(w, abs));
    const items: SweepItem[] = [];
    const seen = new Set<string>();
    for (const f of ctx.floors.values()) {
      for (const it of await sweepRepo(f.dir, { owned, floor: f.def.name })) {
        const key = `${it.action}:${path.resolve(it.path).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(it);
        if (it.action === 'removed') {
          audit.record({
            floor: f.id,
            actor: by ? human(by.name, by.id) : office(),
            action: 'worktree.removed',
            target: { kind: 'worktree', id: it.branch ?? it.path, label: it.branch ?? path.basename(it.path) },
            summary: `Removed the worktree ${path.basename(it.path)} (${it.branch}): merged, clean, and no worker has it`,
            details: { path: it.path, branch: it.branch },
            severity: 'info',
          });
        }
      }
    }
    lastRun = { at: Date.now(), items };
    const removed = items.filter((i) => i.action === 'removed').length;
    if (removed) console.log(`  🧹 Worktree cleanup removed ${removed} merged worktree${removed === 1 ? '' : 's'}`);
    return items;
  } finally {
    running = false;
  }
}

export function setSweep(on: boolean, who: { name: string; id?: string }) {
  updateOfficeSettings({ sweep: on ? undefined : false });
  audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'worktreeSweep', label: 'Worktree cleanup' }, summary: `${who.name} turned the hourly worktree cleanup ${on ? 'on' : 'off'}`, details: { after: { on } }, severity: 'notice' });
}

/** Starts the clock (office/timers.ts). Returns what stops it. */
export function startWorktreeSweep(ctx: Ctx): () => void {
  const tick = () => {
    if (sweepOn()) void runSweep(ctx).catch((err: Error) => console.error(`agent-office: worktree cleanup failed: ${err.message}`));
  };
  const first = setTimeout(tick, FIRST_MS);
  const every = setInterval(tick, HOUR);
  first.unref?.();
  every.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
