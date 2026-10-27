// Pieces both the New project wizard (wizard/team-server-step.ts) and Connect to Team Server (./connect.ts) use:
// the project's Team Server rule in CLAUDE.md, Team Server's main fetched with its history notes, and the commit
// that adopts Team Server's history without changing the project's tree (the toolkit's platform-link.md
// single-tree adoption, done with plumbing so no working tree is checked out).

import { portalUrl, type TeamServerRecord } from '../../shared/team-server.js';
import { gitRefusalWords, type TsGit } from './git.js';

const BEGIN = '<!-- agent-office:team-server -->';
const END = '<!-- /agent-office:team-server -->';

/** The rule the project's agents read in its CLAUDE.md. */
export function teamServerRules(rec: Pick<TeamServerRecord, 'projectId' | 'url' | 'remote' | 'mirror'>): string {
  return [
    BEGIN,
    '## Mendix Team Server',
    '',
    `This app is in the Mendix Portal (${portalUrl(rec.projectId)}). Its Team Server repository (\`${rec.remote}\` remote, ${rec.url}) is where Studio Pro and deployments read \`main\`.`,
    '',
    `- The office pushes \`main\` to Team Server after every merge${rec.mirror ? ' and keeps GitHub’s `main` equal to it' : ''}. Never push to Team Server yourself, never force-push it, and never put a token in a remote URL.`,
    '- Keep the model at the repository root as `App.mpr`, the name Team Server expects.',
    END,
  ].join('\n');
}

/** CLAUDE.md with the rule in it, once (replaced in place on a later run). */
export function withTeamServerRules(md: string, rules: string): string {
  const at = md.indexOf(BEGIN);
  const end = md.indexOf(END);
  if (at >= 0 && end > at) return `${md.slice(0, at)}${rules}${md.slice(end + END.length)}`;
  return `${md.replace(/\s*$/, '')}\n\n${rules}\n`;
}

/**
 * The commit that adopts Team Server's history into `head` without changing its tree (platform-link.md: our tree,
 * Team Server's main as a second parent), so both mains fast-forward from it. Undefined when there's nothing to adopt.
 */
export async function adoptionCommit(g: TsGit, dir: string, head: string, ts: string | undefined, message: string, tree?: string): Promise<string | undefined> {
  if (!ts) return tree ? (await g.plain(dir, ['commit-tree', tree, '-p', head, '-m', message])).stdout.trim() : undefined;
  if (!tree && (await g.plain(dir, ['merge-base', '--is-ancestor', ts, head], { allowFail: true })).code === 0) return undefined;
  const t = tree ?? (await g.plain(dir, ['rev-parse', `${head}^{tree}`])).stdout.trim();
  return (await g.plain(dir, ['commit-tree', t, '-p', head, '-p', ts, '-m', message])).stdout.trim();
}

/** Team Server's main as fetched into refs/remotes/<remote>/main (undefined: an empty repository); its history notes too. */
export async function fetchTsMain(g: TsGit, dir: string, remote: string): Promise<string | undefined> {
  const r = await g.auth(dir, ['fetch', '--quiet', remote, `+refs/heads/main:refs/remotes/${remote}/main`], { allowFail: true });
  if (r.code !== 0) {
    const heads = await g.auth(dir, ['ls-remote', '--heads', remote], { allowFail: true });
    if (heads.code === 0 && !heads.stdout.trim()) return undefined;
    throw new Error(gitRefusalWords(r.tail.join(' ') || heads.tail.join(' ')));
  }
  // The template's Studio Pro note too, so this checkout's notes later fast-forward onto Team Server's.
  await g.auth(dir, ['fetch', '--quiet', remote, '+refs/notes/mx_metadata:refs/notes/mx_metadata'], { allowFail: true });
  return (await g.plain(dir, ['rev-parse', `refs/remotes/${remote}/main`])).stdout.trim();
}
