// The Developer view's cards in the coordinator's conversation (./index.ts merges them in by time):
//
//   asked     what the person asked for, as their message, with the context it carried (the chip) and, under it,
//             the receipt "→ DC-4 · Queued": the change's live state from the record (Queued and why, With the
//             team, On candidate @C, Merged into main @M, In preview, Preview behind, Preview not running), the
//             record's own line, a correction's link to the change it corrects, and Cancel while it hasn't started
//   try       "Please try this" once a change's merge is in the live preview: Looks right (a scoped review of the
//             version tried, kept with that version; never acceptance) or Something's wrong (what went wrong,
//             sent as a correction linked to the change: a new DC), and Open the live preview
//   decision  a business decision for this project with its options, answered through the same record and path
//             as Project Management (./decision-cards.ts: admins only, the revision it was opened at, a 409 said)
//
// Every claim is the record's: nothing is timed or guessed here.

import { h, timeAgo, toast } from '../../dom';
import { CHANGE_TONE, refWords, type DevChangesView, type DevChangeView } from '../../../../shared/dev-changes';
import { cancelButton } from '../../dev-changes/view';
import { askedWords, receiptWords, reviewAt } from './logic';
import type { MarkAsk, MarkSent } from '../validation-api';

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const when = (ms: number) => h('time.pmc-when', { datetime: new Date(ms).toISOString(), title: new Date(ms).toLocaleString() }, new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

/** The person's request as their message in the conversation, with its receipt under it. */
export function askedCard(floor: string, c: DevChangeView, pause: DevChangesView['pause'], me: string | undefined): HTMLElement {
  const r = receiptWords(c, pause);
  const who = me && c.by === me ? 'You' : c.by;
  const via = c.via === 'validation' ? ' from a guided check' : c.via === 'try' ? ' after trying it' : c.via === 'dialog' ? ' with Request a change' : '';
  return h(
    'div.pmc-msg.pmc-user.dk-asked',
    { 'data-change': c.id },
    h(
      'div.pmc-bubble',
      {},
      h('span.pmc-by', {}, `${who} asked for a change${via}`, when(c.at)),
      c.ref ? h('span.dk-chip', { title: refWords(c.ref) }, c.ref.widgetName ? '⌖ ' : '📄 ', c.ref.label ?? c.ref.widgetName ?? c.ref.docQn) : '',
      h('div.pmc-text', {}, askedWords(c.text)),
    ),
    h(
      'div.dk-receipt',
      { 'data-state': c.state, class: CHANGE_TONE[c.state], role: 'status' },
      h('div.dk-rhead', {}, h('b.dk-rid', {}, r.head), h('span.dc-grow'), c.mayCancel ? cancelButton(floor, c) : ''),
      r.line ? h('p.dk-rline', {}, r.line) : '',
      c.of ? h('p.dk-rline', {}, `A correction of ${c.of}.`) : '',
      r.facts.length ? h('dl.dk-facts', {}, ...r.facts.flatMap((f) => [h('dt', {}, f.label), h('dd', { 'data-fact': f.key }, f.text)])) : '',
    ),
  );
}

export interface TryDeps {
  /** The version the live preview serves now (the one a review is kept for). */
  served?: string;
  mark?(m: MarkAsk): Promise<MarkSent>;
  /** Opens the live preview (the canvas's Live preview tab). */
  live(): void;
}

/** "Please try this": Looks right / Something's wrong for a change that's in the live preview. */
export function tryCard(c: DevChangeView, deps: TryDeps): HTMLElement {
  const title = askedWords(c.text).split('\n')[0];
  const done = reviewAt(c, deps.served);
  const err = h('p.aw-warn.dk-err', { role: 'alert', hidden: true });
  const say = (r: MarkSent, ok: string) => {
    if (r.ok) return toast(ok);
    err.hidden = false;
    err.textContent = r.error;
  };
  const rev = deps.served;
  const looks = h('button.aw-btn.dk-looks', { type: 'button', disabled: !rev || !deps.mark }, '✓ Looks right') as HTMLButtonElement;
  looks.addEventListener('click', () => {
    if (!rev || !deps.mark) return;
    looks.disabled = true;
    void deps.mark({ revision: rev, change: c.id, verdict: 'works' }).then((r) => ((looks.disabled = false), say(r, `Kept: ${c.id} looks right on version ${short(rev)}`)));
  });
  const box = h('textarea.aw-note.dk-wrongtext', { rows: 2, placeholder: 'What went wrong, and what you expected instead', 'aria-label': `What went wrong with ${c.id}` }) as HTMLTextAreaElement;
  const send = h('button.aw-btn.aw-primary.dk-wrongsend', { type: 'button' }, 'Send as a correction') as HTMLButtonElement;
  const form = h('div.dk-wrong', { hidden: true }, box, h('div.aw-row', {}, h('span.aw-grow'), send));
  const wrong = h('button.aw-btn.dk-wrongbtn', { type: 'button', disabled: !rev || !deps.mark, onclick: () => ((form.hidden = false), box.focus()) }, 'Something’s wrong');
  send.addEventListener('click', () => {
    const note = box.value.trim();
    if (!rev || !deps.mark) return;
    if (note.length < 4) {
      err.hidden = false;
      err.textContent = 'Say what went wrong first, so the team can put it right.';
      return box.focus();
    }
    send.disabled = true;
    void deps.mark({ revision: rev, change: c.id, verdict: 'wrong', note }).then((r) => {
      send.disabled = false;
      if (r.ok) form.hidden = true;
      say(r, r.ok && r.finding.correction ? `Sent as ${r.finding.correction.id}, a correction of ${c.id}` : 'Sent');
    });
  });
  return h(
    'div.pmc-card.dk-try',
    { 'data-change': c.id, 'data-reviewed': done?.verdict ?? '' },
    h('p.pmc-card-h', {}, `Please try this · ${c.id}`),
    h('p.pmc-card-q', {}, `Try it: ${title}`),
    h('p.dk-rline', {}, rev ? `It’s in the live preview (version ${short(rev)}, which contains its merge @${short(c.revision)}).` : 'It’s in the live preview.'),
    done
      ? h('p.dk-done', { 'data-verdict': done.verdict }, done.verdict === 'works' ? `✓ Looks right · kept for version ${short(done.revision)} by ${done.by} ${timeAgo(done.at)}` : `Something’s wrong · sent as ${done.correction ?? 'a correction'} by ${done.by} ${timeAgo(done.at)}`)
      : '',
    h('div.aw-row.dk-trybtns', {}, done?.verdict === 'works' ? '' : looks, wrong, h('span.aw-grow'), h('button.aw-link', { type: 'button', onclick: () => deps.live() }, 'Open the live preview')),
    form,
    err,
    h('p.aw-small', {}, 'Looks right is kept with this version as your review of it; it doesn’t accept anything.'),
  );
}
