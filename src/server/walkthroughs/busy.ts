// What the walkthroughs' recording app waits for before it starts (app-instance/ `busy`): a live app that is
// building or starting now. Two cold builds and web client bundles at once take several times as long as one
// (measured on a sample app: a 15 s bundle took 2 min 15 s with a second cold start beside it), past mxcli's
// own limits on a busy laptop. The project's own live app comes first; any other project's counts too.

import type { LiveAppStatus } from '../../shared/protocol.js';

const building = (s: LiveAppStatus | undefined) => s === 'starting' || s === 'updating';

/** The live app building now, in words ("the project’s live app"), or undefined. */
export function liveAppBuilding(floors: Iterable<{ id: string; def: { name: string } }>, status: (floorId: string) => LiveAppStatus | undefined, floorId: string): string | undefined {
  if (building(status(floorId))) return 'the project’s live app';
  for (const f of floors) if (f.id !== floorId && building(status(f.id))) return `the live app of “${f.def.name}”`;
  return undefined;
}
