// Which mxbuild a floor's live app builds with, told to mxcli as `--mxbuild-path` instead of left to
// mxcli's own resolution, which on Windows can land on a cached CDN download: the Mendix CDN only
// publishes Linux mxbuild, so that one can't run there ("mxbuild at … is a linux binary and cannot run on
// windows"). In order: MXBUILD_PATH in the floor's .claude/toolkit.env, then the office's own MXBUILD_PATH,
// then (Windows) the installed Studio Pro of the project's Mendix version, before mxcli's cached
// download. An older mxcli without the flag gets MXBUILD_PATH in its environment only. When mxcli still
// picks a Linux mxbuild, the live app says so honestly, with the fix.

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { mendixDir, mprVersion } from '../studio/open.js';

export interface MxbuildDeps {
  platform: NodeJS.Platform;
  /** The office's environment (its MXBUILD_PATH, ProgramFiles). */
  env: NodeJS.ProcessEnv;
  isFile(p: string): boolean;
  isDir(p: string): boolean;
  /** The Mendix version the project was saved in ("11.12.4"), when it can be read. */
  readVersion(mpr: string): string | undefined;
}

export type MxbuildSource = 'toolkit.env' | 'office' | 'studio-pro';

export interface MxbuildPick {
  /** The mxbuild to pass, when one was found. */
  path?: string;
  source?: MxbuildSource;
  /** The project's Mendix version, when it could be read. */
  version?: string;
  /** Where Studio Pro of that version would be (Windows), for the message when there's none. */
  expected?: string;
  /** What was skipped and why ("MXBUILD_PATH in toolkit.env points at … which isn't there"). */
  skipped: string[];
}

const machine = (): MxbuildDeps => ({
  platform: process.platform,
  env: process.env,
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  isDir: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readVersion: mprVersion,
});

/** A path as written in toolkit.env (Git Bash's /c/Program Files/… too) in the platform's own form. */
export function nativePath(p: string, platform: NodeJS.Platform = process.platform): string {
  const s = p.trim();
  if (platform !== 'win32') return s;
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(s);
  return m ? path.win32.normalize(`${m[1].toUpperCase()}:${m[2] ?? '\\'}`) : path.win32.normalize(s);
}

const exeName = (platform: NodeJS.Platform) => (platform === 'win32' ? 'mxbuild.exe' : 'mxbuild');

/** The mxbuild a configured MXBUILD_PATH means: the file itself, or mxbuild in the folder it names. */
function mxbuildAt(raw: string, d: MxbuildDeps): string | undefined {
  const p = nativePath(raw, d.platform);
  if (d.isFile(p)) return p;
  const join = d.platform === 'win32' ? path.win32.join : path.posix.join;
  for (const inner of [join(p, exeName(d.platform)), join(p, 'modeler', exeName(d.platform))]) if (d.isFile(inner)) return inner;
  return undefined;
}

/** Studio Pro's bundled mxbuild of `version` on Windows: <Program Files>\Mendix\<version>\modeler\mxbuild.exe. */
export const studioProMxbuild = (env: NodeJS.ProcessEnv, version: string) => path.win32.join(mendixDir(env), version, 'modeler', 'mxbuild.exe');

/** Which mxbuild to build `mpr` with: see the top of this file. */
export function pickMxbuild(mpr: string, floorEnv: Record<string, string>, d: MxbuildDeps = machine()): MxbuildPick {
  const skipped: string[] = [];
  const version = d.readVersion(mpr);
  const tries: [string | undefined, MxbuildSource, string][] = [
    [floorEnv.MXBUILD_PATH, 'toolkit.env', "MXBUILD_PATH in the project's .claude/toolkit.env"],
    [d.env.MXBUILD_PATH, 'office', "the office's MXBUILD_PATH"],
  ];
  for (const [raw, source, what] of tries) {
    if (!raw?.trim()) continue;
    const found = mxbuildAt(raw, d);
    if (found) return { path: found, source, version, skipped };
    skipped.push(`${what} points at ${raw.trim()}, which isn't there`);
  }
  if (d.platform === 'win32' && version) {
    const expected = studioProMxbuild(d.env, version);
    if (d.isFile(expected)) return { path: expected, source: 'studio-pro', version, skipped };
    return { version, expected, skipped };
  }
  return { version, skipped };
}

/** mxcli's error when the mxbuild it resolved is the CDN's Linux build on Windows: the path it named. */
export function linuxMxbuildIn(lines: readonly string[]): { mxbuild?: string } | undefined {
  for (const l of lines) {
    const m = /mxbuild at (.+?) is a linux binary and cannot run on windows/i.exec(l);
    if (m) return { mxbuild: m[1] };
    if (/is a linux binary and cannot run on windows/i.test(l)) return {};
  }
  return undefined;
}

/**
 * What the live app says when mxcli picked a Linux mxbuild on Windows: why it can't run, and how to fix it
 * (install the project's Studio Pro, or set the mxbuild path), plus, when this mxcli is too old to be told
 * the path, that too.
 */
export function linuxMxbuildMessage(found: { mxbuild?: string }, pick: MxbuildPick, flagSupported: boolean | undefined, mxcli: string): string {
  const ver = pick.version ? `Studio Pro ${pick.version}` : "the project's Studio Pro version";
  const where = pick.expected ? ` (${pick.expected})` : '';
  const parts = [`mxcli picked a Linux mxbuild${found.mxbuild ? ` (${found.mxbuild})` : ''}, which can't run on Windows: the Mendix CDN only publishes Linux mxbuild.`];
  parts.push(`Fix: install ${ver} on the office's computer${where}, or set the mxbuild path (MXBUILD_PATH in the project's .claude/toolkit.env, pointing at Studio Pro's modeler\\mxbuild.exe).`);
  if (pick.path && flagSupported === false) parts.push(`This mxcli (${mxcli}) is too old to be given the mxbuild path (--mxbuild-path): pick a newer mxcli in ☰ → 🚀 First-run setup, or set AGENT_OFFICE_LIVE_MXCLI.`);
  for (const s of pick.skipped) parts.push(`(${s}.)`);
  return parts.join(' ');
}

const flagCache = new Map<string, { mtime: number; ok: boolean }>();

/** Whether `mxcli run` takes --mxbuild-path (newer ones do), from its help; asked once per mxcli build. */
export function supportsMxbuildPath(mxcli: string, timeoutMs = 20_000): Promise<boolean> {
  let mtime = 0;
  try {
    mtime = statSync(mxcli).mtimeMs;
  } catch {
    // A name on PATH: asked every time it's needed (it's a start, not a loop).
  }
  const had = flagCache.get(mxcli);
  if (had && mtime && had.mtime === mtime) return Promise.resolve(had.ok);
  return new Promise((resolve) => {
    execFile(mxcli, ['run', '--help'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } }, (_err, stdout, stderr) => {
      const ok = /--mxbuild-path\b/.test(`${stdout ?? ''}${stderr ?? ''}`);
      if (mtime) flagCache.set(mxcli, { mtime, ok });
      resolve(ok);
    });
  });
}

/** Forgets what was learnt about each mxcli (tests). */
export const forgetMxcliFlags = () => flagCache.clear();

