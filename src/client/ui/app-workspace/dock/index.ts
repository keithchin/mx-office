// The Developer view's docked coordinator chat: the team-lead panel (ui/lead-panel/), the same component,
// conversation and lead as on Project Management's pages, docked on the right of explorer | canvas while the
// Developer view shows. This module lends it what the Developer view knows (ui/lead-panel/dock.ts):
//
//   header    the business status chip, the revision strip (main @M, the preview @S, the active change's
//             candidate @C), "N changes this session" with each one's state, and the project's pause (who, when)
//   chips     what's selected in the explorer (a page open in the Model preview, the widget picked on it with
//             Select element, or another item) as the composer's chip; "Request a change to this" anywhere in the
//             view focuses the composer with it (./index.ts focus), the old dialog only where there's no chat
//   request   Request a change sends through the one intake (POST /api/change-requests: DC-n, with the element
//             reference, the revision being viewed as its source and an idempotency key per message), so the
//             chat, the fallback dialog, a guided check's Something's wrong and a try card all make one record.
//             When the change waits in the queue the lead gets a note after its turn, so it knows
//   cards     each change of the session as the person's message with its receipt, "Please try this" once it's
//             in the live preview, and the project's business decisions (./cards.ts)
//
// It reads only what the workspace already has (the dev-changes feed, Needs you, the live app's message): no
// fetches or timers of its own. Views add no permission: cancelling, answering and marking keep their checks.

import { h } from '../../dom';
import { dockChanged, dockSelection, focusDock, setPanelDock, type ChatExtra, type ContextChip, type DockSent, type PanelDock } from '../../lead-panel/dock';
import { revisionStrip } from '../../dev-changes/view';
import { CHANGE_TONE } from '../../../../shared/dev-changes';
import { draftKey } from '../../dev-changes/feed';
import type { WorkspaceData, WorkspaceDecision, WorkspaceSource } from '../data';
import type { RequestAsk } from '../requests';
import { decisionCard, leftNotes, type CardsCtx } from '../decision-cards';
import { askedCard, tryCard } from './cards';
import { aboutLine, chipFor, executionWords, pauseWords, queuedNote, sessionChanges, sessionSummary, tryAt, wantsTry, type DevContext } from './logic';
import { previewOff } from '../../../../shared/liveapp/not-running';
import './dock.css';

export interface DockDeps {
  source: WorkspaceSource;
  open(tab: string): void;
  /** Shows the canvas's Live preview. */
  live(): void;
  /** Your name as the office records it (your own requests say "You"). */
  me(): string | undefined;
  now?(): number;
}

export interface Dock {
  /** The Developer view shows (true) or steps aside: the panel docks or goes back to how it was. */
  attach(on: boolean): void;
  /** What's selected changed (undefined: nothing now). */
  select(c: DevContext | undefined): void;
  /** "Request a change to this": the composer, with the chip, focused. False: there's no chat here (use the dialog). */
  focus(c: DevContext | undefined): boolean;
  draw(d: WorkspaceData): void;
  /** Tests: what the panel was lent. */
  readonly lent: PanelDock;
}

const deco = (x: WorkspaceDecision) => JSON.stringify({ ...x, answer: undefined });

