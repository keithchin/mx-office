// The new-project wizard's Team & budget page, after the intake answers (docs/wizard.md): three team
// shapes (Solo, Startup, Enterprise, shared/roster/coverage.ts), each with a Lean / Balanced / Fast
// switch, its budget for that level and the working days it expects (GET /api/budget/estimate's
// shapes, shared/budget/shape-cards.ts). The office recommends one from what was said so far
// (shared/roster/recommend.ts), pre-selects it and says why. Customize picks the roles by hand and
// shows the full level picker (Manual included), as the wizard did before shapes.

import { h } from '../dom';
import { fetchEstimate, levelPicker, type Estimate } from '../budget/levels-ui';
import { local, usd } from '../../../shared/budget/money';
import type { LevelCard } from '../../../shared/budget/levels';
import type { ShapeCard } from '../../../shared/budget/shape-cards';
import { SHAPES, shapeForRoles, type TeamShape } from '../../../shared/roster/coverage';
import { recommendShape } from '../../../shared/roster/recommend';
import { PROJECT_ROLES } from '../../../shared/wizard';
import type { PageCtx } from './forms';
import './team-shape.css';

type Level = LevelCard['id'];
type WithShapes = Estimate & { shapes?: ShapeCard[] };

const cache = new Map<string, WithShapes>();
/** The level each card's switch shows, kept while the page is redrawn. */
const switches = new Map<TeamShape, Level>();

/** Fills the plan from a shape card at a level: its roles, its budget and the level's settings. */
function pick(c: PageCtx, e: WithShapes, card: ShapeCard, level: Level) {
  const d = c.draft;
  const l = card.levels.find((x) => x.id === level)!;
  d.shape = card.shape;
  d.customTeam = false;
  d.roles = [...SHAPES[card.shape].roles];
  d.budget = { level, total: l.budget, threshold: e.threshold, autoPause: true, settings: structuredClone(l.settings) };
  d.discovery.model = l.settings.discoveryModel;
}

function shapeCard(c: PageCtx, e: WithShapes, card: ShapeCard, recommended: boolean, redraw: () => void): HTMLElement {
  const d = c.draft;
  const on = !d.customTeam && d.shape === card.shape;
  const level = switches.get(card.shape) ?? (on ? ((d.budget?.level as Level) ?? 'balanced') : 'balanced');
  const l = card.levels.find((x) => x.id === level)!;
  const lc = local(l.budget, e.fx);
  const sw = h(
    'div.wz-lvl',
    { role: 'radiogroup', 'aria-label': `${card.label}: budget level` },
    ...card.levels.map((x) =>
      h(
        'button.wz-lvl-b',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(x.id === level),
          onclick: (ev: Event) => {
            ev.stopPropagation();
            switches.set(card.shape, x.id);
            pick(c, e, card, x.id);
            redraw();
          },
        },
        x.label,
      ),
    ),
  );
  return h(
    'div.wz-card.wz-shape',
    { class: on ? 'on' : '', role: 'button', tabindex: '0', 'aria-pressed': String(on), 'data-shape': card.shape, onclick: () => (pick(c, e, card, level), redraw()), onkeydown: ((ev: KeyboardEvent) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) (ev.preventDefault(), pick(c, e, card, level), redraw());
      }) as EventListener },
    recommended ? h('span.wz-rec', {}, '★ Recommended') : null,
    h('strong', {}, `${card.icon} ${card.label}`, h('small', {}, ` · ${card.tagline}`)),
    h('span', {}, card.who),
    sw,
    h('span.wz-shape-usd', {}, usd(l.budget), lc ? h('small', {}, ` ${lc}`) : null),
    h('small', {}, `About ${l.days} working days · ${l.label}: ${l.tagline.toLowerCase()}`),
  );
}

