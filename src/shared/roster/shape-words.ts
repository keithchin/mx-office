// What each team shape means for the person running the project, and which models it actually runs on at a
// budget level. Fewer agents shift work to you: the Playbooks' review rule (shared/review-gate.ts
// reviewRule) says a pull request is merged only after another Lead reviewed it, "on a team with no other
// Lead, the Project Manager reviews"; and without a Project Coordinator, escalations reach you from the
// member covering Management (or, on Solo, straight from the one agent). The models come from the level's
// settings (shared/budget/levels.ts), which budget/index.ts applyLevelToTeam gives every Lead: never a fixed
// word in the shape's copy (Solo used to say Sonnet while Fast runs it on Opus). Pure.

import type { LevelSettings, ModelWord } from '../budget/levels.js';
import type { TeamShape } from './coverage.js';

/** What the shape leaves to you, in a sentence: shown on the wizard's shape cards and the Team tab. */
export const SHAPE_LEAVES_YOU: Readonly<Record<TeamShape, string>> = {
  solo: 'You review every pull request: with no other Lead, the Playbook sends each one to you before it merges. Every escalation comes straight to you, with nobody to sort or relay it.',
  startup: 'The Chief Analyst and the Lead Developer review each other’s pull requests. With no Coordinator, the Chief Analyst relays the team’s escalations to you alongside its own work.',
  enterprise: 'The Leads review each other’s pull requests and the Project Coordinator sorts and relays escalations: the least of the three lands on you.',
};

const WORD: Record<ModelWord, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };

/** "Solo Lead on Opus; subagents on Sonnet where the role allows" for a shape at a level's settings. */
export function shapeModels(shape: TeamShape, s: Pick<LevelSettings, 'leadModel' | 'discoveryModel' | 'subagentModel'>): string {
  const who = shape === 'solo' ? 'Solo Lead' : shape === 'startup' ? 'Both Leads' : 'Coordinator and Leads';
  const lead = `${who} on ${WORD[s.leadModel]}`;
  const discovery = s.discoveryModel !== s.leadModel ? ` (Discovery on ${WORD[s.discoveryModel]})` : '';
  const subs = s.subagentModel === 'default' ? 'subagents on their own models' : `subagents on ${WORD[s.subagentModel]} where the role allows`;
  return `${lead}${discovery}; ${subs}`;
}
