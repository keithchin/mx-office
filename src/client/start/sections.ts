// Home's sections (start/view.ts puts them on the page): each a summary with links to the page that has
// the whole of it, never a copy of that page. What each says comes from shared/start.ts's rules on what
// the office recorded; nothing here works anything out a second way.

import type { FloorInfo } from '../../shared/protocol';
import type { OfficeBudgetView } from '../../shared/budget/types';
import type { PortfolioView } from '../../shared/portfolios';
import { usd } from '../../shared/budget/money';
import { floorPalette } from '../../shared/floors';
import { businessChip } from '../../shared/business-status';
import { clientSpend, liveWord, needsByProject, redFlag, teamWords, topNeeds, type HealthItem, type StartActivity, type StartNeed, type StartProject } from '../../shared/start';
import { h, timeAgo } from '../ui/dom';
import { miniProgress } from '../ui/progress/mini';
import { tileLetters } from '../home/portal-logic';
import { clientHref } from '../clients/logic';

/** A section's frame: its heading, a link to the page with all of it, and its body. */
export function card(id: string, title: string, more?: { href: string; label: string }): { el: HTMLElement; body: HTMLElement; head: HTMLElement } {
  const body = h('div.st-body');
  const head = h('header.st-card-h', {}, h('h2.st-h', { id: `st-${id}-h` }, title), more ? h('a.st-more', { href: more.href }, more.label) : null);
  const el = h('section.st-card', { id: `st-${id}`, 'aria-labelledby': `st-${id}-h` }, head, body);
  return { el, body, head };
}

const note = (text: string, cls = '') => h(`p.st-note${cls}`, {}, text);
const projectHref = (floor: string) => `/lite?floor=${encodeURIComponent(floor)}`;

// ---- Needs you, across everything --------------------------------------------------------------------

export interface NeedsInput {
  needs?: readonly StartNeed[];
  unread?: readonly string[];
  failed?: string;
  clientOf: (floor: string) => { id: string; label: string } | undefined;
  nameOf: (floor: string) => string;
}

export function needsBody(i: NeedsInput): HTMLElement[] {
  if (!i.needs) return [note(i.failed ? `Couldn’t read Needs you: ${i.failed}` : 'Reading every project…', i.failed ? '.bad' : '')];
  const out: HTMLElement[] = [];
  if (!i.needs.length) out.push(note('Nothing needs you right now.', '.calm'));
  else {
    out.push(
      h(
        'ul.st-needs',
        {},
        ...topNeeds(i.needs).map((n) => {
          const client = i.clientOf(n.floor);
          return h(
            'li.st-need',
            { 'data-level': n.level },
            h('div.st-tags', {}, client ? h('span.st-tag.st-tag-client', { title: 'Client' }, client.label) : null, h('span.st-tag.st-tag-project', { title: 'Project' }, n.project), h(`span.st-tag.st-urg.${n.level}`, {}, n.urgency)),
            h('p.st-need-t', {}, n.summary),
            h('div.st-need-foot', {}, h('small.st-who', {}, n.who), h('div.st-acts', {}, h('a.btn.small', { href: `/${n.path}`, title: `Open it in ${n.project}` }, 'Open'))),
          );
        }),
      ),
    );
    const by = needsByProject(i.needs);
    out.push(h('p.st-seeall', {}, `See all ${i.needs.length}: `, ...by.flatMap((p, k) => [k ? ' · ' : '', h('a', { href: projectHref(p.floor), title: `${p.project}’s Overview: its Needs you card` }, `${p.project} (${p.count})`)])));
  }
  if (i.unread?.length) out.push(note(`Couldn’t read ${i.unread.length} project${i.unread.length === 1 ? '' : 's'} this time: ${i.unread.map(i.nameOf).join(', ')}`, '.bad'));
  return out;
}

// ---- Active projects -----------------------------------------------------------------------------------

export interface ProjectRowInput {
  f: FloorInfo;
  client?: { id: string; label: string };
  facts?: StartProject;
  open: (floor: string) => void;
}

/** What a row shows, as a string: the row is drawn again only when it changes. */
export const rowSig = (r: ProjectRowInput) => JSON.stringify([r.f.id, r.f.name, r.f.palette, r.f.cloning, r.f.workers, r.f.busy, r.f.waiting, r.client?.label, r.facts?.stuck, r.facts?.failing, r.facts?.live?.status, !!r.facts?.live?.viewPort || !!r.facts?.live?.appPort, r.facts?.live?.started, r.facts?.business?.line]);

