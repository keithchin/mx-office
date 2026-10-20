// The Team & budget card of the New project plan: one line with the recommended team shape and budget
// level (shared/roster/recommend.ts, from the size tier, the entry mode and what the brief says), the
// budget for it (GET /api/budget/estimate, the plan priced per shape) and auto-pause at 100 %. Change opens
// Solo / Startup / Enterprise and Lean / Balanced / Fast, and Customize picks the roles and every budget
// setting by hand, as the classic wizard did (team-shape.ts). Advanced holds everything else.
import { intakeFromBrief } from '../../../../shared/brief-map';
import { usd } from '../../../../shared/budget/money';
import type { LevelCard } from '../../../../shared/budget/levels';
import type { ShapeCard } from '../../../../shared/budget/shape-cards';
import { SHAPES, shapeForRoles, TEAM_SHAPES, type TeamShape } from '../../../../shared/roster/coverage';
import { recommendShape, type Recommendation } from '../../../../shared/roster/recommend';
import { ROLE_BY_ID } from '../../../../shared/roster/roles';
import { SHAPE_LEAVES_YOU, shapeModels } from '../../../../shared/roster/shape-words';
import type { IntakeAnswer } from '../../../../shared/wizard';
import { h } from '../../dom';
import { fetchEstimate, levelPicker } from '../../budget/levels-ui';
import { applyShape, rolesPicker, type WithShapes } from '../team-shape';
import { advancedPanel } from './advanced';
import { migrationCap } from './migration-cap';
import { defaultLocalOnly } from './local-only-field';
import { icon } from './parts';
import { teamFromPanel } from './team-from';
import type { Flow } from './index';

type Level = LevelCard['id'];
const LEVEL_WHY: Record<Level, string> = { lean: 'Cheaper models, fewer drafts, more waiting on you.', balanced: 'The default: good models, one early draft per document.', fast: 'Stronger models and more agents at once; costs more.' };
const cache = new Map<string, WithShapes>();

/** The intake answers the recommendation reads: the brief's (Q2, Q4, Q5) and what was typed under Advanced (Q7). */
export function answersFor(flow: Flow): IntakeAnswer[] {
  const d = flow.draft;
  const fromBrief = d?.brief ? intakeFromBrief({ brief: d.brief, attachments: d.attachments }, { entry: flow.plan.entry }) : [];
  return [...fromBrief, ...flow.plan.intake.filter((a) => a.text.trim() && !fromBrief.some((b) => b.n === a.n))];
}

