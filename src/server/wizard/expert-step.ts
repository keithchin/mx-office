// Expert mode's setup (ProjectPlan.mode 'expert', shared/expert-setup.ts), as steps wrapped round the setup's own
// (like team-server-step.ts and local-only.ts). The same create and connect steps as Team mode run: the Team Server
// app, the clone, the Mendix app, the toolkit's init at its pin, the hooks, the commit and the push. What differs:
//   clone     the new project is marked Expert mode on the office the moment it's there (no team round it, ever).
//   env       MXCLI_VERSION in .claude/toolkit.env is the picked mxcli version (the office's release by default).
//   init      the toolkit is pinned at the picked commit (the newest one by default, as for Team mode).
//   intake    the brief, if any, goes to docs/project-brief.md for the session to read; no intake answers.
//   settings  the session's model, demo users and the mxcli pin in agent-office.project.json; the budget set
//             (total, alert at 80 %, auto-pause at 100 %), with no team level.
//   decisions, gates, issue, team, queue: skipped (no register rows, no gates UI, no Discovery, no team).
// The office never types into the session: the brief is a file, the model is a start flag (expert/settings.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StepId } from '../../shared/wizard.js';
import { EXPERT_BRIEF_FILE, LATEST, isExpertPlan, type ExpertPlan } from '../../shared/expert-setup.js';
import type { JobState, StepImpl, StepIO, StepResult } from './job.js';
import { PROJECT_FILE } from '../toolkit-pin/record.js';
import { withRules } from './local-only.js';
import { SESSION_BRANCH } from '../../shared/expert-proof.js';

export interface ExpertStepDeps {
  /** Marks the floor Expert mode, titled as typed (Building.setMode); why not, if it couldn't. */
  setMode(floorId: string, title?: string): string | undefined;
  /** Sets the project's budget: the total, alert at 80 %, auto-pause at 100 % (expert/budget.ts). */
  setBudget(floorId: string, totalUsd: number, by: string): string | undefined;
  /** A pin folder for a toolkit commit (toolkit-pin/pins.ts ensurePin), with the commit's date. */
  pinToolkit(sha: string): Promise<{ sha: string; dir: string; date?: string }>;
  /** The mxcli release the office runs ('latest'), if it can tell. */
  mxcliLatest(): Promise<string | undefined>;
}

const skip = (detail: string): StepResult => ({ status: 'skipped', detail });
const expertOf = (job: JobState): ExpertPlan => job.plan.expert!;

/** The brief's file: the paragraph as typed, under the project's title. */
export function briefMarkdown(title: string, brief: string): string {
  return `# ${title || 'Project brief'}\n\n${brief}\n\n_Written in the Expert wizard of Mx Office. The office never sends it to the session: ask the session to read it, or just start talking._\n`;
}

/** toolkit.env's text with MXCLI_VERSION set to `version`. */
export function withMxcliVersion(text: string, version: string): string {
  const body = text.replace(/\r/g, '').replace(/\n+$/, '');
  const lines = body ? body.split('\n') : [];
  const i = lines.findIndex((l) => l.startsWith('MXCLI_VERSION='));
  if (i >= 0) lines[i] = `MXCLI_VERSION=${version}`;
  else lines.push(`MXCLI_VERSION=${version}`);
  return `${lines.join('\n')}\n`;
}

const RULES_BEGIN = '<!-- agent-office:local-only -->';
const RULES_END = '<!-- /agent-office:local-only -->';

/** The local-only rule in an Expert project's CLAUDE.md (in place of the Team wording: no Leads, no merges by hand). */
export function expertLocalOnlyRules(teamServer: boolean): string {
  return [
    RULES_BEGIN,
    teamServer ? '## Not on GitHub: the code goes to Mendix Team Server' : '## Local only: this project is not on GitHub',
    '',
    `It was created in Mx Office in Expert mode${teamServer ? ', on Mendix Team Server without a GitHub mirror' : ''}.`,
    '',
    '- Never push to GitHub, never add a GitHub remote, and never run `gh` commands that publish anything (`gh repo create`, `gh issue create`, `gh pr create`, `gh release`, `gh gist`).',
    `- Work on \`${SESSION_BRANCH}\`. The office commits and pushes it in the background${teamServer ? ' to Team Server' : ''}; you don't need to push.`,
    '- Merging to main happens at Lock in, when the user chooses it. Don’t merge to main yourself.',
    RULES_END,
  ].join('\n');
}

