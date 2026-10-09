// What the progress bar and the acceptance record are made from, read through what the office already
// keeps and caches: the setup panel's view (the gate verdicts and the decision register, from
// origin/<default>, wizard/), the 📦 Deliverables scan (deliverables/), the budget ledger and plan
// (budget/) and the delivery branch's head. Nothing here runs on a timer; each source has its own cache.

import { createHash } from 'node:crypto';
import { stageCounts, type DeliverablesView } from '../../shared/deliverables.js';
import type { PhaseSpend, StageDeliverablesIn } from '../../shared/progress.js';
import type { SetupView } from '../../shared/wizard.js';
import { budgetOf } from '../budget/index.js';
import { numbersOf } from '../budget/control.js';
import { deliverablesOf } from '../deliverables/index.js';
import { headOf } from '../deliverables/git.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { execFileOff } from '../offloop/exec.js';
import { wizardOf } from '../wizard/index.js';
import { branchInfo } from '../wizard/gate-source.js';

export interface Gathered {
  setup?: SetupView;
  deliverables?: DeliverablesView;
}

/** The setup view (shared with the setup panel for a few seconds) and, unless `mini`, the deliverables scan (shared for 20 s). */
export async function gather(ctx: Ctx, floor: Floor, mini = false): Promise<Gathered> {
  const [setup, deliverables] = await Promise.all([wizardOf(ctx).setup(floor).catch(() => undefined), mini ? Promise.resolve(undefined) : deliverablesOf(ctx, floor)]);
  return { ...(setup ? { setup } : {}), ...(deliverables ? { deliverables } : {}) };
}

/** Per stage: the expected deliverables' counts and each item's status (catalog items only; a team's extras aren't expected). */
export function stageDeliverables(view: DeliverablesView): StageDeliverablesIn[] {
  return stageCounts(view.items).map((c) => ({
    ...c,
    items: view.items.filter((i) => i.stage === c.stage && (!i.optional || i.status !== 'missing')).map((i) => ({ title: i.title, status: i.status, files: i.files.length + (i.more ?? 0) })),
  }));
}

/** The BRD files on main (the catalog's brd-json item), or undefined when the scan has no such item. */
export function brdCount(view: DeliverablesView): number | undefined {
  const it = view.items.find((i) => i.id === 'brd-json');
  if (!it) return undefined;
  const onMain = it.files.filter((f) => f.status === 'present').length;
  return onMain + (onMain === it.files.length ? (it.more ?? 0) : 0);
}

/**
 * A fingerprint of what's on main: each catalog item's files there and their sizes. Not their times: on
 * origin/<default> a file's time is its branch's last commit, so any commit at all would read as a change.
 */
export function deliverablesDigest(view: DeliverablesView): string {
  const lines = view.items
    .flatMap((i) => i.files.filter((f) => f.status === 'present').map((f) => `${i.id}|${f.path}|${f.size ?? ''}`))
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Spend per stage from the ledger's daily rollups (kept for ever), since `since` when a later delivery
 * cycle began; the plan's lines per stage for the first cycle only (the plan is the whole project's).
 */
export function stageSpend(ctx: Ctx, floor: Pick<Floor, 'id' | 'dir' | 'def'>, since?: number): Record<string, PhaseSpend & { first?: string; last?: string }> {
  const b = budgetOf(ctx);
  const ref = { id: floor.id, name: floor.def.name, dir: floor.dir };
  const f = b.file(ref);
  const from = since ? day(since) : '';
  const out: Record<string, PhaseSpend & { first?: string; last?: string }> = {};
  for (const d of Object.keys(f.ledger.days).sort()) {
    if (d < from) continue;
    for (const [s, cost] of Object.entries(f.ledger.days[d].stage)) {
      if (s === '—' || !(cost > 0)) continue;
      const o = (out[s] ??= { actual: 0 });
      o.actual = Math.round((o.actual + cost) * 100) / 100;
      o.first ??= d;
      o.last = d;
    }
  }
  for (const r of f.ledger.rows) if (r.unmetered && r.day >= from && r.stage !== '—') (out[r.stage] ??= { actual: 0 }).partial = true;
  if (!since) {
    for (const l of numbersOf(b, ref).plan.lines) {
      if (l.stage === '—') continue;
      const o = (out[l.stage] ??= { actual: 0 });
      o.planned = Math.round(((o.planned ?? 0) + l.usd) * 100) / 100;
    }
  }
  return out;
}

/**
 * The delivery branch and its head now: origin/<default> (read afresh, not from the setup view's few seconds
 * of cache, so "changed since acceptance" is current), else the folder's own branch.
 */
export async function deliveryHead(floor: Pick<Floor, 'dir'>, setup: SetupView | undefined): Promise<{ branch?: string; commit?: string }> {
  if (setup?.head) {
    const info = await branchInfo(floor.dir);
    return info ? { branch: info.def, commit: info.sha } : { branch: setup.head.branch, commit: setup.head.sha };
  }
  const [out, commit] = await Promise.all([
    new Promise<string | undefined>((resolve) =>
      execFileOff('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: floor.dir, timeout: 10_000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, o) => resolve(err ? undefined : String(o))),
    ),
    headOf(floor.dir),
  ]);
  const branch = out?.trim();
  return commit && /^[a-f0-9]{40}$/.test(commit) ? { branch, commit } : {};
}
