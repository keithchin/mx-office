// Migration (M01): every roster seat that was ever hired and has no entry in profiles.json's `seats` gets one
// profile of its own. Never by name: three projects' "Ada"s are three profiles. Deterministic: the id is a
// ULID whose time is the seat's hiredAt and whose randomness is sha256("floor|role"), so a run cut short
// before its write mints the same ids next time; once written, the seat is in `seats` and skipped. The same
// pass repairs a hire whose profile write was lost. A seat a move released (null) is never minted again.

import { createHash } from 'node:crypto';
import { mintProfileId, seatKey, type Profile } from '../../shared/profiles.js';
import type { RoleId } from '../../shared/roster/roles.js';
import type { ProfilesFile } from './store.js';

export interface SeatFact {
  role: RoleId;
  name: string;
  everHired: boolean;
  hiredAt?: number;
  workerId?: string;
}

export interface FloorFact {
  id: string;
  name: string;
  seats: SeatFact[];
}

/** The id a migrated seat's profile gets: the same for the same seat, every run. */
export function migrationId(floor: string, role: string, hiredAt: number | undefined): string {
  const digest = createHash('sha256').update(seatKey(floor, role)).digest();
  return mintProfileId(hiredAt ?? 0, (n) => new Uint8Array(digest.subarray(0, n)));
}

/** The profiles to add, one per ever-hired seat not yet in `seats` (pure: nothing is written). */
export function planMigration(floors: readonly FloorFact[], file: Pick<ProfilesFile, 'seats' | 'profiles'>, now: number): { profiles: Profile[]; seats: Record<string, string> } {
  const have = new Set(file.profiles.map((p) => p.id));
  const out: Profile[] = [];
  const seats: Record<string, string> = {};
  for (const f of floors) {
    for (const s of f.seats) {
      const key = seatKey(f.id, s.role);
      if (!s.everHired || key in file.seats) continue;
      const id = migrationId(f.id, s.role, s.hiredAt);
      seats[key] = id;
      if (have.has(id)) continue;
      have.add(id);
      out.push({
        id,
        displayName: s.name,
        createdAt: now,
        createdBy: 'migration',
        assignments: [{ floor: f.id, project: f.name, role: s.role, start: s.hiredAt ?? now, reason: 'migrated', workers: s.workerId ? [s.workerId] : [] }],
      });
    }
  }
  return { profiles: out, seats };
}
