// A client's company brain on the Clients page (clients/view.ts) and in a project's ⚙️ Settings › Client
// (ui/settings/portfolio.ts): its state in a few words (the chip), and the part of a client's page with the
// brain's path, snapshot, routed and excluded files, the ROUTING.md size warning and Connect a brain /
// Disconnect (admins).

import type { BrainRead, ExcludeReason, PortfolioView } from '../../shared/portfolios';
import { h } from '../ui/dom';
import { connectBrainDialog, disconnectDialog } from '../ui/portfolios/dialogs';
import type { ActResult } from '../ui/portfolios/api';
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

export const chip = (p: Pick<PortfolioView, 'brain' | 'read'>) => {
  const c = brainChip(p);
  return h('span.pf-chip', { 'data-tone': c.tone }, c.text);
};

/** Connect a brain or Disconnect, as the client's page header has it (admins). */
export function brainButton(p: PortfolioView, after: (r: ActResult) => void): HTMLElement {
  const b = h('button.btn', { type: 'button', class: p.brain ? 'ph-outline' : 'primary' }, p.brain ? 'Disconnect brain' : '🧠 Connect a brain') as HTMLButtonElement;
  b.onclick = () => (p.brain ? disconnectDialog(b, p, after) : connectBrainDialog(b, p, after));
  return b;
}

/** The Company brain part of a client's page. */
export function brainPart(p: PortfolioView): HTMLElement {
  if (!p.brain) return h('section.pf-part', {}, h('h3', {}, 'Company brain'), h('p', {}, 'No brain connected. The client still groups its projects; their agents get no brain line until one is connected.'));
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
  );
}
