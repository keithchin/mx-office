// An Expert project's own settings, committed in agent-office.project.json under `expert` by the Expert wizard
// (wizard/expert-step.ts): the model its session starts on (Sonnet by default, Opus one switch away), whether demo
// users are on for local work (they block Deploy, nothing else), and the mxcli pin. Read when the session starts,
// so the model applies as `--model` on the real `claude`; nothing is ever typed into the session.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_EXPERT_MODEL, isExpertModel, type ExpertModel } from '../../shared/expert-setup.js';
import { PROJECT_FILE } from '../toolkit-pin/record.js';

export interface ExpertSettings {
  model: ExpertModel;
  demoUsers?: boolean;
  mxcli?: string;
  /** Set by the wizard (an attached folder has none: its session starts on the person's own default model). */
  fromWizard: boolean;
}

const cache = new Map<string, { stamp: string; s: ExpertSettings }>();
const NONE: ExpertSettings = { model: DEFAULT_EXPERT_MODEL, fromWizard: false };

/** The project's Expert settings (re-read only when the file changed). */
export function expertSettingsOf(dir: string): ExpertSettings {
  const f = path.join(dir, PROJECT_FILE);
  try {
    const st = statSync(f);
    const stamp = `${st.mtimeMs}:${st.size}`;
    const hit = cache.get(f);
    if (hit?.stamp === stamp) return hit.s;
    const x = (JSON.parse(readFileSync(f, 'utf8')) as { expert?: Record<string, unknown> }).expert;
    const s: ExpertSettings =
      x && typeof x === 'object'
        ? { model: isExpertModel(x.model) ? x.model : DEFAULT_EXPERT_MODEL, fromWizard: true, ...(typeof x.demoUsers === 'boolean' ? { demoUsers: x.demoUsers } : {}), ...(typeof x.mxcli === 'string' ? { mxcli: x.mxcli } : {}) }
        : NONE;
    cache.set(f, { stamp, s });
    return s;
  } catch {
    return NONE;
  }
}

/** The model to start the session on: the wizard's choice; undefined for an attached folder (the person's own default). */
export function sessionModelOf(dir: string): ExpertModel | undefined {
  const s = expertSettingsOf(dir);
  return s.fromWizard ? s.model : undefined;
}
