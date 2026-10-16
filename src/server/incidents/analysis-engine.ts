// What drafts an incident's analysis (analysis.ts): one capped `claude -p` call through the planner's
// helper (wizard/planner/cli.ts: an answer that fits a JSON schema, no tools, no settings, hooks, MCP
// servers or session, an empty temporary folder, `--max-budget-usd`, refused in test mode), or the test
// analyser, which builds the same answer from the evidence alone, deterministically and without any CLI
// (test mode and the docs screenshots). The analyser (analysis.ts) applies the caps around either.

import { ANALYSIS_SCHEMA, cleanAnalysis, type AnalysisResult } from '../../shared/incident-analysis.js';
import { runPlannerCall, type CliRunner } from '../wizard/planner/cli.js';
import type { AnalysisFacts } from './analysis-input.js';

export interface AnalysisAnswer {
  value: AnalysisResult | null;
  cost: number;
  error?: string;
}

export interface AnalysisEngine {
  kind: 'cli' | 'fake';
  /** The model as it's shown ("test analyser" for the fake). */
  model: string;
  /** Why it can't run now, or undefined when it can. */
  why(): string | undefined;
  analyse(req: { facts: AnalysisFacts; input: string; budgetUsd: number }): Promise<AnalysisAnswer>;
}

export const ANALYSIS_SYSTEM = [
  'You are Mx Office, analysing an incident in an office where AI agent teams build Mendix apps.',
  'You are given only the incident record, the audit events it links and audit events from around when it happened, as JSON, plus an optional note from the person who resolved it.',
  'Write a short root cause analysis from that evidence alone: the most likely root cause, its impact (who or what was affected and for how long) and 1 to 5 corrective actions, each a fix, a way to prevent it, or a way to detect it sooner.',
  'Be honest about certainty. Word the root cause as likely, never as proven. Use confidence "high" only when the records show the cause directly, "medium" when they point to it, "low" when it is a guess.',
  'In rootCause.evidence name the records that support it (the detection rule, audit event ids with their action, timeline entries). In unknowns list what the evidence cannot tell.',
  'If the person already wrote a root cause (personRootCause) or a note, take it into account and say where the evidence agrees or not. Never invent events, people or numbers that are not in the records.',
].join('\n');