export function teamCard(flow: Flow) {
  const body = h('div.nw-panel-b', {});
  const el = h('section.nw-panel', { 'aria-label': 'Team and budget', hidden: true }, h('div.nw-panel-h', {}, icon('team'), h('h2', {}, 'Team & budget'), h('span.nw-grow')), body);
  let changeOpen = false;
  let advOpen = false;
  let est: WithShapes | undefined;
  let estKey = '';
  let rec: Recommendation | undefined;
  /** The shape and level picked by hand (else the recommendation). */
  let chosen: { shape: TeamShape; level: Level } | undefined;
  const adv = advancedPanel(flow, () => draw());
  // Start from a team (team-from.ts): a copy sets the shape, the roles and the level the way Change does.
  const fromTeam = teamFromPanel(flow, {
    apply(copy) {
      flow.plan.customTeam = false;
      chosen = { shape: copy.shape, level: copy.level ?? levelOf() };
      pick(chosen.shape, chosen.level);
      if (copy.customTeam) ((flow.plan.customTeam = true), (flow.plan.roles = [...copy.roles]), (flow.plan.shape = copy.shape));
      draw();
    },
    clear() {
      chosen = undefined;
      flow.plan.customTeam = false;
      if (rec) pick(rec.shape, rec.level);
      draw();
    },
    redraw: () => draw(),
  });

  const levelOf = (): Level => { const l = flow.plan.budget?.level; return l === 'lean' || l === 'balanced' || l === 'fast' ? l : (rec?.level ?? 'balanced'); };
  /** The level as the summary says it (Manual under Customize). */
  const levelWord = () => { const l = flow.plan.budget?.level ?? levelOf(); return `${l[0].toUpperCase()}${l.slice(1)}`; };
  const cardOf = (s: TeamShape): ShapeCard | undefined => est?.shapes?.find((c) => c.shape === s);

  function pick(shape: TeamShape, level: Level) {
    const card = cardOf(shape);
    if (est && card) applyShape(flow.plan, est, card, level);
    else ((flow.plan.shape = shape), (flow.plan.roles = [...SHAPES[shape].roles]));
  }

  async function load() {
    const key = `tier=${flow.plan.tier}&entry=${flow.plan.entry}`;
    rec = recommendShape({ tier: flow.plan.tier, entry: flow.plan.entry, intake: answersFor(flow) });
    if (key !== estKey) {
      estKey = key;
      est = cache.get(key) ?? (await fetchEstimate(key));
      if (est) cache.set(key, est);
    }
    if (!flow.plan.customTeam) pick(chosen?.shape ?? rec.shape, chosen?.level ?? rec.level);
    // Off GitHub by default for a migration with a source folder (local-only-field.ts).
    defaultLocalOnly(flow.plan, flow.draft);
    draw();
  }

  function draw() {
    if (!rec) return;
    const d = flow.plan;
    const shape = d.shape ?? shapeForRoles(d.roles);
    const s = SHAPES[shape];
    const level = levelOf();
    const budget = d.budget?.total;
    const names = d.roles.map((r) => ROLE_BY_ID.get(r)?.title ?? r).join(', ');
    const isRec = !d.customTeam && shape === rec.shape && level === rec.level;
    const change = h('button.btn', { type: 'button', 'aria-expanded': String(changeOpen), 'aria-controls': 'nw-change' }, 'Change');
    change.addEventListener('click', () => ((changeOpen = !changeOpen), draw(), body.querySelector<HTMLElement>('[aria-controls="nw-change"]')?.focus()));
    const summary = h(
      'div.nw-team-sum',
      {},
      h('div.nw-avatars', {}, ...d.roles.map((r) => h('span.nw-av.role', { title: ROLE_BY_ID.get(r)?.title ?? r }, (ROLE_BY_ID.get(r)?.title ?? r).split(/\s+/).map((w) => w[0]).slice(0, 2).join('')))),
      h(
        'div.nw-team-txt',
        {},
        `${isRec ? 'Suggested team' : 'Your team'}: `,
        h('strong', {}, `${s.icon} ${s.label} · ${levelWord()}${d.customTeam ? ' (customised)' : ''}`),
        `, ${d.roles.length} agent${d.roles.length === 1 ? '' : 's'} (${s.tagline}) · budget `,
        h('strong', {}, budget ? usd(budget) : 'none'),
        ` · ${d.budget?.autoPause === false ? 'no auto-pause' : 'auto-pause at 100%'}`,
        h('div.nw-roles-line', {}, names),
        d.budget?.settings ? h('div.nw-roles-line.nw-models', {}, shapeModels(shape, d.budget.settings)) : null,
        h('div.nw-roles-line.nw-leaves', {}, SHAPE_LEAVES_YOU[shape]),
        isRec && rec.why.length ? h('div.nw-roles-line', {}, `Why: ${rec.why.join('; ')}`) : null,
      ),
      change,
    );
    const changePanel = h('div.nw-collapse', { id: 'nw-change', class: changeOpen ? '' : 'shut' }, h('div', {}, changeOpen ? changeBody(shape, level) : ''));
    const advH = h('button.nw-adv-h', { type: 'button', 'aria-expanded': String(advOpen), 'aria-controls': 'nw-adv' }, icon('chev', 'nw-ico nw-chev'), 'Advanced ', h('span.nw-from', {}, '· repository, Mendix version, client, Discovery and the rest; defaults from Settings'));
    advH.addEventListener('click', () => ((advOpen = !advOpen), draw(), body.querySelector<HTMLElement>('.nw-adv-h')?.focus()));
    const advPanel = h('div.nw-collapse', { id: 'nw-adv', class: advOpen ? '' : 'shut' }, h('div', {}, advOpen ? adv.build() : ''));
    // A migration's cap: the planner's estimate, the warning and the cap field (migration-cap.ts).
    const cap = migrationCap(d, cardOf(shape)?.estimate, () => draw());
    fromTeam.draw();
    body.replaceChildren(summary, fromTeam.el, ...(cap ? [cap] : []), changePanel, advH, advPanel, ...(est ? [] : [h('p.nw-hint', {}, 'The office couldn’t work out an estimate: the project is made without a budget (set one later on its 💰 Budget tab).')]));
    if (advOpen) adv.showProblems();
  }

  function changeBody(shape: TeamShape, level: Level): HTMLElement {
    const d = flow.plan;
    const shapes = h(
      'div.nw-shapes',
      { role: 'radiogroup', 'aria-label': 'Team shape' },
      ...TEAM_SHAPES.map((k) => {
        const v = SHAPES[k];
        const price = cardOf(k)?.levels.find((l) => l.id === level)?.budget;
        const b = h('button.nw-shape', { type: 'button', role: 'radio', 'aria-checked': String(!d.customTeam && k === shape), 'data-shape': k }, h('b', {}, `${v.icon} ${v.label}`), h('span.nw-shape-t', {}, v.tagline), h('span.nw-shape-p', {}, `${v.roles.length} agent${v.roles.length === 1 ? '' : 's'}${price ? ` · ${usd(price)} at ${level[0].toUpperCase() + level.slice(1)}` : ''}`), h('small', {}, v.who), h('small.nw-shape-you', {}, SHAPE_LEAVES_YOU[k]));
        b.addEventListener('click', () => {
          d.customTeam = false;
          chosen = { shape: k, level };
          pick(k, chosen.level);
          draw();
          body.querySelector<HTMLElement>(`[data-shape="${k}"]`)?.focus();
          flow.say(`${v.label}, ${chosen.level}: ${d.budget ? usd(d.budget.total) : 'no budget'}`);
        });
        return b;
      }),
    );
    const levels = h(
      'div.nw-seg',
      { role: 'radiogroup', 'aria-labelledby': 'nw-lvl-l' },
      ...(['lean', 'balanced', 'fast'] as Level[]).map((l) => {
        const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(l === level), 'data-level': l }, l[0].toUpperCase() + l.slice(1));
        b.addEventListener('click', () => {
          chosen = { shape, level: l };
          pick(shape, l);
          draw();
          body.querySelector<HTMLElement>(`[data-level="${l}"]`)?.focus();
        });
        return b;
      }),
    );
    const custom = h('input', { type: 'checkbox', checked: !!d.customTeam }) as HTMLInputElement;
    custom.addEventListener('change', () => {
      d.customTeam = custom.checked;
      if (!custom.checked) pick(chosen?.shape ?? rec!.shape, chosen?.level ?? rec!.level);
      draw();
    });
    const card = cardOf(shape);
    return h(
      'div',
      {},
      d.customTeam ? null : shapes,
      d.customTeam ? null : h('div.nw-levels', {}, h('span.nw-lbl', { id: 'nw-lvl-l' }, 'Budget level'), levels, h('span.nw-muted', {}, LEVEL_WHY[level])),
      h('label.nw-check', {}, custom, h('span', {}, ' Customize: pick the roles and every budget setting by hand')),
      ...(d.customTeam
        ? [
            h('div.nw-custom', {}, rolesPicker(d, () => ((d.shape = shapeForRoles(d.roles)), draw()))),
            h('p.nw-hint', {}, `These roles make a ${SHAPES[shape].label} team (${SHAPES[shape].who})`),
            est && card ? levelPicker({ ...est, estimate: card.estimate, days: card.days, levels: card.levels }, (choice) => ((d.budget = choice), (d.discovery.model = choice.settings.discoveryModel)), (d.budget?.level as Level) ?? 'balanced', d.budget?.total) : null,
          ]
        : []),
      h('p.nw-hint', {}, 'At 100% of the budget the project pauses and tells you. You can change the level later on the Budget page.'),
    );
  }

  return {
    el,
    /** Shown once the domains are done (or skipped); drawn again when the tier or the entry could have changed. */
    update() {
      const d = flow.draft;
      const ready = !!d?.approved && d.domainsStatus !== 'mapping' && d.busy !== 'domains';
      el.hidden = !ready;
      if (ready) (fromTeam.load(), void load());
    },
    /** Before Create project: the Move list for agents brought from another project, confirmed (or not). */
    confirm: (opener: HTMLElement) => fromTeam.confirm(opener),
    /** Inline problems; Advanced opens on the first one. True when the plan can be created. */
    validate(): boolean {
      if (adv.showProblems()) return true;
      if (!advOpen) {
        advOpen = true;
        draw();
        adv.showProblems();
      }
      const first = [...adv.errs.values()].find((p) => p.textContent);
      first?.parentElement?.querySelector<HTMLElement>('input, select')?.focus();
      return false;
    },
  };
}
