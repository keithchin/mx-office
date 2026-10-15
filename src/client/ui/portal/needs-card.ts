// The Overview's Needs you card (Portal): everything actionable that waits on you, most urgent first, as
// the Needs-you strip works it out (ui/needsyou/feed.ts, the same list and count). The escalations are full
// cards (./needs-logic.ts): the question, who raised it, the options with the recommendation marked, why,
// and Send answer / Reply in my words / Ask <lead>, answered through the escalation's existing action
// (ui/pm/escalations.ts answer). A merged PR that isn't verified gets Re-run checks / Waive / Send back.
// The rest (an agent asking, a ✋ sign-off, an approval…) are rows with their tag and their button.
//
// Each item is a decision card (shared/decisions/, ./decision-card.ts): the header counts decisions, actions
// for you and FYIs; a hands-on action has I've done it / Can't now / Ask, an FYI has Noted, an AWAITING-PM
// line that's gone has Resolved / Still needed, and every card lists the sources it folds, with Separate.
//
// It never redraws a card that shows the same: an escalation you're answering keeps its choice and what
// you typed while the list round it changes.

import type { Escalation } from '../../../shared/roster/escalation';
import type { RosterView } from '../../../shared/roster/types';
import { store } from '../../state';
import { h, timeAgo, toast } from '../dom';
import { answer as answerEscalation } from '../pm/escalations';
import { setRoster } from '../teams/world';
import { onNeeds, waitingCount, type NeedsSnapshot } from '../needsyou/feed';
import type { NeedItem } from '../needsyou/logic';
import { leadOf } from '../lead-panel/logic';
import { askLead } from '../lead-panel/hooks';
import { answerFor, escalationModel, rowModel, verifyAnswer, type EscModel, type Tone } from './needs-logic';
import type { DecisionCard } from '../../../shared/decisions/types';
import { cardCounts, countsWords } from '../../../shared/decisions/words';
import { cardExtras, fyiCard, genericCard, goneCard, handsOnCard, otherEscalations, type CardCtx } from './decision-card';
import { decisionAct } from '../decisions/api';
import { decisionCheck } from '../decisions/feed';
import { stuckView } from '../stuck/feed';
import { dispatchNotices } from '../dispatch/card';
import { followNotices } from '../followthrough/card';

export interface NeedsCardDeps {
  /** Opens a tab (Waive is on the Testing tab). */
  show(tab: string): void;
  /** The escalation's answer action; the existing one unless a test hands another. */
  answer?: typeof answerEscalation;
  /** "Ask <lead>": the team-lead panel's box; the existing one unless a test hands another. */
  ask?: (text: string) => boolean;
}

export interface NeedsCard {
  el: HTMLElement;
  /** Scrolls to an escalation's card and focuses its answer; false when it isn't on the card. */
  focusEscalation(id: string): boolean;
}

const TONE_CLASS: Record<Tone, string> = { block: 't-block', normal: 't-normal', verify: 't-verify', later: 't-later', done: 't-done' };
const ICON: Record<Tone, string> = { block: '⛔', normal: '⚑', verify: '⚠', later: '✋', done: '✓' };

/** Items shown before Show N more. */
const FOLD_AFTER = 6;

const tagEl = (tone: Tone, text: string) => h('span.pt-tag', { class: TONE_CLASS[tone] }, h('span.pt-tag-i', { 'aria-hidden': 'true' }, ICON[tone]), text);

