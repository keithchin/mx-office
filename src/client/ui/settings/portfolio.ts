// ⚙️ Settings › 🗂️ Portfolio (server/portfolios/): the portfolio this project is in, with its company brain's
// state and the office's wiring check, or (admins) Add to portfolio: only a project in no portfolio, after a
// review of what it already has wired (ui/portfolios/dialogs.ts). Moving between portfolios is refused (S03).

import { NOT_ACCESS_CONTROL, NOT_ACCESS_CONTROL_LONG, type PortfoliosView } from '../../../shared/portfolios';
import { store } from '../../state';
import { h } from '../dom';
import { existingContext, portfoliosView } from '../portfolios/api';
import { addToPortfolioDialog, contextLines } from '../portfolios/dialogs';
import { brainChip } from '../../home/portfolios';
import { setting, type Built } from './kit';
import '../portfolios/portfolios.css';

const nodes = (...xs: (Node | null)[]): Node[] => xs.filter((x): x is Node => !!x);

export function portfolioPart(): Built {
  const body = h('div.pf-set', {}, h('p.setting-note', {}, 'Asking the office…'));
  let gone = false;
  const floor = store.floor ?? undefined;
  const draw = async (v: PortfoliosView) => {
    if (gone || !floor) return;
    const p = v.portfolios.find((x) => x.projectIds.includes(floor));
    const note = h('p.pf-note', {}, h('strong', {}, `${NOT_ACCESS_CONTROL}. `), NOT_ACCESS_CONTROL_LONG);
    if (p) {
      const c = brainChip(p);
      const w = p.projects.find((x) => x.id === floor)?.wiring;
      body.replaceChildren(...nodes(
        h('p', {}, 'This project is in the portfolio ', h('a', { href: '/home?tab=portfolios' }, h('strong', {}, p.label)), '. ', h('span.pf-chip', { 'data-tone': c.tone }, c.text)),
        w ? h('p', {}, w.ok ? '✅ Company brain wired in every instruction file (checked by the office).' : `⚠️ Wiring incomplete: ${w.problems.join('; ')}`) : null,
        p.brain ? h('p.setting-note', {}, 'Each hire’s first message gets one line pointing at the brain’s ROUTING.md, and the office records what it was offered (a context manifest).') : h('p.setting-note', {}, 'The portfolio has no company brain yet: hires get no brain line.'),
        h('p.setting-note', {}, 'Moving a project to another portfolio isn’t available in this version.'),
        note,
      ));
      return;
    }
    const ctx = await existingContext(floor);
    if (gone) return;
    const admin = v.admin && store.me.admin;
    const add = h('button.btn.primary', { type: 'button', disabled: !admin || !v.portfolios.length }, '🗂️ Add to portfolio');
    add.onclick = () => addToPortfolioDialog(add, v, { floor }, (r) => r.view && void draw(r.view));
    body.replaceChildren(...nodes(
      h('p', {}, 'This project is in no portfolio: it works on its own, exactly as before portfolios.'),
      h('div.pf-review', {}, h('h3', {}, 'What it already has'), ...contextLines(ctx)),
      add,
      !v.portfolios.length ? h('p.setting-note', {}, 'There are no portfolios yet: make one on Home › 🗂️ Portfolios.') : null,
      admin ? null : h('p.setting-note', {}, 'Only an admin can add a project to a portfolio.'),
      note,
    ));
  };
  portfoliosView().then(draw, (err: Error) => !gone && body.replaceChildren(h('p.setting-note', {}, `Couldn’t ask the office: ${err.message}`)));
  return { nodes: [setting('This project', 'floor', body)], off: () => void (gone = true) };
}
