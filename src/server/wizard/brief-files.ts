// The project brief's files in a new project (setup step "intake"): docs/project-brief.md, committed with
// the project, and the attached documents copied into sources/, the toolkit's drop folder for input
// documents (git-ignored by default by init-project.sh, so client documents stay on the office's machine).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { briefMarkdown } from '../../shared/brief-map.js';
import { ENTRY_MODE_INFO, type ProjectPlan } from '../../shared/wizard.js';

export const BRIEF_FILE = 'docs/project-brief.md';

/** Writes the brief (as a change request, for an existing toolkit project) and copies the attachments; what it did, in short lines (nothing when there's no brief). */
export function writeBriefFiles(dir: string, plan: ProjectPlan, files: { name: string; path: string }[], opts: { change?: boolean } = {}): string[] {
  if (!plan.brief) return [];
  const did: string[] = [];
  const f = path.join(dir, ...BRIEF_FILE.split('/'));
  const md = briefMarkdown(plan.brief, { repo: `${plan.owner}/${plan.name}`, entry: ENTRY_MODE_INFO[plan.entry].label, change: opts.change, source: plan.sourceFolder });
  let had = '';
  try {
    had = readFileSync(f, 'utf8');
  } catch {
    // first time
  }
  if (had !== md) {
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, md);
    did.push(BRIEF_FILE);
  }
  const named = new Set(plan.brief.attachments.map((a) => a.name));
  for (const file of files) {
    if (!named.has(file.name) || !existsSync(file.path)) continue;
    const to = path.join(dir, 'sources', file.name);
    if (existsSync(to)) continue;
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(file.path, to);
    did.push(`sources/${file.name}`);
  }
  return did;
}
