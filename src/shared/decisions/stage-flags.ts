// What doesn't add up about a toolkit project's stage, as an info card (shared/stage-derive.ts): stages
// signed off in PROJECT.md while the office's own gate-check on main still fails an earlier one (the
// toolkit's paperwork: intake answers, triage.md's "Confirmed by"), and a "Current stage" line that isn't
// what gate-check would write from main now. Shown, never counted as waiting on you; its button asks the
// lead, through the team's durable tell (server/wizard/stage-fix.ts), to fix the paperwork, re-run
// gate-check and commit. The office never edits the project itself. Pure.

import type { NeedItem } from '../needsyou.js';
import type { SetupView } from '../wizard.js';
import type { StageCheck, StageFlag } from '../stage-derive.js';
import type { Candidate } from './candidates.js';

/** What the lead is told for these flags (the button's message): what's wrong, on which commit, and what to do. */
export function stageFixMessage(flags: readonly StageFlag[], where: string): string {
  const lines = [`The office's gate-check on ${where} doesn't add up with PROJECT.md:`];
  for (const f of flags) {
    if (f.kind === 'paperwork') {
      lines.push(`- Stage ${f.signed.join(', ')} ${f.signed.length === 1 ? 'is' : 'are'} signed off, but gate-check still reports:`);
      for (const x of f.failing) lines.push(`  - Stage ${x.id} (${x.title})${x.detail ? `: ${x.detail}` : ''}`);
    } else if (f.kind === 'brd-path') {
      lines.push(
        `- ${f.text}. gate-check's Stage 2 reads BRDs only from ${f.expected} (the one knowledge base it resolves); the toolkit's other scripts (open-questions.sh, facts-lock.sh, brd-report.sh) read every knowledge base, so they found ${f.actual.length === 1 ? 'it' : 'them'}.`,
        `  Either put the BRD where gate-check reads it (git mv to ${f.expected}, content unchanged, and update the paths that cite it), or, if the signed file must stay where it is, say so in your journal and in PROJECT.md's Decisions notes so the PENDING is read as paperwork. Don't edit the toolkit.`,
      );
    } else if (f.kind === 'build-plan') {
      lines.push(`- ${f.text}. Mark each row's State in architecture/build-plan.md (built / partial / not built / blocked, brd-to-build-plan.md's row schema) as the build stands on main, in your next docs pull request; don't mark a row built that isn't.`);
    } else lines.push(`- ${f.text}.`);
  }
  lines.push(
    'Please fix the paperwork the gates name (the files, not the verdicts), re-run bin/gate-check.sh on the project and commit what it rewrote (index.html and the Current stage line) in your next docs pull request.',
    "Don't change a decision to make a gate pass: if a stage really isn't done, say so (office-workers escalate).",
  );
  return lines.join('\n');
}

/** "main @abc1234": the commit the office checked. */
export const checkedWhere = (c: StageCheck) => `${c.branch ?? 'main'}${c.sha ? ` @${c.sha.slice(0, 7)}` : ''}`;

export function stageFlagCandidates(setup: SetupView | undefined, floor: string | undefined): Candidate[] {
  const e = setup?.stage;
  if (!e || !floor || !e.flags.length) return [];
  const paperwork = e.flags.find((f) => f.kind === 'paperwork' || f.kind === 'brd-path' || f.kind === 'build-plan');
  const text = e.flags.map((f) => f.text).join('. ');
  const target = { to: 'stage-fix', floor } as const;
  const need: NeedItem = { key: `stage-flags-${floor}`, kind: 'setup', icon: 'ℹ️', text, level: 'info', action: paperwork ? 'Ask the lead to fix the paperwork' : 'Ask the lead to re-run gate-check', target };
  const where = checkedWhere(e.check);
  return [
    {
      need,
      source: { id: `stage-flags:${e.check.sha ?? floor}`, type: 'other', label: 'the office’s gate-check', text, target },
      keys: [],
      kind: 'fyi',
      prio: 9,
      body: {
        question: text,
        detail: `From the toolkit's gate-check, run by the office on a temporary checkout of ${where}. The office doesn't change the project: the lead fixes the files the gates name and re-runs gate-check.`,
        evidence: e.flags.flatMap((f) =>
          f.kind === 'paperwork' ? f.failing.map((x) => ({ label: `gate-check: Stage ${x.id} (${x.title})${x.detail ? `: ${x.detail}` : ''}` })) : f.kind === 'brd-path' ? f.actual.slice(0, 5).map((a) => ({ label: `BRD on main: ${a} (gate-check looked in ${f.expected})` })) : f.kind === 'build-plan' ? [{ label: f.text }] : [{ label: `PROJECT.md says: ${e.line ?? `Stage ${f.says}`}` }],
        ),
        blocks: [],
        owner: 'the lead',
        notes: ['Shown for information: it isn’t counted as waiting on you.'],
        after: 'The lead is told what gate-check reports and asked to fix the paperwork, re-run gate-check and commit, after their current turn. The card goes once a check of main agrees.',
      },
    },
  ];
}
