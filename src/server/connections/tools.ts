// The git / gh check on 🔌 Connections: are git and gh installed on the office's machine, does gh sign
// in with the agents' token, and does git have a name and email for commits. gh runs with the token in
// its own environment and an empty, throwaway GH_CONFIG_DIR, so the machine owner's own gh login and
// config are never read or changed; git's global config is only read. The one fix offered for a
// missing identity is the office's own (GIT_AUTHOR_* / GIT_COMMITTER_* in the workers' environment).

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCheck, ToolsView } from '../../shared/connections.js';
import { adminGhEnv, redactor } from '../wizard/admin-token.js';
import { officeSettings } from './store.js';

export interface Ran {
  code: number;
  out: string;
  /** The program isn't installed (ENOENT). */
  missing?: boolean;
}

export type Runner = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<Ran>;

export const run: Runner = (cmd, args, env) =>
  new Promise((resolve) => {
    execFile(cmd, args, { env, timeout: 15_000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
      const e = err as (NodeJS.ErrnoException & { code?: unknown }) | null;
      if (e?.code === 'ENOENT') return resolve({ code: 127, out, missing: true });
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out });
    });
  });

const firstLine = (s: string) => s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';

/** The check, with `token` the agents' token (or none). */
export async function checkTools(token: string | undefined, runner: Runner = run): Promise<ToolsView> {
  const [git, gh] = await Promise.all([runner('git', ['--version']), runner('gh', ['--version'])]);
  const gitCheck: ToolCheck = git.code === 0 ? { ok: true, text: firstLine(git.out) } : { ok: false, text: 'git isn’t installed (or not on the office’s PATH)', fix: 'Install Git for Windows: winget install Git.Git (or https://git-scm.com), then restart the office.' };
  const ghCheck: ToolCheck = gh.code === 0 ? { ok: true, text: firstLine(gh.out) } : { ok: false, text: 'gh (the GitHub CLI) isn’t installed (or not on the office’s PATH)', fix: 'Install it: winget install GitHub.cli (or https://cli.github.com), then restart the office.' };

  let ghAuth: ToolCheck;
  if (!ghCheck.ok) ghAuth = { ok: false, text: 'Needs gh first' };
  else if (!token) ghAuth = { ok: false, text: 'No GitHub token for agents to try', fix: 'Add the GitHub token for agents above.' };
  else {
    const config = mkdtempSync(path.join(os.tmpdir(), 'agent-office-gh-'));
    try {
      const env = { ...adminGhEnv(process.env, token), GH_CONFIG_DIR: config };
      const r = await runner('gh', ['auth', 'status', '--hostname', 'github.com'], env);
      const hide = redactor([token]);
      const said = hide(r.out).split(/\r?\n/).map((l) => l.trim().replace(/^[✓✗X-]\s*/, '')).filter(Boolean);
      const who = said.find((l) => /Logged in to/i.test(l));
      ghAuth = r.code === 0 ? { ok: true, text: who ?? 'gh signs in with the agents’ token' } : { ok: false, text: said.find((l) => /fail|invalid|bad|error/i.test(l)) ?? 'gh couldn’t sign in with the agents’ token', fix: 'Test the token above: it may have expired or been revoked.' };
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  }

  const [name, email] = gitCheck.ok ? await Promise.all([runner('git', ['config', '--global', 'user.name']), runner('git', ['config', '--global', 'user.email'])]) : [undefined, undefined];
  const n = name?.code === 0 ? firstLine(name.out) : '';
  const e = email?.code === 0 ? firstLine(email.out) : '';
  const office = officeSettings().gitIdentity;
  const identity: ToolsView['identity'] =
    n && e
      ? { ok: true, text: `Commits are by ${n} <${e}> (git’s own settings)`, name: n, email: e }
      : office
        ? { ok: true, text: `git has no ${n ? 'email' : 'name'} of its own; the workers’ commits are by ${office.name} <${office.email}> (set here)`, name: n || undefined, email: e || undefined }
        : { ok: false, text: `git has no ${!n && !e ? 'name or email' : n ? 'email' : 'name'} for commits`, fix: 'Set one for the office’s commits below: it goes into the workers’ environment, git’s own settings stay as they are.', name: n || undefined, email: e || undefined };
  return { git: gitCheck, gh: ghCheck, ghAuth, identity, officeIdentity: office };
}

/** An identity for the office's commits, checked: a name, and an email that looks like one. */
export function cleanIdentity(raw: unknown): { name: string; email: string } | string {
  const r = (raw ?? {}) as { name?: unknown; email?: unknown };
  const name = typeof r.name === 'string' ? r.name.replace(/[\r\n<>]/g, '').trim().slice(0, 80) : '';
  const email = typeof r.email === 'string' ? r.email.trim().slice(0, 120) : '';
  if (!name) return 'Give it a name';
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email)) return 'Give it an email address';
  return { name, email };
}
