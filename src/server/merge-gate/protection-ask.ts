// The one-time Needs-you note about how much the review status proves (shared/merge-gate-protection.ts): the
// office posts `mx-office/review` with the agents' GitHub token, so unless GitHub requires a human review (or the
// check is restricted to one App), an agent could post a passing status itself. One card per project with a
// GitHub remote, under a stable id, so Hide keeps it hidden (asks/service.ts `seen`); it goes away only once the
// branch's verdict reads Enforced. Handed to the asks look with the review gate's cards (review-gate/index.ts).
// The protection is the merge gate's own 10-minute read: this only peeks at it, and starts a read in the
// background when there's none yet, so the note never waits on GitHub.

import type { AskItem } from '../../shared/asks.js';
import { AGENTS_TOKEN_NOTE, VERIFY_NOTE } from '../../shared/merge-gate-protection.js';
import type { Ctx } from '../office/context.js';
import { localOnlyAt } from '../local-only.js';
import { mergeGateOf } from './index.js';

export const PROTECTION_ASK_ID = 'gate-status-token';

/** The note's card for a branch whose verdict isn't Enforced (`verdictText`: what the office read, when it has). */
export function protectionItem(branch: string, verdictText: string | undefined): AskItem {
  return {
    id: PROTECTION_ASK_ID,
    kind: 'gate',
    level: 'info',
    text: `The review status on ${branch} can be posted by any agent`,
    lines: [
      AGENTS_TOKEN_NOTE,
      verdictText ?? 'The office hasn’t read this branch’s protection yet.',
      `Turn on “Require a pull request before merging” with at least one approval (or a CODEOWNERS review) on GitHub. ${VERIFY_NOTE}`,
      'See Branch protection in the office’s guide.',
    ],
    acts: [{ act: 'seen', label: 'Hide' }],
  };
}

/** The note for a project, or none (no GitHub remote, or the branch's protection reads Enforced). */
export function protectionAsks(ctx: Ctx, floorId: string, main: { branch: string; remote: boolean } | undefined): AskItem[] {
  const floor = ctx.floors.get(floorId);
  if (!floor || !main?.remote || localOnlyAt(floor.dir)) return [];
  const gate = mergeGateOf(ctx);
  const seen = gate.peekProtection(floorId, main.branch);
  if (!seen) void gate.protection({ id: floor.id, dir: floor.dir, look: { agents: [] }, personReviews: false }, main.branch).catch(() => undefined);
  if (seen?.verdict === 'enforced') return [];
  return [protectionItem(main.branch, seen?.verdictText)];
}
