// Which of gate-check's MANUAL stages is actually in play. The toolkit reports Stage 5 (Build) as MANUAL
// on every project, from its very first run ("not file-existence-checkable — fill in status manually"),
// so MANUAL alone says nothing about whether a person is needed now. A MANUAL stage waits on you only
// when it is the stage the project is at: every earlier stage (P, 0, 1, … in that order) PASS or WAIVED,
// and no later stage with anything in it yet (gate-check's own position rule: "a MANUAL stage holds the
// position until a later stage has something in it"). Before that it is a stage not started, checked by
// hand later. Pure: Needs you, the progress bar, the setup panel, the phone and Teams all read it here.
//
// Signing one off is the toolkit's way: a CONFIRMED row for the stage in PROJECT.md's Decisions ("its
// verdict is a Decisions row, not a file"). The office doesn't edit the team's register under it; the
// sign-off dialog (ui/signoff/, server/signoff/) tells the lead "Signed off: Stage N" with the exact row.

/** gate-check's stages in pipeline order. Rows with other ids (⟳, ?, ⚑, build-ready) aren't stages. */
export const STAGE_ORDER = ['P', '0', '1', '2', '3', '4', '5', '6', '7'] as const;

export interface VerdictLike {
  id: string;
  status: string;
}

/** A sign-off the Project Manager gave in the office, sent to the lead to record (server/signoff/). */
export interface SignoffRequest {
  stage: string;
  by: string;
  at: number;
  /** Who was asked to record it. */
  lead?: string;
}

const norm = (id: string) => id.trim().toUpperCase().replace(/^STAGE\s*/, '');
const settled = (s: string | undefined) => /^(PASS|WAIVED)$/i.test(s ?? '');
const empty = (s: string | undefined) => s === undefined || /^(PENDING|MANUAL)$/i.test(s);

/** A Decisions row as the gates read it. */
export interface SignoffRow {
  stage: string;
  decision: string;
  status: string;
}

/**
 * Whether the register records stage `id` as signed off: a CONFIRMED row for the stage whose decision says
 * it was signed off (the toolkit's has_confirmed_decision for a ✋ stage, the office's own sign-off row,
 * "BRD F001 signed off as the Stage 2 baseline"). Any other CONFIRMED row (a scope answer at Stage 0) isn't.
 */
export function signedOff(decisions: readonly SignoffRow[] | undefined, id: string): boolean {
  return (decisions ?? []).some((r) => norm(r.stage) === norm(id) && /^confirmed\b/i.test(r.status.trim()) && /\bsign(?:ed)?[- ]?off\b/i.test(r.decision));
}

/**
 * Whether stage `id`'s MANUAL verdict is the one in play: it is MANUAL, every earlier stage on the
 * dashboard is PASS or WAIVED or signed off in the register (`decisions`: a Stage 2 whose BRD is signed
 * off while gate-check still says PENDING doesn't hold the build back; that mismatch is a flag of its
 * own, shared/stage-derive.ts), and every later one is still PENDING (or MANUAL, or not there). An
 * earlier stage the dashboard doesn't list at all (a mode that never runs it) doesn't hold it back.
 */
export function manualInPlay(verdicts: readonly VerdictLike[], id: string, decisions?: readonly SignoffRow[]): boolean {
  const at = STAGE_ORDER.indexOf(norm(id) as (typeof STAGE_ORDER)[number]);
  if (at < 0) return false;
  const by = new Map(verdicts.map((v) => [norm(v.id), v.status.toUpperCase()]));
  if (by.get(STAGE_ORDER[at]) !== 'MANUAL') return false;
  for (const s of STAGE_ORDER.slice(0, at)) if (by.has(s) && !settled(by.get(s)) && !signedOff(decisions, s)) return false;
  for (const s of STAGE_ORDER.slice(at + 1)) if (!empty(by.get(s))) return false;
  return true;
}

/**
 * A row that only waives one artifact of a stage ("Waived artifact improvement-register-html: small tier"): CONFIRMED, but
 * it says nothing about the stage being done. The real-build test's Stage 5 read "Build done" at row 5 of 29 from one.
 */
