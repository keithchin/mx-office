// A project's business status (C2 of the App Workspace proposal): one pure function over the records the
// office already keeps, so every view that says how far the work is (the progress bar's label, Home's
// project rows, the Overview, the Live app chip, the phone's Status tab, the Teams digest) says the same
// thing. It reads; it never stores. Every status names the revision it is about and lists what is missing
// for the next one, and missing evidence never counts as passed:
//
//   Work in progress           nothing new is running to try: the live app isn't running, or the work
//                              isn't in the running build yet (revision: main's head)
//   Ready to try               the running build has some of the work, not all of it (revision: served)
//   Ready for business review  the work is built into the running build and nothing has verified it
//                              against that build yet (no journey ran, no required check has a result)
//   Verification incomplete    some evidence at the served revision, but a journey or check failed or is
//                              missing, the security baseline isn't met there, or merged work is unreviewed
//   Verification passed        every journey passed against the served revision, every required check
//                              passed (or was waived) there, the baseline is met, no unreviewed merge
//   Business accepted          an acceptance record for the delivery commit, unchanged since
//   Submitted for review / Changes requested / Release approved
//                              only under an approval policy (off by default; no policy store yet)
//   Deployed (recorded)        an accepted delivery whose record carries a person's deploy note
//
// A version accepted at commit A whose delivery branch moved to B is judged again at B ("changed since
// v1 acceptance" is kept as a note), never accepted because A was. Inputs left out are unknown, and an
// unknown input that the next status needs is listed as missing. Deterministic: the same input gives the
// same answer on the server and in the page (businessStatusMemo keeps the last few by input).

import type { MilestoneState } from './liveapp/readiness.js';

export type BusinessState =
  | 'unknown'
  | 'work-in-progress'
  | 'ready-to-try'
  | 'ready-for-review'
  | 'verification-incomplete'
  | 'verification-passed'
  | 'accepted'
  | 'submitted'
  | 'changes-requested'
  | 'release-approved'
  | 'deployed-recorded';

/** The words people see, the same everywhere. */
export const BUSINESS_WORDS: Record<BusinessState, string> = {
  unknown: 'Status unknown',
  'work-in-progress': 'Work in progress',
  'ready-to-try': 'Ready to try',
  'ready-for-review': 'Ready for business review',
  'verification-incomplete': 'Verification incomplete',
  'verification-passed': 'Verification passed',
  accepted: 'Business accepted',
  submitted: 'Submitted for review',
  'changes-requested': 'Changes requested',
  'release-approved': 'Release approved',
  'deployed-recorded': 'Deployed (recorded)',
};

/** Which commit a status is about: the one the live app serves, main's head, or the accepted delivery commit. */
export type RevisionKind = 'served' | 'main' | 'accepted';

export type CheckResult = 'passed' | 'failed' | 'missing' | 'skipped' | 'waived';

export interface BusinessMilestone {
  id: string;
  title: string;
  state: MilestoneState;
  journeys: readonly { id: string; result: 'passed' | 'failed' | 'not-run' }[];
  rows: readonly number[];
  inLive: readonly number[];
  onMain?: readonly number[];
  onBranch?: readonly { branch: string; pr?: number; rows: readonly number[] }[];
  missing?: readonly number[];
}

export interface BusinessInput {
  /** The milestone it is about ("phase-3"), or the whole plan ('all', the default): the project's status. */
  milestone?: string;
  /** The default branch's head (merged work). Undefined: not read. */
  main?: { sha: string; branch?: string };
  /** The live app: running and its served revision. Undefined: nobody opened it since the office started. */
  live?: { running: boolean; served?: string };
  /** The live app's readiness (shared/liveapp/readiness.ts), judged at `sha`. */
  readiness?: { sha?: string; milestones: readonly BusinessMilestone[]; note?: string };
  /** Agreed work: open tasks, open pull requests, merged work without a review that counts (E5). */
  work?: { open: number; openPrs: readonly { number: number; draft?: boolean; checks?: 'pass' | 'fail' | 'pending' | 'none' }[]; unreviewed: readonly { pr: number; why?: string }[] };
  /** The project's verification policy evaluated at `revision` (shared/testing/policy.ts evaluatePolicy). */
  checks?: { revision: string; required: readonly { label: string; state: CheckResult }[] };
  /** The security baseline's release gate at `revision` (E2, shared/security.ts judgeGate). */
  security?: { revision: string; meets: boolean; enforced: boolean; missing: readonly string[]; noApp?: boolean };
  /** The current delivery cycle: its version, its acceptance when given, and what changed since. */
  acceptance?: { version: string; accepted?: { commit?: string; branch?: string; at: number; by: string; deploy?: string }; changed: readonly string[] };
  /** The optional approval policy (off by default). `review` is the approver's record for a candidate commit. */
  policy?: { on: boolean; review?: { state: 'submitted' | 'changes' | 'approved'; revision: string } };
}

