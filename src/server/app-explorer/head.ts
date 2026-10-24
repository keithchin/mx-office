// The explorer's default revision: the newest commit of the project's main branch as this machine has it
// (origin's default branch when there is a remote, else the local main or master), read with plain git and
// no fetch, so it costs a few milliseconds and needs no network and no running app. The live app's revision
// is only information next to it: how many commits it is behind (and ahead of) main.

import { execFileOff } from '../offloop/exec.js';
import { SHA_RE, type ExplorerHead } from '../../shared/app-explorer.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

function git(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', args, { cwd, env: ENV, windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, out) => resolve(err ? undefined : String(out)));
  });
}

/** Main's newest commit, and (when `served` is a commit id) how far the live app's revision is from it. */
export async function explorerHead(dir: string, served?: string): Promise<ExplorerHead> {
  const sym = (await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], dir))?.trim();
  const named = sym?.startsWith('refs/remotes/origin/') ? sym.slice('refs/remotes/origin/'.length) : undefined;
  const tries = [...(named ? [`origin/${named}`] : []), 'origin/main', 'origin/master', 'main', 'master', 'HEAD'];
  let branch = 'main';
  let rev: string | undefined;
  for (const t of tries) {
    const sha = (await git(['rev-parse', '--verify', '--quiet', `${t}^{commit}`], dir))?.trim();
    if (sha && SHA_RE.test(sha)) {
      branch = t;
      rev = sha;
      break;
    }
  }
  if (!rev) return { branch };
  const [meta, counts] = await Promise.all([
    git(['log', '-1', '--format=%ct%x1f%s', rev], dir),
    served && SHA_RE.test(served) && served !== rev ? git(['rev-list', '--left-right', '--count', `${served}...${rev}`], dir) : Promise.resolve(undefined),
  ]);
  const [at, subject] = (meta ?? '').trim().split('\x1f');
  const out: ExplorerHead = { rev, branch, ...(Number(at) ? { at: Number(at) * 1000 } : {}), ...(subject ? { subject } : {}) };
  if (served && SHA_RE.test(served)) {
    const [ahead, behind] = (counts ?? '').trim().split(/\s+/).map(Number);
    out.served = served === rev ? { sha: served, behind: 0, ahead: 0 } : { sha: served, ...(Number.isFinite(behind) ? { behind } : {}), ...(Number.isFinite(ahead) ? { ahead } : {}) };
  }
  return out;
}
