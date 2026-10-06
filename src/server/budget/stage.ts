// The toolkit stage a project is in, for attributing spend: the first stage the setup panel's reading
// (wizard/setup.ts: intake.md, PROJECT.md and gate-check's index.html in the floor's folder) hasn't
// settled, and past the build plan (Stage 4), the first of 5-7 gate-check hasn't passed. "—" for a
// project without the toolkit's pipeline. Read only when a file has changed (setupView caches by stat).

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { StageId } from '../../shared/budget/types.js';
import { stageVerdicts } from '../summary/project.js';
import { setupView } from '../wizard/setup.js';

const settled = (status: string) => status === 'PASS' || status === 'WAIVED';
const late = new Map<string, { key: string; stage: StageId }>();

/** Past Stage 4: the first of 5, 6, 7 index.html doesn't show as passed (5 when it shows none). */
function lateStage(dir: string): StageId {
  const file = path.join(dir, 'index.html');
  let key = '-';
  try {
    const s = statSync(file);
    key = `${s.mtimeMs}:${s.size}`;
  } catch {
    return '5';
  }
  const hit = late.get(dir);
  if (hit?.key === key) return hit.stage;
  let stage: StageId = '5';
  try {
    const v = new Map(stageVerdicts(readFileSync(file, 'utf8')).map((x) => [x.id, x.status]));
    stage = (['5', '6', '7'] as const).find((id) => !settled(v.get(id) ?? '')) ?? '7';
  } catch {
    // unreadable: building
  }
  late.set(dir, { key, stage });
  return stage;
}

/** The stage the project in `dir` is in now. */
export function currentStage(dir: string): StageId {
  try {
    const v = setupView(dir);
    if (!v.stages.length) return '—';
    if (v.show) return (v.stages.find((s) => !settled(s.status))?.id as StageId | undefined) ?? '4';
    return lateStage(dir);
  } catch {
    return '—';
  }
}
