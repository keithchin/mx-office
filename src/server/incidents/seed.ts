// The incidents of 2026-10-06, recorded retrospectively: the office applies them once, on the first start
// that has an incidents store and no incidents file yet, and only in an office that was already running
// that day (its audit log has events from then), so a new office starts with an empty list.
// AGENT_OFFICE_SEED_INCIDENTS=0 skips it, =1 applies it whatever the audit log says. Times are the
// office's local time (Singapore, UTC+8) as the builders reported them, so approximate.

import type { CorrectiveAction, IncidentImpact, IncidentSeverity, IncidentStatus } from '../../shared/incidents.js';
import { createIncident, incidentStore } from './index.js';

const DAY_START = Date.parse('2026-10-06T00:00:00+08:00');
const DAY_END = Date.parse('2026-10-07T00:00:00+08:00');

/** Whether an audit event's time falls on 2026-10-06 (the office's local day). */
export const onSeedDay = (t: number) => t >= DAY_START && t < DAY_END;
const at = (hhmm: string) => Date.parse(`2026-10-06T${hhmm}:00+08:00`);

interface Seed {
  at: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  summary: string;
  impact: IncidentImpact;
  rootCause: string;
  actions: Omit<CorrectiveAction, 'id'>[];
  notes?: [string, string][];
}

const SAFE_MODE: Omit<CorrectiveAction, 'id'> = { text: 'Test-office safe mode: a fake --agent is honoured for Claude workers whatever its file name, and test mode refuses to start any real agent CLI', status: 'open', link: { kind: 'commit', ref: 'feat/incidents' } };
const FAKE_NAME_CAUSE = 'The office only honoured an agent override (--agent / AGENT_OFFICE_AGENT) for Claude workers when the file was named "claude"; a fake named anything else (fake-agent.cmd) was ignored and the real claude on PATH started instead.';

export const SEED_INCIDENTS: Seed[] = [
  {
    at: at('16:50'),
    title: 'Team-phone test office started 5 real Claude sessions',
    severity: 'near-miss',
    status: 'mitigated',
    summary: 'A developer test office for the team phone (fix/command-center-polish) started 5 real Claude Code sessions instead of its fake agent. They stopped at the folder trust prompt, so nothing ran.',
    impact: { agents: 5, spendUsd: 0, data: 'None: the sessions never got past the trust prompt' },
    rootCause: FAKE_NAME_CAUSE,
    actions: [SAFE_MODE],
  },
  {
    at: at('17:20'),
    title: 'Developer test office launched 4 real Claude Code sessions',
    severity: 'sev2',
    status: 'mitigated',
    summary: 'A developer test office used to test subagents as workers (scratch\\test-offices\\subagents\\…) launched 4 real Claude Code sessions (Sonnet), which worked for about 2–3 minutes before they were stopped.',
    impact: { agents: 4, data: 'Throwaway worktrees under scratch\\test-offices\\subagents only', text: 'Some API spend (4 Sonnet sessions for 2–3 minutes)' },
    rootCause: FAKE_NAME_CAUSE,
    actions: [
      SAFE_MODE,
      { text: 'Warn builders: until safe mode ships, a fake must be named claude.cmd and be first on PATH', status: 'done' },
      { text: 'Delete the leftover folders scratch\\test-offices\\subagents\\travel-desk and run2 (the builder’s delete was blocked by a safety check, so this is for a person)', status: 'open' },
    ],
    notes: [['17:20', 'Four real Claude sessions start in the test office'], ['17:23', 'Sessions stopped; office shut down']],
  },
  {
    at: at('17:40'),
    title: 'Resume-pause test office started 3 real claude.exe sessions',
    severity: 'near-miss',
    status: 'mitigated',
    summary: 'The resume-pause test office (scratch\\test-offices\\resume-pause) launched 3 real claude.exe sessions on its first start, because its fake was named fake-agent.cmd. They sat on Claude’s first-run theme screen under a scratch USERPROFILE with no login and were killed within minutes.',
    impact: { agents: 3, spendUsd: 0, data: 'None: no login, no spend expected' },
    rootCause: FAKE_NAME_CAUSE,
    actions: [SAFE_MODE],
  },
  {
    at: at('12:00'),
    title: 'Release restarts interrupted workers mid-turn (releases 5–11)',
    severity: 'sev3',
    status: 'open',
    summary: 'Each release restart that day (releases 5 to 11) stopped the office while workers were in the middle of a turn, interrupting them; they carried on from the restart prompt.',
    impact: { text: 'Workers interrupted mid-turn at every release restart; work resumed after' },
    rootCause: 'There was no safe restart: a release stops the office whatever its workers are doing.',
    actions: [{ text: 'Safe restart: wait for turns to end (or pause workers) before a release restarts the office', status: 'open', link: { kind: 'commit', ref: 'resume-pause' } }],
  },
  {
    at: at('13:00'),
    title: 'CHANGELOG entries landed under already-published releases',
    severity: 'sev3',
    status: 'resolved',
    summary: 'When long-lived branches were merged, their CHANGELOG bullets ended up under releases already published (release 6 and release 8) rather than under Unreleased; they were moved.',
    impact: { text: 'Release notes briefly wrong for releases 6 and 8' },
    rootCause: 'The merge placed the branches’ bullets in the old sections they were written against.',
    actions: [
      { text: 'Check where CHANGELOG bullets land on every merge', status: 'done' },
      { text: 'Consider an automated check that published releases’ sections don’t change', status: 'open' },
    ],
  },
  {
    at: at('14:00'),
    title: 'Setup panel showed Stage 0 FAIL from a stale checkout',
    severity: 'sev3',
    status: 'resolved',
    summary: 'The travel-approval floor’s setup panel showed Stage 0 as FAIL because it read the floor’s checkout, 23 commits behind its default branch.',
    impact: { text: 'A false FAIL on the travel-approval setup panel' },
    rootCause: 'The setup panel read the floor’s working folder, not the default branch.',
    actions: [{ text: 'The setup panel reads origin/main (release 7)', status: 'done' }],
  },
];

/** Whether this office should get the seed: its audit log has events from 2026-10-06 (or the environment says so). */
export function wantsSeed(auditTimes: Iterable<number>): boolean {
  const env = process.env.AGENT_OFFICE_SEED_INCIDENTS;
  if (env === '0') return false;
  if (env === '1') return true;
  for (const t of auditTimes) if (onSeedDay(t)) return true;
  return false;
}

/** Applies the seed once: only when there's a store and it has no incidents at all. How many it added. */
export function applySeed(): number {
  const store = incidentStore();
  if (!store || store.exists() || store.list().length) return 0;
  const actor = { kind: 'office' as const, name: 'Recorded retrospectively' };
  for (const s of [...SEED_INCIDENTS].sort((a, b) => a.at - b.at)) {
    const timeline = [{ at: s.at, by: 'Recorded retrospectively', text: 'Recorded retrospectively, from the builders’ reports', kind: 'detected' as const }, ...(s.notes ?? []).map(([t, text]) => ({ at: at(t), by: 'Recorded retrospectively', text, kind: 'note' as const }))];
    createIncident(
      {
        title: s.title,
        severity: s.severity,
        status: s.status,
        summary: s.summary,
        impact: s.impact,
        rootCause: s.rootCause,
        actions: s.actions.map((a, n) => ({ ...a, id: `a${n + 1}` })),
        detectedAt: s.at,
        detectedBy: { kind: 'person', name: 'Builders (retrospective)' },
        retrospective: true,
        timeline,
      },
      actor,
      'seed',
    );
  }
  return SEED_INCIDENTS.length;
}
