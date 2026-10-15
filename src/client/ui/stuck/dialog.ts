// A stuck item's card (server/stuck/, shared/stuck.ts), opened from its Needs-you row: what's stuck and
// since when, what it blocks, the evidence (file:line at main, or the PR's link), what waiting costs and
// the next safe step, with its buttons. A message to the team lead goes after their current turn unless
// you pick "Interrupt now" (the same choice as the console's "OK to interrupt?"); Snooze hides it for a
// day, Dismiss hides it until it clears and comes back, and neither resolves anything: the office does
// that by itself when the condition clears. ✕ and Esc close it and give focus back to where it was opened.

import { actionLabel, ageWords, stuckActions, stuckConsequence, stuckNext, stuckTitle, STUCK_ICON, type StuckAction, type StuckFloorView, type StuckKind, type StuckView } from '../../../shared/stuck';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { setStuckView, stuckView } from './feed';
import './stuck.css';

const KIND_TITLE: Record<StuckKind, string> = { 'stale-pr': 'Stuck: a pull request nobody is moving', decision: 'Decision waiting on you', failing: 'Failing for days', circles: 'Going in circles', 'blocked-row': 'Build-plan rows blocked' };

/** What the card is worked out from, so the tests can check it without a page. */
export interface CardModel {
  title: string;
  heading: string;
  since: string;
  blocks: string[];
  evidence: { label: string; url?: string }[];
  also: string[];
  consequence: string;
  next: string;
  actions: { id: StuckAction; label: string }[];
}

export function cardModel(d: StuckView, now: number): CardModel {
  const lead = d.lead ?? 'the team lead';
  return {
    heading: `${STUCK_ICON[d.kind]} ${KIND_TITLE[d.kind]}`,
    title: stuckTitle(d, now),
    since: `${new Date(d.since).toLocaleString()} (${ageWords(now - d.since)} ago)`,
    blocks: d.blocks,
    evidence: d.evidence.map((e) => ({ label: e.label, ...(e.url ? { url: e.url } : {}) })),
    also: [...(d.kind === 'stale-pr' ? (d.failing ?? []).map((f) => `${f.name} has failed for ${ageWords(now - f.since)}: waits on PR #${d.pr?.number}`) : []), ...(d.decision?.accepted ? [`Accepted for now earlier: ${d.decision.accepted}`] : [])],
    consequence: stuckConsequence(d),
    next: stuckNext(d, lead),
    actions: stuckActions(d).map((a) => ({ id: a, label: actionLabel(a, d, lead) })),
  };
}

