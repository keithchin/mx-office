// The Team tab's org chart: the Project Manager over the four Leads, each card with its fixed name,
// where it stands (working, idle, benched…), its model and cost, its team's subagents and the newest
// entry in its team journal; and what the CTO can do to it (hire or wake, bench, rename, change model).

import { ROLE_BY_ID } from '../../../shared/roster/roles';
import type { MemberStatus, MemberView, RosterView } from '../../../shared/roster/types';
import { h, timeAgo } from '../dom';
import { act } from './api';
import { askText } from './ask';

export const STATUS_TEXT: Record<MemberStatus, string> = {
  'not-hired': 'Not hired',
  working: 'Working',
  'needs-you': 'Needs you',
  idle: 'Idle',
  asleep: 'Asleep',
  benching: 'Writing handoff',
  benched: 'Benched',
};

const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];

export interface OrgDeps {
  /** Opens a worker's terminal (the 1D view's). */
  openWorker(id: string): void;
  /** Draw the team again with what an action answered. */
  redraw(view: RosterView): void;
}

/** One member's card (a team page shows its Lead with it too, ui/teams/page.ts). */
export function memberCard(v: RosterView, m: MemberView, deps: OrgDeps): HTMLElement {
  const role = ROLE_BY_ID.get(m.role)!;
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
    m.activity ? h('p.ro-activity', {}, m.activity) : null,
    h('p.ro-facts', {}, facts.join(' · ')),
    role.subagents.length ? h('p.ro-subs', {}, '👥 ', role.subagents.map((s) => s.title + 's').join(', ')) : h('p.ro-subs', {}, '👥 Coordinates the Leads'),
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
      canBench && v.admin ? h('button.btn.small', { type: 'button', title: `Ask ${m.name} for a handoff note and lessons, then stop it and clear its session`, onclick: () => run('bench') }, '🪑 Bench') : null,
      v.admin ? h('button.btn.small', { type: 'button', title: 'Rename this role', onclick: () => askText({ title: `Rename the ${m.title}`, label: 'Name', value: m.name, ok: 'Rename' }, (name) => run('rename', { name })) }, '✏️') : null,
      v.admin ? h('button.btn.small', { type: 'button', title: 'Change the model (from its next hire)', onclick: () => askText({ title: `${m.name}'s model`, label: 'From its next hire (a running session keeps its model)', value: m.model, ok: 'Save', choices: MODELS }, (model) => run('model', { model })) }, `🧠 ${m.model}`) : null,
    ),
  );
}

export function orgChart(v: RosterView, deps: OrgDeps): HTMLElement {
  const pm = v.members.find((m) => m.role === 'pm')!;
  const leads = v.members.filter((m) => m.role !== 'pm');
  return h('section.ro-org', { 'aria-label': 'Org chart' }, h('div.ro-top', {}, memberCard(v, pm, deps)), h('div.ro-line', { 'aria-hidden': 'true' }), h('div.ro-leads', {}, ...leads.map((m) => memberCard(v, m, deps))));
}