/** The real call. `claude` is the CLI's path (none: unavailable). */
export function cliAnalysisEngine(o: { claude: string | null; env: Record<string, string>; model: string; timeoutMs: number; run?: CliRunner }): AnalysisEngine {
  return {
    kind: 'cli',
    model: o.model,
    why: () => (o.claude ? undefined : 'The office can’t find the claude CLI on its machine'),
    async analyse(req) {
      const r = await runPlannerCall(o.claude!, o.env, { model: o.model, system: ANALYSIS_SYSTEM, input: `The incident, as JSON:\n\n${req.input}`, schema: ANALYSIS_SCHEMA, timeoutMs: o.timeoutMs, budgetUsd: req.budgetUsd, who: 'The analysis' }, o.run);
      const value = r.value ? cleanAnalysis(r.value) : undefined;
      return value ? { value, cost: r.cost } : { value: null, cost: r.cost, error: r.error ?? 'The analysis came back without a root cause or corrective actions' };
    },
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const span = (ms: number) => (ms < 60_000 ? 'under a minute' : ms < 90_000 ? 'about a minute' : ms < 90 * 60_000 ? `about ${Math.round(ms / 60_000)} minutes` : ms < 36 * 3_600_000 ? `about ${Math.round(ms / 3_600_000)} hours` : `about ${Math.round(ms / 86_400_000)} days`);

/** A rule's usual way to prevent it, for the test analyser. */
const PREVENT: Record<string, string> = {
  realLaunch: 'Keep test offices on the fake agent and refuse real agent CLIs there',
  spendSpike: 'Set or lower the project’s budget level and daily cap so a runaway turn stops sooner',
  spendCap: 'Review the daily spend cap against the project’s plan',
  interrupted: 'Pause the project before restarting the office so no turn is cut off',
  escalationUndelivered: 'Check that answered escalations reach their agent',
  crashLoop: 'Look at the worker’s exit output and fix what makes it exit',
  studioDenied: 'Agree with the team when Studio Pro is open so agents don’t write meanwhile',
  flowFailed: 'Fix the failing gate-check or workflow step before it runs again',
  sweepErrors: 'Close what holds the worktree folders open so the cleanup can remove them',
  loginFailed: 'Check who is signing in and whether the password needs changing',
  pageStall: 'Profile the view that froze and move its heavy work off the page’s main thread',
  serverStall: 'Find the blocking call in the office server and move it off the event loop',
  storeUnreadable: 'Find what holds the data file (a virus scanner, the search indexer, a sync tool) and exclude the office’s data folder from it',
};

/**
 * The test analyser: the same answer, built only from the facts, the same way every time. Low confidence
 * unless the rule and linked events both point at it (then medium); never high: it reads, it doesn't know.
 */
export function fakeAnalysisEngine(): AnalysisEngine {
  return {
    kind: 'fake',
    model: 'test analyser',
    why: () => undefined,
    async analyse({ facts }) {
      const i = facts.incident;
      const rule = i.rule;
      const evidence = [
        ...(rule ? [`Detection rule: ${rule.label} (${i.occurrences}×)`] : [`Opened by ${i.detectedBy}`]),
        ...facts.linked.slice(0, 4).map((e) => `Audit event ${e.id.slice(-8)}: ${e.action}`),
        ...(facts.nearby.length ? [`${plural(facts.nearby.length, 'audit event')} around ${i.detectedAt.slice(11, 16)} UTC`] : []),
        ...(facts.note ? ['The person’s note'] : []),
      ];
      const confidence = rule && facts.linked.length >= 1 ? 'medium' : 'low';
      const what = i.summary || i.title;
      const cause = `${rule ? `Most likely what the “${rule.label}” rule detected: ${what}` : `Most likely: ${what}`}${facts.note ? `. The person noted: “${facts.note.slice(0, 200)}”` : ''}. This is drawn from the incident’s own records only; check it.`;
      const lasted = Date.parse(i.resolvedAt ?? i.lastSeenAt) - Date.parse(i.detectedAt);
      const who = [i.floors.length ? `the project${i.floors.length === 1 ? '' : 's'} ${i.floors.join(', ')}` : 'the office as a whole', i.agents.length ? plural(i.agents.length, 'agent') + ` (${i.agents.slice(0, 5).join(', ')})` : ''].filter(Boolean).join(' and ');
      const impact = [i.impact.spendUsd !== undefined ? `$${i.impact.spendUsd.toFixed(2)} spent` : '', i.impact.data ? `data: ${i.impact.data}` : '', `seen ${plural(i.occurrences, 'time')}`].filter(Boolean).join(', ');
      return {
        cost: 0,
        value: {
          rootCause: { text: cause, confidence, evidence },
          impact: { text: `${impact[0].toUpperCase()}${impact.slice(1)}.`, scope: `${who}, for ${span(Math.max(0, lasted))} from detection to ${i.resolvedAt ? 'resolution' : 'last sighting'}` },
          correctiveActions: [
            { action: `Confirm the cause above against the linked events and fix it`, kind: 'fix' },
            { action: (rule && PREVENT[rule.id]) || 'Write down what would have stopped it and add it to the team’s Playbook', kind: 'prevent' },
            { action: rule ? `Keep the “${rule.label}” detection rule on and review its threshold` : 'Add a detection rule or an alert for this kind of failure', kind: 'detect' },
          ],
          unknowns: [
            ...(facts.linked.length ? [] : ['No audit events are linked to it, so what happened just before is inferred from the time window only']),
            'Whether anything outside the office’s own records (the app, GitHub, the machine) was affected',
            'The exact trigger: the test analyser only reads the incident’s record and nearby audit events',
          ],
        },
      };
    },
  };
}
