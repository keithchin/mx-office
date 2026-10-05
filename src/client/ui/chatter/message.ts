// One team chatter message as a line of a chat thread: who said it (their 2D character from the waist
// up, as on the escalation cards; Jeff's own portrait; a badge for the Project Manager, who is a
// person; a Firm reviewer's framed portrait; 🏢 for the office), their name and role, who it's to, the words in a speech bubble, what kind
// of exchange it is, and when. The bubble opens what it's about. No three.js.

import { CHATTER_ICON, CHATTER_WORD, isGroup, type ChatterMessage, type ChatterParty, type ChatterTo } from '../../../shared/chatter';
import { ZONE_BY_TEAM } from '../../../shared/zones';
import { REVIEWER_BY_ID, type ReviewerId } from '../../../shared/firm/roles';
import { portrait } from '../../firm/portraits';
import { lookFor, standing, type Outfit } from '../../pixel/chars';
import { store } from '../../state';
import { h, timeAgo } from '../dom';
import { jeffPortrait } from '../jeff';

export interface ChatterActions {
  openWorker(id: string): void;
  openEscalation(id: string): void;
  openPull(n: number): void;
  openJournal(path: string, heading: string): void;
  openStandup(): void;
}

const OUTFIT: Record<string, Outfit> = { pm: 'pm', 'lead-designer': 'designer', 'lead-developer': 'dev', 'lead-tester': 'qa', 'chief-analyst': 'analyst' };

/** A speaker's face, `size` CSS pixels square. */
export function avatar(p: ChatterParty, size = 32): HTMLElement {
  if (p.kind === 'jeff') return h('span.tc-face.tc-jeff', {}, jeffPortrait(size));
  if (p.kind === 'human') return h('span.tc-face.tc-human', { role: 'img', 'aria-label': `${p.name}, the Project Manager (a person)`, style: `width:${size}px;height:${size}px` }, '🧑‍💼');
  if (p.kind === 'reviewer') {
    const r = REVIEWER_BY_ID.get(p.reviewer as ReviewerId);
    if (r) return h('span.tc-face.tc-reviewer', {}, portrait({ ...r, name: p.name }, size));
  }
  if (p.kind === 'office') return h('span.tc-face.tc-office', { role: 'img', 'aria-label': 'The office', style: `width:${size}px;height:${size}px` }, '🏢');
  const w = p.workerId ? store.workers.get(p.workerId) : undefined;
  const color = (p.team && ZONE_BY_TEAM.get(p.team)?.color) ?? w?.color ?? '#00a6a6';
  const src = standing(lookFor(p.workerId ?? `${p.team ?? ''}:${p.name}`, color, (p.roleId && OUTFIT[p.roleId]) || 'plain'), 'front', false, 0);
  const c = h('canvas.tc-px', { width: 24, height: 24, role: 'img', 'aria-label': `${p.name}${p.role ? `, ${p.role}` : ''}`, style: `width:${size}px;height:${size}px` }) as HTMLCanvasElement;
  c.getContext('2d')?.drawImage(src, 0, 0, 24, 24, 0, 0, 24, 24);
  return h('span.tc-face', {}, c);
}

function toChip(t: ChatterTo): HTMLElement {
  if (isGroup(t)) return h('span.tc-to', { class: t.group === 'pm' ? 'tc-to-pm' : '' }, t.group === 'pm' ? '→ 🧑‍💼 Project Manager' : '→ 👥 the team');
  return h('span.tc-to', { class: t.kind === 'human' ? 'tc-to-pm' : '', title: t.role ? `${t.name}, ${t.role}` : t.name }, `→ ${t.kind === 'human' ? '🧑‍💼 ' : ''}${t.name}`);
}

/** What clicking the bubble opens, and its label; undefined when there's nothing to open. */
function target(m: ChatterMessage, act: ChatterActions): { label: string; go: () => void } | undefined {
  const r = m.ref ?? {};
  if (r.escalationId) return { label: 'Open the escalation', go: () => act.openEscalation(r.escalationId!) };
  if (r.pr) return { label: `Open PR #${r.pr}`, go: () => act.openPull(r.pr!) };
  if (r.journal) {
    const i = r.journal.indexOf('#');
    return { label: 'Read the journal entry', go: () => act.openJournal(r.journal!.slice(0, i < 0 ? undefined : i), i < 0 ? '' : r.journal!.slice(i + 1)) };
  }
  if (r.standup) return { label: 'Open the standup', go: () => act.openStandup() };
  if (r.engagement) return { label: 'Open The Firm', go: () => location.assign('/firm') };
  const here = (p: ChatterParty | ChatterTo) => !isGroup(p) && p.kind === 'agent' && p.workerId && store.workers.has(p.workerId) ? p.workerId : undefined;
  const id = here(m.from) ?? here(m.to);
  if (id) return { label: `Open ${store.workers.get(id)?.name ?? 'its'}'s terminal`, go: () => act.openWorker(id) };
  return undefined;
}

/** A message as a thread line; `compact` drops the role and the kind word. */
export function messageNode(m: ChatterMessage, act: ChatterActions, compact = false): HTMLElement {
  const go = target(m, act);
  const words = h('span.tc-text', {}, m.text);
  const bubble = go ? h('button.tc-bubble', { type: 'button', title: go.label, onclick: go.go }, words) : h('p.tc-bubble', {}, words);
  return h(
    'li.tc-msg',
    { class: `tc-k-${m.kind} tc-by-${m.from.kind}`, 'data-id': m.id },
    h('figure.tc-who', { title: m.from.role ? `${m.from.name}, ${m.from.role}` : m.from.name }, avatar(m.from, compact ? 24 : 32)),
    h(
      'div.tc-main',
      {},
      h(
        'div.tc-line',
        {},
        h('b.tc-name', {}, m.from.name),
        m.from.kind === 'human' ? h('span.tc-badge', { title: 'A person: the Project Manager' }, 'PM') : null,
        !compact && m.from.role && m.from.kind !== 'human' ? h('small.tc-role', {}, m.from.role) : null,
        toChip(m.to),
        h('span.tc-kind', { title: CHATTER_WORD[m.kind], 'aria-label': CHATTER_WORD[m.kind] }, CHATTER_ICON[m.kind]),
        h('time.tc-time', { datetime: new Date(m.at).toISOString(), 'data-at': String(m.at), title: new Date(m.at).toLocaleString() }, timeAgo(m.at)),
      ),
      bubble,
    ),
  );
}

/** Moves every "3m ago" in `root` on, in place. */
export function refreshTimes(root: HTMLElement) {
  for (const t of root.querySelectorAll<HTMLTimeElement>('time.tc-time')) t.textContent = timeAgo(Number(t.dataset.at));
}
