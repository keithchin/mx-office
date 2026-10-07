// The team's shape and coverage on the Team tab and the Command Center (shared/roster/coverage.ts): the
// "Solo · Lean" chip, the read-only coverage table (which member covers each team), and the "covered
// by …" notes the team pages, the deliverables and the 2D view's signposts use. An Enterprise team
// with every team covering itself shows no table and no notes: just its chip.

import { coverageRows, coveredNote, managerOf, SHAPES, TEAM_OWNER, type Coverage } from '../../../shared/roster/coverage';
import type { RoleId, TeamId } from '../../../shared/roster/roles';
import { TEAM_META } from '../../../shared/roster/card-team';
import type { MemberView, RosterView } from '../../../shared/roster/types';
import { h } from '../dom';
import './coverage.css';

const LEVEL_WORD: Record<string, string> = { lean: 'Lean', balanced: 'Balanced', fast: 'Fast', manual: 'Manual' };

/** The coverage a view carries, or every team covering itself (an office from before shapes). */
export const coverageOf = (v: Pick<RosterView, 'coverage'> | undefined): Coverage => v?.coverage ?? { ...TEAM_OWNER };

/** The member who covers Management: the one the Command Center talks to. */
export const managerIn = (v: RosterView | undefined): MemberView | undefined => v?.members.find((m) => m.role === managerOf(coverageOf(v)));

/** The member who covers a team. */
export const covererIn = (v: RosterView | undefined, team: TeamId): MemberView | undefined => v?.members.find((m) => m.role === coverageOf(v)[team]);

const nameIn = (v: RosterView | undefined) => (role: RoleId) => v?.members.find((m) => m.role === role)?.name ?? role;

/** "covered by Sam (Solo Lead)" for a team another member covers; undefined when it covers itself. */
export const coverNote = (v: RosterView | undefined, team: TeamId): string | undefined => (v ? coveredNote(coverageOf(v), team, nameIn(v)) : undefined);

/** "Solo · Lean": the team's shape and the project's budget level. */
export function shapeText(v: Pick<RosterView, 'shape' | 'level'>): string {
  const s = SHAPES[v.shape ?? 'enterprise'];
  return `${s.label}${v.level ? ` · ${LEVEL_WORD[v.level] ?? v.level}` : ''}`;
}

export function shapeChip(v: Pick<RosterView, 'shape' | 'level'>): HTMLElement {
  const s = SHAPES[v.shape ?? 'enterprise'];
  return h('span.ro-shape-chip', { title: `Team shape: ${s.label} — ${s.who}${v.level ? ` Budget level: ${LEVEL_WORD[v.level] ?? v.level}.` : ''}` }, h('span.ao-emo', { 'aria-hidden': 'true' }, `${s.icon} `), shapeText(v));
}

/** The coverage table: which member covers each team (read-only for now). Undefined on a team that covers itself. */
export function coverageTable(v: RosterView): HTMLElement | undefined {
  const c = coverageOf(v);
  const rows = coverageRows(c, nameIn(v));
  if (rows.every((r) => r.own)) return undefined;
  return h(
    'section.ro-coverage',
    { 'aria-label': 'Team coverage' },
    h('h3.ro-coverage-h', {}, `🧩 Coverage · ${SHAPES[v.shape ?? 'enterprise'].label}`),
    h('p.ro-dim', {}, SHAPES[v.shape ?? 'enterprise'].who),
    h(
      'table.ro-coverage-t',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Team'), h('th', {}, 'Covered by'))),
      h('tbody', {}, ...rows.map((r) => h('tr', { 'data-team': r.team }, h('td', {}, `${TEAM_META[r.team].icon} ${TEAM_META[r.team].name}`), h('td', {}, h('b', {}, r.name), ` · ${r.title}${r.own ? '' : ' (covering)'}`)))),
    ),
  );
}
