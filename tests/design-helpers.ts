// Shared fakes for the design-system tests: a synthetic Mendix app folder (no Studio Pro), a fake mxcli whose
// `theme apply` writes fenced blocks, a DesignService on a temporary data folder, a published package, and git
// repositories with a local bare origin (never GitHub).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignService, type DesignDeps } from '../src/server/design/service.js';
import type { Run } from '../src/server/design/apply.js';
import { DEFAULT_INPUT } from '../src/shared/design/tokens.js';

export const CLIENT = 'pfl_01JA0000000000000000000000';
const STOCK_CV = '$brand-logo: false;\n:root {\n  --brand-primary: #264ae5;\n}\n$use-css-variables: true;\n';
const STOCK_MAIN = '@import "custom-variables";\n@import "theme-dark";\n@import "theme-neutral";\n';

export const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function appDir(root: string, opts: { custom?: boolean } = {}) {
  const d = mkdtempSync(path.join(root, 'app-'));
  mkdirSync(path.join(d, 'theme', 'web'), { recursive: true });
  mkdirSync(path.join(d, 'themesource', 'atlas_core', 'web'), { recursive: true });
  writeFileSync(path.join(d, 'App.mpr'), 'mpr-bytes');
  writeFileSync(path.join(d, 'theme', 'web', 'custom-variables.scss'), STOCK_CV);
  writeFileSync(path.join(d, 'theme', 'web', 'main.scss'), opts.custom ? `${STOCK_MAIN}.legacy { color: red; }\n` : STOCK_MAIN);
  writeFileSync(path.join(d, 'themesource', 'atlas_core', 'web', 'main.scss'), '/* atlas */\n');
  return d;
}

/** An app with styling of its own in a git repository on main, with a project file of other settings and (unless `remote: false`) a bare origin it was pushed to. */
export function repoApp(root: string, opts: { remote?: boolean } = {}) {
  const dir = appDir(root, { custom: true });
  writeFileSync(path.join(dir, 'agent-office.project.json'), `${JSON.stringify({ toolkit: { pin: 'abc123' }, team: { size: 3 } }, null, 2)}\n`);
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'app');
  let origin: string | undefined;
  if (opts.remote !== false) {
    origin = mkdtempSync(path.join(root, 'origin-'));
    sh(origin, 'init', '-q', '--bare', '-b', 'main');
    sh(dir, 'remote', 'add', 'origin', origin);
    sh(dir, 'push', '-q', '-u', 'origin', 'main');
  }
  return { dir, origin };
}

/** A fake mxcli: `theme apply` writes fenced blocks (or says unchanged). */
export function fakeMxcli() {
  const calls: string[][] = [];
  const run: Run = async (_cmd, args, o) => {
    calls.push(args);
    const say = (l: string) => o.onLine?.(l);
    if (args[0] === '--version') return { code: 0, tail: [], stdout: 'mxcli version nightly-test (2026-10-03)\n' };
    if (args[1] === 'create') return { code: 0, tail: [], stdout: '' };
    const name = args[2];
    for (const f of ['custom-variables.scss', 'main.scss']) {
      const file = path.join(o.cwd, 'theme', 'web', f);
      const text = readFileSync(file, 'utf8');
      if (text.includes(`mxcli:theme:begin ${name}`)) say(`  unchanged theme/web/${f}`);
      else {
        writeFileSync(file, `${text}// mxcli:theme:begin ${name} v1 — generated\n:root { --mxt-brand: #7f2bd8; }\n// mxcli:theme:end ${name} 0123456789abcdef\n`);
        say(`  added     theme/web/${f}`);
      }
    }
    return { code: 0, tail: [], stdout: '' };
  };
  return { run, calls, applies: () => calls.filter((a) => a[1] === 'apply').length };
}

export function designWorld(t: { after(fn: () => void): void }, over: Partial<DesignDeps> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-design-txn-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const floors: { id: string; name: string; dir: string }[] = [];
  const audits: { action: string; summary: string }[] = [];
  const mx = fakeMxcli();
  const deps: DesignDeps = {
    dataDir: path.join(root, 'data'),
    floors: () => floors,
    clientOf: () => ({ id: CLIENT, label: 'Acme' }),
    clientLabel: () => 'Acme',
    mxcli: () => 'mxcli',
    live: () => ({ running: false, status: 'stopped' }),
    audit: (e) => void audits.push({ action: e.action, summary: e.summary }),
    now: () => 1_000,
    run: mx.run,
    shooter: async () => {
      throw new Error('no screenshot in this test');
    },
    ...over,
  };
  return { s: new DesignService(deps), deps, root, floors, audits, mx };
}

export async function published(s: DesignService, kind: 'branded' | 'atlas' = 'branded', name = 'Acme Design System') {
  assert.equal(await s.saveDraft({ client: CLIENT }, kind, { ...DEFAULT_INPUT, name }, 'Ada'), undefined);
  const id = s.store.ofOwner({ client: CLIENT })!.id;
  const r = await s.publish(id, 'Ada');
  assert.ok(typeof r !== 'string');
  await s.approve(id, r.n, 'Ada');
  const m = (await s.store.manifest(id, r.n))!;
  return { id, n: r.n, digest: r.digest, themeName: m.themeName!, branch: `agent-office/design-${m.themeName}` };
}