/** The roles ticked by hand (Customize), as the wizard had them before shapes. */
function rolesBox(c: PageCtx, redraw: () => void): HTMLElement {
  const d = c.draft;
  return h(
    'div.wz-roles',
    {},
    ...PROJECT_ROLES.map((r) => {
      const box = h('input', { type: 'checkbox', checked: d.roles.includes(r.id) }) as HTMLInputElement;
      box.addEventListener('change', () => {
        d.roles = box.checked ? [...new Set([...d.roles, r.id])] : d.roles.filter((x) => x !== r.id);
        d.shape = shapeForRoles(d.roles);
        redraw();
      });
      return h('label.wz-role', {}, box, ` ${r.icon} ${r.label}`);
    }),
  );
}

export function teamShapePage(c: PageCtx): HTMLElement {
  const d = c.draft;
  const key = `tier=${d.tier}&entry=${d.entry}`;
  const box = h('div.wz-shapes-box', {}, h('p.setting-note', {}, 'Working out the estimates…'));
  const rec = recommendShape({ tier: d.tier, entry: d.entry, intake: d.intake });
  const show = (e: WithShapes) => {
    const shapes = e.shapes ?? [];
    // First time here: the recommendation, pre-selected.
    if (!d.shape && !d.customTeam) {
      const card = shapes.find((s) => s.shape === rec.shape);
      if (card) {
        switches.set(rec.shape, rec.level);
        pick(c, e, card, rec.level);
      }
    }
    const redraw = () => show(e);
    const custom = h('input', { type: 'checkbox', checked: !!d.customTeam }) as HTMLInputElement;
    custom.addEventListener('change', () => {
      d.customTeam = custom.checked;
      if (!custom.checked) {
        const card = shapes.find((s) => s.shape === (d.shape ?? rec.shape)) ?? shapes[0];
        if (card) pick(c, e, card, switches.get(card.shape) ?? 'balanced');
      }
      redraw();
    });
    const shapeNow = d.shape ?? shapeForRoles(d.roles);
    const card = shapes.find((s) => s.shape === shapeNow);
    box.replaceChildren(
      h('div.wz-note.wz-why', {}, h('strong', {}, `★ Recommended: ${SHAPES[rec.shape].label} · ${rec.level[0].toUpperCase()}${rec.level.slice(1)}`), h('ul', {}, ...rec.why.map((w) => h('li', {}, w)))),
      h('div.wz-shapes', {}, ...shapes.map((s) => shapeCard(c, e, s, s.shape === rec.shape, redraw))),
      h('label.wz-check', {}, custom, ' Customize: pick the roles and every budget setting by hand'),
      ...((d.customTeam
        ? [
            rolesBox(c, redraw),
            h('p.setting-note', {}, `These roles make a ${SHAPES[shapeNow].label} team (${SHAPES[shapeNow].who})`),
            card
              ? levelPicker(
                  { ...e, estimate: card.estimate, days: card.days, levels: card.levels },
                  (choice) => {
                    d.budget = choice;
                    d.discovery.model = choice.settings.discoveryModel;
                  },
                  d.budget?.level ?? 'balanced',
                  d.budget?.total,
                )
              : null,
          ]
        : []).filter((x): x is HTMLElement => !!x)),
    );
  };
  const hit = cache.get(key);
  if (hit) show(hit);
  else
    void fetchEstimate(key).then((e) => {
      if (!e) return box.replaceChildren(h('p.wz-note', {}, 'The office couldn’t work out an estimate: the project is made without a budget (set one later on its 💰 Budget tab), with the team ticked below.'), rolesBox(c, () => undefined));
      cache.set(key, e);
      show(e);
    });
  return h(
    'div.wz-page',
    {},
    h('p.wz-intro', {}, 'Who works on it and how fast against how much. Each shape is priced for this project from the office’s plan; the level sets the models, early drafts, autonomy by stage and how many agents work at once. At 100 % of the budget the project pauses and tells you.'),
    box,
    c.editing ? h('p.wz-note', {}, 'For a project that’s already set up, the setup applies its shape and level once; change the level later on its 💰 Budget tab.') : null,
  );
}
