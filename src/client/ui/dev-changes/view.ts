// What the Developer view and Project Management draw of the Developer changes (shared/dev-changes.ts): a
// change's state pill (DC-n, the state, the revision it names), the revision strip (main @M, the live preview @S
// and how far behind, the active change's candidate @C), the current change with its detail, and the list with
// Cancel on a change that hasn't started. Everything shown comes from GET /api/dev-changes (./feed.ts); what the
// person wrote is shown as written.

import { h, timeAgo, toast } from '../dom';
import { CHANGE_TONE, refWords, stripChips, type DevChangesView, type DevChangeView } from '../../../shared/dev-changes';
import { cancelChange } from './feed';
import './dev-changes.css';

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const NAMES_REV = new Set(['candidate', 'merged', 'in-preview', 'preview-behind', 'preview-off']);

/** A change's state pill: the state's words, with @revision for the states that name one. */
export function changePill(c: DevChangeView): HTMLElement {
  const rev = NAMES_REV.has(c.state) && c.revision ? ` @${short(c.revision)}` : '';
  return h('span.dc-pill', { class: CHANGE_TONE[c.state], 'data-state': c.state }, `${c.words}${rev}`);
}

/** The revision strip: a compact line of chips; a chip that names a revision copies it on a click. */
export function revisionStrip(v: DevChangesView | undefined): HTMLElement {
  if (!v) return h('div.dc-strip', { role: 'group', 'aria-label': 'Revisions', 'data-strip': 'reading' }, h('span.dc-chip.idle', {}, 'Reading revisions…'));
  const chips = stripChips(v.strip).map((c) => {
    const b = h(c.sha ? 'button.dc-chip' : 'span.dc-chip', { class: c.tone, 'data-chip': c.key, title: c.sha ? `${c.title} (click to copy)` : c.title, ...(c.sha ? { type: 'button' } : {}) }, c.label);
    if (c.sha) b.addEventListener('click', () => void navigator.clipboard?.writeText(c.sha!).catch(() => undefined));
    return b;
  });
  return h('div.dc-strip', { role: 'group', 'aria-label': 'Revisions' }, ...chips);
}

/** Cancel on a change that hasn't started: a second click within a few seconds confirms (no modal). */
function cancelButton(floor: string, c: DevChangeView): HTMLElement {
  const b = h('button.dc-cancel', { type: 'button', 'data-cancel': c.id }, 'Cancel request') as HTMLButtonElement;
  let armed: ReturnType<typeof setTimeout> | undefined;
  b.addEventListener('click', () => {
    if (!armed) {
      b.textContent = `Cancel ${c.id}? Click again`;
      b.classList.add('armed');
      armed = setTimeout(() => ((armed = undefined), (b.textContent = 'Cancel request'), b.classList.remove('armed')), 4000);
      return;
    }
    clearTimeout(armed);
    armed = undefined;
    b.disabled = true;
    void cancelChange(floor, c.id).then((r) => {
      b.disabled = false;
      toast(r.ok ? `${c.id} cancelled: nothing was handed to the team` : r.error, r.ok ? 'info' : 'warn');
    });
  });
  return b;
}

/** What it was about, in a line: who asked when, the page, the source revision, what it points at. */
function aboutLine(c: DevChangeView): string {
  const parts = [`Asked ${timeAgo(c.at)} by ${c.by}`];
  if (c.source.sha) parts.push(`at main @${short(c.source.sha)}`);
  if (c.page) parts.push(`on ${c.page}`);
  if (c.ref) parts.push(refWords(c.ref));
  return parts.join(' · ');
}

/** The handed-over line: which request and task it became, its branch. */
function handedLine(c: DevChangeView): string {
  if (c.queue === 'cancelled' && !c.requestId) return '';
  if (c.queue === 'clarify') return `Not started: it would go on branch ${c.branch}`;
  if (!c.requestId) return `Branch ${c.branch} once it starts`;
  return `${c.requestId} for ${c.member ?? 'the team lead'} · branch ${c.branch}`;
}

/** One change, in a row of the list or as the current one. */
export function changeRow(floor: string, c: DevChangeView, full = true): HTMLElement {
  return h(
    'div.dc-row',
    { 'data-change': c.id, 'data-state': c.state },
    h('div.dc-head', {}, h('b.dc-id', {}, c.id), changePill(c), h('span.dc-grow'), c.mayCancel ? cancelButton(floor, c) : ''),
    h('p.dc-text', {}, clip(full ? c.text : c.text.split('\n')[0], full ? 400 : 140)),
    h('p.dc-small', {}, c.detail),
    c.checks ? h('p.dc-small', { 'data-checks': c.checks.candidate }, `Checks: ${c.checks.line}`) : '',
    handedLine(c) ? h('p.dc-small', {}, handedLine(c)) : '',
    full ? h('p.dc-small', {}, aboutLine(c)) : '',
  );
}

/** The panel's current change (undefined: not read yet). */
export function currentChangePart(floor: string, v: DevChangesView | undefined, ask: (() => void) | undefined): HTMLElement {
  const btn = ask ? h('button.aw-btn.aw-ask', { type: 'button', onclick: ask }, 'Request a change') : '';
  if (!v) return h('div', {}, h('p.aw-none', {}, 'Reading your requests…'), btn);
  const cur = v.changes.find((c) => c.id === v.current);
  if (!cur) return h('div', {}, h('p.aw-none', {}, 'Describe what should behave differently. It becomes a change the team works on, one at a time, and its state shows here.'), btn);
  const queued = v.changes.filter((c) => c.state === 'queued').length;
  return h('div.dc-current', {}, changeRow(floor, cur, false), queued && cur.state !== 'queued' ? h('p.dc-small', {}, `${queued} more queued, under Decisions › Requests`) : '', btn);
}

/** Decisions' Requests: every change, newest first. */
export function changeList(floor: string, v: DevChangesView | undefined): HTMLElement {
  if (!v) return h('p.aw-none', {}, 'Reading your requests…');
  if (!v.changes.length) return h('p.aw-none', {}, 'No requests yet. Use Request a change: each one shows here as DC-n with where it is.');
  return h('ul.dc-list', {}, ...v.changes.map((c) => h('li', {}, changeRow(floor, c))));
}
