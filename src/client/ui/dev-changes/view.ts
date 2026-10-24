// What the Developer view and Project Management draw of the Developer changes (shared/dev-changes.ts): a
// change's execution pill (DC-n, the state, the revision it names), its four facts apart (work, checks, preview,
// your review), the revision strip (main @M, the live preview @S and how far behind, the active change's
// candidate @C), the current change with its detail, and the list. The person's actions sit with the change they
// act on: Cancel (before it starts, or while the team has it: the worker is stopped first), Retry when it needs
// attention, Mark superseded on a correction, Confirm / Dismiss a possibly related commit, and the findings of a
// data-impact hold. Everything shown comes from GET /api/dev-changes (./feed.ts); what the person wrote is shown
// as written.

import { h, timeAgo, toast } from '../dom';
import { CHANGE_TONE, FACT_LABEL, NAMES_REVISION, refWords, stripChips, type ChangeFour, type DevChangesView, type DevChangeView } from '../../../shared/dev-changes';
import { changeAct, cancelChange } from './feed';
import { openFindings } from '../data-impact/open';
import './dev-changes.css';

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A change's execution pill: the state's words, with @revision for the states that name one. */
export function changePill(c: DevChangeView): HTMLElement {
  const rev = NAMES_REVISION.has(c.state) && c.revision ? ` @${short(c.revision)}` : '';
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

/** A button that asks for a second click within a few seconds before it acts (no modal). */
function armed(label: string, confirm: string, attrs: Record<string, string>, act: () => Promise<{ ok: boolean; error?: string }>, ok: string): HTMLElement {
  const b = h('button.dc-cancel', { type: 'button', ...attrs }, label) as HTMLButtonElement;
  let t: ReturnType<typeof setTimeout> | undefined;
  b.addEventListener('click', () => {
    if (!t) {
      b.textContent = confirm;
      b.classList.add('armed');
      t = setTimeout(() => ((t = undefined), (b.textContent = label), b.classList.remove('armed')), 4000);
      return;
    }
    clearTimeout(t);
    t = undefined;
    b.disabled = true;
    void act().then((r) => {
      b.disabled = false;
      toast(r.ok ? ok : (r.error ?? 'Not done'), r.ok ? 'info' : 'warn');
    });
  });
  return b;
}

/** Cancel: before it starts; while the team has it, the office stops or isolates the worker first. */
export function cancelButton(floor: string, c: DevChangeView): HTMLElement {
  const active = c.queue === 'active';
  return armed(active ? 'Cancel (stops the work)' : 'Cancel request', `Cancel ${c.id}? Click again`, { 'data-cancel': c.id }, () => cancelChange(floor, c.id), active ? `${c.id} cancelled: the worker was stopped before the next change starts` : `${c.id} cancelled: nothing was handed to the team`);
}

/** The person's actions on a change, as the record allows them for this viewer. */
function actions(floor: string, c: DevChangeView): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (c.mayRetry) out.push(armed('Retry', `Hand ${c.id} over again? Click again`, { 'data-retry': c.id }, () => changeAct('retry', { floor, id: c.id }), `${c.id} goes to the team lead again`));
  if (c.maySupersede) out.push(armed(`Mark ${c.maySupersede} superseded`, `${c.maySupersede} replaced by ${c.id}? Click again`, { 'data-supersede': c.id }, () => changeAct('supersede', { floor, id: c.id }), `${c.maySupersede} is marked superseded by ${c.id}`));
  if (c.mayCancel) out.push(cancelButton(floor, c));
  return out;
}

const FACTS: readonly (keyof ChangeFour)[] = ['execution', 'verification', 'preview', 'review'];

/** The four facts, apart: a small definition list, each with its source's words; a hold has its findings. */
export function factList(floor: string, c: DevChangeView): HTMLElement {
  return h(
    'dl.dk-facts.dc-facts',
    { 'data-facts': c.id },
    ...FACTS.flatMap((k) => {
      const f = c.facts[k];
      const held = k === 'preview' && c.facts.preview.held;
      const link = held ? h('button.aw-link.dc-findings', { type: 'button', onclick: (e: Event) => openFindings(floor, c.facts.preview.held!.env, e.currentTarget as HTMLElement) }, `Findings (${c.facts.preview.held!.findings})`) : '';
      return [h('dt', {}, FACT_LABEL[k]), h('dd', { 'data-fact': k, 'data-status': f.status, class: f.tone }, f.words, link ? ' · ' : '', link)];
    }),
  );
}

/** Commits on main linked or possibly related to it, with Confirm / Dismiss for a possible one. */
function relatedList(floor: string, c: DevChangeView): HTMLElement | '' {
  const list = c.relatedView ?? [];
  if (!list.length) return '';
  return h(
    'ul.dc-related',
    { 'aria-label': `Commits on main related to ${c.id}` },
    ...list.map((r) => {
      const kind = r.explicit ? 'Linked' : r.verdict === 'confirmed' ? 'Confirmed related' : r.verdict === 'dismissed' ? 'Dismissed' : 'Possibly related';
      const decide = !r.explicit && !r.verdict && r.mayDecide;
      const btn = (verdict: 'confirmed' | 'dismissed', label: string) =>
        h('button.aw-link', { type: 'button', 'data-link': verdict, onclick: () => void changeAct('link', { floor, id: c.id, sha: r.sha, verdict }).then((x) => toast(x.ok ? `${label}: ${short(r.sha)}` : x.error, x.ok ? 'info' : 'warn')) }, label);
      return h('li', { 'data-related': r.sha, 'data-kind': r.explicit ? 'linked' : (r.verdict ?? 'possible') }, `${kind}: @${short(r.sha)} “${clip(r.subject, 80)}”${r.docs.length ? ` (touches ${r.docs.slice(0, 2).map((d) => d.split(':')[1]).join(', ')})` : ''}${r.by ? ` · ${r.by}` : ''}. Never counts as implemented. `, decide ? btn('confirmed', 'Confirm') : '', decide ? ' ' : '', decide ? btn('dismissed', 'Dismiss') : '');
    }),
  );
}

/** The lines every view of a change carries besides its facts: late results, the dependency note, aliases, related commits. */
export function lifecycleLines(floor: string, c: DevChangeView): (HTMLElement | '')[] {
  return [
    c.late ? h('p.dc-small.dc-late', { 'data-late': c.id }, c.late) : '',
    c.depends?.length ? h('p.dc-small.dc-depends', { 'data-depends': c.depends.map((d) => d.id).join(',') }, `Depends on ${c.depends.map((d) => d.id).join(', ')} (not yet tried). It ${c.queue === 'queued' ? 'goes ahead anyway unless the project’s policy says wait' : 'went ahead anyway'}.`) : '',
    c.aliases?.length ? h('p.dc-small', { 'data-aliases': c.aliases.join(',') }, `Also known as ${c.aliases.join(', ')} (${c.via === 'model' ? 'the Model tab’s Change this' : 'asked before Developer changes'}).`) : '',
    relatedList(floor, c),
  ];
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
  if (c.queue === 'linked') return `Followed from ${c.linked?.id}${c.member ? ` (${c.member})` : ''}`;
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
    h('div.dc-head', {}, h('b.dc-id', {}, c.id), changePill(c), h('span.dc-grow'), ...actions(floor, c)),
    h('p.dc-text', {}, clip(full ? c.text : c.text.split('\n')[0], full ? 400 : 140)),
    h('p.dc-small', {}, c.detail),
    factList(floor, c),
    ...lifecycleLines(floor, c),
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

export { actions as changeActions };
