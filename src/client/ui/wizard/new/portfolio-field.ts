// Advanced › Portfolio (server/portfolios/): which portfolio the new project joins, if any. Shown only once
// the office has a portfolio; the list is fetched once per page. After init and the pin instructions the
// setup adds the project to it and, when it has a company brain, wires and checks it (wizard/portfolio-step.ts).

import type { ProjectPlan } from '../../../../shared/wizard';
import { NOT_ACCESS_CONTROL, type PortfoliosView } from '../../../../shared/portfolios';
import { h } from '../../dom';
import { portfoliosView } from '../../portfolios/api';

let view: PortfoliosView | undefined;
let asked = false;

export function portfolioField(d: ProjectPlan, redraw: () => void): HTMLElement | null {
  if (!asked) {
    asked = true;
    portfoliosView().then(
      (v) => {
        view = v;
        if (v.portfolios.length) redraw();
      },
      () => undefined,
    );
  }
  if (!view?.portfolios.length) return null;
  const sel = h('select', { id: 'nw-a-portfolio' }, h('option', { value: '', selected: !d.portfolio }, 'None (a project on its own)'), ...view.portfolios.map((p) => h('option', { value: p.id, selected: d.portfolio === p.id }, `${p.label}${p.brain ? ' (company brain connected)' : ''}`))) as HTMLSelectElement;
  sel.addEventListener('change', () => {
    if (sel.value) d.portfolio = sel.value;
    else delete d.portfolio;
  });
  return h('div.nw-field', {}, h('label', { for: 'nw-a-portfolio' }, 'Client'), sel, h('span.nw-hint', {}, `Optional: the client (the company) this project is for. With a company brain, the project is wired to it right after the toolkit’s scaffold and checked. ${NOT_ACCESS_CONTROL}.`));
}
