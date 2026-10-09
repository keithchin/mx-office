// The toolkit stage a project is in, for attributing spend: read the way the setup panel reads it, from
// the project's default branch on origin (gate-source.ts: a quiet fetch of origin/<default> at most every
// minute and a half, PROJECT.md, intake.md and index.html with `git show`), so the ledger and the setup
// panel agree even when the floor's folder sits on an old branch. The first stage not settled; past the
// build plan (Stage 4), the first of 5-7 gate-check hasn't passed. "—" without the toolkit's pipeline.
// Booking can't wait on git, so the stage is kept per floor and read again in the background at most
// once a minute; until the first read lands (and for a project with no remote) the floor's folder is read.

import { dropKeys, onForgetFloor } from '../office/forget.js';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { StageId } from '../../shared/budget/types.js';
import { stageVerdicts } from '../summary/project.js';
import { branchInfo, fetchDefault, GATE_FILES, showAt } from '../wizard/gate-source.js';
import { setupView, setupViewOf } from '../wizard/setup.js';

/** How often at most a floor's stage is read from origin again. */
const REFRESH_MS = 60_000;

const settled = (status: string) => status === 'PASS' || status === 'WAIVED';

/** The stage from the gate files' text (read with `read`). */
export function stageFrom(view: ReturnType<typeof setupViewOf>, indexHtml: string | undefined): StageId {
  if (!view.stages.length) return '—';
  if (view.show) return (view.stages.find((s) => !settled(s.status))?.id as StageId | undefined) ?? '4';
  if (!indexHtml) return '5';
  const v = new Map(stageVerdicts(indexHtml).map((x) => [x.id, x.status]));
  return (['5', '6', '7'] as const).find((id) => !settled(v.get(id) ?? '')) ?? '7';
}

/** The stage from the floor's folder (no remote, or until origin has been read). */
export function folderStage(dir: string): StageId {
  try {
    let html: string | undefined;
    try {
      statSync(path.join(dir, 'index.html'));
      html = readFileSync(path.join(dir, 'index.html'), 'utf8');
    } catch {
      html = undefined;
    }
    return stageFrom(setupView(dir), html);
  } catch {
    return '—';
  }
}

const cache = new Map<string, { stage: StageId; at: number }>();
const reading = new Set<string>();
onForgetFloor((f) => (dropKeys(cache, f), dropKeys(reading, f)));

/** Reads the stage from origin/<default> into the cache (the folder's when there's no remote). */
export async function refreshStage(dir: string, now = Date.now()): Promise<StageId> {
  let stage: StageId;
  try {
    const before = await branchInfo(dir);
    if (!before) stage = folderStage(dir);
    else {
      await fetchDefault(dir, before.def);
      const info = (await branchInfo(dir)) ?? before;
      const files: Partial<Record<(typeof GATE_FILES)[number], string>> = {};
      for (const f of GATE_FILES) {
        const text = await showAt(dir, info.sha, f);
        if (text !== undefined) files[f] = text;
      }
      stage = stageFrom(setupViewOf(files), files['index.html']);
    }
  } catch {
    stage = folderStage(dir);
  }
  cache.set(dir, { stage, at: now });
  return stage;
}

/** The stage the project in `dir` is in now (as last read; a fresh read starts in the background when due). */
export function currentStage(dir: string): StageId {
  const hit = cache.get(dir);
  if ((!hit || Date.now() - hit.at > REFRESH_MS) && !reading.has(dir)) {
    reading.add(dir);
    void refreshStage(dir).finally(() => reading.delete(dir));
  }
  return hit?.stage ?? folderStage(dir);
}
