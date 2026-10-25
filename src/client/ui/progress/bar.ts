// Drawing the progress bar (ui/progress/index.ts mounts it): a segment per phase, coloured by what was
// measured, the ✋ gates and decisions as small marks on it, and one line saying where the project is
// (or "v1 accepted · date"). The tooltip is built only when a segment is hovered or focused, into one
// element the bar keeps. The mini version on Home's cards is the same segments without words.

import { progressLabel, spendText, type Milestone, type Phase, type ProjectProgress } from '../../../shared/progress';
import { freshnessText } from '../../../shared/stage-derive';
import { buildSummary, buildUnderWay } from '../../../shared/build-progress';
import { h } from '../dom';

/** At most this many marks drawn on one segment (the tooltip lists them all, up to its own cap). */
const MARKS_MAX = 4;
const TIP_LIST_MAX = 8;

const STATUS_WORD: Record<Phase['status'], string> = { done: 'passed', waived: 'waived', failed: 'failing', waiting: 'waiting on someone', active: 'in progress', pending: 'not started', unknown: 'unknown' };
const MARK_ICON: Record<Milestone['status'], string> = { passed: '✓', waived: '↷', failed: '!', waiting: '…', assumed: '~', pending: '·', unknown: '?' };
const OPEN_WORD: Record<Phase['open'], string> = { setup: 'the setup panel', deliverables: 'the Documents page', acceptance: 'the acceptance record' };

const short = (p: Phase) => (p.kind === 'stage' ? p.id : p.title);
/** A phase's status in words: "signed off" for one the register settled while gate-check still says PENDING. */
const statusWord = (p: Phase) => (p.signedOff ? 'signed off' : STATUS_WORD[p.status]);

/** A segment's accessible name: what it is and what was measured, in a sentence. */
export function segmentLabel(p: Phase): string {
  return `${p.kind === 'stage' ? `Stage ${p.id}, ${p.title}` : p.title}: ${statusWord(p)}${p.current ? ' (current)' : ''}. ${p.measures[0] ?? ''}`;
}

function marks(p: Phase): HTMLElement | null {
  if (!p.milestones.length) return null;
  const shown = p.milestones.slice(0, MARKS_MAX);
  return h('span.pg-marks', { 'aria-hidden': 'true' }, ...shown.map((m) => h('i.pg-mark', { class: `${m.kind} ${m.status}` }, m.kind === 'gate' ? '✋' : MARK_ICON[m.status])), p.milestones.length > MARKS_MAX ? h('i.pg-mark.more', {}, `+${p.milestones.length - MARKS_MAX}`) : null);
}

