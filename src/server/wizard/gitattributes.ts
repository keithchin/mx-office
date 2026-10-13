// The new project's .gitattributes, committed with the scaffold. Without it a Windows machine
// (core.autocrlf=true) checks every text file out with CRLF, the toolkit's skills are rewritten with LF
// about 25 s after an agent's worktree is made, and the worktree shows some 200 modified files that are
// only line endings (2026-10-13). LF everywhere, whatever core.autocrlf says; Windows scripts keep CRLF;
// the Mendix model (the .mpr, and the mprcontents/ units of the newer format), packages, images and
// office files are binary, never touched. Only a new project gets it: an existing one is never changed
// by itself (docs/site/teams-and-agents/workers-and-worktrees: how to add it by hand).

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const GITATTRIBUTES = [
  '# Written by Agent Office for a new project. LF in the repository and in every checkout,',
  '# agent worktrees included, whatever core.autocrlf says.',
  '* text=auto eol=lf',
  '',
  '# Windows scripts keep CRLF.',
  '*.bat text eol=crlf',
  '*.cmd text eol=crlf',
  '*.ps1 text eol=crlf',
  '',
  '# The Mendix model and packages: binary, never converted or merged as text.',
  '*.mpr binary',
  '*.mpk binary',
  '*.mprbackup binary',
  '*.mxunit binary',
  'mprcontents/** binary',
  '',
  '# Images, fonts, archives and office files.',
  ...['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'pdf', 'zip', 'jar', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'xlsx', 'docx', 'pptx'].map((x) => `*.${x} binary`),
  '',
].join('\n');

/** Writes the project's .gitattributes when it has none; true when it wrote it. */
export function writeGitattributes(dir: string): boolean {
  const f = path.join(dir, '.gitattributes');
  if (existsSync(f)) return false;
  writeFileSync(f, GITATTRIBUTES);
  return true;
}
