// A member's 🧰 Skills window on the org chart: its skills in three groups (manage up, manage down,
// craft), each on or off, and for a gated one its gate (Ask / Propose / Tell / FYI) with whether that's
// the project's default for the autonomy level or the Project Manager's override, and a reset. Only
// the Project Manager (an admin) can change them; everyone else sees them read-only.

import { GATE_LABEL, GATES, GROUP_TITLE, type Gate, type SkillGroup, type SkillView } from '../../../shared/roster/skills';
import type { MemberView, RosterView } from '../../../shared/roster/types';
import { h, openModal } from '../dom';
import { act } from './api';

const GROUPS: SkillGroup[] = ['up', 'down', 'craft'];
const GATE_HINT: Record<Gate, string> = { ask: 'asks the Project Manager first', propose: 'proposes; the Project Manager approves', tell: 'decides, tells the Coordinator', fyi: 'decides; FYI to the Project Manager' };

function skillRow(v: RosterView, m: MemberView, s: SkillView, change: (body: Record<string, unknown>) => void): HTMLElement {
  const off = !v.admin;
  const on = h('input', { type: 'checkbox', checked: s.enabled, disabled: off, 'aria-label': `${s.title} on` }) as HTMLInputElement;
  on.addEventListener('change', () => change({ skill: s.key, enabled: on.checked }));
  let gate: HTMLElement | null = null;
  if (s.defaultGate) {
    const sel = h('select.ro-select.sk-gate', { disabled: off || !s.enabled, 'aria-label': `${s.title}: gate` }, ...GATES.map((g) => h('option', { value: g, selected: s.gate === g }, GATE_LABEL[g]))) as HTMLSelectElement;
    sel.addEventListener('change', () => change({ skill: s.key, gate: sel.value }));
    gate = h(
      'span.sk-gatebox',
      {},
      sel,
      h('span.sk-src', { class: s.overridden ? 'sk-override' : '' }, s.overridden ? `(override · default ${GATE_LABEL[s.defaultGate]})` : '(project default)'),
      s.overridden && v.admin ? h('button.btn.small.sk-reset', { type: 'button', title: `Back to the project's default for ${m.name}`, onclick: () => change({ skill: s.key, reset: true }) }, '↺ Reset') : null,
    );
  } else if (s.group !== 'craft') {
    gate = h('span.sk-src', {}, 'Always allowed');
  }
  return h(
    'li.sk-row',
    { class: s.enabled ? '' : 'sk-off', 'data-skill': s.key },
    h('label.sk-name', {}, on, ' ', h('b', {}, s.title)),
    gate,
    s.group !== 'craft' ? h('span.sk-does', {}, s.does, s.gate && s.enabled ? ` · ${m.name} ${GATE_HINT[s.gate]}` : '', s.how ? h('code', {}, s.how) : null) : null,
  );
}

function skillsBody(v: RosterView, m: MemberView, change: (body: Record<string, unknown>) => void): HTMLElement {
  const list = v.skills[m.role] ?? [];
  return h(
    'div.body.sk-body',
    {},
    h('p.ro-sub', {}, v.admin ? `Defaults follow the autonomy level (${v.settings.autonomy}); an override stays when the level changes. Changes rewrite ${m.name}'s Playbook, and ${m.name} is told if idle.` : 'Only the Project Manager (an admin) can change these.'),
    ...GROUPS.map((g) => {
      const rows = list.filter((s) => s.group === g);
      if (!rows.length) return null;
      return h('section.sk-group', { 'data-group': g }, h('h4', {}, GROUP_TITLE[g], g === 'craft' ? h('small', {}, ' toolkit skills its Playbook lists (off = not mentioned)') : null), h('ul.sk-list', { class: g === 'craft' ? 'sk-craft' : '' }, ...rows.map((s) => skillRow(v, m, s, change))));
    }),
  );
}

/** Opens a member's skills; `redraw` draws the team with what each change answered. */
export function openSkills(v: RosterView, m: MemberView, redraw: (v: RosterView) => void) {
  let view = v;
  const change = (body: Record<string, unknown>) =>
    void act(view.floor, 'skill', { role: m.role, ...body }).then((r) => {
      if (!r) return;
      view = r;
      redraw(r);
      win.querySelector('.sk-body')?.replaceWith(skillsBody(r, r.members.find((x) => x.role === m.role) ?? m, change));
    });
  const win = h('div.modal.sk-win', { role: 'dialog', 'aria-label': `${m.name}'s skills` }, h('header', {}, h('h2', {}, `🧰 ${m.name}'s skills · ${m.title}`)), skillsBody(v, m, change));
  openModal(win);
}
