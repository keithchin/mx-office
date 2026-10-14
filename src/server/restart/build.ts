// The build the office runs, and the one built since (shared/build-info.ts). What it runs is read once,
// as the office starts: build-info.json beside the pages it serves, which `npm run build` writes. What's
// built now is the same file read again when someone asks (a stat each time, read only when it
// changed), so a rebuild under a running office shows as "A newer build is ready". Without the file (a
// dev server, a test office's own pages) the commit and the changelog's release stand in, and no newer
// build is ever claimed.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { BUILD_INFO_FILE, newerBuild, parseBuildInfo, releaseOf, type BuildInfo, type RunningBuild } from '../../shared/build-info.js';
import { appDir, headSha } from './checkout.js';

export class BuildWatch {
  readonly running: RunningBuild;
  private seen?: { mtime: number; info?: BuildInfo };

  constructor(
    private file: string,
    fallback: () => BuildInfo,
    startedAt = Date.now(),
  ) {
    this.running = { ...(this.read() ?? fallback()), startedAt };
  }

  /** The build on disk now, read again only when the file changed. */
  onDisk(): BuildInfo | undefined {
    return this.read();
  }

  /** A build made after the office started: a restart puts it to use. */
  ready(): BuildInfo | undefined {
    const now = this.read();
    return now && newerBuild(now, this.running) ? now : undefined;
  }

  private read(): BuildInfo | undefined {
    let mtime: number;
    try {
      mtime = statSync(this.file).mtimeMs;
    } catch {
      return undefined;
    }
    if (this.seen?.mtime === mtime) return this.seen.info;
    let info: BuildInfo | undefined;
    try {
      info = parseBuildInfo(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      info = undefined;
    }
    this.seen = { mtime, info };
    return info;
  }
}

/** Without build-info.json: the checkout's commit and its changelog's newest release, no build time. */
export function checkoutBuild(dir = appDir()): BuildInfo {
  let release: number | undefined;
  try {
    release = releaseOf(readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'));
  } catch {
    // no changelog
  }
  return { sha: (headSha(dir) ?? 'unknown').slice(0, 7), ...(release ? { release } : {}) };
}

const watches = new WeakMap<object, BuildWatch>();

/** The office's build watch, made the first time (office/timers.ts asks as the office starts). */
export function buildOf(ctx: { publicDir: string }): BuildWatch {
  let w = watches.get(ctx);
  if (!w) {
    w = new BuildWatch(path.join(ctx.publicDir, BUILD_INFO_FILE), () => checkoutBuild());
    watches.set(ctx, w);
  }
  return w;
}
