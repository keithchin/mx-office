// First-run setup's GitHub sign-in in one click: `gh auth login --web` run without a terminal, its
// one-time code read from what it prints and handed to the page (shown big, with Copy and GitHub's
// page), then `gh auth setup-git` so git pushes with the same sign-in. A gh that won't sign in without
// a terminal gets one: a window of its own running `gh auth login`, and the office waits for it. The
// agents' token can then come from the same sign-in (`gh auth token`), straight into 🔌 Connections:
// the value is never printed, streamed, returned or audited. Every gh here runs without the office's
// own GH_TOKEN (ghEnv), or gh would sign in with, and hand back, the token it already has.

import { parseDeviceCode, type FixEvent } from '../../shared/first-run-fix.js';
import { ghEnv, waitFor, type FixChild, type FixDeps } from './fixes.js';

const LOGIN = ['auth', 'login', '--web', '--git-protocol', 'https', '--hostname', 'github.com'];

/** gh's lines worth showing: not the browser it couldn't open (the page has the link) or the code (it's shown big). */
const shown = (l: string) => !/Failed opening a web browser|Please try entering the URL|Press Enter|one-time code/i.test(l);

/** Signs gh in. Returns why it couldn't. */
export async function ghSignIn(d: FixDeps, emit: (e: FixEvent) => void, signal: AbortSignal): Promise<string | undefined> {
  const gh = await d.find('gh');
  if (!gh) return 'gh isn’t on the office’s PATH (restart the office after installing it)';
  const env = ghEnv(d.env);
  const line = (text: string) => emit({ t: 'line', text });
  const r = await new Promise<{ code: number | null; sawCode: boolean; said: string }>((resolve) => {
    let out = '';
    let tail = '';
    let sawCode = false;
    let child: FixChild;
    try {
      child = d.spawn(gh, LOGIN, env);
    } catch (err) {
      return resolve({ code: null, sawCode, said: (err as Error).message });
    }
    const timer = setTimeout(() => child.kill(), d.waitMs);
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    const take = (chunk: string) => {
      out = (out + chunk).slice(-20_000);
      tail += chunk;
      const parts = tail.split(/\r\n|\r|\n/);
      tail = parts.pop() ?? '';
      for (const p of parts) if (p.trim() && shown(p)) line(p.trim().slice(0, 300));
      if (sawCode) return;
      const found = parseDeviceCode(out);
      if (!found) return;
      sawCode = true;
      emit({ t: 'code', ...found });
      // Some gh versions wait for Enter before going on: give it one.
      child.write('\n');
    };
    child.on('stdout', take);
    child.on('stderr', take);
    child.on('error', (e) => line(e.message));
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      resolve({ code, sawCode, said: out.trim().split(/\r?\n/).filter(shown).at(-1) ?? '' });
    });
  });
  if (signal.aborted) return 'Stopped';
  if (r.code !== 0) {
    if (r.sawCode) return `gh didn’t finish signing in (${r.said || (r.code === null ? 'it timed out' : `exit ${r.code}`)})`;
    // This gh won't do it without a terminal: open one, and wait for it.
    line(`gh couldn’t sign in without a terminal here (${r.said || `exit ${r.code}`}): opening a terminal window running gh auth login instead. Finish there.`);
    const why = await d.openTerminal('gh', ['auth', 'login', '--git-protocol', 'https', '--hostname', 'github.com', '--web'], env);
    if (why) return `${why}. Run gh auth login in a terminal yourself, then Re-check.`;
    const waited = await waitFor(d, async () => (await d.run(gh, ['auth', 'status', '--hostname', 'github.com'], env)).code === 0, signal, 'gh’s sign-in');
    if (waited) return waited;
  }
  line('Signed in. Setting git up to use this sign-in (gh auth setup-git)…');
  const git = await d.run(gh, ['auth', 'setup-git', '--hostname', 'github.com'], env);
  if (git.code !== 0) return `gh auth setup-git failed: ${git.out.split(/\r?\n/)[0] || `exit ${git.code}`}`;
  return undefined;
}

const TOKEN = /^(gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

/**
 * The agents' token from gh's sign-in: `gh auth token` straight into Connections. The value only ever
 * lives in this function: `line` hears that it was saved, never what.
 */
export async function ghToken(d: FixDeps, line: (text: string) => void): Promise<string | undefined> {
  if (d.hasAgentToken()) return void line('The agents already have a GitHub token in Connections: left as it is.');
  const gh = await d.find('gh');
  if (!gh) return 'gh isn’t on the office’s PATH';
  const r = await d.run(gh, ['auth', 'token', '--hostname', 'github.com'], ghEnv(d.env));
  const token = r.code === 0 ? r.out.trim() : '';
  if (!TOKEN.test(token)) return r.code === 0 ? 'gh gave back something that isn’t a GitHub token' : 'gh isn’t signed in (sign it in first)';
  const why = await d.saveAgentToken(token);
  if (why) return `Connections didn’t take it: ${why}`;
  line('Saved as the agents’ GitHub token in 🔌 Connections (from your gh sign-in).');
  return undefined;
}