export function withExpert(deps: ExpertStepDeps, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const { clone, env, init, intake, settings } = steps;
  const only = (job: JobState) => isExpertPlan(job.plan) && !!job.plan.expert;
  const markExpert = (job: JobState) => {
    if (!job.floor) return undefined;
    return deps.setMode(job.floor, job.plan.expert?.title);
  };
  return {
    ...steps,
    async clone(job, io) {
      const r = await clone(job, io);
      if (!only(job)) return r;
      const err = markExpert(job);
      if (err) throw new Error(`Couldn't mark the project Expert mode: ${err}`);
      return { ...r, detail: [r.detail, 'Expert mode'].filter(Boolean).join(' · ') };
    },

    async env(job, io) {
      const r = await env(job, io);
      if (!only(job) || !job.dir) return r;
      const x = expertOf(job);
      if (x.mxcli === LATEST) {
        const v = await deps.mxcliLatest().catch(() => undefined);
        if (!v) return { ...r, detail: [r.detail, 'mxcli: the office has none to pin yet (the toolkit installs its own)'].filter(Boolean).join(' · ') };
        x.mxcli = v;
        io.save?.();
      }
      const f = path.join(job.dir, '.claude', 'toolkit.env');
      const before = existsSync(f) ? readFileSync(f, 'utf8') : '';
      const after = withMxcliVersion(before, x.mxcli);
      if (after !== before) {
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, after);
      }
      return { status: after !== before || r.status === 'done' ? 'done' : r.status, detail: [r.detail, `mxcli ${x.mxcli}`].filter(Boolean).join(' · ') };
    },

    async init(job, io) {
      if (only(job) && !job.toolkit && expertOf(job).toolkit !== LATEST) {
        const sha = expertOf(job).toolkit;
        job.toolkit = await deps.pinToolkit(sha).catch((err: Error) => {
          throw new Error(`Couldn't pin the toolkit at ${sha.slice(0, 7)}: ${err.message}`);
        });
        io.save?.();
      }
      return init(job, io);
    },

    async intake(job, io) {
      if (!only(job)) return intake(job, io);
      const x = expertOf(job);
      if (!x.brief) return skip('no brief: the session asks what it needs');
      if (!job.dir) throw new Error("The project isn't there yet: Retry from the clone step");
      const f = path.join(job.dir, ...EXPERT_BRIEF_FILE.split('/'));
      const body = briefMarkdown(x.title || job.plan.name, x.brief);
      if (existsSync(f) && readFileSync(f, 'utf8') === body) return skip(`already in ${EXPERT_BRIEF_FILE}`);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, body);
      return { status: 'done', detail: `brief saved to ${EXPERT_BRIEF_FILE} for the session to read` };
    },

    async decisions(job, io) {
      return only(job) ? skip('Expert mode: no register rows from the wizard') : steps.decisions(job, io);
    },

    async settings(job, io) {
      const r = await settings(job, io);
      if (!only(job) || !job.dir) return r;
      const x = expertOf(job);
      const f = path.join(job.dir, PROJECT_FILE);
      let saved: Record<string, unknown> = {};
      try {
        saved = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      } catch {
        // the inner settings step writes it; a missing one is made here
      }
      const record = { model: x.model, demoUsers: x.demoUsers, ...(x.mxcli !== LATEST ? { mxcli: x.mxcli } : {}), ...(x.title ? { title: x.title } : {}) };
      const next = { ...saved, mode: 'expert', expert: record };
      const did: string[] = [];
      // The local-only rule in Expert words (the inner step wrote the Team wording: Leads, merges by hand).
      if (job.plan.localOnly) {
        const claude = path.join(job.dir, 'CLAUDE.md');
        const before = existsSync(claude) ? readFileSync(claude, 'utf8') : '';
        const after = withRules(before, expertLocalOnlyRules(!!job.plan.teamServer));
        if (after !== before) {
          writeFileSync(claude, after);
          did.push('CLAUDE.md: Expert rule');
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(saved)) {
        writeFileSync(f, `${JSON.stringify(next, null, 2)}\n`);
        did.push(`${x.model === 'opus' ? 'Opus' : 'Sonnet'}, demo users ${x.demoUsers ? 'on locally' : 'off'}`);
      }
      if (job.floor && !job.budgetApplied) {
        const err = deps.setBudget(job.floor, x.budget, job.by);
        if (err) throw new Error(`Couldn't set the budget: ${err}`);
        job.budgetApplied = true;
        io.save?.();
        did.push(`budget $${x.budget}, pauses at 100 %`);
      }
      return did.length ? { status: 'done', detail: [r.detail, ...did].filter(Boolean).join(' · ') } : r;
    },

    async gates(job, io) {
      return only(job) ? skip('Expert mode: no gates UI (the toolkit’s gate-check runs when the session asks for it)') : steps.gates(job, io);
    },
    async issue(job, io) {
      return only(job) ? skip('Expert mode: no Discovery issue') : steps.issue(job, io);
    },
    async team(job, io) {
      if (!only(job)) return steps.team(job, io);
      // A Retry after the clone step's mark failed to save: marked here at the latest.
      const err = markExpert(job);
      if (err) throw new Error(`Couldn't mark the project Expert mode: ${err}`);
      return skip('Expert mode: no team is hired; the session opens in the project folder');
    },
    async queue(job, io) {
      return only(job) ? skip('Expert mode: nothing is queued') : steps.queue(job, io);
    },
  };
}
