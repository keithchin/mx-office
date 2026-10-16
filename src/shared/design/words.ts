// Design systems' words, the same on every page and in the audit log. Pure.

import type { AdoptionStageId, DesignAdoption, ProjectDesignBinding, StartPoint, VersionStatus } from './types.js';

export type ApplyState = 'started' | 'done' | 'failed';

export const STATUS_WORDS: Record<VersionStatus, string> = { draft: 'Draft', approved: 'Approved', superseded: 'Superseded' };

export function startWords(s: StartPoint | undefined): string {
  if (!s || s === 'unknown') return 'not checked';
  if (s === 'atlas') return 'plain Atlas';
  if (s === 'custom') return 'its own styling';
  return `mxcli theme ${s.slice(6)}`;
}

/** "Acme Design System v1 (Branded Atlas) · #3f2a91c". */
export const bindingWords = (b: Pick<ProjectDesignBinding, 'name' | 'n' | 'digest' | 'kind'>) => `${b.name} v${b.n} (${b.kind === 'branded' ? 'Branded Atlas' : 'Atlas defaults'}) · #${b.digest.slice(0, 7)}`;

export const KEEP_WORDS = 'Keep the app’s design';
export const ADOPT_AFTER = 'After you choose: Adopt applies the package with mxcli theme on a branch of its own (agent-office/design-…), commits it there and pushes that branch; the project is bound to it once that branch is merged into the default branch. Keep existing design changes nothing. Nothing is applied until you press Adopt.';

export function stageWords(s: AdoptionStageId): string {
  return { apply: 'Applying the theme', commit: 'Committing it', push: 'Pushing the branch', merge: 'Merging', activate: 'Activating it' }[s];
}

/** Where an open adoption is, in a sentence: never "adopted" before its candidate is merged. */
export function adoptionWords(a: Pick<DesignAdoption, 'name' | 'n' | 'status' | 'branch' | 'remote' | 'failed' | 'stages' | 'into' | 'commit'>): string {
  const what = `${a.name} v${a.n}`;
  if (a.status === 'active') return `${what} is adopted: merged into ${a.into ?? 'the default branch'}.`;
  if (a.status === 'discarded') return `${what}: the adoption was discarded.`;
  if (a.status === 'failed' && a.failed) {
    if (a.failed.stage === 'push' && a.commit) return `${what} is committed locally on ${a.branch}, not pushed: ${a.failed.detail.replace(/^committed locally, not pushed: /, '')}`;
    return `The adoption of ${what} failed at “${stageWords(a.failed.stage).toLowerCase()}”: ${a.failed.detail}`;
  }
  if (a.status === 'candidate') return `${what} is a candidate on the branch ${a.branch} (${a.remote === 'pushed' ? 'committed and pushed' : 'committed on a local branch'}), not merged into the default branch yet: the project isn’t bound to it until it is.`;
  const at = (['apply', 'commit', 'push'] as const).find((s) => a.stages[s].state === 'started') ?? 'apply';
  return `Adopting ${what}: ${stageWords(at).toLowerCase()}…`;
}
