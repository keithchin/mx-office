// A plan's source folder (ProjectPlan.sourceFolder, shared/source-folder.ts) at setup: after the intake step
// has written the brief and copied the attachments, the folder is copied into the project's
// sources/legacy/<name>/ off the event loop (wizard/source-folder.ts: dependencies, build output, secrets-like
// and large files left out). sources/ is git-ignored (init-project.sh --ignore-sources), so the copy never
// reaches a commit or a push; an existing project without that rule gets /sources/legacy/ added. A plan
// without a source folder runs the intake step exactly as before.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StepId } from '../../shared/wizard.js';
import { legacyRel, summaryText } from '../../shared/source-folder.js';
import type { StepImpl } from './job.js';
import { copySourceFolder } from './source-folder.js';

/** Whether .gitignore already keeps sources/ (or sources/legacy/) out of git. */
export const ignoresSources = (gitignore: string) => /^\/?sources(\/(legacy\/?)?)?\s*$/m.test(gitignore.replace(/\r/g, ''));

export function withSourceFolder(steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const intake = steps.intake;
  return {
    ...steps,
    async intake(job, io) {
      const r = await intake(job, io);
      const src = job.plan.sourceFolder;
      if (!src || !job.dir) return r;
      if (!existsSync(src.path)) throw new Error(`The source folder ${src.path} isn't there any more: put it back (or start again without it), then Retry`);
      const ignore = path.join(job.dir, '.gitignore');
      const had = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
      if (!ignoresSources(had)) writeFileSync(ignore, `${had.replace(/\s*$/, '')}${had ? '\n' : ''}# Legacy source copied by the agent-office new-project wizard: confidential, never committed\n/sources/legacy/\n`);
      const rel = legacyRel(src.name);
      io.log(`  copying the source folder into ${rel}/ (on this machine only; nothing is uploaded)…`);
      const c = await copySourceFolder(src.path, path.join(job.dir, ...rel.split('/')));
      const said = `${rel}/: ${summaryText(c)}${c.kept ? ` (${c.kept} already there)` : ''}`;
      return { status: 'done', detail: [r.detail, said].filter(Boolean).join(' · ') };
    },
  };
}
