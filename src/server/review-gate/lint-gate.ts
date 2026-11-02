// "lint could not run (lint-gate exit 2)" on every apply (release 83, a real build's docs/BUILD-LOG.md). The
// toolkit's lint gate (project-bin/lint-gate.sh, run by the toolkit's apply step, not by the office) exits 0 clean,
// 1 when a rule rose (or a rule couldn't read the model), and 2 when it couldn't run at all. It can't run:
//   * without a lint baseline (.claude/lint-baseline.json): its first run says "no baseline" and exits 2, and it
//     ratchets against nothing until one is committed (`lint-gate.sh --update-baseline`, once). A project that never
//     made one gets exit 2 on every apply, which is what the build showed: lint never ran, nothing was checked;
//   * without mxcli where the gate looks (the project root's mxcli.exe, or on the PATH of the apply's shell).
// Making or resetting the baseline is the Project Manager's decision (shared/review-gate.ts reviewRule), so the
// office doesn't write one: it reads main's build log and says which of the two it is, on one info card for
// Needs you (./index.ts), with the step to take. Local git only, off the event loop.

import type { AskItem } from '../../shared/asks.js';
import { BUILD_LOG, LINT_BASELINE } from '../../shared/review-gate.js';
import { git } from '../asks/sources.js';

const COULD_NOT_RUN = /lint (could not|couldn['’]t) run[^\n]*exit 2/gi;

export interface LintGateLook {
  /** Build-log lines saying the lint gate couldn't run (exit 2). */
  failures: number;
  /** Whether main has the lint baseline. */
  baseline: boolean;
}

/** What main's build log and tree say about the lint gate; undefined when the log names no such failure. Never throws. */
export async function lookLintGate(dir: string, mainSha: string): Promise<LintGateLook | undefined> {
  const log = await git(['show', `${mainSha}:${BUILD_LOG}`], dir).catch(() => undefined);
  const failures = (log?.slice(-256 * 1024).match(COULD_NOT_RUN) ?? []).length;
  if (!failures) return undefined;
  const has = await git(['cat-file', '-e', `${mainSha}:${LINT_BASELINE}`], dir).catch(() => undefined);
  return { failures, baseline: has !== undefined };
}

/** The why, in words: the missing baseline, or mxcli not found by the gate. Pure. */
export function lintGateWhy(l: LintGateLook): string {
  return l.baseline
    ? `the baseline (${LINT_BASELINE}) is there, so the gate didn't find mxcli where it looks (mxcli.exe in the project root, or on the PATH of the shell the apply runs in)`
    : `the project has no lint baseline (${LINT_BASELINE}): the gate exits 2 until one is committed, so lint has never checked anything`;
}

/** One info card, or undefined when lint runs. */
export function lintGateItem(l: LintGateLook | undefined, lead?: string): AskItem | undefined {
  if (!l) return undefined;
  return {
    id: `lint-gate-${l.baseline ? 'mxcli' : 'baseline'}`,
    kind: 'gate',
    level: 'info',
    text: `Lint never ran on apply (${l.failures} time${l.failures === 1 ? '' : 's'} in the build log: lint-gate exit 2)`,
    lines: [
      `Exit 2 means the toolkit's lint gate couldn't run at all: ${lintGateWhy(l)}.`,
      l.baseline
        ? 'Ask the lead to make mxcli reachable for the apply step (the office puts it on every agent’s PATH; a copy in the project root works too), then apply again.'
        : `Decide whether to start the ratchet now: the lead runs \`bash project-bin/lint-gate.sh --update-baseline\` once and commits ${LINT_BASELINE} citing your decision (Decided per ESC-<id> rev <n>). From then on a rule that rises fails the apply.`,
    ],
    acts: [...(lead ? [{ act: 'ask-lead' as const, label: `Ask ${lead} about it` }] : []), { act: 'seen', label: 'Hide' }],
  };
}
