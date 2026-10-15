// Home › 🗂️ Portfolios (server/portfolios/): every portfolio with its projects and its company brain's state,
// New portfolio, and a portfolio's own page (its projects and their wiring, the brain's path, snapshot,
// routed and excluded files, the ROUTING.md size warning, Connect a brain / Disconnect, Add a project).
// "Knowledge organisation, not access control" is said on both. Fetched when the tab shows, and from what
// an action answers; nothing is fetched while it's hidden.

import { NOT_ACCESS_CONTROL, NOT_ACCESS_CONTROL_LONG, type BrainRead, type ExcludeReason, type PortfoliosView, type PortfolioView } from '../../shared/portfolios';
import { store } from '../state';
import { h } from '../ui/dom';
import { portfoliosView, type ActResult } from '../ui/portfolios/api';
import { addToPortfolioDialog, connectBrainDialog, disconnectDialog, newPortfolioDialog } from '../ui/portfolios/dialogs';
import '../ui/portfolios/portfolios.css';

const REASON: Record<ExcludeReason, string> = { inbox: 'candidates (inbox/)', handoffs: 'handoffs/', proposals: 'proposals/', patches: 'patches/', 'missing-file': 'routed but missing', unrouted: 'not routed' };

/** The brain's state in a few words and its tone. */
export function brainChip(p: Pick<PortfolioView, 'brain' | 'read'>): { text: string; tone: 'good' | 'warn' | 'bad' | 'none' } {
  if (!p.brain) return { text: 'No brain connected', tone: 'none' };
  const r = p.read;
  if (!r || r.status === 'unavailable') return { text: 'Brain unavailable', tone: 'bad' };
  if (r.status === 'unversioned') return { text: 'Connected · not versioned', tone: 'warn' };
  return { text: `Connected @${r.snapshot!.slice(0, 7)}${r.dirty ? ' · uncommitted changes' : ''}`, tone: r.dirty ? 'warn' : 'good' };
}

const banner = () => h('div.pf-banner', { role: 'note' }, h('strong', {}, `🔓 ${NOT_ACCESS_CONTROL}. `), NOT_ACCESS_CONTROL_LONG);
const chip = (p: PortfolioView) => {
  const c = brainChip(p);
  return h('span.pf-chip', { 'data-tone': c.tone }, c.text);
};

function brainPart(p: PortfolioView, admin: boolean, act: (fn: (opener: HTMLElement) => void) => (e: Event) => void): HTMLElement {
  if (!p.brain) {
    return h('section.pf-part', {}, h('h3', {}, 'Company brain'), h('p', {}, 'No brain connected. The client still groups its projects; their agents get no brain line until one is connected.'), admin ? h('button.btn.primary', { type: 'button', onclick: act((o) => connectBrainDialog(o, p, after)) }, '🧠 Connect a brain') : null);
  }
  const r: BrainRead | undefined = p.read;
  const byReason = new Map<ExcludeReason, number>();
  for (const x of r?.excluded ?? []) byReason.set(x.reason, (byReason.get(x.reason) ?? 0) + 1);
  return h(
    'section.pf-part',
    {},
    h('h3', {}, 'Company brain'),
    h('p', {}, chip(p)),
    h('dl.pf-dl', {}, h('dt', {}, 'Folder'), h('dd', {}, h('code', {}, p.brain.path)), h('dt', {}, 'Snapshot'), h('dd', {}, r?.snapshot ? h('code', {}, r.snapshot.slice(0, 12)) : r?.status === 'unversioned' ? 'not versioned (not a git repository): sessions record no snapshot' : '—'), h('dt', {}, 'Connected'), h('dd', {}, `${new Date(p.brain.connectedAt).toLocaleString()} by ${p.brain.by || 'someone'}`)),
    r?.status === 'unavailable' ? h('p.pf-refused', { role: 'alert' }, `Brain unavailable: ${r.why ?? 'it can’t be read'}. Hires carry on, told the brain is unavailable this session.`) : null,
    r && r.status !== 'unavailable'
      ? h('div', {}, h('p', {}, `${r.routed.length} routed file${r.routed.length === 1 ? '' : 's'} offered to each session (by path and hash: the office keeps no brain text)${r.routing ? `, from ${r.routing.rows} ROUTING.md row${r.routing.rows === 1 ? '' : 's'}` : ''}.`), h('ul.pf-files', {}, ...r.routed.slice(0, 12).map((x) => h('li', {}, h('code', {}, x.path), h('small', {}, ` ${x.bytes} B`)))), byReason.size ? h('p.pf-hint', {}, `Left out: ${[...byReason].map(([k, n]) => `${n} ${REASON[k]}`).join(', ')}.`) : null)
      : null,
    ...(r?.warnings ?? []).map((w) => h('p.pf-warn', {}, `⚠️ ${w}`)),
    admin ? h('div.pf-acts', {}, h('button.btn', { type: 'button', onclick: act((o) => disconnectDialog(o, p, after)) }, 'Disconnect')) : null,
  );
}