const DAY = /^(d{4})-(d{2})-(d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2 Oct" for 2026-10-02. */
const shortDay = (d: string) => ((m) => (m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : d))(d.match(DAY));

/**
 * The line under a stage's name on the Overview's Progress card (ui/portal/overview.css shows it): its ✋
 * gate when it has one ("✋ confirmed 2 Oct", "✋ needs your sign-off"), else where it stands ("done",
 * what was measured while it's the one in progress, "next" for the one after it).
 */
export function segmentDetail(ph: Phase, next = false): string {
  const gate = ph.milestones.find((m) => m.kind === 'gate');
  if (gate?.status === 'passed') return `✋ confirmed${gate.at ? ` ${shortDay(gate.at)}` : ''}`;
  // Main still says otherwise, but the team's working branch has it: said as such, next to main's state.
  if (ph.onBranch && ph.status !== 'done' && ph.status !== 'waived') return `on the team's branch (not merged) · main: ${STATUS_WORD[ph.status]}`;
  if (gate?.status === 'waiting') return '✋ needs your sign-off';
  if (gate?.status === 'failed') return '✋ failing';
  if (ph.signedOff) return 'signed off';
  if (ph.status === 'done') return 'done';
  if (ph.status === 'waived') return 'waived';
  if (ph.status === 'failed') return 'failing';
  if (ph.status === 'waiting') return 'waiting on someone';
  if (ph.status === 'active') return ph.measures[0] ?? 'in progress';
  if (gate && ph.status === 'pending') return next ? 'next · ✋ ahead' : '✋ needs a decision';
  return next ? 'next' : '';
}

/** The bar's segments; `words` puts each phase's id or name in it (the full bar), without them for the mini one. */
export function segments(p: ProjectProgress, words: boolean, onOpen?: (phase: Phase) => void): HTMLElement[] {
  const cur = p.phases.findIndex((x) => x.current);
  return p.phases.slice(0, 12).map((ph, i) => {
    const attrs = { class: `${ph.status}${ph.current ? ' current' : ''} k-${ph.kind}`, 'data-phase': ph.id, 'aria-label': segmentLabel(ph) };
    if (!words || !onOpen) return h('span.pg-seg', attrs);
    const tiny = ph.kind === 'handover' ? '🤝' : ph.kind === 'accepted' ? '✅' : ph.kind === 'delivery' ? '…' : undefined;
    // The name and the line under it are the Overview's Progress card's (hidden in the bar); its tooltip has the whole of both.
    const name = ph.kind === 'stage' ? `${ph.id} · ${ph.title}` : ph.title;
    return h(
      'button.pg-seg',
      { ...attrs, type: 'button', onclick: () => onOpen(ph) },
      h('span.pg-seg-id', {}, short(ph)),
      tiny ? h('span.pg-seg-tiny', { 'aria-hidden': 'true' }, tiny) : null,
      ph.kind === 'stage' ? h('span.pg-seg-t', {}, ph.title) : null,
      marks(ph),
      h('span.pg-seg-n', { 'aria-hidden': 'true' }, name),
      h('span.pg-seg-d', { 'aria-hidden': 'true' }, segmentDetail(ph, cur >= 0 && i === cur + 1)),
    );
  });
}

const fmtDay = (d?: string) => d ?? '?';

/** The tooltip's content for one phase. */
export function tipContent(ph: Phase): HTMLElement {
  const dates = ph.dates ? `Spend booked ${fmtDay(ph.dates.first)}${ph.dates.last && ph.dates.last !== ph.dates.first ? ` to ${ph.dates.last}` : ''}` : undefined;
  const spend = spendText(ph.spend);
  return h(
    'div.pg-tip-body',
    {},
    h('strong.pg-tip-h', {}, `${ph.kind === 'stage' ? `Stage ${ph.id} · ${ph.title}` : ph.title} — ${statusWord(ph)}${ph.current ? ' (now)' : ''}`),
    h('ul.pg-tip-list', {}, ...ph.measures.slice(0, TIP_LIST_MAX).map((m) => h('li', {}, m))),
    ph.deliverables?.items.length
      ? h('div.pg-tip-sec', {}, h('b', {}, 'Documents'), h('ul.pg-tip-list', {}, ...ph.deliverables.items.slice(0, TIP_LIST_MAX).map((i) => h('li', { class: `dv-${i.status}` }, `${i.title}: ${i.status === 'present' ? 'on main' : i.status}`))))
      : null,
    ph.milestones.length
      ? h('div.pg-tip-sec', {}, h('b', {}, 'Gates and decisions'), h('ul.pg-tip-list', {}, ...ph.milestones.slice(0, TIP_LIST_MAX).map((m) => h('li', {}, `${m.kind === 'gate' ? '' : `${MARK_ICON[m.status]} `}${m.label}: ${m.status}${m.at ? ` · ${m.at}` : ''}`))))
      : null,
    dates ? h('p.pg-tip-p', {}, dates) : null,
    spend ? h('p.pg-tip-p', {}, `💰 ${spend}`) : ph.kind === 'stage' ? h('p.pg-tip-p', {}, '💰 no spend booked to this stage') : null,
    h('p.pg-tip-foot', {}, `Click: opens ${OPEN_WORD[ph.open]}`),
  );
}

/**
 * Under the bar: how fresh the office's stage is ("checked on main @abc1234, 3 min ago", "checking…",
 * "couldn't check: …") and what doesn't add up (shared/stage-derive.ts). Null for a project without stages.
 */
export function stageNotes(p: ProjectProgress, now = Date.now()): HTMLElement | null {
  const e = p.stage;
  if (!e) return null;
  const fresh = freshnessText(e.check, now);
  const bad = !!e.check.error || !!e.check.stale || e.check.source !== 'office';
  // Build (MANUAL) with work the office can see: what it sees, and the toolkit's verdict kept beside it.
  const build = p.phases.find((x) => x.kind === 'stage' && x.id === '5' && x.status === 'active' && x.verdict === 'MANUAL');
  const where = e.build?.sha ? ` · checked on ${e.build.branch ?? 'main'} @${e.build.sha.slice(0, 7)}` : '';
  return h(
    'div.pg-notes',
    {},
    build && e.build && buildUnderWay(e.build) ? h('p.pg-build', { title: build.measures.join(' · ') }, `🔨 Build · in progress · ${buildSummary(e.build)} · gate-check: MANUAL${where}`) : null,
    fresh ? h('p.pg-fresh', { class: bad ? 'stale' : '', title: 'Where the stage comes from: the toolkit’s gate-check, run by the office on a temporary checkout of the default branch' }, `🧭 ${fresh}`) : null,
    ...e.flags.map((f) => h('p.pg-flag', { role: 'note' }, `ℹ️ ${f.text}`)),
  );
}

/** The whole bar's row: the fold button, the segments, and the line on the right. */
export function barRow(p: ProjectProgress, collapsed: boolean, on: { toggle(): void; open(ph: Phase): void; label(): void }): HTMLElement {
  const fold = h('button.pg-fold', { type: 'button', title: collapsed ? 'Show the project progress bar' : 'Fold the project progress bar to a thin line', 'aria-expanded': String(!collapsed), 'aria-label': 'Project progress', onclick: on.toggle }, collapsed ? '▸' : '▾');
  const track = h('div.pg-track', { role: 'group', 'aria-label': 'Project phases' }, ...segments(p, !collapsed, on.open));
  const label = progressLabel(p);
  return h(
    'div.pg-bar',
    { class: `${collapsed ? 'collapsed' : ''}${p.acceptance.accepted ? ' accepted' : ''}${p.acceptance.changed?.length ? ' changed' : ''}` },
    fold,
    track,
    collapsed ? null : h('button.pg-label', { type: 'button', title: `${label}${p.note ? ` — ${p.note}` : ''}: open the acceptance record`, onclick: on.label }, p.acceptance.accepted ? `✅ ${label}` : label),
  );
}
