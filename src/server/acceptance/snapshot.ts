// Acceptance reads immutable Git objects. The live setup/deliverables caches may describe different
// commits (or uncommitted files), so neither is a source for a signed delivery record. The one thing
// taken from memory is gate-check's dashboard as the office rendered it from that very commit (the
// committed index.html is often stale): it is said to be a check at a time, never cited as a file.
import { createHash } from 'node:crypto';
import type { AcceptanceDraft } from '../../shared/acceptance.js';
import { commitTime } from '../deliverables/git.js';
import { scanDeliverables } from '../deliverables/scan.js';
import type { Floor } from '../floor.js';
import { deliveryHead } from '../progress/gather.js';
import { branchInfo, GATE_FILES, showAt } from '../wizard/gate-source.js';
import { setupViewOf } from '../wizard/setup.js';

/** The locally known delivery ref, without falling back to a cached setup head. */
export async function acceptanceHead(floor: Pick<Floor, 'dir'>) {
  const remote = await branchInfo(floor.dir);
  return remote ? { branch: remote.def, commit: remote.sha } : deliveryHead(floor, undefined);
}

/** gate-check's dashboard as the office rendered it from exactly `sha` (no commit of it exists), if it has. */
export type RenderedAt = (dir: string, sha: string) => { html: string; at: number } | undefined;

export async function acceptanceSource(floor: Pick<Floor, 'id' | 'dir'>, rendered?: RenderedAt) {
  const head = await acceptanceHead(floor);
  if (!head.commit) return { head, current: head };
  const sha = head.commit;
  const [entries, deliverables] = await Promise.all([
    Promise.all(GATE_FILES.map(async (file) => [file, await showAt(floor.dir, sha, file)] as const)),
    commitTime(floor.dir, sha).then((at) => scanDeliverables({ floor: floor.id, dir: floor.dir, people: [], main: { def: head.branch ?? 'HEAD', sha, at } })),
  ]);
  const files: Partial<Record<string, string>> = Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  const r = rendered?.(floor.dir, sha);
  if (r) files['index.html'] = r.html;
  const setup = { ...setupViewOf(files), checking: false, ...(r ? { checkedAt: r.at } : {}), head: { branch: head.branch ?? 'HEAD', sha } };
  // Resolve once more after the asynchronous reads. A concurrent ref movement must not be accepted.
  return { head, setup, deliverables, current: await acceptanceHead(floor) };
}

/**
 * Bind confirmation to the reviewed evidence, the budget terms and the delivery cycle. Not to what ticks on
 * its own while someone reads: the clock, the day's exchange rate, and the spend of agents still at work
 * (an active project would refuse every confirm). The record freezes the spend at the moment of confirming;
 * crossing the budget is the one spend change that asks for a fresh look.
 */
export function reviewToken(draft: Omit<AcceptanceDraft, 'reviewToken'>, cycle: number): string {
  const { admin: _admin, cost, ...evidence } = draft;
  const terms = {
    budget: cost.budget,
    planned: cost.planned,
    overBudget: cost.budget ? cost.spent >= cost.budget : undefined,
    currency: cost.fx?.currency,
    stages: cost.byStage.map((s) => [s.stage, s.planned]),
  };
  return createHash('sha256').update(JSON.stringify({ cycle, ...evidence, cost: terms })).digest('hex');
}
