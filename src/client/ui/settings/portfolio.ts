// ⚙️ Settings › 🗂️ Portfolio (server/portfolios/): the portfolio this project is in, with its company brain's
// state and the office's wiring check, or (admins) Add to portfolio (or to a new client, named there): only a project in no portfolio, after a
// review of what it already has wired (ui/portfolios/dialogs.ts). Moving between portfolios is refused (S03).

import { NOT_ACCESS_CONTROL, NOT_ACCESS_CONTROL_LONG, type PortfoliosView } from '../../../shared/portfolios';
import { store } from '../../state';
import { h } from '../dom';
import { existingContext, portfoliosView } from '../portfolios/api';
import { addToPortfolioDialog, contextLines } from '../portfolios/dialogs';
import { brainChip } from '../../clients/brain';
import { clientHref } from '../../clients/logic';
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
        h('p', {}, 'This project belongs to the client ', h('a', { href: clientHref(p.id) }, h('strong', {}, p.label)), '. ', h('span.pf-chip', { 'data-tone': c.tone }, c.text)),
        w ? h('p', {}, w.ok ? '✅ Company brain wired in every instruction file (checked by the office).' : `⚠️ Wiring incomplete: ${w.problems.join('; ')}`) : null,
        p.brain ? h('p.setting-note', {}, 'Each hire’s first message gets one line pointing at the brain’s ROUTING.md, and the office records what it was offered (a context manifest).') : h('p.setting-note', {}, 'The client has no company brain yet: hires get no brain line.'),
        h('p.setting-note', {}, 'A project can belong to one client: moving it to another client isn’t available in this version.'),
        note,
      ));
      return;
    }
    const ctx = await existingContext(floor);
    if (gone) return;
    const admin = v.admin && store.me.admin;
    // With no client yet the dialog offers ＋ New client, so a new client's name can be given from here.
    const add = h('button.btn.primary', { type: 'button', disabled: !admin }, v.portfolios.length ? '🗂️ Add to client' : '🗂️ Add to a new client');
    add.onclick = () => addToPortfolioDialog(add, v, { floor }, (r) => r.view && void draw(r.view));
    body.replaceChildren(...nodes(
      h('p', {}, 'This project has no client: it works on its own, exactly as projects always have.'),
      h('div.pf-review', {}, h('h3', {}, 'What it already has'), ...contextLines(ctx)),
      add,
      !v.portfolios.length ? h('p.setting-note', {}, 'There are no clients yet: make one here, or on the Clients page.') : null,
      admin ? null : h('p.setting-note', {}, 'Only an admin can add a project to a client.'),
      note,
    ));
  };
  portfoliosView().then(draw, (err: Error) => !gone && body.replaceChildren(h('p.setting-note', {}, `Couldn’t ask the office: ${err.message}`)));
  return { nodes: [setting('This project', 'floor', body)], off: () => void (gone = true) };
}
