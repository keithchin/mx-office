// Acceptance reads immutable Git objects. The live setup/deliverables caches may describe different
// commits (or uncommitted files), so neither is a source for a signed delivery record.
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

export async function acceptanceSource(floor: Pick<Floor, 'id' | 'dir'>) {
  const head = await acceptanceHead(floor);
  if (!head.commit) return { head, current: head };
  const sha = head.commit;
  const [entries, deliverables] = await Promise.all([
    Promise.all(GATE_FILES.map(async (file) => [file, await showAt(floor.dir, sha, file)] as const)),
    commitTime(floor.dir, sha).then((at) => scanDeliverables({ floor: floor.id, dir: floor.dir, people: [], main: { def: head.branch ?? 'HEAD', sha, at } })),
  ]);
  const setup = { ...setupViewOf(Object.fromEntries(entries.filter(([, value]) => value !== undefined))), checking: false, head: { branch: head.branch ?? 'HEAD', sha } };
  // Resolve once more after the asynchronous reads. A concurrent ref movement must not be accepted.
  return { head, setup, deliverables, current: await acceptanceHead(floor) };
}

/** Bind confirmation to the reviewed evidence, cost values and delivery cycle; clocks alone may tick. */
export function reviewToken(draft: Omit<AcceptanceDraft, 'reviewToken'>, cycle: number): string {
  const { admin: _admin, cost: { at: _at, ...cost }, ...evidence } = draft;
  return createHash('sha256').update(JSON.stringify({ cycle, ...evidence, cost })).digest('hex');
}
