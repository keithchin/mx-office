// Where Studio Pro opens a project, when that isn't the project's own folder: a feature that keeps a copy of its
// own for Studio Pro registers here (Team Server's Studio copy, team-server/studio-copy.ts, whose origin is Team
// Server so Publish works). Studio mode (watch.ts) then looks for Studio Pro on that copy's .mpr, while the
// marker the agents' guard reads stays in the project's own .agent-office (one writer at a time, as before);
// Edit in Studio Pro (http/routes/studio.ts) asks the target to get the copy ready before it opens it.

import type { StudioTarget } from '../../shared/studio-target.js';

export interface StudioFloorRef {
  id: string;
  dir: string;
}

export interface StudioTargetProvider {
  /** The target for this project, or undefined when Studio Pro opens its own folder. Cheap: asked every few seconds. */
  of(floor: StudioFloorRef): StudioTarget | undefined;
  /** Gets the copy ready (made, or brought up to date when that's safe): the folder to open, and what to tell; or why not. */
  prepare(floor: StudioFloorRef, by: string): Promise<{ dir: string; note?: string } | { error: string }>;
}

const providers = new Set<StudioTargetProvider>();

/** Adds a provider; returns how to take it off again (tests). */
export function registerStudioTarget(p: StudioTargetProvider): () => void {
  providers.add(p);
  return () => void providers.delete(p);
}

/** The project's target and its provider, if one claims it. */
export function studioTargetOf(floor: StudioFloorRef): { target: StudioTarget; provider: StudioTargetProvider } | undefined {
  for (const p of providers) {
    try {
      const target = p.of(floor);
      if (target) return { target, provider: p };
    } catch (err) {
      console.error(`agent-office: a Studio Pro target failed for ${floor.id}: ${(err as Error).message}`);
    }
  }
  return undefined;
}

/** The folder Studio mode watches for the project: the target's copy once it's there, else the project's own folder. */
export function studioFolderOf(floor: StudioFloorRef): string {
  const t = studioTargetOf(floor)?.target;
  return t?.ready ? t.dir : floor.dir;
}
