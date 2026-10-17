// "Try these first" (a migration project, 2026-10-16): the Playbook line for whoever builds pages and the model, and
// the office-wide workarounds list it points to. The list is the office's own `docs/mendix-workarounds.md`,
// copied into each project at WORKAROUNDS_PATH with the Playbooks (re-written whenever it changed), so an
// agent reads it inside its project without reaching outside its sandbox; the project's own entries go in
// WORKAROUNDS_LOCAL_PATH, seeded once and never overwritten, which its agents add to. An entry that holds
// beyond one project goes into the office's list by a pull request to the office repo. The escalate gate
// that enforces the `Tried:` section is shared/roster/handadd.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKAROUNDS_LOCAL_PATH, WORKAROUNDS_PATH } from '../../shared/roster/handadd.js';
import type { RoleId } from '../../shared/roster/roles.js';

/** The roles that build pages and the model, whose Playbooks carry TRY_FIRST and get the workarounds files. */
export const TRY_FIRST_ROLES: readonly RoleId[] = ['lead-developer', 'lead-designer', 'solo-lead'];

export const TRY_FIRST =
  `- **Before escalating "needs Studio Pro" or "mxcli can't do X", try these and note each one's exact error:** \`mxcli syntax <topic>\`; \`mxcli widget list -p <app>.mpr\` and \`mxcli widget describe <name> -p <app>.mpr\`; \`mxcli marketplace search "<what>"\` (a pluggable widget or module that does it; installing needs \`MENDIX_PAT\`); \`--engine legacy\` for a write the default engine refuses; \`mxcli check -p <app>.mpr\` with the attempt; and the workarounds list \`${WORKAROUNDS_PATH}\` (the project's own: \`${WORKAROUNDS_LOCAL_PATH}\`). ` +
  `The escalation's details then carry a \`Tried:\` section, one \`- \` line per attempt with its error; without one the office hands it back to you. A workaround that worked goes in \`${WORKAROUNDS_LOCAL_PATH}\` as an entry in its format, for the next agent.`;

/** The project's own list, as first seeded. */
export const LOCAL_SEED = [
  '# Mendix workarounds (this project)',
  '',
  `This project's own entries; the office-wide list is \`${WORKAROUNDS_PATH}\` (the office re-writes that copy: don't edit it). Add an entry here when a workaround worked, one per problem, in the same format, with no customer content. The office never overwrites this file; an entry that holds beyond this project can go into the office's list by a pull request to the office repo.`,
  '',
  '- **Problem:**',
  "- **Why mxcli can't do it directly:**",
  '- **Workaround:**',
  '- **Verified with:**',
  '- **Source:**',
  '',
].join('\n');

/** The office's checkout: the nearest folder up with its package.json. */
function officeDir(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return dir;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

let list: string | null | undefined;
/** The office's workarounds list (docs/mendix-workarounds.md, read once), or undefined when it isn't there. */
export function officeWorkarounds(): string | undefined {
  if (list === undefined) {
    const dir = officeDir();
    try {
      list = dir ? readFileSync(path.join(dir, 'docs', 'mendix-workarounds.md'), 'utf8').replace(/\r\n?/g, '\n') : null;
    } catch {
      list = null;
    }
  }
  return list ?? undefined;
}

/** The workarounds files a role's files include: the office's list (when it has one) and the project's seed. */
export function workaroundFiles(roleId: RoleId): { rel: string; text: string; keep?: boolean }[] {
  if (!TRY_FIRST_ROLES.includes(roleId)) return [];
  const office = officeWorkarounds();
  return [...(office ? [{ rel: WORKAROUNDS_PATH, text: office }] : []), { rel: WORKAROUNDS_LOCAL_PATH, text: LOCAL_SEED, keep: true }];
}
