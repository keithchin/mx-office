// What a project's toolkit has: whether a skill or script is in the folder its scripts run from (its pin,
// else the shared clone). The office tells a team about a toolkit artifact only when its own toolkit can
// make it (the process map: shared/process-map.ts), so agents on an older pin aren't sent after a skill
// their copy lacks. One stat per folder and file, kept: a pin never changes (its folder is per commit), the
// shared clone is looked at again after a minute.

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const AGAIN_MS = 60_000;
const kept = new Map<string, { has: boolean; at: number }>();

const keyOf = (dir: string, rel: string) => `${path.resolve(dir).toLowerCase()}\0${rel}`;
/** A pin folder is `<clone>-pins/<sha12>`: what's in it never changes once it's there. */
const isPin = (dir: string) => /-pins[\\/][0-9a-f]{12}[\\/]?$/i.test(dir);

function fresh(dir: string, rel: string): boolean | undefined {
  const hit = kept.get(keyOf(dir, rel));
  if (!hit) return undefined;
  return (hit.has && isPin(dir)) || Date.now() - hit.at < AGAIN_MS ? hit.has : undefined;
}

function keep(dir: string, rel: string, has: boolean): boolean {
  kept.set(keyOf(dir, rel), { has, at: Date.now() });
  if (kept.size > 500) kept.delete(kept.keys().next().value!);
  return has;
}

/** Whether `rel` (`skills/process-map.md`) is in the toolkit folder `dir`: for a Playbook, written at a hire or a rewrite. */
export function toolkitHas(dir: string | undefined, rel: string): boolean {
  if (!dir) return false;
  return fresh(dir, rel) ?? keep(dir, rel, existsSync(path.join(dir, rel)));
}

/** The same without holding the event loop: for the scans. */
export async function toolkitHasAsync(dir: string | undefined, rel: string): Promise<boolean> {
  if (!dir) return false;
  const hit = fresh(dir, rel);
  if (hit !== undefined) return hit;
  try {
    return keep(dir, rel, (await stat(path.join(dir, rel))).isFile());
  } catch {
    return keep(dir, rel, false);
  }
}
