// ✅ Accept's preflight: what will refuse it, listed before it's pressed (shared/acceptance-gates.ts), from the
// same checks accept() and its route run, in the same words, without changing anything: no mx check is
// started (pressing Accept still starts one when none ran at the delivery commit), nothing is recorded. The
// server's refusal is unchanged; this only says it in advance. GET /api/acceptance/draft carries the answer.
//
// Enforced by code: the Project Manager (an admin), a cycle not already accepted, a readable delivery commit, and
// the security baseline with `mx check` at that commit when the project's policy enforces it.
// Informational (recorded, never a refusal): the testing policy at the commit, the guided checks of that version,
// and reviews (each merge's own gate, not re-checked by Accept).

import type { AcceptanceDraft } from '../../shared/acceptance.js';
import type { AcceptGate } from '../../shared/acceptance-gates.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { acceptanceStore } from './index.js';

/** The route's own refusal for someone who isn't an admin (http/routes/progress.ts). */
export const NOT_ADMIN = 'Only the Project Manager (an admin) can accept or reopen a delivery';
/** accept()'s refusal when the delivery commit can't be read. */
export const NO_COMMIT = 'The delivery commit could not be read. Commit the delivery and reopen the acceptance dialog';

const short = (sha: string) => sha.slice(0, 7);

export interface PreflightDeps {
  security(commit: string): Promise<{ refusal?: string; advisory?: string; gate?: { missing: string[]; flags?: string[] } }>;
  testing(commit: string): Promise<{ verified: boolean; nothingRan: boolean; missing: string[] } | undefined>;
  guided(commit: string): Promise<{ scenarios: number; works: number; wrong: number } | undefined>;
}

/** The office's own checks, the ones accept() calls. */
function officeDeps(ctx: Ctx, floor: Floor): PreflightDeps {
  return {
    security: async (commit) => (await import('../security-gate/index.js')).acceptancePreview(ctx, floor, commit),
    async testing(commit) {
      const t = await (await import('../testing/verify-office.js')).testingSummary(ctx, floor, commit);
      if (!t) return undefined;
      return { verified: t.evaluation.verified, nothingRan: t.evaluation.nothingRan, missing: t.evaluation.checks.filter((c) => c.state !== 'passed' && c.state !== 'waived').map((c) => `${c.label}: ${c.state}`) };
    },
    async guided(commit) {
      try {
        const v = await (await import('../guided-validation/index.js')).validationOf(ctx, floor, commit);
        return { scenarios: v.scenarios.length, works: v.scenarios.filter((s) => s.finding?.verdict === 'works').length, wrong: v.scenarios.filter((s) => s.finding?.verdict === 'wrong').length };
      } catch {
        return undefined;
      }
    },
  };
}

/** What will refuse Accept now, and what's only shown. */
export async function acceptancePreflight(ctx: Ctx, floor: Floor, admin: boolean, draft: Pick<AcceptanceDraft, 'source'>, deps: PreflightDeps = officeDeps(ctx, floor)): Promise<AcceptGate[]> {
  const gates: AcceptGate[] = [];
  gates.push(admin ? { id: 'admin', label: 'The Project Manager accepts', enforced: true, state: 'pass', text: 'You are an admin: you can accept' } : { id: 'admin', label: 'The Project Manager accepts', enforced: true, state: 'fail', text: NOT_ADMIN });
  const cur = acceptanceStore(ctx.cfg.dataDir, floor.id).cycles().at(-1);
  gates.push(cur?.record ? { id: 'cycle', label: 'A version not accepted yet', enforced: true, state: 'fail', text: `${cur.record.version} is already accepted: reopen it to start the next version` } : { id: 'cycle', label: 'A version not accepted yet', enforced: true, state: 'pass', text: `${cur?.version ?? 'v1'} is open for acceptance` });
  const commit = draft.source.commit;
  if (!commit) {
    gates.push({ id: 'commit', label: 'The delivery commit', enforced: true, state: 'fail', text: NO_COMMIT, action: { label: 'Open Git', tab: 'git' } });
    gates.push({ id: 'security', label: 'Security baseline and mx check at the delivery commit', enforced: true, state: 'unknown', text: 'Checked at the delivery commit, once it can be read' });
  } else {
    gates.push({ id: 'commit', label: 'The delivery commit', enforced: true, state: 'pass', text: `${draft.source.branch ?? 'The delivery branch'} @ ${short(commit)}` });
    const sec = await deps.security(commit);
    if (sec.refusal) {
      gates.push({ id: 'security', label: 'Security baseline and mx check at the delivery commit', enforced: true, state: 'fail', text: sec.refusal, action: { label: 'Open Security', tab: 'security' } });
    } else if (sec.advisory) gates.push({ id: 'security', label: 'Security baseline and mx check at the delivery commit', enforced: false, state: 'info', text: sec.advisory, action: { label: 'Open Security', tab: 'security' } });
    else gates.push({ id: 'security', label: 'Security baseline and mx check at the delivery commit', enforced: true, state: 'pass', text: `Met at ${short(commit)}${sec.gate?.flags?.[0] ? ` (${sec.gate.flags[0]})` : ''}` });
  }
  // Informational: recorded with the acceptance, never a refusal.
  const t = commit ? await deps.testing(commit).catch(() => undefined) : undefined;
  gates.push({ id: 'testing', label: 'Testing policy', enforced: false, state: 'info', text: !t ? 'Couldn’t be read at the delivery commit; Accept records it as a gap' : t.verified ? 'Every required check passed or is waived at the delivery commit' : t.nothingRan ? 'No required check has a result at the delivery commit (recorded, not a refusal)' : `Not verified at the delivery commit: ${t.missing.slice(0, 3).join('; ')}${t.missing.length > 3 ? '…' : ''} (recorded, not a refusal)`, action: { label: 'Open Testing', tab: 'testing' } });
  const g = commit ? await deps.guided(commit).catch(() => undefined) : undefined;
  gates.push({ id: 'guided', label: 'Guided checks of this version', enforced: false, state: 'info', text: !g ? 'Not read for the delivery commit' : !g.scenarios ? 'No guided checks for this version' : `${g.works} of ${g.scenarios} marked "Works"${g.wrong ? `, ${g.wrong} "Something’s wrong"` : ''} (people’s marks, not a refusal)` });
  gates.push({ id: 'reviews', label: 'Code reviews', enforced: false, state: 'info', text: 'Checked when each change merges (the merge gate); Accept doesn’t check them again' });
  return gates;
}
