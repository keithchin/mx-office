// Which toolkit commit an unpinned project is on, best effort, for projects made before pins:
//   1. PROJECT.md's `Toolkit commit: <sha>` (the toolkit's own session ack), when the clone has that commit;
//   2. else the scripts the toolkit copied into the project's bin/ (from its project-bin/): each one that's
//      byte-for-byte a version the toolkit once had says the project is at least as new as the commit
//      that brought that version, so the newest of those is the estimate;
//   3. else unknown, and the setup panel offers to pin it now.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PinSource } from '../../shared/toolkit.js';
import { git, revParse } from './git.js';

export interface Detected {
  source: PinSource;
  sha?: string;
  detail?: string;
}

/** git's blob id of `buf` (what `git hash-object` says), without starting git. */
export const blobId = (buf: Buffer) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

/** Scripts the toolkit copies into a project's bin/, matched against its project-bin/ history. */
export async function detectFromScripts(root: string, projectDir: string): Promise<Detected | undefined> {
  const names = await readdir(path.join(projectDir, 'bin')).catch(() => [] as string[]);
  if (!names.length) return undefined;
  const blobs = new Map<string, string>();
  for (const n of names) {
    const buf = await readFile(path.join(projectDir, 'bin', n)).catch(() => undefined);
    if (buf) {
      blobs.set(n, blobId(buf));
      // Checked out on Windows with CRLF: the toolkit's blob has LF.
      if (buf.includes(13)) blobs.set(`${n}\0lf`, blobId(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')));
    }
  }
  // Newest first: each commit's new blob for every project-bin file it touched.
  const log = await git(['log', '--format=%x1e%H', '--raw', '--no-abbrev', '--no-merges', '-n', '2000', '--', 'project-bin'], root, 30_000);
  if (!log) return undefined;
  const order: string[] = [];
  const intro = new Map<string, number>();
  let tracked = 0;
  const seenFiles = new Set<string>();
  for (const block of log.split('\x1e').filter((b) => b.trim())) {
    const [sha, ...lines] = block.split('\n');
    const idx = order.push(sha.trim()) - 1;
    for (const l of lines) {
      const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]{40}) [AM]\tproject-bin\/(.+)$/.exec(l.trim());
      if (!m) continue;
      const [, blob, file] = m;
      seenFiles.add(file);
      const mine = blobs.get(file) === blob || blobs.get(`${file}\0lf`) === blob;
      // The newest commit that brought this exact version.
      if (mine && !intro.has(file)) intro.set(file, idx);
    }
  }
  for (const n of names) if (seenFiles.has(n)) tracked++;
  if (!intro.size) return undefined;
  const newest = Math.min(...intro.values());
  return { source: 'snapshot', sha: order[newest], detail: `${intro.size} of ${tracked} copied scripts in bin/ match the toolkit's history` };
}

/** The best guess at the toolkit commit of the project, given its PROJECT.md text. */
export async function detect(root: string, projectDir: string, register: string | undefined): Promise<Detected> {
  const ack = register ? /Toolkit commit:\s*([0-9a-f]{7,40})\b/i.exec(register)?.[1] : undefined;
  if (ack) {
    const full = await revParse(root, ack);
    if (full) return { source: 'ack', sha: full, detail: `from PROJECT.md's "Toolkit commit: ${ack}" line` };
  }
  const fromScripts = await detectFromScripts(root, projectDir).catch(() => undefined);
  if (fromScripts) return fromScripts;
  return { source: 'none', detail: ack ? `PROJECT.md names ${ack}, which the toolkit clone hasn't got` : 'no Toolkit commit line in PROJECT.md and no copied scripts to compare' };
}