/** Opens item `id` of the floor's stuck items, if it's still there. */
export function openStuck(id: string): void {
  const v = stuckView();
  // A dismissed one too (Needs you's "hidden (N)" opens it): hidden, still open.
  const d = v ? [...v.items, ...(v.dismissed ?? [])].find((x) => x.id === id) : undefined;
  if (!v || !d) return;
  const back = document.activeElement as HTMLElement | null;
  const m = cardModel(d, Date.now());
  const status = h('p.stuckc-status', { role: 'status' });
  // A client question in a BRD has one answer path, the Questions page: no answer box here.
  const brd = d.kind === 'decision' && !!d.decision?.brd;
  const answer = d.kind === 'decision' && !brd ? (h('textarea.stuckc-answer', { rows: 3, placeholder: 'Your answer (sent to the team lead to record in PROJECT.md as CONFIRMED)', 'aria-label': 'Your answer' }) as HTMLTextAreaElement) : undefined;
  let when: 'after' | 'now' = 'after';
  const choice = (v2: 'after' | 'now', label: string) => {
    const b = h('button.btn.small.stuckc-when', { type: 'button', role: 'radio', 'aria-checked': String(v2 === when), 'data-v': v2, onclick: () => ((when = v2), paint()) }, label);
    return b;
  };
  const whens = [choice('after', 'After their current turn'), choice('now', 'Interrupt now')];
  const paint = () => whens.forEach((b) => (b.setAttribute('aria-checked', String(b.dataset.v === when)), b.classList.toggle('on', b.dataset.v === when)));
  paint();
  const sends = m.actions.some((a) => a.id !== 'snooze' && a.id !== 'dismiss');
  const leadLine = !sends
    ? null
    : !v.lead
      ? h('p.stuckc-note', {}, 'This project has no team lead at work to ask.')
      : v.lead.working
        ? h('div.stuckc-interrupt', {}, h('p.stuckc-note', {}, `${v.lead.name} is working. OK to interrupt?`), h('div.stuckc-whens', { role: 'radiogroup', 'aria-label': `When ${v.lead.name} gets it` }, ...whens))
        : h('p.stuckc-note', {}, `${v.lead.name} is ready: the message goes now.`);
  const busy = (on: boolean) => content.querySelectorAll<HTMLButtonElement>('footer button').forEach((b) => (b.disabled = on || (!v.admin && b.dataset.act !== undefined)));
  const act = async (a: StuckAction) => {
    if (a === 'answer' && !answer?.value.trim()) {
      status.textContent = 'Write the answer first.';
      return answer?.focus();
    }
    busy(true);
    status.textContent = 'Sending…';
    const res = await fetch('/api/stuck/action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor: v.floor, id: d.id, action: a, when, ...(a === 'answer' ? { text: answer!.value } : {}), by: store.me.account?.name ?? store.profile.name }),
    }).catch(() => undefined);
    const out = (await res?.json().catch(() => ({}))) as (StuckFloorView & { error?: string }) | undefined;
    if (!res?.ok || !out?.items) {
      busy(false);
      status.textContent = `Not done: ${out?.error ?? 'the office could not be reached'}`;
      return;
    }
    setStuckView(out);
    modal.close();
  };
  const section = (label: string, ...kids: (Node | string | null)[]) => h('section.stuckc-part', {}, h('h3', {}, label), ...kids);
  const content = h(
    'div.modal.stuckc',
    { role: 'dialog', 'aria-label': m.heading, 'data-stuck': d.id },
    h('header', {}, h('h2', { title: m.heading }, m.heading)),
    h(
      'div.body',
      {},
      h('p.stuckc-title', {}, m.title),
      section('Since', h('p', {}, m.since)),
      m.blocks.length ? section('What it blocks', h('ul.stuckc-list', {}, ...m.blocks.map((b) => h('li', {}, b)))) : null,
      m.also.length ? section('Same cause', h('ul.stuckc-list', {}, ...m.also.map((b) => h('li', {}, b)))) : null,
      section('Evidence', h('ul.stuckc-list.stuckc-ev', {}, ...m.evidence.map((e) => h('li', {}, e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.label) : h('code', {}, e.label))))),
      section('If it waits', h('p', {}, m.consequence)),
      section('Next safe step', h('p', {}, m.next)),
      answer ? section('Your answer', answer) : null,
      brd ? section('Your answer', h('p', {}, 'Answer it on the Questions page: the analyst records it in the BRD. ', h('a', { href: `/lite?tab=questions&floor=${encodeURIComponent(v.floor)}` }, 'Open the Questions page'))) : null,
      d.dismissedAt ? h('p.stuckc-note', {}, 'Dismissed: hidden from Needs you, but still open (dismissing resolves nothing).') : null,
      d.unreadAt ? h('p.stuckc-note', {}, `The office couldn't re-read its source at ${new Date(d.unreadAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: kept as it was, not resolved.`) : null,
      leadLine,
      v.admin ? null : h('p.stuckc-note', {}, 'Only an admin can act on this.'),
      status,
    ),
    h(
      'footer',
      {},
      ...m.actions.map((a, i) => h(`button.btn${i === 0 ? '.primary' : ''}.stuckc-act`, { type: 'button', 'data-act': a.id, disabled: !v.admin, onclick: () => void act(a.id) }, a.label)),
    ),
  );
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  setTimeout(() => (answer ?? content.querySelector<HTMLButtonElement>('.stuckc-act:not([disabled])') ?? content.querySelector<HTMLElement>('button'))?.focus(), 0);
}
