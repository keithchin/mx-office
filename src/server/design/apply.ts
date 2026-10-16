// Applying a Branded Atlas package to an app: `mxcli theme create <theme> --from <tokens.css> --force`, then
// `mxcli theme apply <theme>`, as child processes (never on the event loop), then the office's own check,
// because mxcli's own word isn't enough (0a): a refusal exits 0 and `theme` ignores --json, so any `skipped`
// (or "left alone") line is a failure; the fences `mxcli:theme:begin <theme>` must be in custom-variables.scss
// and main.scss (the theme name ends in the package digest's first 8 characters, so the fences name the
// package); and the .mpr and themesource/ must be exactly as they were. mxcli's apply is idempotent (the same
// tokens again print `unchanged`), so running it twice after a restart changes nothing.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runCommand, type RunOptions, type RunResult } from '../wizard/run.js';
import { scanScss, themeWebOf } from './scan.js';

export type Run = (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult>;

export interface ApplyInput {
  /** The folder with the .mpr. */
  appDir: string;
  mpr: string;
  themeName: string;
  tokensFile: string;
  title: string;
  mxcli: string;
  run?: Run;
  log?: (line: string) => void;
}

export interface ApplyOutcome {
  ok: boolean;
  /** What went wrong, in a sentence (ok: what it did). */
  detail: string;
  /** mxcli's fence digest per file, for the binding. */
  fences: Record<string, string>;
  /** Each file mxcli reported, with what it did. */
  files: { action: string; file: string }[];
}

const FILE_LINE = /^\s*(created|added|updated|unchanged|skipped|removed|replaced)\s+(\S+)/;

/** mxcli's per-file lines, and whether it refused anything (it exits 0 when it does). */
export function readApplyOutput(out: string): { files: ApplyOutcome['files']; refused: string[] } {
  const files: ApplyOutcome['files'] = [];
  const refused: string[] = [];
  for (const line of out.replace(/\r/g, '').split('\n')) {
    const m = FILE_LINE.exec(line);
    if (m) {
      files.push({ action: m[1], file: m[2] });
      if (m[1] === 'skipped') refused.push(m[2]);
    } else if (/left alone|has local edits/i.test(line)) refused.push(line.trim().slice(0, 160));
  }
  return { files, refused: [...new Set(refused)] };
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve()).on('error', reject);
  });
  return h.digest('hex');
}

/** themesource/'s files with their sizes and times: enough to see that nothing there changed. */
async function fingerprint(dir: string): Promise<string> {
  const h = createHash('sha256');
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const s = await stat(p).catch(() => undefined);
        h.update(`${path.relative(dir, p)}\0${s?.size ?? -1}\0${s?.mtimeMs ?? -1}\n`);
      }
    }
  };
  await walk(dir);
  return h.digest('hex');
}

const output = async (run: Run, cmd: string, args: string[], cwd: string, log?: (l: string) => void) => {
  const lines: string[] = [];
  const r = await run(cmd, args, { cwd, timeoutMs: 2 * 60_000, allowFail: true, onLine: (l) => (lines.push(l), log?.(`  ${l}`)) });
  return { code: r.code, text: lines.length ? lines.join('\n') : r.stdout, tail: r.tail };
};

export async function applyPackage(i: ApplyInput): Promise<ApplyOutcome> {
  const run = i.run ?? runCommand;
  const fail = (detail: string, files: ApplyOutcome['files'] = []): ApplyOutcome => ({ ok: false, detail, fences: {}, files });
  const mprBefore = await sha256File(i.mpr);
  const coreBefore = await fingerprint(path.join(i.appDir, 'themesource'));
  const mprArg = path.basename(i.mpr);
  const created = await output(run, i.mxcli, ['theme', 'create', i.themeName, '-p', mprArg, '--from', i.tokensFile, '--title', i.title, '--force'], i.appDir, i.log);
  if (created.code !== 0) return fail(`mxcli theme create exited ${created.code}: ${created.tail.slice(-2).join(' ').slice(0, 300)}`);
  const applied = await output(run, i.mxcli, ['theme', 'apply', i.themeName, '-p', mprArg], i.appDir, i.log);
  const read = readApplyOutput(applied.text);
  if (applied.code !== 0) return fail(`mxcli theme apply exited ${applied.code}: ${applied.tail.slice(-2).join(' ').slice(0, 300)}`, read.files);
  if (read.refused.length) return fail(`mxcli theme apply left ${read.refused.length} block${read.refused.length === 1 ? '' : 's'} alone (local edits inside a fence: ${read.refused.slice(0, 3).join(', ')}); nothing is forced over them`, read.files);
  const fences: Record<string, string> = {};
  for (const f of ['custom-variables.scss', 'main.scss']) {
    const s = scanScss(await readFile(path.join(themeWebOf(i.appDir), f), 'utf8').catch(() => ''));
    const d = s.fences[i.themeName];
    if (!d) return fail(`theme/web/${f} has no mxcli:theme block for ${i.themeName} after apply`, read.files);
    fences[`theme/web/${f}`] = d;
  }
  if ((await sha256File(i.mpr)) !== mprBefore) return fail(`${mprArg} changed during the theme apply: it must not. Look at the app in Studio Pro before going on`, read.files);
  if ((await fingerprint(path.join(i.appDir, 'themesource'))) !== coreBefore) return fail('themesource/ (Atlas core) changed during the theme apply: it must not', read.files);
  const changed = read.files.filter((f) => f.action !== 'unchanged').length;
  return { ok: true, detail: changed ? `theme ${i.themeName} applied (${changed} file${changed === 1 ? '' : 's'} written, fences checked, .mpr and Atlas core unchanged)` : `theme ${i.themeName} already applied (mxcli: unchanged)`, fences, files: read.files };
}

/** `mxcli --version` in a word ("nightly-20261003-14a0a7c0c", "v0.21.0"), or "unknown". */
export async function mxcliVersion(mxcli: string, run: Run = runCommand): Promise<string> {
  try {
    const r = await run(mxcli, ['--version'], { cwd: process.cwd(), timeoutMs: 20_000, allowFail: true });
    return /version\s+(\S+)/i.exec(r.stdout)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
