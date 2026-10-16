// Design systems' words, the same on every page and in the audit log. Pure.

import type { ProjectDesignBinding, StartPoint, VersionStatus } from './types.js';

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
export const ADOPT_AFTER = 'After you choose: Adopt applies the package with mxcli theme on a branch of its own (agent-office/design-…) and records the binding; Keep existing design changes nothing. Nothing is applied until you press Adopt.';
