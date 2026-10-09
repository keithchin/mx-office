// Letting go of a floor's in-memory state when its project is deleted (server/project-delete/), so a
// project added again under the same floor id before the office restarts starts clean. Every service
// that keeps something per floor in memory says how it lets go: a module-level cache with
// onForgetFloor, an instance with forgetWith (held weakly, so a test's throwaway instances go away).
// Keys are matched by dropKeys: the floor id itself, "<floor>:…" / "<floor>|…" style keys, and the
// project's folder (caches keyed by checkout).

import path from 'node:path';

export interface ForgetTarget {
  id: string;
  dir: string;
}

type Forget = (f: ForgetTarget) => void;

const fns = new Set<Forget>();
const owners = new Set<{ ref: WeakRef<object>; fn: (o: object, f: ForgetTarget) => void }>();

/** A module-level cache's way of letting go of a floor; returns how to stop. */
export function onForgetFloor(fn: Forget): () => void {
  fns.add(fn);
  return () => void fns.delete(fn);
}

/** An instance's way of letting go of a floor, for as long as the instance lives. */
export function forgetWith<T extends object>(owner: T, fn: (o: T, f: ForgetTarget) => void) {
  owners.add({ ref: new WeakRef(owner), fn: fn as (o: object, f: ForgetTarget) => void });
}

/** Every service lets go of the floor. Returns what went wrong (nothing stops the rest). */
export function forgetFloor(f: ForgetTarget): string[] {
  const errors: string[] = [];
  const call = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      errors.push((err as Error).message);
    }
  };
  for (const fn of fns) call(() => fn(f));
  for (const o of owners) {
    const owner = o.ref.deref();
    if (!owner) owners.delete(o);
    else call(() => o.fn(owner, f));
  }
  return errors;
}

const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const SEPS = [':', '|', '/', '\\', '#', '\0', ' '];

/** Whether a cache key belongs to the floor: its id, "<id>:<more>" and the like, or its folder (or inside it). */
export function keyOfFloor(key: string, f: ForgetTarget): boolean {
  if (key === f.id || SEPS.some((s) => key.startsWith(f.id + s))) return true;
  if (!f.dir || !/[\\/]/.test(key)) return false;
  const k = norm(key.split(/[|#\0]/)[0]);
  const d = norm(f.dir);
  return k === d || k.startsWith(d + path.sep);
}

/** Drops the floor's keys from a Map or a Set (clearing a timer value as it goes). */
export function dropKeys(m: Map<string, unknown> | Set<string>, f: ForgetTarget) {
  for (const k of [...m.keys()]) {
    if (!keyOfFloor(k, f)) continue;
    if (m instanceof Map) {
      const v = m.get(k);
      if (v && typeof v === 'object' && 'unref' in (v as object) && 'ref' in (v as object)) clearTimeout(v as NodeJS.Timeout);
    }
    m.delete(k);
  }
}
