import './autonomy-step.css';
// The New project plan's required autonomy step, between the functional domains and Team & budget: "How much
// should the agent team do without asking you?" Four levels as a radio group with nothing preselected (2 Guided
// carries a "Recommended" badge, never a tick), and a preview of the level picked, every line generated from the
// gate tables (shared/roster/autonomy-step.ts), each approval tagged with how it's held. Create project stays
// disabled until a level is picked (and, when the office's policy fixes one, acknowledged). The policy can also
// limit the levels; it comes with WizardInfo. The answer goes with the plan as `autonomy`; the office checks it.
import { AUTONOMY, type AutonomyLevel } from '../../../../shared/roster/autonomy';
import {
  ACK_REASON,
  CHOOSE_REASON,
  HELD_FOOTER,
  HELD_LABEL,
  LEVELS,
  RECOMMENDED,
  STEP_NOTE,
  STEP_TITLE,
  allowedLevels,
  askProblem,
  byStageLabel,
  byStageOffered,
  levelPreview,
  type AutonomyPolicy,
} from '../../../../shared/roster/autonomy-step';
import type { ProjectPlan } from '../../../../shared/wizard';
import { h } from '../../dom';
import { icon } from './parts';

export interface AutonomyHost {
  plan: ProjectPlan;
  policy?: AutonomyPolicy;
  /** The step's answer changed (Create project follows it). */
  changed(): void;
  say?(text: string): void;
}