export function createDock(deps: DockDeps): Dock {
  const now = deps.now ?? Date.now;
  const header = h('div.dk-head', { role: 'region', 'aria-label': 'This version and your changes' });
  let ctx: DevContext | undefined;
  const contexts = new Map<string, DevContext>();
  let pending: string | undefined;
  let extras: ChatExtra[] = [];
  let extrasKey = '';
  let noteGen = 0;
  let noteAt = 0;
  const firstSeen = new Map<string, number>();
  let attached = false;

  const remember = (c: DevContext) => {
    const chip = chipFor(c);
    contexts.set(chip.key, c);
    if (contexts.size > 50) contexts.delete(contexts.keys().next().value!);
    return chip;
  };

  async function request(text: string, chip: ContextChip | undefined): Promise<DockSent> {
    const d = deps.source.get();
    if (!d.floor) return { ok: false, error: 'Pick a project first' };
    const c = chip ? contexts.get(chip.key) : undefined;
    const about = c ? (c.element ? `${c.element.chip} (${c.element.where})` : c.about) : '';
    const served = d.appUrl ? d.live?.served?.sha : undefined;
    pending ??= draftKey();
    const ask: RequestAsk = {
      text: about ? `${text}\n\nAbout: ${about}` : text,
      ...(c?.page ? { page: c.page } : {}),
      ...(served ? { revision: served } : {}),
      ...(c?.element ? { ref: c.element.ref } : {}),
      ...(c?.rev ? { source: c.rev } : {}),
      key: pending,
      via: 'chat',
    };
    const r = await deps.source.request(ask);
    if (!r.ok) return { ok: false, error: r.error };
    pending = undefined;
    // Handed to the lead now, the hand-over is the lead's message; waiting in the queue, a note says so.
    return { ok: true, ...(r.change.queue !== 'active' && !r.again ? { note: queuedNote(r.change, ask.text) } : {}) };
  }

  const lent: PanelDock = {
    header,
    extras: () => extras,
    context: () => (ctx ? chipFor(ctx) : undefined),
    request,
    about: (chip) => {
      const c = contexts.get(chip.key);
      return c ? aboutLine(c) : `About: ${chip.label}`;
    },
    footer: 'Changes go to the team through the coordinator, one at a time, and work without the live app.',
  };

  /** What the header last drew from: the workspace draws on every live-app message, the header only when this moves. */
  let headKey = '';
  function drawHeader(d: WorkspaceData, session: ReturnType<typeof sessionChanges>) {
    const b = d.business;
    // Why the preview isn't showing the app, when it isn't (a failed build: its commit and reason).
    const off = d.appUrl ? undefined : previewOff(d.live);
    const offLine = off && off.kind !== 'checking' ? off : undefined;
    const key = JSON.stringify([b?.label, b?.tone, b?.line, b?.unknown, d.dev?.strip, d.dev?.pause, session.map((c) => [c.id, c.state, c.revision]), offLine?.line]);
    if (key === headKey) return;
    headKey = key;
    const s = sessionSummary(session);
    const chip = b ? h('span.aw-pill.aw-statuschip', { class: b.tone, title: `Business status: ${b.line || b.label}` }, b.label) : h('span.aw-pill.idle', {}, 'Status…');
    const pills = session.slice(-6).map((c) => h('span.dk-dc', { 'data-change': c.id }, h('b', {}, c.id), ' ', h('span.dc-pill', { class: CHANGE_TONE[c.state], 'data-state': c.state }, executionWords(c))));
    header.replaceChildren(
      h('div.dk-row', {}, chip, revisionStrip(d.dev)),
      // Status unknown: why, and the one thing that would make it known for each reason (shared/business-status.ts UNKNOWN_WHY).
      b?.state === 'unknown' && b.unknown?.length
        ? h('div.dk-unknown', { role: 'note' }, h('b', {}, 'Why the status is unknown'), h('ul', {}, ...b.unknown.map((u) => h('li', { 'data-why': u.why }, u.text, u.action ? h('span', {}, ' · ', h('button.aw-link', { type: 'button', onclick: () => deps.open(u.action!.tab) }, u.action.label)) : ''))))
        : '',
      h('div.dk-row.dk-session', {}, h('b', {}, s.head), s.parts.length ? h('span.dk-parts', {}, s.parts.join(' · ')) : ''),
      pills.length ? h('div.dk-row.dk-dcs', {}, ...pills) : '',
      d.dev?.pause ? h('p.dk-pause', { role: 'status' }, '⏸ ', pauseWords(d.dev.pause)) : '',
      offLine ? h('p.dk-preview', { class: offLine.kind === 'failed' || offLine.kind === 'crashed' || offLine.kind === 'timeout' ? 'bad' : '', 'data-off': offLine.kind }, offLine.line, ' ', h('button.aw-link', { type: 'button', onclick: () => deps.open('live') }, 'Live app page')) : '',
    );
  }

  function draw(d: WorkspaceData) {
    const t = now();
    const session = sessionChanges(d.dev?.changes ?? [], t);
    drawHeader(d, session);
    const floor = d.floor ?? '';
    const pause = d.dev?.pause;
    const me = deps.me();
    const served = d.appUrl ? d.live?.served?.sha : undefined;
    const mark = deps.source.mark ? (m: Parameters<NonNullable<WorkspaceSource['mark']>>[0]) => deps.source.mark!(m) : undefined;
    const cards: CardsCtx = { floor: d.floor, admin: d.admin, open: deps.open, answer: (x, a) => deps.source.answer(x, a), redraw: () => ((noteGen++), (noteAt = now()), draw(deps.source.get())) };
    const out: ChatExtra[] = [];
    for (const c of session) {
      out.push({ id: `dc:${c.id}`, at: c.at, sig: JSON.stringify([c.state, c.words, c.detail, c.revision, c.mayCancel, c.position, c.checks?.line, c.text, c.reviews, pause, me]), draw: () => askedCard(floor, c, pause, me) });
      if (wantsTry(c)) out.push({ id: `try:${c.id}`, at: tryAt(c), sig: JSON.stringify([c.revision, served, c.reviews, !!mark]), draw: () => tryCard(c, { ...(served ? { served } : {}), ...(mark ? { mark } : {}), live: deps.live }) });
    }
    const list = d.decisions ?? [];
    for (const x of list) {
      if (!firstSeen.has(x.id)) firstSeen.set(x.id, t);
      out.push({
        id: `dec:${x.id}`,
        at: x.since ?? firstSeen.get(x.id)!,
        sig: JSON.stringify([deco(x), d.admin, noteGen]),
        draw: () => h('div.pmc-card.dk-dec', { 'data-decision': x.id }, h('p.pmc-card-h', {}, 'Decision needed'), h('ul.aw-decisions', {}, decisionCard(x, cards)), h('p.aw-small.dk-also', {}, 'Also listed in Project Management › Approvals.')),
      });
    }
    const left = leftNotes(list, cards);
    if (left.length) out.push({ id: 'dec:answered', at: noteAt, sig: `notes|${noteGen}`, draw: () => h('div.dk-dec.dk-left', {}, ...leftNotes(deps.source.get().decisions ?? [], cards)) });
    const key = out.map((x) => `${x.id}\u0001${x.at}\u0001${x.sig}`).join('\u0002');
    if (key === extrasKey) return;
    extrasKey = key;
    extras = out;
    if (attached) dockChanged();
  }

  return {
    lent,
    attach(on) {
      if (on === attached) return;
      attached = on;
      setPanelDock(on ? lent : null);
      if (on && ctx) dockSelection(chipFor(ctx));
    },
    select(c) {
      const before = ctx ? chipFor(ctx).key : '';
      ctx = c;
      const chip = c ? remember(c) : undefined;
      if ((chip?.key ?? '') !== before) dockSelection(chip);
    },
    focus(c) {
      if (c) ((ctx = c), remember(c));
      return focusDock(c ? chipFor(c) : undefined, 'change');
    },
    draw,
  };
}
