// What each member of the team may do, as a catalogue of skills in three groups: managing up (to the
// Project Coordinator and the Project Manager), managing down (its subagents, or for the Coordinator
// the Leads) and its craft (the toolkit skills it works from). A manage-up/down skill has a gate:
// whether the agent asks the Project Manager first, proposes it for approval, does it and tells the
// Coordinator, or does it and files an FYI. The default gate comes from the floor's autonomy level;
// the Project Manager can override a skill per member (on/off, gate). One table, so the Playbooks,
// the prompts, the server's gate check and the Team tab can't disagree. Pure: the browser imports it too.

import type { AutonomyLevel } from './autonomy.js';
import { ROLE_BY_ID, type RoleId } from './roles.js';

export type SkillGroup = 'up' | 'down' | 'craft';
export type Gate = 'ask' | 'propose' | 'tell' | 'fyi';
export const GATES: readonly Gate[] = ['ask', 'propose', 'tell', 'fyi'];
export const isGate = (v: unknown): v is Gate => typeof v === 'string' && (GATES as readonly string[]).includes(v);

export const GROUP_TITLE: Record<SkillGroup, string> = { up: '⬆️ Manage up', down: '⬇️ Manage down', craft: '🛠️ Craft' };
export const GATE_LABEL: Record<Gate, string> = { ask: 'Ask', propose: 'Propose', tell: 'Tell', fyi: 'FYI' };
/** The gate in plain words, for the Playbook and the panel. */
export const GATE_WORDS: Record<Gate, string> = {
  ask: 'ask the Project Manager first (an escalation); it happens only once they approve',
  propose: 'you propose it, the Project Manager approves (in their approvals)',
  tell: 'you decide, then the office tells the Project Coordinator',
  fyi: 'you decide; the Project Manager gets an FYI',
};

export interface SkillDef {
  key: string;
  group: SkillGroup;
  title: string;
  /** What it is, one line. */
  does: string;
  /** How the agent does it, when there's a command for it. */
  how?: string;
  /** The default gate at each autonomy level 1–4; undefined: not gated (always allowed). */
  gates?: readonly [Gate, Gate, Gate, Gate];
}

const all = (g: Gate) => [g, g, g, g] as const;

/** Managing up: every member has these (the Coordinator's go to the Project Manager directly). */
const UP: SkillDef[] = [
  { key: 'report', group: 'up', title: 'Report to the Coordinator', does: 'Journal entries and standup answers the Project Coordinator reads', how: 'your team journal', gates: all('tell') },
  { key: 'propose', group: 'up', title: 'Propose at standup', does: 'What needs the Project Manager goes under ### Proposals', how: 'your team journal, ### Proposals', gates: all('propose') },
  { key: 'escalate', group: 'up', title: 'Escalate to the Project Manager', does: "What can't wait for the standup", how: 'office-workers escalate' },
  { key: 'ask-client', group: 'up', title: 'Ask the client via the Project Manager', does: 'A question for the client goes to the Project Manager, who asks them', how: 'office-workers escalate --trigger blocked', gates: all('ask') },
];

/** Managing down, for a Lead: its subagents. */
const DOWN_LEAD: SkillDef[] = [
  { key: 'dispatch', group: 'down', title: 'Dispatch subagents', does: 'Hand a subagent a task with the Agent tool', how: 'the Agent tool', gates: all('tell') },
  { key: 'review', group: 'down', title: 'Review & request rework', does: "Review every result and record the verdict: it's the subagent's track record", how: 'office-workers subagent review <name> --verdict accept|rework --note "…"', gates: all('tell') },
  { key: 'warn', group: 'down', title: 'Put a subagent on warning', does: 'Adds a ⚠️ Warning with what went wrong to its definition, for its next runs', how: 'office-workers subagent warn <name> --reason "…"', gates: ['propose', 'tell', 'tell', 'fyi'] },
  { key: 'bench', group: 'down', title: 'Bench a subagent', does: 'Takes it off your team until it is reinstated (after a cool-down, or by the Project Manager)', how: 'office-workers subagent bench <name> --reason "…"', gates: ['ask', 'propose', 'tell', 'fyi'] },
  { key: 'swap-model', group: 'down', title: "Swap a subagent's model", does: 'Sets the model its definition runs on', how: 'office-workers subagent swap-model <name> --model haiku|sonnet|opus', gates: ['ask', 'propose', 'tell', 'fyi'] },
  { key: 'reinstate', group: 'down', title: 'Reinstate a subagent', does: 'Brings a benched subagent back (its warning notes stay)', how: 'office-workers subagent reinstate <name>', gates: all('tell') },
];

/** Managing down, for the Project Coordinator: the Leads. Listed only: the office enforces nothing here, and the Coordinator never benches a Lead. */
const DOWN_PM: SkillDef[] = [
  { key: 'nudge-lead', group: 'down', title: 'Nudge a Lead', does: 'A short prompt to a Lead that is stuck or quiet', how: 'office-workers tell <name>', gates: all('tell') },
  { key: 'reassign-lead', group: 'down', title: 'Reassign work between Leads', does: "Move a task from one Lead's lane to another's", how: 'the journals, and office-workers tell', gates: ['ask', 'propose', 'tell', 'fyi'] },
];

/** The subagent actions the office carries out (bin/office-workers.js subagent …), each its skill. */
export type SubagentOp = 'warn' | 'bench' | 'swap-model' | 'reinstate';
export const SUBAGENT_OPS: readonly SubagentOp[] = ['warn', 'bench', 'swap-model', 'reinstate'];
export const isSubagentOp = (v: unknown): v is SubagentOp => typeof v === 'string' && (SUBAGENT_OPS as readonly string[]).includes(v);

