// The office's stage, from the setup view's verdicts (the office's own gate-check on origin/<default>,
// gate-source.ts) and the register on the same commit: shared/stage-derive.ts works it out, this keeps
// the latest per floor so the places that can't wait on git (the project summary, Teams' digest) say
// the same thing the progress bar does. Flags are only raised from a check of origin/<default>'s head
// itself: an older or committed dashboard says nothing about what doesn't add up now.

import { deriveStage, lineText, stageFlags, type StageCheck, type StageEvidence } from '../../shared/stage-derive.js';
import type { SetupView } from '../../shared/wizard.js';
import { dropKeys, onForgetFloor } from '../office/forget.js';

/** Per floor folder: the latest evidence and the verdicts it was derived from. */
export interface LatestStage {
  evidence: StageEvidence;
  verdicts: NonNullable<SetupView['verdicts']>;
}

const latest = new Map<string, LatestStage>();
onForgetFloor((f) => dropKeys(latest, f));

/** The evidence for one setup view: the derived stage, the check it came from, PROJECT.md's line and the flags. */
export function stageEvidence(view: Pick<SetupView, 'verdicts' | 'decisions' | 'toolkit'>, projectMd: string | undefined, check: StageCheck): StageEvidence | undefined {
  if (!view.toolkit) return undefined;
  const verdicts = view.verdicts ?? [];
  const stage = deriveStage(verdicts, view.decisions);
  const line = lineText(projectMd);
  const current = check.source === 'office' && !check.stale;
  return { ...(stage ? { stage } : {}), check, ...(line ? { line } : {}), flags: current ? stageFlags(verdicts, view.decisions, projectMd) : [] };
}

/** Keeps the floor's latest evidence (the setup view just worked it out). */
export function rememberEvidence(dir: string, e: StageEvidence | undefined, verdicts: SetupView['verdicts'] = []): void {
  if (e) latest.set(dir, { evidence: e, verdicts });
  else latest.delete(dir);
}

/** The floor's latest evidence, when the setup view has been worked out since the office started. */
export function latestEvidence(dir: string): LatestStage | undefined {
  return latest.get(dir);
}