export function projectRow(r: ProjectRowInput): HTMLElement {
  const { f } = r;
  const red = redFlag(r.facts);
  // The server's facts not in yet: the live app is not known yet either, rather than "unknown".
  const live = r.facts ? liveWord(r.facts.live) : undefined;
  // Its business status (shared/business-status.ts): the same words as its Overview, progress bar and phone card.
  const biz = r.facts?.business ? businessChip(r.facts.business) : undefined;
  const name = h('a.st-row-name', { href: projectHref(f.id), title: `Open ${f.name}` }, f.name);
  const row = h(
    'li.st-row',
    { class: red ? 'red' : '', 'data-floor': f.id, style: `--tile:${floorPalette(f.palette).trim}` },
    h('span.st-tile', { 'aria-hidden': 'true' }, tileLetters(f.name)),
    h('div.st-row-main', {}, h('div.st-row-top', {}, name, h('span.st-row-client', {}, r.client?.label ?? 'No client')), f.cloning ? h('p.st-row-line', {}, f.clone?.step ?? 'Being added…') : miniProgress(f.id)),
    h(
      'div.st-row-facts',
      {},
      h('span.st-fact', { title: 'The team: working, asking you, idle' }, teamWords(f)),
      biz ? h(`span.st-fact.st-business.${biz.tone}`, { title: biz.title }, biz.text) : null,
      live ? h(`span.st-fact.st-live.${live.tone}`, {}, live.text) : null,
      red ? h('span.st-fact.st-red', { title: 'Stuck detection and failing checks: see its Needs you' }, red) : null,
    ),
  );
  name.addEventListener('click', (e) => {
    e.preventDefault();
    if (!f.cloning) r.open(f.id);
  });
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a, button') || f.cloning) return;
    r.open(f.id);
  });
  return row;
}

// ---- Clients -------------------------------------------------------------------------------------------

export function clientsBody(list: readonly PortfolioView[] | undefined, budget: OfficeBudgetView | undefined, failed?: string): HTMLElement[] {
  if (!list) return [note(failed ? `Couldn’t read the clients: ${failed}` : 'Reading the clients…', failed ? '.bad' : '')];
  if (!list.length) return [note('No clients yet. A client groups a company’s projects and can point their agents at its company brain.')];
  return [
    h(
      'ul.st-clients',
      {},
      ...[...list]
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
        .map((p) => {
          const s = clientSpend(p.projectIds, budget?.floors);
          const spend = !s ? (budget ? '' : 'Spend: reading…') : s.budget !== undefined ? `${usd(s.spent)} of ${usd(s.budget)}` : `${usd(s.spent)} spent${s.unbudgeted && p.projectIds.length ? ` · ${s.unbudgeted === p.projectIds.length ? 'no budget set' : `${s.unbudgeted} without a budget`}` : ''}`;
          const brain = p.brain ? (p.read?.status === 'unavailable' ? 'Brain unavailable' : 'Brain connected') : 'No brain connected';
          return h(
            'li.st-client',
            {},
            h('a.st-client-a', { href: clientHref(p.id) }, h('b.st-client-n', {}, p.label), h('span.st-client-l', {}, `${p.projectIds.length} project${p.projectIds.length === 1 ? '' : 's'}`), spend ? h('span.st-client-l', {}, spend) : null, h(`span.st-client-l.st-brain.${p.brain && p.read?.status !== 'unavailable' ? 'on' : 'off'}`, {}, brain)),
          );
        }),
    ),
  ];
}

// ---- Recent activity -----------------------------------------------------------------------------------

const ACT_ICON: Record<StartActivity['kind'], string> = { 'pr-merged': 'Merged', 'live-ready': 'Live app', accepted: 'Accepted' };

export function activityBody(items: readonly StartActivity[] | undefined, nameOf: (floor: string) => string, failed?: string): HTMLElement[] {
  if (!items) return [note(failed ? `Couldn’t read the activity: ${failed}` : 'Reading…', failed ? '.bad' : '')];
  if (!items.length) return [note('No milestones recorded yet: merged pull requests, live-app milestones and accepted deliveries show here.')];
  return [
    h(
      'ul.st-acts-list',
      {},
      ...items.map((a) =>
        h(
          'li.st-act',
          { 'data-kind': a.kind },
          h('span.st-act-k', {}, ACT_ICON[a.kind]),
          h('span.st-act-t', {}, h('a', { href: projectHref(a.floor) }, nameOf(a.floor)), ' · ', a.text),
          h('time.st-act-at', { datetime: new Date(a.at).toISOString(), title: new Date(a.at).toLocaleString() }, timeAgo(a.at)),
        ),
      ),
    ),
  ];
}

// ---- The office's health -------------------------------------------------------------------------------

export function healthStrip(items: readonly HealthItem[]): HTMLElement[] {
  const bad = items.filter((i) => !i.ok);
  return [
    h('span.st-health-word', {}, bad.length ? `${bad.length} thing${bad.length === 1 ? '' : 's'} to look at` : 'All OK'),
    ...items.map((i) => (i.href ? h(`a.st-hi${i.ok ? '' : '.warn'}`, { href: i.href, 'data-health': i.id }, i.text) : h(`span.st-hi${i.ok ? '' : '.warn'}`, { 'data-health': i.id }, i.text))),
  ];
}