const craft = (role: RoleId): SkillDef[] => ROLE_BY_ID.get(role)!.toolkitSkills.map((s) => ({ key: `craft:${s}`, group: 'craft', title: s, does: `The toolkit's ${s} skill` }));

/** How strict a gate is: when a member covers several roles, the strictest of theirs wins. */
const STRICT: Record<Gate, number> = { ask: 3, propose: 2, tell: 1, fyi: 0 };

/**
 * Every skill a role has: managing up, managing down (its subagents, or the Leads), its craft. `also`:
 * the roles whose teams it covers besides its own (shared/roster/coverage.ts): it gets the union of their
 * skills, a skill both have keeps the strictest gate at each level, and a generalist (the Solo Lead) keeps
 * its own short craft list. Empty (every team covering itself): exactly the role's own.
 */
export function skillsFor(role: RoleId, also: readonly RoleId[] = []): SkillDef[] {
  const own = (r: RoleId) => [...UP, ...(r === 'pm' ? DOWN_PM : DOWN_LEAD), ...(r === role || !ROLE_BY_ID.get(role)?.generalist ? craft(r) : [])];
  const out: SkillDef[] = [];
  const at = new Map<string, number>();
  for (const r of [role, ...also.filter((x) => x !== role)]) {
    for (const s of own(r)) {
      const i = at.get(s.key);
      if (i === undefined) {
        at.set(s.key, out.length);
        out.push(s);
        continue;
      }
      const was = out[i];
      if (s.gates && was.gates) out[i] = { ...was, gates: was.gates.map((g, n) => (STRICT[s.gates![n]] > STRICT[g] ? s.gates![n] : g)) as unknown as SkillDef['gates'] };
    }
  }
  return out;
}

export const skillOf = (role: RoleId, key: string, also: readonly RoleId[] = []): SkillDef | undefined => skillsFor(role, also).find((s) => s.key === key);

/** What the Project Manager changed of one member's skill. */
export interface SkillOverride {
  enabled?: boolean;
  gate?: Gate;
}
export type SkillOverrides = Record<string, SkillOverride>;

/** A skill's default gate at `level`; undefined when it isn't gated. */
export const defaultGate = (s: SkillDef, level: AutonomyLevel): Gate | undefined => s.gates?.[level - 1];

export interface SkillView {
  key: string;
  group: SkillGroup;
  title: string;
  does: string;
  how?: string;
  enabled: boolean;
  /** The gate that applies (undefined: not gated), the level's default, and whether it's an override. */
  gate?: Gate;
  defaultGate?: Gate;
  overridden: boolean;
}

/** A member's skills as they stand: the defaults for `level` with its overrides on top. */
export function effectiveSkills(role: RoleId, level: AutonomyLevel, overrides: SkillOverrides = {}, also: readonly RoleId[] = []): SkillView[] {
  return skillsFor(role, also).map((s) => {
    const o = overrides[s.key] ?? {};
    const def = defaultGate(s, level);
    const gate = def && o.gate ? o.gate : def;
    return { key: s.key, group: s.group, title: s.title, does: s.does, ...(s.how ? { how: s.how } : {}), enabled: o.enabled ?? true, gate, defaultGate: def, overridden: o.enabled === false || (!!def && !!o.gate) };
  });
}

/** One member's skill, or undefined when the role doesn't have it. */
export const effectiveSkill = (role: RoleId, level: AutonomyLevel, key: string, overrides?: SkillOverrides, also: readonly RoleId[] = []) => effectiveSkills(role, level, overrides, also).find((s) => s.key === key);

/** Overrides from what was saved or sent: only the role's skills, only real values; a no-op override is dropped. */
export function cleanOverrides(role: RoleId, raw: unknown, also: readonly RoleId[] = []): SkillOverrides {
  const out: SkillOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = skillOf(role, key, also);
    if (!s || !v || typeof v !== 'object') continue;
    const o = v as SkillOverride;
    const clean: SkillOverride = {};
    if (o.enabled === false) clean.enabled = false;
    if (s.gates && isGate(o.gate)) clean.gate = o.gate;
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

/** The Playbook's skills section: each enabled skill, with its gate in plain words. */
export function skillsBrief(role: RoleId, level: AutonomyLevel, overrides: SkillOverrides = {}, also: readonly RoleId[] = []): string[] {
  const list = effectiveSkills(role, level, overrides, also);
  const line = (s: SkillView) => `- **${s.title}** — ${s.gate ? GATE_WORDS[s.gate] : 'always allowed'}${s.how ? ` (\`${s.how}\`)` : ''}. ${s.does}.`;
  const group = (g: SkillGroup) => list.filter((s) => s.group === g && s.enabled && g !== 'craft');
  const off = list.filter((s) => !s.enabled && s.group !== 'craft');
  return [
    '## Your skills',
    `What you may do and how, at autonomy level ${level}. The office enforces the gates of the \`office-workers subagent\` commands: \`ask\` raises an escalation for you, \`propose\` files it in the Project Manager's approvals, \`tell\` and \`fyi\` do it straight away.`,
    '',
    `**${GROUP_TITLE.up}**`,
    ...group('up').map(line),
    '',
    `**${GROUP_TITLE.down}**`,
    ...group('down').map(line),
    ...(off.length ? ['', `Not yours on this project (the Project Manager turned them off): ${off.map((s) => s.title).join('; ')}. Escalate instead.`] : []),
    '',
  ];
}

/** The craft skills a member has on (the toolkit section of its Playbook lists only these). */
export const craftOn = (role: RoleId, overrides: SkillOverrides = {}, also: readonly RoleId[] = []): string[] =>
  skillsFor(role, also).filter((s) => s.group === 'craft' && overrides[s.key]?.enabled !== false).map((s) => s.title);
