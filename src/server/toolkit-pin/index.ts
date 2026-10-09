// Which toolkit folder a project runs from: its pin (pins.ts) when it has one, else the office's shared
// clone as before. Read by whatever runs or names the toolkit for a floor: the setup panel's gate-check
// (wizard/index.ts), the Playbooks (roster/playbooks.ts), the Discovery brief. The office's book
// (record.ts) is set once the toolkit service is made (service.ts, at start); before that, and for a
// floor the book doesn't know, the record committed in the floor's folder counts.

import { existsSync } from 'node:fs';
import { toolkitDir as sharedToolkitDir } from '../connections/store.js';
import { ensurePin, pinDir } from './pins.js';
import { folderRecord, type PinBook } from './record.js';

let book: PinBook | undefined;

/** The service hands its book in once it's made. */
export const useBook = (b: PinBook | undefined) => (book = b);

export interface FloorToolkit {
  /** The folder its scripts run from. */
  dir: string;
  /** The pinned commit, when it's pinned. */
  sha?: string;
  pinned: boolean;
}

/** The pinned commit of the floor whose checkout is `floorDir`, if any. */
export function pinnedCommit(floorDir: string): string | undefined {
  return book?.byDir(floorDir)?.commit ?? folderRecord(floorDir)?.commit;
}

/**
 * The toolkit folder for the floor at `floorDir`, without waiting: the pin's folder when the floor is
 * pinned (made in the background if it isn't there yet, so a Playbook naming it is right a moment later),
 * else the shared clone.
 */
export function toolkitOf(floorDir: string, root = sharedToolkitDir()): FloorToolkit {
  const sha = pinnedCommit(floorDir);
  if (!sha) return { dir: root, pinned: false };
  const dir = pinDir(root, sha);
  if (!existsSync(dir)) void ensurePin(root, sha).catch((err: Error) => console.warn(`agent-office: toolkit pin ${sha.slice(0, 12)}: ${err.message}`));
  return { dir, sha, pinned: true };
}

/** The same, waiting for the pin to be made; the shared clone (with a warning) when it can't be. */
export async function toolkitDirFor(floorDir: string, root = sharedToolkitDir()): Promise<FloorToolkit> {
  const sha = pinnedCommit(floorDir);
  if (!sha) return { dir: root, pinned: false };
  try {
    return { dir: await ensurePin(root, sha), sha, pinned: true };
  } catch (err) {
    console.warn(`agent-office: ${floorDir} is pinned to toolkit ${sha.slice(0, 12)} but its pin couldn't be made (${(err as Error).message}); using ${root}`);
    return { dir: root, pinned: false };
  }
}

let jobsBusy: (floorDir: string) => boolean = () => false;
/** The Update toolkit jobs hand in whether they have temporary worktrees out for a floor (the worktree sweep leaves those alone). */
export const useJobsBusy = (fn: (floorDir: string) => boolean) => (jobsBusy = fn);
export const toolkitBusy = (floorDir: string) => jobsBusy(floorDir);
