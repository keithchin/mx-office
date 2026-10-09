// Letting go of a deleted project in the office's memory (office/forget.ts: every per-floor cache, the
// roster file waiting to be written, the budget store, the pause and pacing, the live app…), and moving
// the office's shared records of it, its analysis runs and its workflow runs (pause, resume, the wizard),
// into its archive, so the same floor id added again before a restart starts clean.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunRecord as AnalysisRun } from '../../shared/analysis.js';
import { forgetFloor } from '../office/forget.js';
import type { DeleteFloor } from './types.js';

export interface SharedRecords {
  /** The analysis run store (server/analysis/store.ts). */
  runs?: { dropFloor(floor: string): AnalysisRun[] };
  /** The workflow engine (server/flow/engine.ts). */
  flows?: { forgetFloor(floor: string): unknown[] };
}

/** Lets go of the floor everywhere; resolves what went wrong (nothing stops the rest). */
export async function forgetProject(f: DeleteFloor, archiveDir: string, shared: SharedRecords): Promise<string[]> {
  const runs = shared.runs?.dropFloor(f.id) ?? [];
  const flows = shared.flows?.forgetFloor(f.id) ?? [];
  await mkdir(archiveDir, { recursive: true });
  if (runs.length) await writeFile(path.join(archiveDir, 'analysis-runs.jsonl'), runs.map((r) => `${JSON.stringify(r)}\n`).join(''));
  if (flows.length) await writeFile(path.join(archiveDir, 'flows.json'), `${JSON.stringify(flows, null, 2)}\n`);
  return forgetFloor({ id: f.id, dir: f.dir });
}
