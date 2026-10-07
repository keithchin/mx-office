// The Team tab's org chart: the Project Coordinator over the four Leads, each card with its fixed name,
// where it stands (working, idle, benched…), its model and cost, its team's subagents and the newest
// entry in its team journal; and what the Project Manager can do to it (hire or wake, bench, rename, change model).

import { CLAUDE_MODEL_NAMES, claudeModelName, claudePermissionMode } from '../../../shared/providers';
import { ROLE_BY_ID } from '../../../shared/roster/roles';
import type { MemberStatus, MemberView, RosterView } from '../../../shared/roster/types';
import { h, timeAgo } from '../dom';
import { jeffCard } from '../jeff';
import { act } from './api';
import { askText } from './ask';
import { openSkills } from './skills';
import { subagentList } from './subagents';
import { coverageOf, coverageTable, managerIn } from './coverage';
import { subagentDefsOf } from '../../../shared/roster/coverage';
import { TEAM_META } from '../../../shared/roster/card-team';

export const STATUS_TEXT: Record<MemberStatus, string> = {
  'not-hired': 'Not hired',
  working: 'Working',
  'needs-you': 'Needs you',
  idle: 'Idle',
  asleep: 'Asleep',
  benching: 'Writing handoff',
  benched: 'Benched',
};

// The models a role can run on, by what they're called today ("Sonnet 5.5"): Claude Code's aliases, newest family first.
// Haiku has no auto mode, so it says it runs in accept edits mode (shared/providers.ts).
const MODELS = (['fable', 'opus', 'sonnet', 'haiku'] as const).map((value) => ({ value, label: claudePermissionMode(value) ? `${CLAUDE_MODEL_NAMES[value]} (accept edits)` : CLAUDE_MODEL_NAMES[value] }));
/** "Sonnet 5.5" for a role's model alias, or the id as it is. */
const modelName = (m: string) => (CLAUDE_MODEL_NAMES as Record<string, string>)[m] ?? claudeModelName(m) ?? m;

export interface OrgDeps {
  /** Opens a worker's terminal (the 1D view's). */
  openWorker(id: string): void;
  /** Draw the team again with what an action answered. */
  redraw(view: RosterView): void;
}