export function needsCard(deps: NeedsCardDeps): NeedsCard {
  const answer = deps.answer ?? answerEscalation;
  const ask = deps.ask ?? askLead;
  const heading = h('h2', { id: 'pt-needs-h', tabindex: '-1' }, 'Needs you');
  const count = h('span.pt-badge');
  const list = h('div.pt-needs-list');
  // "3 decisions · 2 actions for you · 4 FYIs": only decisions and actions count as waiting on you.
  const counts = h('p.pt-needs-counts', { role: 'status' });
  const hidden = h('div.pt-needs-hidden');
  let showHidden = false;
  // Answers whose outcome the office couldn't establish (server/dispatch/): above the rest, until you settle each.
  const notices = dispatchNotices();
  // Answered decisions still being followed through (server/followthrough/): status-level, after the rest, never counted.
  const follow = followNotices();
  const el = h('section.pt-ov-card.pt-needs', { id: 'pt-needs', 'aria-labelledby': 'pt-needs-h' }, h('div.pt-ov-card-h', {}, heading, count), counts, notices.el, list);
  /** Each item's element by its key, with what it was drawn from. */
  let drawn = new Map<string, { sig: string; el: HTMLElement }>();
  /** Answered here, shown as done until the project changes. */
  const answered = new Map<string, { title: string; text: string }>();
  let floor: string | undefined;
  let snap: NeedsSnapshot | undefined;
  /** Every item, not just the first few (Show N more). */
  let all = false;
  const more = h('button.pt-link.pt-needs-more', { type: 'button', hidden: true, onclick: () => ((all = !all), snap && draw(snap)) }) as HTMLButtonElement;
  el.append(more, follow.el, hidden);

  function escCard(e: Escalation, r: RosterView, m: EscModel, card?: DecisionCard, x?: CardCtx): HTMLElement {
    const lead = leadOf(r);
    const leadName = lead && lead.kind === 'lead' ? lead.name : undefined;
    let pick = m.options.find((o) => o.recommended)?.key ?? m.options[0]?.key;
    const noteId = `pt-note-${e.id}`;
    const note = h('textarea.pt-esc-note', { id: noteId, rows: 2, hidden: m.options.length > 0, placeholder: 'Your answer in your own words…', 'aria-label': `Your answer to: ${e.title}` }) as HTMLTextAreaElement;
    const buttons: HTMLButtonElement[] = [];
    const send = async (a: { verdict: 'reply' | 'approve' | 'reject'; text: string } | undefined) => {
      if (!a || !floor) return void (note.hidden = false, note.focus(), toast('Write your answer first', 'warn'));
      buttons.forEach((b) => (b.disabled = true));
      // A card that folds other escalations answers them all (FYIs among them noted): server/decisions/.
      const others = card ? otherEscalations(card) : [];
      const v = others.length ? ((await decisionAct(floor, { action: 'answer', escalation: e.id, others, verdict: a.verdict, text: a.text, expectedRev: e.resolution?.answerRev ?? 0 })) ? r : undefined) : await answer(floor, e, a.verdict, a.text);
      buttons.forEach((b) => (b.disabled = false));
      if (!v) return;
      answered.set(e.id, { title: e.title, text: `${a.text.replace(/^Go with: /, '')} · sent to ${e.by}` });
      if (v.floor === store.floor) setRoster(v);
      toast(`Answer sent to ${e.by}`);
      if (snap) draw(snap);
      heading.focus({ preventScroll: true });
    };
    const btn = (cls: string, text: string, run: () => void, attrs: Record<string, string> = {}) => {
      const b = h(`button.btn.small${cls}`, { type: 'button', ...attrs }, text) as HTMLButtonElement;
      b.addEventListener('click', run);
      buttons.push(b);
      return b;
    };
    const opts = m.options.length
      ? h(
          'fieldset.pt-esc-opts',
          {},
          h('legend.pt-sr', {}, 'Options'),
          ...m.options.map((o) => {
            const input = h('input', { type: 'radio', name: `pt-esc-${e.id}`, value: o.key }) as HTMLInputElement;
            input.checked = o.key === pick;
            input.addEventListener('change', () => (pick = o.key));
            return h('label.pt-opt', { class: o.recommended ? 'pt-opt-rec' : '' }, input, h('span', {}, h('b', {}, `${o.key}. `), o.text, o.recommended ? h('span.pt-badge.pt-rec', {}, 'Recommended') : null));
          }),
        )
      : null;
    const admin = r.admin;
    const verify = m.kind === 'verify';
    const acts = !admin
      ? h('p.pt-esc-meta', {}, 'Only the Project Manager (an admin) can answer it.')
      : verify
        ? h(
            'div.pt-esc-acts',
            {},
            btn('', 'Re-run checks', () => void send(verifyAnswer('rerun')), { title: 'The agent re-runs the checks on the merge commit; the office picks the new run up' }),
            btn('', 'Waive', () => deps.show('testing'), { title: 'Waive a check, with a reason: Testing › Verification' }),
            btn('', 'Send back', () => (note.hidden ? ((note.hidden = false), note.focus()) : void send(verifyAnswer('back', note.value))), { title: 'Send it back for rework: what you write goes with it' }),
          )
        : h(
            'div.pt-esc-acts',
            {},
            btn('.primary.pt-esc-send', 'Send answer', () => void send(answerFor(m, pick, note.hidden ? '' : note.value))),
            m.options.length
              ? btn('.pt-esc-own', 'Reply in my words', () => {
                  note.hidden = !note.hidden;
                  buttons.find((b) => b.classList.contains('pt-esc-own'))?.setAttribute('aria-expanded', String(!note.hidden));
                  if (!note.hidden) note.focus();
                }, { 'aria-expanded': 'false', 'aria-controls': noteId })
              : btn('', 'Approve', () => void send({ verdict: 'approve', text: note.value.trim() })),
            m.options.length ? null : btn('', 'Reject', () => (note.value.trim() ? void send({ verdict: 'reject', text: note.value.trim() }) : (note.focus(), toast('Say why it is rejected', 'warn')))),
            h('span.pt-grow'),
            leadName ? h('button.pt-link.pt-esc-ask', { type: 'button', onclick: () => ask(`About "${e.title.split(':')[0]}": `) }, `Ask ${leadName}`) : null,
          );
    return h(
      'article.pt-nitem.pt-esc',
      { 'data-id': e.id, 'aria-label': `${m.tag}: ${e.title}` },
      h('div.pt-esc-h', {}, tagEl(m.tone, m.tag), h('b.pt-esc-t', {}, m.title)),
      h('p.pt-esc-meta.pt-esc-by', {}, m.meta),
      m.question ? h('p.pt-esc-q', {}, m.question) : null,
      verify ? null : opts,
      m.why ? h('p.pt-esc-why', {}, h('b', {}, `${m.why.label} `), m.why.text) : null,
      ...(card && x ? cardExtras(card, x) : []),
      note,
      acts,
    );
  }

  /** The dismissed stuck items: hidden, still open ("hidden (N)"), with a way to see each. */
  function drawHidden(go: NeedsSnapshot['go']) {
    const v = stuckView();
    const ds = v && v.floor === floor ? (v.dismissed ?? []) : [];
    if (!ds.length) return void hidden.replaceChildren();
    const toggle = h('button.pt-link', { type: 'button', 'aria-expanded': String(showHidden), onclick: () => ((showHidden = !showHidden), drawHidden(go)) }, `Hidden (${ds.length}) ${showHidden ? '▴' : '▾'}`);
    hidden.replaceChildren(
      toggle,
      h('small.pt-dc-small', {}, ' Dismissed: hidden, not resolved.'),
      ...(showHidden ? [h('ul', {}, ...ds.map((d) => h('li', {}, d.id, ' ', h('button.pt-link', { type: 'button', onclick: () => go({ to: 'stuck', id: d.id }) }, 'Open'))))] : []),
    );
  }

  function row(n: NeedItem, go: NeedsSnapshot['go']): HTMLElement {
    const m = rowModel(n);
    return h(
      'div.pt-nitem.pt-nrow',
      { 'data-key': n.key },
      tagEl(m.tone, m.tag),
      h('div.pt-grow', {}, h('span.pt-nrow-t', {}, m.text), n.since ? h('small', {}, ` · ${timeAgo(n.since)}`) : null),
      h('div.pt-nrow-b', {}, h('button.btn.small', { type: 'button', onclick: () => go(n.target), 'aria-label': `${n.action}: ${n.text}` }, n.action), n.alt ? h('button.btn.small', { type: 'button', onclick: () => go(n.alt!.target), 'aria-label': `${n.alt.action}: ${n.text}` }, n.alt.action) : null),
    );
  }

  function draw(s: NeedsSnapshot) {
    snap = s;
    if (s.floor !== floor) {
      floor = s.floor;
      answered.clear();
      drawn = new Map();
      list.replaceChildren();
    }
    const r = s.roster?.floor === s.floor ? s.roster : undefined;
    notices.update(s.floor, !!r?.admin, s.go);
    follow.update(s.floor, !!r?.admin, s.go);
    const lead = leadOf(r);
    const leadName = lead && lead.kind === 'lead' ? lead.name : undefined;
    const items = s.items.filter((n) => !(n.target.to === 'escalation' && answered.has(n.target.id)));
    const n = waitingCount(items);
    const cardOf = new Map((s.cards ?? []).map((c) => [c.need.key, c]));
    const shownCards = items.map((it) => cardOf.get(it.key)).filter((c): c is DecisionCard => !!c);
    counts.textContent = s.cards ? countsWords(cardCounts(shownCards)) : '';
    counts.hidden = !s.cards || !items.length;
    drawHidden(s.go);
    count.textContent = n ? `${n} now` : 'All clear';
    count.className = `pt-badge ${n ? 'pt-warn' : 'pt-ok'}`;
    const keep = new Map<string, { sig: string; el: HTMLElement }>();
    const nodes: HTMLElement[] = [];
    for (const [id, a] of answered) {
      const sig = `done|${a.text}`;
      const had = drawn.get(`done-${id}`);
      const d = had?.sig === sig ? had : { sig, el: h('div.pt-nitem.pt-done', {}, tagEl('done', 'Answered'), h('div.pt-grow', {}, h('b', {}, a.title), h('small', {}, a.text))) };
      keep.set(`done-${id}`, d);
      nodes.push(d.el);
    }
    // A long list folds after the first few, so the Overview isn't one long card (and isn't all built at once).
    const shown = all || items.length <= FOLD_AFTER + 1 ? items : items.slice(0, FOLD_AFTER);
    more.hidden = shown.length === items.length && !(all && items.length > FOLD_AFTER + 1);
    more.textContent = shown.length < items.length ? `Show ${items.length - shown.length} more ▾` : 'Show fewer ▴';
    more.setAttribute('aria-expanded', String(all));
    const ctx = (r?: RosterView): CardCtx => ({ floor: floor ?? '', admin: !!r?.admin || !!s.roster?.admin, leadName, go: s.go, ask, done: (c, what) => {
      answered.set(c.escalation ?? c.id, { title: c.question, text: what });
      if (snap) draw(snap);
      heading.focus({ preventScroll: true });
    } });
    for (const it of shown) {
      const card = cardOf.get(it.key);
      const cardSig = card ? JSON.stringify([card.kind, card.sources.map((x) => x.id + (x.note ?? '')), card.notes, card.gone ?? null, card.related.length, card.escalation ? (decisionCheck(card.escalation)?.at ?? 0) : 0, card.answered ?? null]) : '';
      if (card && answered.has(card.id)) continue;
      const e = it.target.to === 'escalation' ? r?.escalations.find((x) => x.id === (it.target as { id: string }).id) : undefined;
      if (e && r && card && (card.gone || card.kind === 'hands-on' || card.kind === 'fyi')) {
        const sig = JSON.stringify([e.status, r.admin, leadName, e.title, e.details, cardSig]);
        const had = drawn.get(it.key);
        const make = card.gone ? goneCard : card.kind === 'hands-on' ? handsOnCard : fyiCard;
        const d = had?.sig === sig ? had : { sig, el: make(card, ctx(r)) };
        keep.set(it.key, d);
        nodes.push(d.el);
        continue;
      }
      if (e && r) {
        const m = escalationModel(e, { leadName, ago: (at) => timeAgo(at) });
        // "18m ago" moves on by itself: the line is brought up to date in place, so the card (your pick, what you typed) stays.
        const sig = JSON.stringify([e.status, r.admin, leadName, e.title, e.options, e.recommendation, e.details, e.urgency, e.trigger, cardSig]);
        const had = drawn.get(it.key);
        const d = had?.sig === sig ? had : { sig, el: escCard(e, r, m, card, card ? ctx(r) : undefined) };
        const meta = d.el.querySelector<HTMLElement>('.pt-esc-by');
        if (meta && meta.textContent !== m.meta) meta.textContent = m.meta;
        keep.set(it.key, d);
        nodes.push(d.el);
        continue;
      }
      // A decision, or a card that folds sources or has evidence: a full card; the rest stay rows.
      const full = !!card && it.kind !== 'asking' && it.kind !== 'floor' && it.level !== 'info' && (card.kind === 'decision' || card.sources.length > 1 || card.evidence.length > 0);
      const sig = JSON.stringify([it.text, it.action, it.alt?.action ?? '', it.level, it.since ? timeAgo(it.since) : '', full, cardSig]);
      const had = drawn.get(it.key);
      const d = had?.sig === sig ? had : { sig, el: full ? genericCard(card!, ctx(r)) : row(it, s.go) };
      keep.set(it.key, d);
      nodes.push(d.el);
    }
    if (!nodes.length) nodes.push((drawn.get('calm') ?? { sig: '', el: h('p.pt-card-none.pt-calm', { role: 'status' }, 'Nothing needs you right now.') }).el);
    if (!nodes.length || (nodes.length === 1 && nodes[0].classList.contains('pt-calm'))) keep.set('calm', { sig: '', el: nodes[0] });
    // Only what changed moves: a card kept keeps its focus, its choice and what you typed.
    let at: ChildNode | null = list.firstChild;
    for (const node of nodes) {
      if (node !== at) list.insertBefore(node, at);
      at = node.nextSibling;
    }
    while (at) {
      const next: ChildNode | null = at.nextSibling;
      at.remove();
      at = next;
    }
    drawn = keep;
  }

  onNeeds(draw);

  return {
    el,
    focusEscalation(id) {
      // One folded away under Show N more: unfold first.
      if (!all && snap && !list.querySelector(`.pt-esc[data-id="${CSS.escape(id)}"]`) && snap.items.some((n) => n.target.to === 'escalation' && n.target.id === id)) ((all = true), draw(snap));
      const card = list.querySelector<HTMLElement>(`.pt-esc[data-id="${CSS.escape(id)}"]`);
      if (!card || el.offsetParent === null) return false;
      card.scrollIntoView({ block: 'center' });
      (card.querySelector<HTMLElement>('.pt-esc-send, .pt-esc-acts .btn, textarea') ?? card).focus({ preventScroll: true });
      card.classList.add('pt-flash');
      setTimeout(() => card.classList.remove('pt-flash'), 1400);
      return true;
    },
  };
}
