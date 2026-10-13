// What the surfaced asks' detectors read of main and the floor (detect.ts), from what the office already
// has: main's files as stuck detection reads them (stuck/repo.ts, once per main commit), and local git
// only, off the event loop, for the commits not on main yet.

import type { Ctx } from '../office/context.js';
import type { DetectInput } from './detect.js';
import type { AsksFloor } from './service.js';
import type { Read } from './sources.js';

/** The detectors' input besides what was read everywhere. */
export async function detectInputOf(_ctx: Ctx, _floor: AsksFloor, _reads: readonly Read[]): Promise<Omit<DetectInput, 'reads' | 'now'>> {
  return {};
}
