// The session screen's bottom strip: the background proof (GET /api/expert/proof, server/expert/index.ts): the
// last commit on the session branch and its push, the budget meter, stuck status and the decision count, as the
// mockup's strip has them ("COMMIT a3f91c2 12 s ago pushed · BUDGET ▬▬ $554 / $800 · STUCK No · DECISIONS 23").
// A push failure shows here, never as a dialog. Asked again when the session's state changes and on the
// project's roster.changed message (the proof says it moved), never on a timer of its own.
// Slice 6: TESTS and LINT cells for the background checks ("33/34 journeys · J04b regressed · 0 microflow",
// "0 errors +1 warn", or running…); a click opens their popover (./checks.ts) with the detail and Send to session.

import { h, timeAgo } from '../dom';
import { pushWords, type ExpertProof } from '../../../shared/expert-proof';
import { getProof } from './api';
import { lintTone, lintWords, testsTone, testsWords } from '../../../shared/expert-checks';
import type { WorkerInfo } from '../../../shared/protocol';
import { checksPopover, type ChecksFocus, type ChecksPopover } from './checks';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const PUSH_SHORT = { ok: 'pushed', pending: 'push pending', failed: 'push failed', off: 'not pushed' } as const;

export interface ProofStrip {
  el: HTMLElement;
  refresh(floor: string | null): void;
  /** The session's state changed (Send to session follows it). */
  session(): void;
}

export function proofStrip(o: { worker: () => WorkerInfo | undefined } = { worker: () => undefined }): ProofStrip {
  const el = h('footer.xs-proof', { 'aria-label': 'Background proof', role: 'status' });
  let asked = 0;
  let floorNow: string | null = null;
  let last: ExpertProof | undefined;
  let pop: (ChecksPopover & { focus: ChecksFocus }) | undefined;
  function openPop(anchor: HTMLElement, focus: ChecksFocus) {
    const had = pop?.focus;
    pop?.close();
    if (had === focus || !last || !floorNow) return;
    const p = checksPopover({ anchor, floor: floorNow, focus, proof: last, worker: o.worker, onClose: () => (pop = undefined) });
    pop = Object.assign(p, { focus });
  }
  /** A cell that opens the checks' popover. */
  const checkCell = (k: string, tone: string, focus: ChecksFocus, words: string, title: string, running: boolean) =>
    h(
      'button.xs-pc.xs-pbtn',
      { type: 'button', class: `${tone}${running ? ' running' : ''}`, 'aria-haspopup': 'dialog', 'aria-expanded': String(pop?.focus === focus), title, onclick: (e: Event) => openPop(e.currentTarget as HTMLElement, focus) },
      h('span.xs-pd', { 'aria-hidden': 'true' }),
      h('span.xs-pk', {}, k),
      running ? h('span.xs-ck-spin', { 'aria-hidden': 'true' }) : null,
      h('b.xs-pw', {}, words),
    );
  const cell = (k: string, cls: string, ...v: (Node | string | null)[]) => h('div.xs-pc', { class: cls }, h('span.xs-pd', { 'aria-hidden': 'true' }), h('span.xs-pk', {}, k), ...v);
  function draw(p: ExpertProof | 'missing' | undefined) {
    if (p === 'missing' || !p) {
      el.replaceChildren(h('div.xs-pc.xs-soon', {}, h('span.xs-pk', {}, 'Background proof'), p === 'missing' ? 'coming soon: commits, budget and stuck checks show here' : 'couldn’t be read just now'));
      return;
    }
    last = p;
    const c = p.commit;
    const t = p.tests ?? null;
    const l = p.lint ?? null;
    const b = p.budget;
    const s = p.stuck;
    const pct = b && b.totalUsd ? Math.min(100, (100 * b.spentUsd) / b.totalUsd) : 0;
    el.replaceChildren(
      cell(
        'Commit',
        c ? (c.push === 'failed' ? 'bad' : c.push === 'ok' ? 'good' : 'warn') : 'idle',
        c ? h('code.xs-sha', { title: c.message }, c.sha.slice(0, 7)) : h('span.xs-pm', {}, 'none yet'),
        c ? h('span.xs-pm', {}, timeAgo(c.at)) : null,
        c ? h(`b.xs-push.${c.push}`, { title: pushWords(c) }, PUSH_SHORT[c.push]) : null,
        !c && p.branch ? h('span.xs-pm', {}, `on ${p.branch}`) : null,
      ),
      t ? checkCell('Tests', testsTone(t), 'tests', testsWords(t), `Background tests at ${t.commit.slice(0, 7)}: click for detail`, t.state === 'running') : cell('Tests', 'idle', h('span.xs-pm', {}, 'run when the session is idle')),
      l ? checkCell('Lint', lintTone(l), 'lint', lintWords(l), `New lint findings against the baseline at ${l.commit.slice(0, 7)}: click for detail`, l.state === 'running') : cell('Lint', 'idle', h('span.xs-pm', {}, '–')),
      cell(
        'Budget',
        b?.paused ? 'bad' : pct >= 80 ? 'warn' : 'good',
        b && b.totalUsd ? h('span.xs-meter', { title: `${Math.round(pct)} % of the budget` }, h('i', { style: `width:${pct}%` })) : null,
        b ? h('b', {}, b.totalUsd ? `${usd(b.spentUsd)} / ${usd(b.totalUsd)}` : `${usd(b.spentUsd)} spent`) : h('span.xs-pm', {}, 'not set'),
        b && b.todayUsd ? h('span.xs-pm', {}, `${usd(b.todayUsd)} today`) : null,
        b?.paused ? h('b.xs-push.failed', {}, 'paused') : null,
      ),
      cell('Stuck', s?.stuck ? 'bad' : 'good', h('b', { class: s?.stuck ? 'xs-bad' : '' }, s ? (s.stuck ? 'Yes' : 'No') : '–'), s?.stuck && s.reason ? h('span.xs-pm.xs-reason', { title: s.reason }, s.reason) : null),
      cell('Decisions', 'idle', h('b', {}, String(p.decisions))),
    );
    if (c?.push === 'failed' && c.error) el.append(h('div.xs-pc.xs-perr', { title: c.error }, c.error));
    pop?.update(p);
  }
  draw('missing');
  return {
    el,
    session() {
      pop?.session();
    },
    refresh(floor) {
      if (!floor) return;
      if (floor !== floorNow) pop?.close();
      floorNow = floor;
      const n = ++asked;
      void getProof(floor).then((p) => n === asked && draw(p));
    },
  };
}