export interface BusinessStatus {
  state: BusinessState;
  label: string;
  /** The milestone id, or 'all'. */
  about: string;
  /** The milestone's title, when it is about one. */
  title?: string;
  /** The full commit it is about, and which kind of commit that is. */
  revision?: string;
  revisionKind?: RevisionKind;
  /** The delivery version the acceptance part is about (v1, v1.1…). */
  version?: string;
  /** What the next status needs, a line each, in order. */
  missing: string[];
  /** What is true but doesn't block it (changed since acceptance, main moved on, advisory security flags). */
  notes: string[];
  /** One line: "Verification incomplete · running abc1234 · no journey evidence for abc1234 (+1 more)". */
  line: string;
  tone: 'good' | 'busy' | 'bad' | 'idle';
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const same = (a?: string, b?: string) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
const rowsWord = (rows: readonly number[]) => (rows.length === 1 ? `BUILD row ${rows[0]}` : `BUILD rows ${rows.join(', ')}`);
const BUILT: readonly MilestoneState[] = ['ready', 'unverified', 'no-evidence'];
const GOOD: readonly BusinessState[] = ['verification-passed', 'accepted', 'release-approved', 'deployed-recorded'];

const REV_WORD: Record<RevisionKind, string> = { served: 'running', main: 'main @', accepted: 'accepted at' };

function make(state: BusinessState, about: string, p: { title?: string; revision?: string; kind?: RevisionKind; version?: string; missing?: string[]; notes?: string[]; failing?: boolean }): BusinessStatus {
  const missing = p.missing ?? [];
  const notes = p.notes ?? [];
  const label = BUSINESS_WORDS[state];
  const rev = p.revision && p.kind ? `${REV_WORD[p.kind]}${p.kind === 'main' ? '' : ' '}${short(p.revision)}` : '';
  const head = [p.title && about !== 'all' ? `${p.title}: ${label}` : label, p.version && GOOD.includes(state) && state !== 'verification-passed' ? p.version : '', rev].filter(Boolean).join(' · ');
  const line = missing.length ? `${head} · ${missing[0]}${missing.length > 1 ? ` (+${missing.length - 1} more)` : ''}` : head;
  const tone: BusinessStatus['tone'] = state === 'unknown' ? 'idle' : GOOD.includes(state) ? 'good' : state === 'changes-requested' || p.failing ? 'bad' : 'busy';
  return { state, label, about, ...(p.title ? { title: p.title } : {}), ...(p.revision ? { revision: p.revision } : {}), ...(p.revision && p.kind ? { revisionKind: p.kind } : {}), ...(p.version ? { version: p.version } : {}), missing, notes, line, tone };
}

/** Open work in words: "2 open tasks", "PR #6 open (checks failing)". */
function workLines(w: BusinessInput['work']): string[] {
  if (!w) return [];
  const out: string[] = [];
  if (w.open) out.push(`${w.open} open task${w.open === 1 ? '' : 's'}`);
  for (const p of w.openPrs.filter((x) => !x.draft).slice(0, 3)) out.push(`PR #${p.number} open, not merged${p.checks === 'fail' ? ' (checks failing)' : ''}`);
  return out;
}

/** Why a milestone isn't (all) in the running build, a line each. */
function notInLive(m: BusinessMilestone, running: boolean): string[] {
  const out: string[] = [];
  if (m.onMain?.length) out.push(`${rowsWord(m.onMain)} merged to main, not in the running build yet${running ? ' (its next update picks it up)' : ''}`);
  for (const b of m.onBranch ?? []) out.push(`${rowsWord(b.rows)} ${b.pr ? `in PR #${b.pr}, not merged` : `only on branch ${b.branch}`}`);
  if (m.missing?.length) out.push(`${rowsWord(m.missing)} not built`);
  return out;
}

/** What verification at `rev` still needs, and whether any evidence at all was there. */
function verification(i: BusinessInput, m: BusinessMilestone, rev: string): { missing: string[]; notes: string[]; evidence: boolean; failing: boolean } {
  const missing: string[] = [];
  const notes: string[] = [];
  const s = short(rev);
  let evidence = false;
  let failing = false;
  // Journeys against this very build (readiness keeps only results whose tested revision is the served one).
  if (!m.journeys.length) missing.push(`no journey evidence for ${s}`);
  else {
    const failed = m.journeys.filter((j) => j.result === 'failed').map((j) => j.id);
    const notRun = m.journeys.filter((j) => j.result === 'not-run').map((j) => j.id);
    if (m.journeys.some((j) => j.result !== 'not-run')) evidence = true;
    if (failed.length) ((failing = true), missing.push(`${failed.join(', ')} failed against ${s}`));
    if (notRun.length) missing.push(`${notRun.join(', ')} not run against ${s}`);
  }
  // The verification policy's required checks at this revision.
  const c = i.checks && same(i.checks.revision, rev) ? i.checks : undefined;
  if (!i.checks) missing.push(`required checks at ${s} not read`);
  else if (!c) missing.push(`required checks not evaluated at ${s}`);
  else {
    if (c.required.some((x) => x.state !== 'missing')) evidence = true;
    const failed = c.required.filter((x) => x.state === 'failed').map((x) => x.label);
    const none = c.required.filter((x) => x.state === 'missing' || x.state === 'skipped').map((x) => x.label);
    if (failed.length) ((failing = true), missing.push(`checks failed on ${s}: ${failed.join(', ')}`));
    if (none.length) missing.push(`no result on ${s} for ${none.join(', ')}`);
  }
  // The security baseline's release gate (E2) at this revision.
  const sec = i.security && same(i.security.revision, rev) ? i.security : undefined;
  if (!sec) missing.push(`security baseline not checked at ${s}`);
  else if (!sec.noApp && !sec.meets) {
    const words = sec.missing.length ? sec.missing.join('; ') : 'not met';
    if (sec.enforced) missing.push(`security baseline missing: ${words}`);
    else notes.push(`Security baseline (advisory) not met: ${words}`);
  }
  // Merged work without a review that counts (E5): never verified, whatever its checks say.
  if (!i.work) missing.push('review state not read');
  else for (const u of i.work.unreviewed.slice(0, 3)) missing.push(`unreviewed head: PR #${u.pr} merged without a review that counts`);
  if (i.work && i.work.unreviewed.length > 3) missing.push(`${i.work.unreviewed.length - 3} more merged PRs without a review that counts`);
  return { missing, notes, evidence, failing };
}

/** The business status of the project (or one milestone) from its records. Pure and deterministic. */
export function businessStatus(i: BusinessInput): BusinessStatus {
  const about = i.milestone ?? 'all';
  const notes: string[] = [];
  const acc = i.acceptance;
  const rec = acc?.accepted;
  // 1. An accepted delivery that hasn't changed since: accepted, then (by policy) reviewed, or deployed (recorded).
  if (acc && rec && !acc.changed.length) {
    const rev = rec.commit;
    const p = { revision: rev, kind: 'accepted' as const, version: acc.version };
    const at = rev ? ` ${short(rev)}` : '';
    if (!rev) notes.push('The acceptance record has no delivery commit');
    if (i.policy?.on) {
      const r = i.policy.review && same(i.policy.review.revision, rev) ? i.policy.review : undefined;
      if (r?.state === 'approved')
        return rec.deploy ? make('deployed-recorded', about, { ...p, notes: [...notes, `Deploy: ${rec.deploy}`] }) : make('release-approved', about, { ...p, notes, missing: [`no deployment recorded for${at}`] });
      if (r?.state === 'changes') return make('changes-requested', about, { ...p, notes, missing: [`the approver asked for changes on${at}`] });
      if (r?.state === 'submitted') return make('submitted', about, { ...p, notes, missing: [`waiting for the release review of${at}`] });
      return make('accepted', about, { ...p, notes, missing: [`not submitted for release review (the approval policy is on)`] });
    }
    if (rec.deploy) return make('deployed-recorded', about, { ...p, notes: [...notes, `Deploy: ${rec.deploy}`] });
    return make('accepted', about, { ...p, notes, missing: [`no deployment recorded for${at || ' it'}`] });
  }
  if (acc && rec) notes.push(`Changed since ${acc.version} acceptance: ${acc.changed.join('; ')}`);
  const version = acc?.version;
  // 2. The work as it runs now.
  const running = !!i.live?.running && !!i.live.served;
  const served = running ? i.live!.served! : undefined;
  if (served && i.main && !same(i.main.sha, served)) notes.push(`Main has moved on to ${short(i.main.sha)}; the live app picks it up on its next update`);
  const ms = i.readiness && served && same(i.readiness.sha, served) ? i.readiness.milestones : undefined;
  const m = ms?.find((x) => x.id === about);
  const title = m?.title;
  if (!served) {
    if (!i.main && !i.live) return make('unknown', about, { notes, missing: ["main's head couldn't be read and the live app hasn't run since the office started"] });
    const why = !i.live ? "the live app hasn't run since the office started: start it on the Live app tab to try the work" : "the live app isn't running: start it on the Live app tab to try the work";
    return make('work-in-progress', about, { title, revision: i.main?.sha, kind: 'main', version, notes, missing: [why, ...workLines(i.work)] });
  }
  if (!m) {
    if (ms && about !== 'all') return make('unknown', about, { revision: served, kind: 'served', version, notes, missing: [`no milestone ${about} in the build plan`] });
    const why = !i.readiness || (i.readiness.sha && !same(i.readiness.sha, served)) ? `what ${short(served)} has of the plan isn't worked out yet` : "no build plan with numbered BUILD rows, so the office can't tell which of the work is in it";
    return make('ready-to-try', about, { revision: served, kind: 'served', version, notes, missing: [why, ...workLines(i.work)] });
  }
  if (!BUILT.includes(m.state)) {
    const rest = [...notInLive(m, running), ...workLines(i.work)];
    if (m.inLive.length) return make('ready-to-try', about, { title, revision: served, kind: 'served', version, notes, missing: rest });
    return make('work-in-progress', about, { title, revision: i.main?.sha ?? served, kind: i.main ? 'main' : 'served', version, notes, missing: rest.length ? rest : [`none of ${rowsWord(m.rows)} is in the running build yet`] });
  }
  // 3. Built into the running build: what verified it there.
  const v = verification(i, m, served);
  notes.push(...v.notes);
  if (!v.missing.length) {
    const next = rec ? `${acc!.version} was accepted at ${short(rec.commit)}: reopen it and accept the next version for ${short(served)}` : `${version ? `${version} ` : ''}not accepted for ${short(served)} yet`;
    return make('verification-passed', about, { title, revision: served, kind: 'served', version, notes, missing: [next] });
  }
  return make(v.evidence ? 'verification-incomplete' : 'ready-for-review', about, { title, revision: served, kind: 'served', version, notes, missing: v.missing, failing: v.failing });
}

/** The status of the project and of each milestone of the plan, from one input. */
export function businessStatuses(i: BusinessInput): { project: BusinessStatus; milestones: BusinessStatus[] } {
  const project = businessStatusMemo({ ...i, milestone: 'all' });
  const milestones = (i.readiness?.milestones ?? []).filter((m) => m.id !== 'all').map((m) => businessStatusMemo({ ...i, milestone: m.id }));
  return { project, milestones };
}

const memo = new Map<string, BusinessStatus>();
const MEMO_MAX = 128;

/** businessStatus, kept per input (the same records give the same answer, so it's worked out once). */
export function businessStatusMemo(i: BusinessInput): BusinessStatus {
  const key = JSON.stringify(i);
  const hit = memo.get(key);
  if (hit) return hit;
  const out = businessStatus(i);
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(key, out);
  return out;
}

/** What a page or a card shows of it: the line, the tone, and what's missing. */
export interface BusinessSummary {
  state: BusinessState;
  label: string;
  line: string;
  tone: BusinessStatus['tone'];
  revision?: string;
  missing: string[];
}

export const summaryOf = (s: BusinessStatus): BusinessSummary => ({ state: s.state, label: s.label, line: s.line, tone: s.tone, ...(s.revision ? { revision: s.revision } : {}), missing: s.missing.slice(0, 5) });

/** GET /api/business-status's answer. */
export interface BusinessStatusView {
  floor: string;
  project: BusinessStatus;
  milestones: BusinessStatus[];
  generatedAt: number;
}

/** A short chip of it for a card (Home's project rows, the phone): "Verification incomplete · abc1234", with the full line and what's missing as its title. */
export function businessChip(s: Pick<BusinessSummary, 'label' | 'line' | 'tone' | 'revision' | 'missing'>): { text: string; title: string; tone: BusinessStatus['tone'] } {
  return { text: `${s.label}${s.revision ? ` · ${short(s.revision)}` : ''}`, title: [s.line, ...s.missing.slice(1).map((m) => `· ${m}`)].join('\n'), tone: s.tone };
}
