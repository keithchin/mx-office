// The project's journey-runner config at a commit (tests/e2e/project.config.js, the toolkit's one file that
// knows the project), read for who a walkthrough signs in as (shared/walkthroughs/identity.ts). The file is
// a CommonJS module whose `credentials()` gives the runner's default identity (TEST_USER / TEST_PASS, else
// its DEFAULT_USER / DEFAULT_PASS) and whose `roles` name per-role accounts. It is agent-written code, so
// it is never loaded into the office: a child node process loads a copy of it, taken from the project's git
// objects into a temporary folder, with an environment that has nothing of the office's in it (so the
// defaults come out, and no secret goes in), Node's permission model on (it may read that folder and
// nothing else: no writes, no child processes, no workers) and a ten-second limit. Where that can't run, its
// defaults are read off the text instead. What comes back (passwords included) stays in memory, cached per
// commit; nothing here writes or prints a password.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RunnerAccount, RunnerConfig } from '../../shared/walkthroughs/identity.js';
import { execFileOffP } from '../offloop/exec.js';
import { readFiles } from '../testing/repo.js';

export const CONFIG_FILE = 'tests/e2e/project.config.js';

/** What the child prints: the config's defaults as JSON on one line. */
const PROBE = `
const c = require(process.argv[1]);
const out = { roles: [] };
try { const k = typeof c.credentials === 'function' ? c.credentials() : c.credentials || {}; if (typeof k.user === 'string') out.user = k.user; if (typeof k.pass === 'string') out.pass = k.pass; } catch {}
try { for (const [key, r] of Object.entries(c.roles || {})) if (r && typeof r.user === 'string') out.roles.push({ key, user: r.user, pass: typeof r.pass === 'string' ? r.pass : '', ...(typeof r.label === 'string' ? { label: r.label } : {}) }); } catch {}
process.stdout.write('\\u0000' + JSON.stringify(out) + '\\u0000');
`;

/** Node's permission flag on this node, or undefined when it has none (then the text is read instead). */
function permissionFlag(): string | undefined {
  const flags = process.allowedNodeEnvironmentFlags;
  return flags.has('--permission') ? '--permission' : flags.has('--experimental-permission') ? '--experimental-permission' : undefined;
}

const ACCOUNT = /^[A-Za-z0-9_.@+-]{1,80}$/;

function clean(j: unknown): RunnerConfig | undefined {
  if (!j || typeof j !== 'object') return undefined;
  const o = j as { user?: unknown; pass?: unknown; roles?: unknown };
  const roles: RunnerAccount[] = (Array.isArray(o.roles) ? o.roles : []).flatMap((r: { key?: unknown; user?: unknown; pass?: unknown; label?: unknown }) =>
    r && typeof r.user === 'string' && ACCOUNT.test(r.user) ? [{ user: r.user, pass: typeof r.pass === 'string' ? r.pass : '', ...(typeof r.key === 'string' ? { key: r.key.slice(0, 60) } : {}), ...(typeof r.label === 'string' ? { label: r.label.slice(0, 80) } : {}) }] : [],
  );
  const user = typeof o.user === 'string' && ACCOUNT.test(o.user) ? o.user : undefined;
  return { ...(user ? { user } : {}), ...(user && typeof o.pass === 'string' ? { pass: o.pass } : {}), roles };
}

/** Loads a copy of the config text in a sandboxed child node; undefined when that can't be done. */
export async function evaluateConfig(text: string, node = process.execPath): Promise<RunnerConfig | undefined> {
  const flag = permissionFlag();
  if (!flag) return undefined;
  const root = await mkdtemp(path.join(tmpdir(), 'wt-runner-'));
  try {
    // Nested, so what it looks for around itself (the project root two levels up, a design folder beside it) is inside what it may read.
    const dir = path.join(root, 'sandbox', 'office', 'project', 'tests', 'e2e');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'project.config.js');
    await writeFile(file, text);
    const env: NodeJS.ProcessEnv = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {};
    const { stdout } = await execFileOffP(node, [flag, `--allow-fs-read=${root}`, '-e', PROBE, file], { cwd: root, env, timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true });
    const m = /\u0000(\{.*\})\u0000/s.exec(stdout);
    return m ? clean(JSON.parse(m[1])) : undefined;
  } catch {
    return undefined;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The config's defaults read off its text, the toolkit template's shape: DEFAULT_USER / DEFAULT_PASS, and roles' `user: … || 'x'`. */
export function parseConfig(text: string): RunnerConfig | undefined {
  const lit = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(['"\`])([^'"\`\\n]*)\\1`).exec(text)?.[2];
  const user = lit('DEFAULT_USER');
  const pass = lit('DEFAULT_PASS');
  const roles: RunnerAccount[] = [];
  const block = /\bROLES\s*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1] ?? '';
  for (const m of block.matchAll(/(\w+)\s*:\s*\{([\s\S]*?)\}/g)) {
    const body = m[2];
    const u = /\buser\s*:[^\n]*?(['"`])([^'"`\n]+)\1\s*,?\s*$/m.exec(body)?.[2];
    const p = /\bpass\s*:[^\n]*?(['"`])([^'"`\n]*)\1\s*,?\s*$/m.exec(body)?.[2];
    const label = /\blabel\s*:\s*(['"`])([^'"`\n]+)\1/.exec(body)?.[2];
    if (u && ACCOUNT.test(u)) roles.push({ key: m[1], user: u, pass: p ?? '', ...(label ? { label } : {}) });
  }
  if (!user && !roles.length) return undefined;
  return clean({ user, pass, roles });
}

const cache = new Map<string, Promise<RunnerConfig | undefined>>();

/** The project's journey-runner config at `commit`: evaluated in the sandbox, else read off its text; undefined without one. */
export function runnerConfigAt(dir: string, commit: string): Promise<RunnerConfig | undefined> {
  const key = `${dir}|${commit}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const text = (await readFiles(dir, commit, [CONFIG_FILE], 256 * 1024)).get(CONFIG_FILE);
      if (!text) return undefined;
      return (await evaluateConfig(text)) ?? parseConfig(text);
    })();
    cache.set(key, p);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    p.catch(() => cache.delete(key));
  }
  return p;
}
