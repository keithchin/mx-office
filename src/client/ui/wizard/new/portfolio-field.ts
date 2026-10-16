// Advanced › Client (server/portfolios/): which client the new project joins, if any. Shown once the office
// has a client, and always to an admin, whose list ends with ＋ New client… (the New client dialog, then
// picked); the list is fetched once per page. After init and the pin instructions the
// setup adds the project to it and, when it has a company brain, wires and checks it (wizard/portfolio-step.ts).

import type { ProjectPlan } from '../../../../shared/wizard';
import { NOT_ACCESS_CONTROL, type PortfoliosView } from '../../../../shared/portfolios';
import { h } from '../../dom';
import { portfoliosView } from '../../portfolios/api';
import { newPortfolioDialog } from '../../portfolios/dialogs';

const NEW = '__new';

let view: PortfoliosView | undefined;
let asked = false;

export function portfolioField(d: ProjectPlan, redraw: () => void): HTMLElement | null {
  if (!asked) {
    asked = true;
    portfoliosView().then(
      (v) => {
        view = v;
        if (v.portfolios.length || v.admin) redraw();
      },
      () => undefined,
    );
  }
  if (!view || (!view.portfolios.length && !view.admin)) return null;
  const v = view;
  const sel = h(
    'select',
    { id: 'nw-a-portfolio' },
    h('option', { value: '', selected: !d.portfolio }, 'None (a project on its own)'),
    ...v.portfolios.map((p) => h('option', { value: p.id, selected: d.portfolio === p.id }, `${p.label}${p.brain ? ' (company brain connected)' : ''}`)),
    v.admin ? h('option', { value: NEW }, '＋ New client…') : null,
  ) as HTMLSelectElement;
  sel.addEventListener('change', () => {
    if (sel.value === NEW) {
      sel.value = d.portfolio ?? '';
      return newPortfolioDialog(sel, (r) => {
        if (r.view) view = r.view;
        if (r.portfolio) d.portfolio = r.portfolio.id;
        redraw();
      });
    }
    if (sel.value) d.portfolio = sel.value;
    else delete d.portfolio;
    // The client's design system line (design-field.ts) follows the client.
    redraw();
  });
  return h('div.nw-field', {}, h('label', { for: 'nw-a-portfolio' }, 'Client'), sel, h('span.nw-hint', {}, `Optional: the client (the company) this project is for. With a company brain, the project is wired to it right after the toolkit’s scaffold and checked. ${NOT_ACCESS_CONTROL}.`));
}
