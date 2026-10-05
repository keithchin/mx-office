// The Project Manager changing one member's skill from the Team tab (🧰 Skills): on/off and its gate,
// or back to the project's default. The member's Playbook is written again with it, and a hired one
// between turns is told in a short prompt (never one at work, asleep or asking a person).

import { isRoleId, type RoleId } from '../../shared/roster/roles.js';
import { cleanOverrides, effectiveSkill, GATE_WORDS, isGate, skillOf } from '../../shared/roster/skills.js';
import type { Roster } from './index.js';
import { skillsChangedPrompt } from './prompts.js';
import type { TeamFloor } from './types.js';

export interface SkillChange {
  skill: unknown;
  enabled?: unknown;
  /** A gate, or null for the project's default. */
  gate?: unknown;
  /** Both back to the project's default. */
  reset?: unknown;
}

export function changeSkill(roster: Roster, floor: TeamFloor, role: RoleId, c: SkillChange): string | undefined {
  if (!isRoleId(role)) return 'Which role?';
  const key = typeof c.skill === 'string' ? c.skill : '';
  const def = skillOf(role, key);
  if (!def) return 'No such skill for this role';
  const d = roster.data(floor.id);
  const m = d.members[role];
  const all = { ...(m.skills ?? {}) };
  const o = { ...(all[key] ?? {}) };
  if (c.reset === true) {
    delete o.enabled;
    delete o.gate;
  }
  if (typeof c.enabled === 'boolean') {
    if (c.enabled) delete o.enabled;
    else o.enabled = false;
  }
  if (c.gate === null) delete o.gate;
  else if (c.gate !== undefined) {
    if (!def.gates) return `${def.title} has no gate: it's always allowed`;
    if (!isGate(c.gate)) return 'ask, propose, tell or fyi';
    o.gate = c.gate;
  }
  all[key] = o;
  m.skills = cleanOverrides(role, all);
  const wrote = roster.members.rewrite(floor, role);
  const w = roster.workerOf(floor, m);
  const now = effectiveSkill(role, d.settings.autonomy, key, m.skills)!;
  if (wrote && w && (w.status === 'idle' || w.status === 'done') && def.group !== 'craft') {
    floor.prompt(w.id, skillsChangedPrompt([`- **${now.title}**: ${now.enabled ? (now.gate ? GATE_WORDS[now.gate] : 'always allowed') : 'off — escalate instead'}${now.how && now.enabled ? ` (\`${now.how}\`)` : ''}`]));
  }
  roster.touch(floor);
  return undefined;
}
