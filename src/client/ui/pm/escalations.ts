// Escalations on the project console (🎛️ Command Center) (ui/pm/console.ts) and in the Team tab's approvals
// (ui/roster/approvals.ts): what an agent raised to the Project Manager — you, the human — with
// Reply / Approve / Reject. The answer goes back to the agent that raised it as its next prompt and the
// card is resolved (server/roster/escalations.ts). Urgent and critical ones are highlighted; FYIs (below
// the floor's threshold at its autonomy level) are dimmed and get a plain "Noted". No three.js here:
// the flat views import it.
//
// The list is drawn again whenever the team is fetched, so a card being answered is kept, not rebuilt:
// what you're typing in it survives the redraws.

import { TRIGGER_LABEL } from '../../../shared/roster/autonomy';
import { URGENCY_ICON, type Escalation, type EscalationVerdict } from '../../../shared/roster/escalation';
import { ROLE_BY_ID } from '../../../shared/roster/roles';
import type { RosterView } from '../../../shared/roster/types';
import { h, timeAgo, toast } from '../dom';
import { act } from '../roster/api';
import { store } from '../../state';
import { ZONE_BY_TEAM } from '../../../shared/zones';
import { lookFor, standing, type Outfit } from '../../pixel/chars';
import './escalations.css';

const VERDICT_DONE: Record<EscalationVerdict, string> = { reply: '💬 Replied', approve: '✅ Approved', reject: '❌ Rejected', dismiss: '✓ Noted' };

/** Answers an escalation; the team as it is afterwards, or undefined (act toasts why) when refused. */
export function answer(floor: string, e: Escalation, verdict: EscalationVerdict, text: string): Promise<RosterView | undefined> {
  return act(floor, 'escalation', { escalation: e.id, verdict, text });
}

/**
 * One escalation as a card. `admin` can answer it; `done` gets the team after an answer. The card
 * holds its own text box, so a redraw that keeps the element keeps what you typed.
 */
export function escalationCard(floor: string, e: Escalation, admin: boolean, done: (v: RosterView) => void): HTMLElement {
  const role = e.role ? ROLE_BY_ID.get(e.role) : undefined;
  const level = e.fyi ? 'fyi' : e.urgency;
  const tag = e.fyi ? 'FYI' : e.urgency.toUpperCase();
  const meta = [`${role?.icon ?? '🤖'} ${e.by}${role ? ` · ${role.title}` : ''}`, timeAgo(e.at), e.trigger ? TRIGGER_LABEL[e.trigger] : null].filter(Boolean).join(' · ');
  const reply = h('textarea.esc-reply', { rows: 1, placeholder: e.options.length ? 'Your answer (or pick an option)…' : 'Your answer…', 'aria-label': `Your answer to “${e.title}”` }) as HTMLTextAreaElement;
  const send = (verdict: EscalationVerdict) => {
    const text = reply.value.trim();
    if ((verdict === 'reply' || verdict === 'reject') && !text) {
      reply.focus();
      toast(verdict === 'reply' ? 'Write your reply first' : 'Say why it is rejected', 'warn');
      return;
    }
    for (const b of card.querySelectorAll<HTMLButtonElement>('button')) b.disabled = true;
    void answer(floor, e, verdict, text).then((v) => {
      for (const b of card.querySelectorAll<HTMLButtonElement>('button')) b.disabled = false;
      if (!v) return;
      reply.value = '';
      toast(`${VERDICT_DONE[verdict]} — ${verdict === 'dismiss' ? 'resolved' : `sent to ${e.by}`}`);
      done(v);
    });
  };
  const resolved = e.status === 'resolved' && e.resolution;
  const card: HTMLElement = h(
    'article.esc',
    { class: `esc-${level}${resolved ? ' esc-resolved' : ''}`, 'data-id': e.id, 'aria-label': `${tag} escalation from ${e.by}: ${e.title}` },
    h('header.esc-h', {}, h('span.esc-tag', {}, `${URGENCY_ICON[e.urgency]} ${tag}`), h('b.esc-title', {}, e.title)),
    h('p.esc-meta', {}, meta),
    e.details ? h('details.esc-details', {}, h('summary', {}, 'Details'), h('p', {}, e.details)) : null,
    e.options.length
      ? h(
          'div.esc-options',
          { role: 'group', 'aria-label': 'Options' },
          ...e.options.map((o) =>
            h('button.btn.small.esc-opt', { type: 'button', class: o === e.recommendation ? 'rec' : '', disabled: !admin || !!resolved, title: 'Use this option as your answer', onclick: () => ((reply.value = `Go with: ${o}`), reply.focus()) }, o === e.recommendation ? `⭐ ${o}` : o),
          ),
        )
      : null,
    e.recommendation ? h('p.esc-rec', {}, h('b', {}, 'Recommends: '), e.recommendation) : null,
    resolved
      ? h('p.esc-answer', {}, h('b', {}, `${VERDICT_DONE[e.resolution!.verdict]} by ${e.resolution!.by}`), ` · ${timeAgo(e.resolution!.at)}`, e.resolution!.text ? ` — ${e.resolution!.text}` : '', e.resolution!.delivered || e.resolution!.verdict === 'dismiss' ? '' : ` (kept for ${e.by}'s next session)`)
      : admin
        ? h(
            'div.esc-act',
            {},
            reply,
            h(
              'div.esc-btns',
              {},
              h('button.btn.small.esc-reply-btn', { type: 'button', title: `Send your answer to ${e.by} as its next prompt`, onclick: () => send('reply') }, '💬 Reply'),
              h('button.btn.small.ro-approve', { type: 'button', title: `Approve: ${e.by} goes ahead (your note goes with it)`, onclick: () => send('approve') }, '✅ Approve'),
              h('button.btn.small.esc-reject', { type: 'button', title: `Reject: ${e.by} doesn't go ahead (say why)`, onclick: () => send('reject') }, '❌ Reject'),
              e.fyi ? h('button.btn.small', { type: 'button', title: 'Noted: resolve it without sending anything', onclick: () => send('dismiss') }, '✓ Noted') : null,
            ),
          )
        : h('p.esc-meta', {}, 'Only the Project Manager (an admin) can answer it.'),
  );
  // Who raised it, big enough to tell at a glance: the same character as in the 2D office.
  const body = h('div.esc-body');
  body.append(...card.childNodes);
  card.append(raisedBy(e), body);
  return card;
}

