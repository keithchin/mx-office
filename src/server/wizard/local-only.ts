// "Keep this project off GitHub" (ProjectPlan.localOnly) in the setup. The repository is a bare git
// repository on this machine (`<projects home>/.local-git/<owner>/<name>.git`, made by the repo step) and
// the project is cloned from it, so `git push origin` and the worktrees' `origin/main` work as before
// without anything leaving the machine. This module adds what differs: the settings step records
// `"localOnly": true` in agent-office.project.json and puts the project's rule in its CLAUDE.md; the
// Discovery brief is a file in the project (docs/discovery-brief.md, written before the commit) instead of
// a GitHub issue, and the team step or the queue hands that file on. Nothing here runs gh.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { StepId } from '../../shared/wizard.js';
import type { JobState, StepImpl } from './job.js';
import type { SetupDeps } from './steps.js';
import { DISCOVERY_TITLE, discoveryBrief, discoveryPrompt } from './brief.js';
import { forgetLocalOnly } from '../local-only.js';

/** The Discovery brief's file in a local-only project. */
export const DISCOVERY_FILE = 'docs/discovery-brief.md';

/** Where a local-only project's bare repository is: in the projects home, out of the way. */
export const localBareOf = (projectsDir: string, owner: string, name: string) => path.join(projectsDir, '.local-git', owner, `${name}.git`);

const BEGIN = '<!-- agent-office:local-only -->';
const END = '<!-- /agent-office:local-only -->';

/** The rule a local-only project's agents read in its CLAUDE.md. */
export function localOnlyRules(bare: string): string {
  return [
    BEGIN,
    '## Local only: this project is not on GitHub',
    '',
    'It was created in Mx Office with "Keep this project off GitHub": its analysis quotes confidential client source code.',
    '',
    `- Never push to GitHub, never add a GitHub remote, and never run \`gh\` commands that publish anything (\`gh repo create\`, \`gh issue create\`, \`gh pr create\`, \`gh release\`, \`gh gist\`).`,
    `- \`origin\` is a bare git repository on this machine (\`${bare.replace(/\\/g, '/')}\`): pushing your branch there is fine, it never leaves the machine.`,
    '- Work on a local branch. Where your Playbook says to open a pull request, commit, push the branch to origin and tell the Lead it is ready; the Lead merges it into main locally (`git merge --no-ff`) and pushes main to origin.',
    `- The Discovery brief is \`${DISCOVERY_FILE}\`, not a GitHub issue. PR checks, GitHub issues and pull requests are unavailable here.`,
    END,
  ].join('\n');
}

/** CLAUDE.md with the rule in it, once (replaced in place on a later run). */
export function withRules(md: string, rules: string): string {
  const at = md.indexOf(BEGIN);
  const end = md.indexOf(END);
  if (at >= 0 && end > at) return `${md.slice(0, at)}${rules}${md.slice(end + END.length)}`;
  return `${md.replace(/\s*$/, '')}\n\n${rules}\n`;
}

/** The Discovery task the team step or the queue hands on: the GitHub issue, or a local-only project's file. */
export function discoveryTask(job: Pick<JobState, 'issue' | 'discoveryFile' | 'dir' | 'plan'>): { prompt: string; title: string; issue?: number } | undefined {
  if (job.discoveryFile) {
    const abs = job.dir ? `${job.dir.replace(/\\/g, '/').replace(/\/+$/, '')}/${job.discoveryFile}` : job.discoveryFile;
    return { prompt: `Work on the Discovery brief in this repo: read \`${job.discoveryFile}\` (in the project's main checkout: ${abs}) and follow it exactly. This project is local only: there is no GitHub issue, and nothing is pushed to GitHub.`, title: `Discovery (${job.discoveryFile}, ${job.plan.discovery.model})` };
  }
  if (job.issue) return { prompt: discoveryPrompt(job.issue), title: `Discovery #${job.issue} (${job.plan.discovery.model})`, issue: job.issue };
  return undefined;
}

export function withLocalOnly(deps: SetupDeps, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const { settings, issue } = steps;
  return {
    ...steps,
    async settings(job, io) {
      const r = await settings(job, io);
      if (!job.plan.localOnly || !job.dir) return r;
      const did: string[] = [];
      // Recorded in the project file (the Overview shows it, github.ts refuses GitHub calls for it).
      const f = path.join(job.dir, 'agent-office.project.json');
      const saved = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      if (saved.localOnly !== true) {
        writeFileSync(f, `${JSON.stringify({ ...saved, localOnly: true }, null, 2)}\n`);
        forgetLocalOnly();
        did.push('local only recorded');
      }
      // The project's rule, where every agent reads it.
      const claude = path.join(job.dir, 'CLAUDE.md');
      const before = existsSync(claude) ? readFileSync(claude, 'utf8') : '';
      const after = withRules(before, localOnlyRules(localBareOf(deps.projectsDir(), job.plan.owner, job.plan.name)));
      if (after !== before) {
        writeFileSync(claude, after);
        did.push('CLAUDE.md: never push to GitHub');
      }
      // The Discovery brief as a file, committed with the scaffold (the commit step runs after this).
      if (job.plan.discovery.issue) {
        const body = `# ${DISCOVERY_TITLE}\n\n${discoveryBrief(job.plan, job.toolkit?.dir ?? deps.cfg.toolkitDir, job.toolkit?.sha, job.dir)}\n`;
        const at = path.join(job.dir, ...DISCOVERY_FILE.split('/'));
        if (!existsSync(at) || readFileSync(at, 'utf8') !== body) {
          mkdirSync(path.dirname(at), { recursive: true });
          writeFileSync(at, body);
          did.push(DISCOVERY_FILE);
        }
      }
      if (!did.length) return r;
      return { status: 'done', detail: [r.detail, ...did].filter(Boolean).join(' · ') };
    },
    async issue(job, io) {
      if (!job.plan.localOnly) return issue(job, io);
      if (!job.plan.discovery.issue) return { status: 'skipped', detail: 'not asked for' };
      if (!job.dir || !existsSync(path.join(job.dir, ...DISCOVERY_FILE.split('/')))) throw new Error(`${DISCOVERY_FILE} isn't in the project: Retry from the settings step`);
      job.discoveryFile = DISCOVERY_FILE;
      return { status: 'done', detail: `local only: no GitHub issue; the Discovery brief is ${DISCOVERY_FILE}` };
    },
  };
}