export const waiverRow = (r: { decision?: string }) => /^\s*waived\s+(artifact|file|document)\b/i.test(r.decision ?? '');

/** A CONFIRMED row for the stage in PROJECT.md's Decisions: the toolkit's record of a manual verdict (an artifact waiver isn't one). */
export function signedOffIn(decisions: readonly { stage: string; status: string; decision?: string }[] | undefined, id: string): boolean {
  return (decisions ?? []).some((r) => norm(r.stage.replace(/^stage\s*/i, '')) === norm(id) && /^confirmed\b/i.test(r.status.trim()) && !waiverRow(r));
}

export type SignoffState = { state: 'recorded' } | { state: 'requested'; req: SignoffRequest } | { state: 'open' };

/** Where a MANUAL stage in play stands: signed off in the register, signed off in the office and waiting for the lead to record it, or open. */
export function signoffState(setup: { decisions?: readonly { stage: string; status: string }[]; signoffs?: readonly SignoffRequest[] } | undefined, id: string): SignoffState {
  if (signedOffIn(setup?.decisions, id)) return { state: 'recorded' };
  const req = setup?.signoffs?.find((r) => norm(r.stage) === norm(id));
  return req ? { state: 'requested', req } : { state: 'open' };
}

/** The MANUAL stage in play, when there is one. */
export function manualStageInPlay<T extends VerdictLike>(verdicts: readonly T[]): T | undefined {
  return verdicts.find((v) => manualInPlay(verdicts, v.id));
}

/** Whether a verdict waits on you: a MANUAL stage in play and not signed off in the register. Everything that counted MANUAL as "waiting" asks here. */
export function manualWaiting(verdicts: readonly VerdictLike[], v: VerdictLike, decisions?: readonly { stage: string; status: string }[]): boolean {
  return manualInPlay(verdicts, v.id) && !signedOffIn(decisions, v.id);
}

/** What a MANUAL stage that isn't in play yet says, on the bar and the setup panel. */
export const MANUAL_LATER_TEXT = 'Not started: the toolkit checks this stage by hand, once the stages before it have passed or are signed off';

/** What signing off a stage means, for the sign-off dialog and the card. */
export function signoffMeaning(id: string, title: string): string {
  if (norm(id) === '5')
    return `Stage 5 (${title}) is the build itself. The toolkit can't certify it from files: it is done when every module's coverage checklist is built and confirmed with you, and the build gates are green. Signing off records that you, the Project Manager, accept the build as complete, so the team moves on to Stage 6 (Test).`;
  return `The toolkit can't check Stage ${norm(id)} (${title}) from files: its verdict is a CONFIRMED row in PROJECT.md's Decisions. Signing off records that you, the Project Manager, accept the stage as done.`;
}

/** The exact Decisions row the lead is asked to add (the toolkit reads a stage's CONFIRMED row: has_confirmed_decision). */
export function signoffRow(id: string, title: string, by: string, date: string): string {
  const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').trim();
  return `| ${clean(norm(id))} | Stage ${clean(norm(id))} (${clean(title)}) signed off by the Project Manager | CONFIRMED ${date} | Signed off in Mx Office by ${clean(by)} |`;
}

/** What the lead is told: an explicit "Signed off: Stage N", the row to add, and nothing to read as anything else. */
export function signoffMessage(id: string, title: string, by: string, date: string): string {
  return [
    `Signed off: Stage ${norm(id)} (${title}). The Project Manager (${by}) signed it off in Mx Office on ${date}.`,
    `Record it the toolkit's way: add this row to the Decisions table in PROJECT.md, in your next docs pull request, then re-run bin/gate-check.sh:`,
    signoffRow(id, title, by, date),
    `This is the sign-off itself, not a question: don't ask for it again. If the stage isn't actually done (a module not built, a gate red), don't record it: escalate (office-workers escalate) and say what's missing.`,
  ].join('\n');
}
