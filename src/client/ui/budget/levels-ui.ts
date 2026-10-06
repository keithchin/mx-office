// The budget level cards (Lean, Balanced, Fast, and Manual), as the new-project wizard's Budget step and
// the Budget tab's "Change level" show them: each card's preset budget in dollars and the local currency,
// its expected duration, what it changes and its alert threshold. Picking one fills in a BudgetChoice.

import type { FxView, LevelId } from '../../../shared/budget/types';
import { LEVEL_BY_ID, type BudgetChoice, type LevelCard, type LevelSettings, type ModelWord } from '../../../shared/budget/levels';
import { local, usd } from '../../../shared/budget/money';
import { h } from '../dom';
import './budget.css';

/** GET /api/budget/estimate's answer. */
export interface Estimate {
  tier: string;
  entry: string;
  estimate: number;
  days: number;
  basis: string;
  levels: LevelCard[];
  threshold: number;
  fx: FxView;
}

export async function fetchEstimate(q: string): Promise<Estimate | undefined> {
  try {
    const res = await fetch(`/api/budget/estimate?${q}`, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as Estimate) : undefined;
  } catch {
    return undefined;
  }
}

const MODELS: ModelWord[] = ['haiku', 'sonnet', 'opus'];

function select<T extends string>(label: string, value: T, options: readonly T[], words: Record<string, string>, on: (v: T) => void): HTMLElement {
  const s = h('select', { 'aria-label': label }, ...options.map((o) => h('option', { value: o, selected: o === value }, words[o] ?? o)));
  s.addEventListener('change', () => on(s.value as T));
  return h('label.bud-field', {}, h('span', {}, label), s);
}

/** The manual choice's own settings, each picked by hand. */
function manualForm(c: BudgetChoice, changed: () => void): HTMLElement {
  const s = c.settings;
  const set = <K extends keyof LevelSettings>(k: K, v: LevelSettings[K]) => ((s[k] = v), changed());
  const word = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', default: 'Each its own', fewer: 'Fewer', normal: 'Usual', more: 'More' };
  const drafts = h('input', { type: 'checkbox', checked: s.earlyDrafts });
  drafts.addEventListener('change', () => set('earlyDrafts', drafts.checked));
  const bystage = h('input', { type: 'checkbox', checked: s.autonomyByStage.enabled });
  bystage.addEventListener('change', () => set('autonomyByStage', { ...s.autonomyByStage, enabled: bystage.checked }));
  return h(
    'div.bud-manual',
    {},
    select('Leads', s.leadModel, MODELS, word, (v) => set('leadModel', v)),
    select('Discovery (Chief Analyst)', s.discoveryModel, MODELS, word, (v) => set('discoveryModel', v)),
    select('Subagents', s.subagentModel, [...MODELS, 'default'] as const, word, (v) => set('subagentModel', v)),
    select('Agents at once', s.parallel, ['fewer', 'normal', 'more'] as const, word, (v) => set('parallel', v)),
    h('label.bud-check', {}, drafts, ' Early drafts'),
    h('label.bud-check', {}, bystage, ' Autonomy by stage'),
  );
}

/**
 * The cards and the budget fields under them. `onChange` hears every change to the choice; `initial` is
 * the level to start on (Balanced by default) and `total` a budget already set (kept with Manual).
 */
export function levelPicker(e: Estimate, onChange: (c: BudgetChoice) => void, initial: LevelId = 'balanced', total?: number): HTMLElement {
  const fresh = (id: LevelId): BudgetChoice => {
    const card = e.levels.find((l) => l.id === (id === 'manual' ? 'balanced' : id))!;
    return { level: id, total: id === 'manual' ? (total ?? card.budget) : card.budget, threshold: e.threshold, autoPause: true, settings: structuredClone(card.settings) };
  };
  let choice = fresh(initial);
  const root = h('div.bud-levels-box', {});
  const draw = () => {
    const cards = e.levels.map((l) => {
      const def = LEVEL_BY_ID.get(l.id)!;
      const lc = local(l.budget, e.fx);
      return h(
        'button.bud-level',
        { type: 'button', 'aria-pressed': String(choice.level === l.id), onclick: () => ((choice = fresh(l.id)), draw(), onChange(choice)) },
        h('span.bud-level-h', {}, h('span.ao-emo', { 'aria-hidden': 'true' }, `${l.icon} `), h('b', {}, l.label), h('small', {}, ` · ${l.tagline}`)),
        h('strong.bud-level-usd', {}, usd(l.budget)),
        lc ? h('span.bud-level-local', {}, lc) : null,
        h('span.bud-level-time', {}, `${l.time} · about ${l.days} working days`),
        h('ul.bud-level-list', {}, ...l.changes.map((c) => h('li', {}, c))),
        h('span.bud-level-th', {}, `Alert at ${e.threshold} % · pauses at 100 %`),
        h('span.vh', {}, `${def.costFactor}× the plan estimate`),
      );
    });
    cards.push(
      h(
        'button.bud-level',
        { type: 'button', 'aria-pressed': String(choice.level === 'manual'), onclick: () => ((choice = fresh('manual')), draw(), onChange(choice)) },
        h('span.bud-level-h', {}, h('span.ao-emo', { 'aria-hidden': 'true' }, '✍️ '), h('b', {}, 'Manual'), h('small', {}, ' · Your own')),
        h('strong.bud-level-usd', {}, 'Type it'),
        h('span.bud-level-time', {}, 'Pick each setting yourself'),
      ),
    );
    const totalIn = h('input.bud-in', { type: 'number', min: '1', step: '10', value: String(choice.total), 'aria-label': 'Total budget in USD' });
    const localOut = h('span.bud-hint', {}, local(choice.total, e.fx) ?? '');
    totalIn.addEventListener('input', () => {
      choice.total = Number(totalIn.value);
      localOut.textContent = local(choice.total, e.fx) ?? '';
      onChange(choice);
    });
    const th = h('input.bud-in.bud-in-days', { type: 'number', min: '1', max: '99', value: String(choice.threshold), 'aria-label': 'Alert threshold, percent' });
    th.addEventListener('input', () => ((choice.threshold = Number(th.value)), (choice.settings.threshold = Number(th.value)), onChange(choice)));
    const ap = h('input', { type: 'checkbox', checked: choice.autoPause });
    ap.addEventListener('change', () => ((choice.autoPause = ap.checked), onChange(choice)));
    root.replaceChildren(
      h('div.bud-levels', {}, ...cards),
      h('p.bud-note', {}, `Plan estimate ${usd(e.estimate)} at Balanced for this ${e.tier} ${e.entry} project, about ${e.days} working days (${e.basis}).`),
      h('div.bud-fields', {}, h('label.bud-field', {}, h('span', {}, 'Total budget (USD)'), h('span.bud-row', {}, '$', totalIn, localOut)), h('label.bud-field', {}, h('span', {}, 'Alert at'), h('span.bud-row', {}, th, '%')), h('label.bud-check', {}, ap, ' Pause the project at 100 %')),
      ...(choice.level === 'manual' ? [manualForm(choice, () => onChange(choice))] : []),
    );
  };
  draw();
  onChange(choice);
  return root;
}
