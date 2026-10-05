// The Firm's people on /firm: a card per reviewer with its portrait, role, model badge, who it's
// attached to on a project team, its skills and what it produces. An admin can change its model.

import { firmModelLabel, FIRM_MODELS } from '../../shared/firm/roles';
import { ROLE_BY_ID } from '../../shared/roster/roles';
import { h, toast } from '../ui/dom';
import { firmAction, type FirmView } from './api';
import { portrait } from './portraits';

const STAFFING = { always: 'Leads every engagement', default: 'On by default', optional: 'Optional' } as const;

export function renderPeople(root: HTMLElement, view: FirmView, busy: Set<string>, reload: () => void) {
  const card = (p: FirmView['people'][number]) =>
    h(
      'article.firm-person',
      { class: busy.has(p.id) ? 'away' : '' },
      h('div.firm-person-top', {},
        portrait(p, 84),
        h('div.firm-person-id', {},
          h('h3', {}, p.name),
          h('p.firm-role', {}, `${p.icon} ${p.title}`),
          h('p.firm-attached', {}, `↔ ${ROLE_BY_ID.get(p.interviews)?.title ?? p.interviews} · ${STAFFING[p.staffing]}`),
          view.admin
            ? h('select.firm-model', { 'aria-label': `${p.name}'s model`, onchange: (e: Event) => void setModel(p.id, (e.target as HTMLSelectElement).value) }, ...FIRM_MODELS.map((m) => h('option', { value: m.id, selected: m.id === p.model }, m.label)))
            : h('span.firm-badge', {}, firmModelLabel(p.model)),
          busy.has(p.id) ? h('span.firm-away', {}, '🧳 With a client') : h('span.firm-in', {}, '🪑 In the office'),
        ),
      ),
      h('p.firm-mission', {}, p.mission),
      h('ul.firm-skills', {}, ...p.skills.map((s) => h('li', {}, h('b', {}, s.name), ` — ${s.checks}`))),
      h('p.firm-produces', {}, h('small', {}, 'Produces: '), p.produces.join(' · ')),
    );

  async function setModel(id: string, model: string) {
    try {
      await firmAction({ action: 'models', models: { [id]: model } });
      toast(`${view.people.find((p) => p.id === id)?.name} now runs on ${firmModelLabel(model)} (from the next engagement)`);
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  root.replaceChildren(
    h('h2.lite-h.firm-h', {}, 'Our people', h('span.firm-sub', {}, 'Independent Reviewer Agents · default model Fable 5.1 — best-in-class reviewing, not cheap')),
    h('div.firm-people', {}, ...view.people.map(card)),
  );
}