/** The step's body: also drawn on its own (the DOM test, the docs' screenshots). */
export function autonomyStep(host: AutonomyHost) {
  const policy = host.policy ?? { mode: 'none' };
  const fixed = policy.mode === 'fixed' && policy.level ? policy.level : undefined;
  const allowed = allowedLevels(policy);
  // A fixed level is shown chosen and locked: still to be acknowledged, so never valid until then.
  if (fixed && host.plan.autonomy?.level !== fixed) host.plan.autonomy = { level: fixed };
  if (host.plan.autonomy && !allowed.includes(host.plan.autonomy.level)) delete host.plan.autonomy;

  const banner = fixed
    ? h('div.aw-policy', { role: 'note' }, icon('lock'), h('span', {}, h('b', {}, 'Set by your organisation: '), `new projects work at ${fixed} ${AUTONOMY[fixed].name}${policy.name ? ` (“${policy.name}”)` : ''}. Read what it means below and confirm you understand it.`))
    : policy.mode === 'limit'
      ? h('div.aw-policy', { role: 'note' }, icon('lock'), h('span', {}, `Your organisation’s policy${policy.name ? ` (“${policy.name}”)` : ''} allows ${allowed.map((l) => `${l} ${AUTONOMY[l].name}`).join(', ')} for new projects.`))
      : null;

  const cards = LEVELS.map((l) => {
    const off = !allowed.includes(l);
    const rec = l === RECOMMENDED && !fixed;
    return h(
      'button.aw-lvl',
      { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-level': String(l), ...(off ? { 'aria-disabled': 'true' } : {}), tabindex: '-1' },
      h('span.aw-lvl-t', {}, h('span.aw-radio-dot', { 'aria-hidden': 'true' }), `${l} ${AUTONOMY[l].name}`, rec ? h('span.nw-badge.aw-rec', { title: 'The office’s own default and the docs’ advice for a new project: a recommendation, not a default. Pick it if it fits.' }, 'Recommended for a new project') : null),
      h('span.aw-one', {}, AUTONOMY[l].plain),
      off ? h('span.aw-off', {}, fixed ? 'Fixed by your organisation’s policy' : 'Not allowed by your organisation’s policy') : null,
    );
  });
  const group = h('div.aw-lvls', { role: 'radiogroup', 'aria-labelledby': 'aw-h', 'aria-describedby': 'aw-why' }, ...cards);
  const preview = h('div.aw-preview', { 'aria-live': 'polite' });
  const extras = h('div.aw-extras', {});
  const why = h('p.aw-why', { id: 'aw-why' });
  const el = h('div.aw', {}, h('h3.aw-h', { id: 'aw-h' }, STEP_TITLE), h('p.nw-hint.aw-note', {}, STEP_NOTE), banner, group, preview, extras, why);

  const level = (): AutonomyLevel | undefined => host.plan.autonomy?.level;
  const problem = () => askProblem(host.plan.autonomy, policy);

  function pick(l: AutonomyLevel, focus = false) {
    if (!allowed.includes(l) || fixed) return;
    const had = host.plan.autonomy;
    host.plan.autonomy = { level: l, ...(had?.byStage && byStageOffered(l, allowed) ? { byStage: true } : {}) };
    draw();
    if (focus) cards[l - 1].focus();
    host.say?.(`${l} ${AUTONOMY[l].name} picked`);
    host.changed();
  }
  cards.forEach((c, i) => c.addEventListener('click', () => pick((i + 1) as AutonomyLevel)));
  group.addEventListener('keydown', (e) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (e.key === ' ' || e.key === 'Enter') {
      const i = cards.indexOf(document.activeElement as HTMLButtonElement);
      if (i >= 0) (e.preventDefault(), pick((i + 1) as AutonomyLevel, true));
      return;
    }
    if (!keys.includes(e.key) || fixed) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const from = Math.max(0, cards.indexOf(document.activeElement as HTMLButtonElement));
    for (let k = 1; k <= LEVELS.length; k++) {
      const n = LEVELS[(from + step * k + LEVELS.length * 2) % LEVELS.length];
      if (allowed.includes(n)) return pick(n, true);
    }
  });

  let drawn = '';
  function draw(force = true) {
    const cur = level();
    const key = JSON.stringify([host.plan.autonomy ?? null, host.plan.budget?.autoPause ?? null]);
    if (!force && key === drawn) return;
    drawn = key;
    cards.forEach((c, i) => {
      const l = (i + 1) as AutonomyLevel;
      const on = cur === l;
      c.setAttribute('aria-checked', String(on));
      c.classList.toggle('on', on);
      // Roving tabindex: the picked level, else the first one that may be picked, takes Tab.
      c.tabIndex = (cur ? on : l === allowed[0]) ? 0 : -1;
    });
    if (!cur) preview.replaceChildren(h('p.aw-empty', {}, 'Pick a level to see what the team may do without asking and what still needs you.'));
    else {
      const p = levelPreview(cur, { autoPause: host.plan.budget?.autoPause });
      preview.replaceChildren(
        h('div.aw-ph', {}, `Preview: ${cur} ${p.name}`),
        h(
          'div.aw-pb',
          {},
          h('div', {}, h('h4', {}, 'What the team may do without asking'), p.may.length ? h('ul', {}, ...p.may.map((m) => h('li', {}, m.text))) : null, p.mayNote ? h('p.aw-small', {}, p.mayNote) : null, h('p.aw-small', {}, p.turns)),
          h('div', {}, h('h4', {}, 'What still requires your approval'), h('ul', {}, ...p.approvals.map((a) => h('li', {}, a.text, ' ', h(`span.aw-mk.${a.held}`, {}, HELD_LABEL[a.held])))), h('p.aw-small', {}, p.alerts)),
        ),
        h('p.aw-held', {}, HELD_FOOTER),
      );
    }
    const parts: HTMLElement[] = [];
    if (cur && !fixed && byStageOffered(cur, allowed)) {
      const box = h('input', { type: 'checkbox', checked: !!host.plan.autonomy?.byStage, id: 'aw-bystage' }) as HTMLInputElement;
      box.addEventListener('change', () => ((host.plan.autonomy = { ...host.plan.autonomy!, byStage: box.checked || undefined }), host.changed()));
      parts.push(h('label.nw-check', {}, box, h('span', {}, `${byStageLabel()}. `, h('span.nw-hint', {}, 'Off unless you tick it. The office raises the level itself when the build plan’s gate passes (toolkit projects), and records it. Your budget level never changes autonomy.'))));
    }
    if (fixed) {
      const ack = h('input', { type: 'checkbox', checked: host.plan.autonomy?.ack === true, id: 'aw-ack' }) as HTMLInputElement;
      ack.addEventListener('change', () => ((host.plan.autonomy = { level: fixed, ...(ack.checked ? { ack: true } : {}) }), sayWhy(), host.changed()));
      parts.push(h('label.nw-check.aw-ack', {}, ack, h('span', {}, `I understand the team will work at ${fixed} ${AUTONOMY[fixed].name} on this project, as set by my organisation.`)));
    }
    extras.replaceChildren(...parts);
    sayWhy();
  }
  const sayWhy = () => (why.textContent = problem() ? (fixed ? ACK_REASON : CHOOSE_REASON) : '');

  draw();
  return { el, problem, draw, refresh: () => draw(false), focus: () => (cards.find((c) => c.tabIndex === 0) ?? cards[0]).focus() };
}

/** The step as a panel of the New project plan: shown with Team & budget, once the scope is approved and the domains are done. */
export function autonomyPanel(flow: { plan: ProjectPlan; info: { autonomyPolicy?: AutonomyPolicy }; draft?: { approved?: unknown; domainsStatus?: string; busy?: string }; say(t: string): void }, changed: () => void) {
  const step = autonomyStep({ plan: flow.plan, policy: flow.info.autonomyPolicy, changed, say: (t) => flow.say(t) });
  const el = h('section.nw-panel.aw-panel', { 'aria-label': 'Autonomy', id: 'nw-autonomy', hidden: true }, h('div.nw-panel-h', {}, icon('compass'), h('h2', {}, 'Autonomy'), h('span.nw-grow')), h('div.nw-panel-b', {}, step.el));
  return {
    el,
    /** Why Create project can't go yet, or undefined. */
    problem: () => step.problem(),
    update() {
      const d = flow.draft;
      el.hidden = !(d?.approved && d.domainsStatus !== 'mapping' && d.busy !== 'domains');
      // The plan may have changed under it (Start from a team, the budget's auto-pause): drawn again.
      if (!el.hidden) step.refresh();
    },
    focus() {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      step.focus();
    },
  };
}
