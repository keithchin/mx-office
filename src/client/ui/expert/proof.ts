// The session screen's bottom strip: the background proof (GET /api/expert/proof, server/expert/index.ts): the
// last commit on the session branch and its push, the budget meter, stuck status and the decision count, as the
// mockup's strip has them ("COMMIT a3f91c2 12 s ago pushed · BUDGET ▬▬ $554 / $800 · STUCK No · DECISIONS 23").
// A push failure shows here, never as a dialog. Asked again when the session's state changes and on the
// project's roster.changed message (the proof says it moved), never on a timer of its own.

import { h, timeAgo } from '../dom';
import { pushWords, type ExpertProof } from '../../../shared/expert-proof';
import { getProof } from './api';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const PUSH_SHORT = { ok: 'pushed', pending: 'push pending', failed: 'push failed', off: 'not pushed' } as const;

export interface ProofStrip {
  el: HTMLElement;
  refresh(floor: string | null): void;
}

export function proofStrip(): ProofStrip {
  const el = h('footer.xs-proof', { 'aria-label': 'Background proof', role: 'status' });
  let asked = 0;
  const cell = (k: string, cls: string, ...v: (Node | string | null)[]) => h('div.xs-pc', { class: cls }, h('span.xs-pd', { 'aria-hidden': 'true' }), h('span.xs-pk', {}, k), ...v);
  function draw(p: ExpertProof | 'missing' | undefined) {
    if (p === 'missing' || !p) {
      el.replaceChildren(h('div.xs-pc.xs-soon', {}, h('span.xs-pk', {}, 'Background proof'), p === 'missing' ? 'coming soon: commits, budget and stuck checks show here' : 'couldn’t be read just now'));
      return;
    }
    const c = p.commit;
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
  }
  draw('missing');
  return {
    el,
    refresh(floor) {
      if (!floor) return;
      const n = ++asked;
      void getProof(floor).then((p) => n === asked && draw(p));
    },
  };
}