/** One member's card (a team page shows its Lead with it too, ui/teams/page.ts). */
export function memberCard(v: RosterView, m: MemberView, deps: OrgDeps): HTMLElement {
  const role = ROLE_BY_ID.get(m.role)!;
  const subs = subagentDefsOf(coverageOf(v), m.role);
  const also = (m.covers ?? []).filter((t) => t !== m.team);
  const run = (action: string, extra: Record<string, unknown> = {}) => void act(v.floor, action, { role: m.role, ...extra }).then((r) => r && deps.redraw(r));
  const hired = !!m.workerId;
  const canHire = !hired || m.status === 'asleep';
  const canBench = hired && (m.status === 'idle' || m.status === 'asleep');
  const idleFor = m.idleSince && v.settings.idleMinutes > 0 ? Math.max(0, v.settings.idleMinutes - Math.floor((Date.now() - m.idleSince) / 60_000)) : undefined;
  const facts = [
    `🧠 ${m.model}`,
    m.cost !== undefined ? `💵 $${m.cost.toFixed(2)}` : null,
    idleFor !== undefined ? `⏳ benched in ${idleFor} min` : null,
    m.status === 'benched' && m.benchedAt ? `🪑 ${timeAgo(m.benchedAt)}` : null,
    m.handoffAt ? '📝 handoff kept' : null,
  ].filter(Boolean);
  return h(
    'article.ro-card',
    { class: `ro-${m.status}${m.role === 'pm' ? ' ro-pm' : ''}`, 'data-role': m.role },
    h(
      'header.ro-card-h',
      {},
      h('span.ro-icon', { 'aria-hidden': 'true' }, m.icon),
      h('span.ro-who', {}, h('span.ro-name', {}, m.name), h('span.ro-title', {}, m.title)),
      h('span.ro-pill', { class: `ro-pill-${m.status}` }, STATUS_TEXT[m.status]),
    ),
    also.length ? h('p.ro-covers', {}, '🧩 Also covers ', also.map((t) => `${TEAM_META[t].icon} ${TEAM_META[t].name}`).join(', ')) : null,
    m.activity ? h('p.ro-activity', {}, m.activity) : null,
    h('p.ro-facts', {}, facts.join(' · ')),
    subs.length ? (subagentList(v, m.role, deps.redraw) ?? h('p.ro-subs', {}, '👥 ', subs.map((s) => s.title + 's').join(', '))) : h('p.ro-subs', {}, '👥 Coordinates the Leads'),
    h(
      'div.ro-journal',
      {},
      h('span.ro-journal-h', {}, `📓 docs/team/${m.team}.md`),
      m.lastJournal ? h('span.ro-journal-e', {}, h('b', {}, m.lastJournal.heading), ' ', m.lastJournal.excerpt) : h('span.ro-journal-e.ro-dim', {}, 'No entries yet'),
    ),
    h(
      'div.ro-actions',
      {},
      canHire && v.admin
        ? h('button.btn.small.primary', {
            type: 'button',
            title: m.status === 'asleep' ? `Wake ${m.name}: its session carries on` : `Hire ${m.name}: a fresh session from its Playbook${m.handoffAt ? ' and handoff note' : ''}`,
            onclick: () =>
              m.status === 'asleep'
                ? run('hire')
                : askText(
                    { title: `Hire ${m.name}, the ${m.title}`, label: 'A task to start on (optional): it reads its Playbook and journal first', long: true, ok: '🤝 Hire', optional: true, pick: { label: 'Model', options: MODELS, value: m.model } },
                    // A different model is saved for the role first, so this hire (and the next) runs on it.
                    (task, model) => void (model && model !== m.model ? act(v.floor, 'model', { role: m.role, model }) : Promise.resolve(null)).then(() => run('hire', task ? { task } : {})),
                  ),
          }, m.status === 'asleep' ? '⏰ Wake' : '🤝 Hire')
        : null,
      hired ? h('button.btn.small', { type: 'button', title: `Open ${m.name}'s terminal`, onclick: () => deps.openWorker(m.workerId!) }, '🖥️ Terminal') : null,
      h('button.btn.small.ro-skills', { type: 'button', title: `${m.name}'s skills and their gates${v.admin ? '' : ' (read-only)'}`, onclick: () => openSkills(v, m, deps.redraw) }, '🧰 Skills'),
      canBench && v.admin ? h('button.btn.small', { type: 'button', title: `Ask ${m.name} for a handoff note and lessons, then stop it and clear its session`, onclick: () => run('bench') }, '🪑 Bench') : null,
      v.admin ? h('button.btn.small', { type: 'button', title: 'Rename this role', onclick: () => askText({ title: `Rename the ${m.title}`, label: 'Name', value: m.name, ok: 'Rename' }, (name) => run('rename', { name })) }, '✏️') : null,
      v.admin ? h('button.btn.small', { type: 'button', title: 'Change the model (from its next hire)', onclick: () => askText({ title: `${m.name}'s model`, label: 'From its next hire (a running session keeps its model)', ok: 'Save', pickOnly: true, pick: { label: 'Model', options: MODELS, value: m.model } }, (_, model) => model && model !== m.model && run('model', { model })) }, `🧠 ${modelName(m.model)}`) : null,
    ),
  );
}

export function orgChart(v: RosterView, deps: OrgDeps): HTMLElement {
  // On top, whoever covers Management: the Coordinator, or the Chief Analyst / Solo Lead on a smaller team.
  const pm = managerIn(v) ?? v.members[0];
  const leads = v.members.filter((m) => m !== pm);
  return h(
    'section.ro-org',
    { 'aria-label': 'Org chart' },
    h('div.ro-top', {}, pm ? memberCard(v, pm, deps) : null, jeffCard(v.floor)),
    leads.length ? h('div.ro-line', { 'aria-hidden': 'true' }) : null,
    leads.length ? h('div.ro-leads', {}, ...leads.map((m) => memberCard(v, m, deps))) : null,
    coverageTable(v) ?? null,
  );
}
