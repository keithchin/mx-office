// The team settings: the autonomy level (what needs the Project Manager), how long a Lead may sit idle before
// it's benched, the review nudge, the standup's schedule, a daily cost cap per autonomy level, and a dry
// run for issues, and Jeff the Router's two modes.
// Only the Project Manager (an admin) can save them; everyone else sees them read-only.

import { AUTONOMY, DECISION_LABEL, REVIEW_POLICY, type AutonomyLevel } from '../../../shared/roster/autonomy';
import type { RosterSettings, RosterView } from '../../../shared/roster/types';
import { DEFAULT_JEFF, JEFF_MODES, type JeffMode, type JudgeKind } from '../../../shared/judge';
import { h } from '../dom';
import { JEFF_MODE_LABEL, jeffPortrait } from '../jeff';
import { act } from './api';

const LEVELS: AutonomyLevel[] = [1, 2, 3, 4];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function settingsView(v: RosterView, redraw: (v: RosterView) => void): HTMLElement {
  const s: RosterSettings = structuredClone(v.settings);
  const off = !v.admin;
  const levels = h(
    'div.ro-levels',
    { role: 'radiogroup', 'aria-label': 'Autonomy level' },
    ...LEVELS.map((l) => {
      const a = AUTONOMY[l];
      const input = h('input', { type: 'radio', name: 'ro-level', value: l, disabled: off, checked: s.autonomy === l, onchange: () => (s.autonomy = l) });
      return h(
        'label.ro-level',
        { class: s.autonomy === l ? 'on' : '' },
        input,
        h('span.ro-level-n', {}, String(l)),
        h('span.ro-level-t', {}, h('b', {}, a.name), h('span', {}, a.summary), h('small', {}, `Project Manager approves: ${a.approves.map((k) => DECISION_LABEL[k]).join(', ')}`), h('small', {}, `Leads escalate reviews: ${REVIEW_POLICY[l].rule.replace(/^Escalate /, '')}`)),
      );
    }),
  );
  levels.addEventListener('change', () => levels.querySelectorAll('.ro-level').forEach((el) => el.classList.toggle('on', (el.querySelector('input') as HTMLInputElement).checked)));
  const num = (value: number | undefined, set: (n: number | undefined) => void, attrs: Record<string, string | number> = {}) => {
    const i = h('input.ro-num', { type: 'number', min: 0, step: 'any', disabled: off, ...attrs });
    i.value = value === undefined ? '' : String(value);
    i.addEventListener('input', () => set(i.value === '' ? undefined : Number(i.value)));
    return i;
  };
  const text = (value: string, set: (t: string) => void, attrs: Record<string, string> = {}) => {
    const i = h('input.ro-text', { type: 'text', disabled: off, ...attrs });
    i.value = value;
    i.addEventListener('input', () => set(i.value));
    return i;
  };
  const check = (on: boolean, set: (b: boolean) => void, label: string) => {
    const i = h('input', { type: 'checkbox', disabled: off, checked: on, onchange: () => set(i.checked) });
    return h('label.ro-check', {}, i, ' ', label);
  };
  s.jeff ??= { ...DEFAULT_JEFF };
  const mode = (label: string, kind: JudgeKind) => {
    const sel = h('select.ro-select', { disabled: off, 'aria-label': `Jeff: ${label}` }, ...JEFF_MODES.map((m) => h('option', { value: m, selected: s.jeff[kind] === m }, JEFF_MODE_LABEL[m])));
    sel.addEventListener('change', () => (s.jeff[kind] = sel.value as JeffMode));
    return h('label.ro-jeff-mode', {}, h('b', {}, label), sel);
  };
  const days = h('div.ro-days', {}, ...DAYS.map((d, i) => check(s.schedule.days.includes(i), (b) => (s.schedule.days = b ? [...s.schedule.days, i].sort() : s.schedule.days.filter((x) => x !== i)), d)));
  const save = h('button.btn.primary', { type: 'button', disabled: off, id: 'ro-save-settings', onclick: () => void act(v.floor, 'settings', { settings: s }).then((r) => r && redraw(r)) }, '💾 Save settings');
  return h(
    'section.ro-settings',
    { 'aria-label': 'Team settings' },
    h('div.ro-bar', {}, h('div', {}, h('h3', {}, '⚙️ Team settings'), h('p.ro-sub', {}, off ? 'Only the Project Manager (an admin) can change these.' : 'The autonomy level is written into every Lead\'s Playbook and told to the Leads at work.')), save),
    h('h4', {}, 'Autonomy'),
    levels,
    h('h4', {}, 'Benching'),
    h('p.ro-row', {}, 'Bench a Lead after ', num(s.idleMinutes, (n) => (s.idleMinutes = n ?? 0), { max: 1440, step: 1, 'aria-label': 'Idle minutes' }), ' idle minutes (0 = only by hand). A Lead mid-task or waiting on someone is never idle.'),
    h('h4', {}, 'Review loop'),
    check(s.reviewNudge, (b) => (s.reviewNudge = b), "Nudge a Lead to review its subagent's result when its turn ends right after one came back (once per idle period; never while it needs you, asleep or benched)"),
    h('h4', {}, 'Daily standup'),
    h('p.ro-row', {}, check(s.schedule.enabled, (b) => (s.schedule.enabled = b), 'Scheduled'), ' at ', text(s.schedule.time, (t) => (s.schedule.time = t), { 'aria-label': 'Time', size: '5' }), ' ', text(s.schedule.timeZone, (t) => (s.schedule.timeZone = t), { 'aria-label': 'Time zone', size: '18' })),
    days,
    h('p.ro-sub', {}, 'It only runs when the floor had activity since the last one.'),
    h('h4', {}, 'Daily cost cap per autonomy level'),
    h('p.ro-row', {}, ...LEVELS.flatMap((l) => [h('span.ro-cap-l', {}, `${l} ${AUTONOMY[l].name} $`), num(s.costCaps[l], (n) => (n ? (s.costCaps[l] = n) : delete s.costCaps[l]), { 'aria-label': `Cap at level ${l}` })])),
    h('p.ro-sub', {}, `Blank = off. Spent today on this floor: $${v.spentToday.toFixed(2)}${v.cap !== undefined ? ` of $${v.cap.toFixed(2)}` : ''}. When the cap for the current level is reached, hiring on this floor pauses until tomorrow.`),
    h('h4', {}, 'Issues'),
    check(s.dryRunIssues, (b) => (s.dryRunIssues = b), 'Dry run: record approvals without making GitHub issues'),
    h('h4.ro-jeff-h', {}, jeffPortrait(22), ' Jeff · Router'),
    h('p.ro-sub', {}, 'Jeff is the office’s quick judge. In Shadow he is watching, not acting: he logs his verdict next to the office’s own rule, and the Analysis tab shows where you agree. Switch to On where he agrees with you.'),
    h('p.ro-row', {}, mode('Waiting on you', 'waiting'), ' When an agent ends its turn: is it waiting on you? On: he escalates it to you if it didn’t.'),
    h('p.ro-row', {}, mode('Triage', 'triage'), ' When a new issue appears: which team is it for? On: he labels unlabelled issues he’s sure about.'),
  );
}
