// The report viewer's harder pieces: the findings table with its severity filter, the root cause
// chains, the planned-vs-forecast timeline chart and the recommendations board.

import type { Finding, Milestone, Recommendation, RootCause } from '../../shared/firm/report';
import { bySeverity, SEVERITIES } from '../../shared/firm/report';
import { REVIEWER_BY_ID, type ReviewerId } from '../../shared/firm/roles';
import { h } from '../ui/dom';

const SVG = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

export function findingsTable(findings: Finding[]): HTMLElement {
  const shown = new Set<string>(SEVERITIES);
  const body = h('tbody');
  const counts = Object.fromEntries(SEVERITIES.map((sv) => [sv, findings.filter((f) => f.severity === sv).length]));
  const draw = () =>
    body.replaceChildren(
      ...[...findings].sort(bySeverity).filter((f) => shown.has(f.severity)).map((f) =>
        h('tr', { class: `sev-${f.severity}` },
          h('td.mono', {}, f.id),
          h('td', {}, h('span.firm-sev', { class: f.severity }, f.severity)),
          h('td', {}, f.team),
          h('td', {}, h('b', {}, f.title), f.reviewer ? h('small.firm-by', {}, ` · ${REVIEWER_BY_ID.get(f.reviewer as ReviewerId)?.title ?? f.reviewer}`) : null),
          h('td.firm-ev', {}, ...f.evidence.map((e) => h('div', {}, e.text, e.file ? h('code', {}, ` ${e.file}${e.line ? `:${e.line}` : ''}`) : null, e.pr ? h('span.firm-chip', {}, `PR #${e.pr}`) : null, e.issue ? h('span.firm-chip', {}, `#${e.issue}`) : null, e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, ' ↗') : null))),
          h('td', {}, f.recommendation),
          h('td.c', {}, f.effort),
        ),
      ),
    );
  const chips = h('div.firm-filters', { role: 'group', 'aria-label': 'Filter by severity' },
    ...SEVERITIES.map((sv) => {
      const b = h('button.btn.small.firm-sev-chip.on', { type: 'button', class: sv, 'aria-pressed': 'true', onclick: () => {
        if (shown.has(sv)) shown.delete(sv);
        else shown.add(sv);
        b.classList.toggle('on', shown.has(sv));
        b.setAttribute('aria-pressed', String(shown.has(sv)));
        draw();
      } }, `${sv} ${counts[sv]}`);
      return b;
    }),
  );
  draw();
  return h('div', {}, chips, h('div.firm-table-wrap', {}, h('table.firm-table.firm-findings', {}, h('thead', {}, h('tr', {}, ...['ID', 'Severity', 'Team', 'Finding', 'Evidence', 'Recommendation', 'Effort'].map((t) => h('th', {}, t)))), body)));
}

export function causalChains(rcs: RootCause[]): HTMLElement {
  if (!rcs.length) return h('p.firm-empty', {}, 'No root cause analysis in this report.');
  return h('div.firm-rcas', {}, ...rcs.map((c) =>
    h('article.firm-rca', {},
      h('h4', {}, `⚠️ ${c.problem}`),
      h('ol.firm-chain', {}, ...c.chain.map((w, i) => h('li', {}, h('small', {}, `Why ${i + 1}`), w))),
      h('div.firm-root', {}, h('b', {}, 'Root cause: '), c.rootCause),
      h('div.firm-fix', {}, h('b', {}, 'Fix: '), c.fix),
    ),
  ));
}

const day = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? Date.parse(d.slice(0, 10)) : NaN);

export function timelineChart(ms: Milestone[]): HTMLElement {
  const dates = ms.flatMap((m) => [day(m.planned), day(m.forecast)]).filter((n) => !Number.isNaN(n));
  if (!ms.length) return h('p.firm-empty', {}, 'No milestones in this report.');
  const now = Date.now();
  const lo = Math.min(...dates, now) - 3 * 86_400_000;
  const hi = Math.max(...dates, now) + 3 * 86_400_000;
  const W = 720;
  const L = 190;
  const ROW = 30;
  const H = ms.length * ROW + 34;
  const x = (t: number) => L + ((t - lo) / (hi - lo || 1)) * (W - L - 16);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'firm-timeline', role: 'img', 'aria-label': 'Planned vs forecast milestones' });
  // Month ticks.
  const d0 = new Date(lo);
  for (let d = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); d.getTime() < hi; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const tx = x(d.getTime());
    svg.append(s('line', { x1: tx, x2: tx, y1: 14, y2: H - 6, class: 'tl-grid' }), s('text', { x: tx + 3, y: 11, class: 'tl-tick' }, d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })));
  }
  svg.append(s('line', { x1: x(now), x2: x(now), y1: 14, y2: H - 6, class: 'tl-today' }), s('text', { x: x(now) + 3, y: H - 8, class: 'tl-tick' }, 'today'));
  ms.forEach((m, i) => {
    const y = 30 + i * ROW;
    const p = day(m.planned);
    const f = day(m.forecast);
    svg.append(s('text', { x: 4, y: y + 4, class: 'tl-label' }, m.name.length > 28 ? `${m.name.slice(0, 27)}…` : m.name));
    if (!Number.isNaN(p) && !Number.isNaN(f)) svg.append(s('line', { x1: x(p), x2: x(f), y1: y, y2: y, class: `tl-slip ${m.status}` }));
    if (!Number.isNaN(p)) svg.append(s('rect', { x: x(p) - 5, y: y - 5, width: 10, height: 10, transform: `rotate(45 ${x(p)} ${y})`, class: 'tl-planned' }, s('title', {}, `Planned ${m.planned}`)));
    if (!Number.isNaN(f)) svg.append(s('circle', { cx: x(f), cy: y, r: 6, class: `tl-forecast ${m.status}` }, s('title', {}, `Forecast ${m.forecast} · ${m.status} · ${m.confidence} confidence`)));
  });
  const legend = h('p.firm-tl-legend', {}, h('span.tl-key.planned', {}, '◆ planned'), h('span.tl-key.forecast', {}, '● forecast after review'), h('span.tl-key', {}, 'colour = status'));
  const table = h('div.firm-table-wrap', {}, h('table.firm-table', {}, h('thead', {}, h('tr', {}, ...['Milestone', 'Planned', 'Forecast', 'Status', 'Confidence', 'Note'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...ms.map((m) => h('tr', {}, h('td', {}, m.name), h('td', {}, m.planned ?? '—'), h('td', {}, m.forecast ?? '—'), h('td', {}, h('span.firm-status', { class: m.status }, m.status)), h('td', {}, m.confidence), h('td', {}, m.note ?? ''))))));
  return h('div', {}, h('div.firm-chart', {}, svg), legend, table);
}

export function recBoard(recs: Recommendation[]): HTMLElement {
  const col = (p: Recommendation['priority'], title: string) =>
    h('div.firm-rec-col', { class: p },
      h('h4', {}, title, h('span.firm-n', {}, String(recs.filter((r) => r.priority === p).length))),
      ...recs.filter((r) => r.priority === p).map((r) => h('article.firm-rec', {}, h('b', {}, r.title), h('p', {}, r.detail), h('div.firm-rec-meta', {}, h('span.firm-chip', {}, r.owner), r.effort ? h('span.firm-chip', {}, `effort ${r.effort}`) : null))),
    );
  return h('div.firm-recs', {}, col('now', '🔥 Now'), col('next', '⏭️ Next'), col('later', '🗓️ Later'));
}
