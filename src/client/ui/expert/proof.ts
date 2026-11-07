// The session screen's bottom strip: the background proof (slice 2's GET /api/expert/proof: the last commit
// and its push, the budget meter, stuck status, open decisions). Until that route is there (a 404) it says
// "Background proof: coming soon". Asked again when the session's state changes, never on a timer of its own.

import { h, timeAgo } from '../dom';
import type { ExpertProof } from '../../../shared/expert';
import { getProof } from './api';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const PUSH: Record<NonNullable<ExpertProof['commit']>['push'], string> = { ok: 'pushed', pending: 'pushing…', failed: 'push failed', off: 'not pushed' };

export interface ProofStrip {
  el: HTMLElement;
  refresh(floor: string | null): void;
}

export function proofStrip(): ProofStrip {
  const el = h('footer.xs-proof', { 'aria-label': 'Background proof', role: 'status' });
  let asked = 0;
  const cell = (k: string, ...v: (Node | string | null)[]) => h('div.xs-pc', {}, h('span.xs-pk', {}, k), ...v);
  function draw(p: ExpertProof | 'missing' | undefined) {
    if (p === 'missing' || !p) {
      el.replaceChildren(h('div.xs-pc.xs-soon', {}, h('span.xs-pk', {}, 'Background proof'), p === 'missing' ? 'coming soon: commits, budget and stuck checks show here' : 'couldn’t be read just now'));
      return;
    }
    const c = p.commit;
    const b = p.budget;
    const s = p.stuck;
    el.replaceChildren(
      cell('Commit', c ? h('code', {}, c.sha.slice(0, 7)) : 'none yet', c ? h('span.xs-pm', {}, timeAgo(c.at)) : null, c ? h(`span.xs-push.${c.push}`, { title: c.error ?? '' }, PUSH[c.push]) : null),
      cell('Budget', b ? h('span.xs-meter', {}, h('i', { style: `width:${Math.min(100, b.totalUsd ? (100 * b.spentUsd) / b.totalUsd : 0)}%` })) : null, b ? `${usd(b.spentUsd)} / ${usd(b.totalUsd)}` : 'not set', b?.paused ? h('span.xs-push.failed', {}, 'paused') : null),
      cell('Stuck', s ? h('b', { class: s.stuck ? 'xs-bad' : '' }, s.stuck ? 'Yes' : 'No') : '–', s?.stuck && s.reason ? h('span.xs-pm', {}, s.reason) : null),
      cell('Decisions', h('b', {}, String(p.decisions))),
      h('div.xs-pc.xs-pbranch', {}, h('span.xs-pk', {}, 'Branch'), h('code', {}, p.branch)),
    );
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
