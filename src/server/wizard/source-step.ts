// A plan's source folder (ProjectPlan.sourceFolder, shared/source-folder.ts) at setup: after the intake step
// has written the brief and copied the attachments, the folder is imported as the project's snapshot in
// sources/legacy/<name>/ with its manifest beside it, sources/legacy/<name>.manifest.json (paths, sizes,
// sha256), off the event loop (wizard/source-snapshot.ts: a fresh copy every time, checked, then swapped in;
// dependencies, build output, secrets-like and large files left out). A Retry imports the folder again as
// it is now, so an edit or a deleted file is never missed. sources/ is git-ignored (init-project.sh
// --ignore-sources), so the snapshot never reaches a commit or a push; an existing project without that
// rule gets /sources/legacy/ added. It is stored on this machine, but it isn't kept from the hosted model:
// the team's agents read it and send what they read to Claude (through its API) to work on it. A plan
// without a source folder runs the intake step exactly as before.

import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StepId } from '../../shared/wizard.js';
import { bytesText, legacyRel, summaryText } from '../../shared/source-folder.js';
import type { StepImpl } from './job.js';
import { copySourceFolder } from './source-snapshot.js';

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
      if (!(await stat(src.path).then((s) => s.isDirectory(), () => false))) throw new Error(`The source folder ${src.path} isn't there any more: put it back (or start again without it), then Retry`);
      const ignore = path.join(job.dir, '.gitignore');
      const had = await readFile(ignore, 'utf8').catch(() => '');
      if (!ignoresSources(had)) await writeFile(ignore, `${had.replace(/\s*$/, '')}${had ? '\n' : ''}# Legacy source imported by the agent-office new-project wizard: confidential, kept on this machine, never committed\n/sources/legacy/\n`);
      const rel = legacyRel(src.name);
      io.log(`  importing the source folder into ${rel}/ (stored on this machine and git-ignored, never pushed to GitHub)…`);
      const c = await copySourceFolder(src.path, path.join(job.dir, ...rel.split('/')), undefined, {
        name: src.name,
        onNote: (line) => io.log(`  ${line}`),
        onProgress: (p) => io.log(`  ${p.phase === 'copying' ? 'copied' : 'checked'} ${p.files.toLocaleString('en-US')} of ${p.totalFiles.toLocaleString('en-US')} files (${bytesText(p.bytes)} of ${bytesText(p.totalBytes)})`),
      });
      const said = `${rel}/: ${summaryText(c)}, manifest ${rel}.manifest.json (sha256 ${c.manifest.sha256.slice(0, 12)})${c.replaced ? ', replacing the earlier snapshot' : ''}`;
      return { status: 'done', detail: [r.detail, said].filter(Boolean).join(' · ') };
    },
  };
}
