// The team's shape and coverage on a floor (shared/roster/coverage.ts holds the rules): who the
// office's relays, the standup page and the project console go to (whoever covers Management), the
// roles a member's skills and subagents come from, and setting a floor's shape from the new-project
// wizard. Enterprise with every team covering itself answers exactly as the fixed roles did.

import { alsoCovers, defaultCoverage, managerOf, SHAPES, type TeamShape } from '../../shared/roster/coverage.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { audit, byWhom } from '../audit/index.js';
import type { Roster } from './index.js';
import type { RosterData } from './store.js';
import type { TeamFloor } from './types.js';

/** The role that covers Management on the floor: the Coordinator on an Enterprise team. */
export const managerRole = (d: Pick<RosterData, 'coverage'>): RoleId => managerOf(d.coverage);

/** The roles whose lanes a member covers besides its own, for its skills, gates and Playbook. */
export const alsoOf = (d: Pick<RosterData, 'coverage'>, role: RoleId): RoleId[] => alsoCovers(d.coverage, role);

/**
 * Sets the floor's team shape with its default coverage (the wizard's team step, before it hires): the
 * shape's roles are the ones the Team tab shows, and everything routed by team follows the coverage.
 * Playbooks of members already hired are written again with what they now cover.
 */
export function setShape(roster: Roster, floor: TeamFloor, shape: TeamShape, by: string): void {
  const d = roster.data(floor.id);
  if (d.shape === shape) return;
  const was = d.shape;
  d.shape = shape;
  d.coverage = defaultCoverage(shape);
  for (const r of SHAPES[shape].roles) roster.members.rewrite(floor, r);
  audit.record({ floor: floor.id, actor: byWhom(by), action: 'team.shape', target: { kind: 'team', id: floor.id, label: 'Team' }, summary: `Set the team's shape to ${SHAPES[shape].label} (was ${SHAPES[was].label})`, details: { before: was, after: shape, coverage: d.coverage }, severity: 'notice' });
  roster.touch(floor);
}