const OUTFIT: Record<string, Outfit> = { pm: 'pm', 'lead-designer': 'designer', 'lead-developer': 'dev', 'lead-tester': 'qa', 'chief-analyst': 'analyst' };

/** The agent that raised `e` from the waist up, with its name and role under it. */
function raisedBy(e: Escalation): HTMLElement {
  const role = e.role ? ROLE_BY_ID.get(e.role) : undefined;
  const w = store.workers.get(e.workerId);
  const color = (role && ZONE_BY_TEAM.get(role.team)?.color) ?? w?.color ?? '#00a6a6';
  const src = standing(lookFor(e.workerId, color, (e.role && OUTFIT[e.role]) || 'plain'), 'front', false, 0);
  const c = h('canvas.esc-face', { width: 24, height: 24, role: 'img', 'aria-label': `${e.by}${role ? `, ${role.title}` : ''}` }) as HTMLCanvasElement;
  c.getContext('2d')!.drawImage(src, 0, 0, 24, 24, 0, 0, 24, 24);
  return h('figure.esc-who', { title: `Raised by ${e.by}${role ? ` (${role.title})` : ''}` }, c, h('figcaption', {}, e.by), role ? h('small', {}, role.title) : null);
}

/** The console's list of escalations: the open ones as cards, the answered ones folded away. */
export class EscalationList {
  readonly el = h('section.esc-list', { 'aria-label': 'Escalations to you, the Project Manager' });
  private cards = new Map<string, { sig: string; el: HTMLElement }>();
  /** Kept between redraws, so it stays open once you've opened it. */
  private folded = h('details.esc-answered');
  /** What was drawn last: the console draws often (every worker update), and moving a card would lose your caret. */
  private drawn = '';

  constructor(private done: (v: RosterView) => void) {}

  render(v: RosterView | undefined) {
    const list = v?.escalations ?? [];
    const open = list.filter((e) => e.status === 'open');
    const answered = list.filter((e) => e.status === 'resolved').slice(0, 3);
    this.el.hidden = !list.length;
    const sig = `${v?.floor}|${v?.admin}|${list.map((e) => `${e.id}:${e.status}`).join(',')}`;
    if (sig === this.drawn) return;
    this.drawn = sig;
    if (!v || !list.length) return void this.el.replaceChildren();
    const loud = open.filter((e) => !e.fyi && (e.urgency === 'urgent' || e.urgency === 'critical')).length;
    const keep = new Map<string, { sig: string; el: HTMLElement }>();
    const cardFor = (e: Escalation) => {
      const sig = `${e.status}|${v.admin}`;
      const had = this.cards.get(e.id);
      const c = had && had.sig === sig ? had : { sig, el: escalationCard(v.floor, e, v.admin, this.done) };
      keep.set(e.id, c);
      return c.el;
    };
    const head = h('header.esc-list-h', {}, h('b', {}, `🚩 Escalations to you${open.length ? ` (${open.length} open)` : ''}`), loud ? h('span.esc-loud', {}, `${loud} need${loud === 1 ? 's' : ''} you now`) : null);
    this.folded.replaceChildren(h('summary', {}, `Answered (${answered.length})`), ...answered.map(cardFor));
    this.el.replaceChildren(head, ...open.map(cardFor), ...(answered.length ? [this.folded] : []));
    this.cards = keep;
  }
}