let after: (r: ActResult) => void = () => undefined;

export function homePortfolios(root: HTMLElement) {
  let view: PortfoliosView | undefined;
  let open: string | undefined;
  let showing = false;
  const act = (fn: (opener: HTMLElement) => void) => (e: Event) => fn(e.currentTarget as HTMLElement);
  after = (r) => {
    if (r.view) view = r.view;
    render();
  };

  function list(v: PortfoliosView): HTMLElement[] {
    const admin = v.admin && store.me.admin;
    return [
      h('div.pf-head', {}, h('h2', {}, 'Clients'), admin ? h('button.btn.primary', { type: 'button', onclick: act((o) => newPortfolioDialog(o, after)) }, '＋ New client') : null),
      banner(),
      v.portfolios.length
        ? h(
            'ul.pf-list',
            {},
            ...v.portfolios.map((p) =>
              h('li.pf-card', {}, h('button.pf-open', { type: 'button', onclick: () => ((open = p.id), render()), 'aria-label': `Open the client ${p.label}` }, h('span.pf-name', {}, `🗂️ ${p.label}`), h('span.pf-meta', {}, `${p.projects.length} project${p.projects.length === 1 ? '' : 's'}`), chip(p))),
            ),
          )
        : h('p.pf-empty', {}, 'No clients yet. Projects work on their own as always; a client is only for pointing several of one company’s projects at the same company brain.'),
      h('p.pf-hint', {}, `${v.ungrouped.length} project${v.ungrouped.length === 1 ? '' : 's'} without a client.`),
    ];
  }

  function page(v: PortfoliosView, p: PortfolioView): HTMLElement[] {
    const admin = v.admin && store.me.admin;
    return [
      h('p', {}, h('button.pt-link.pf-back', { type: 'button', onclick: () => ((open = undefined), render()) }, '← All clients')),
      h('div.pf-head', {}, h('h2', {}, `🗂️ ${p.label}`), chip(p)),
      banner(),
      h(
        'section.pf-part',
        {},
        h('h3', {}, 'Projects'),
        p.projects.length ? h('ul.pf-projects', {}, ...p.projects.map((x) => h('li', {}, h('a', { href: `/lite?floor=${encodeURIComponent(x.id)}` }, x.name), x.wiring ? h('span.pf-chip', { 'data-tone': x.wiring.ok ? 'good' : 'bad', title: x.wiring.problems.join('\n') }, x.wiring.ok ? 'wired' : 'wiring incomplete') : null))) : h('p', {}, 'No projects yet.'),
        admin ? h('button.btn', { type: 'button', onclick: act((o) => addToPortfolioDialog(o, v, { portfolio: p.id }, after)) }, '＋ Add a project') : null,
      ),
      brainPart(p, admin, act),
    ];
  }

  function render() {
    if (!showing) return;
    if (!view) return void root.replaceChildren(h('p.pf-hint', {}, 'Asking the office…'));
    const p = open ? view.portfolios.find((x) => x.id === open) : undefined;
    root.replaceChildren(h('div.pf-wrap', {}, ...(p ? page(view, p) : list(view))));
  }

  async function load() {
    try {
      view = await portfoliosView();
    } catch (err) {
      root.replaceChildren(h('p.pf-hint', {}, `Couldn’t ask the office: ${(err as Error).message}`));
      return;
    }
    render();
  }

  return {
    show() {
      showing = true;
      render();
      void load();
    },
    hide() {
      showing = false;
    },
    /** Opens one portfolio's page (for links and screenshots). */
    open(id: string) {
      open = id;
      render();
    },
  };
}
