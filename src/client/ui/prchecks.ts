// A pull request's checks, as its pr-checks run left them (GET /api/pr-shots): the scorecard's rows
// (mx check, lint, the best-practices score, unit and e2e tests) and a strip of the Playwright
// screenshots, each opening larger on a click. Shown in a PR card's hover preview and its window;
// a PR with no run yet shows nothing at all. No three.js here: the 1D view imports it.

import type { PrChecks, PrShot } from '../../shared/prshots';
import { store } from '../state';
import { h } from './dom';
import './prchecks.css';

/** An answer is reused this long (ms): hovering along a column shouldn't ask GitHub again and again. */
const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<PrChecks | null> }>();

function fetchChecks(floor: string, pr: number): Promise<PrChecks | null> {
  const key = `${floor}#${pr}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.p;
  const p = fetch(`/api/pr-shots?floor=${encodeURIComponent(floor)}&pr=${pr}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<PrChecks>) : null))
    .catch(() => null);
  cache.set(key, { at: Date.now(), p });
  return p;
}

const shotUrl = (floor: string, pr: number, run: number, s: PrShot) => `/api/pr-shots/file?floor=${encodeURIComponent(floor)}&pr=${pr}&run=${run}&name=${encodeURIComponent(s.name)}`;

/**
 * A panel for PR `pr` on the floor you're on, empty until its checks come back (and for good when it
 * has none). `loaded` runs once it has something in it, so a preview can find room for it again.
 */
export function prChecksPanel(pr: number, loaded?: () => void): HTMLElement {
  const root = h('div.prc', { hidden: true });
  const floor = store.floor;
  if (!floor) return root;
  void fetchChecks(floor, pr).then((c) => {
    if (!c || (!c.rows.length && !c.shots.length && !c.run)) return;
    root.replaceChildren(...draw(floor, c));
    root.hidden = false;
    loaded?.();
  });
  return root;
}

function draw(floor: string, c: PrChecks): HTMLElement[] {
  const run = c.run;
  const running = run && run.status !== 'completed';
  const head = h(
    'div.prc-head',
    {},
    h('span.prc-label', {}, '🧪 PR checks'),
    c.headline ? h('span.prc-headline', {}, c.headline) : running ? h('span.prc-headline', {}, '⏳ running…') : null,
    run ? h('a.prc-run', { href: run.url, target: '_blank', rel: 'noopener noreferrer', title: `Run ${run.id} on ${run.sha.slice(0, 7)}` }, `run ↗`) : null,
  );
  const rows = c.rows.length
    ? h(
        'ul.prc-rows',
        {},
        ...c.rows.map((r) => h('li', { title: `${r.check}: ${r.result}` }, h('span.prc-ico', {}, r.icon), h('span.prc-check', {}, shortCheck(r.check)), h('span.prc-result', {}, shortResult(r.result)))),
      )
    : null;
  const shots =
    run && c.shots.length
      ? h(
          'div.prc-shots',
          {},
          ...c.shots.map((s, i) =>
            h(
              'button.prc-thumb',
              { type: 'button', title: s.label, 'aria-label': `Screenshot: ${s.label}`, onclick: () => openShots(floor, c.pr, run.id, c.shots, i) },
              h('img', { src: shotUrl(floor, c.pr, run.id, s), alt: s.label, loading: 'lazy' }),
            ),
          ),
        )
      : null;
  return ([head, rows, shots] as (HTMLElement | null)[]).filter((e): e is HTMLElement => !!e);
}

/** "Studio Pro mx check" → "mx check"; "Best-practices score (mxcli report)" → "score". */
function shortCheck(check: string): string {
  const c = check.toLowerCase();
  if (c.includes('mx check')) return 'mx check';
  if (c.includes('lint')) return 'lint';
  if (c.includes('best-practices') || c.includes('report')) return 'score';
  if (c.includes('unit')) return 'unit';
  if (c.includes('e2e') || c.includes('playwright')) return 'e2e';
  return check.replace(/\s*\(.*\)$/, '');
}

/** The result without the per-category breakdown the score row carries. */
const shortResult = (r: string) => r.split(' — ')[0].replace(/,\s*\d+\s*info$/i, '').replace(/,\s*0 skipped$/i, '');

/** The screenshots big, one at a time, with ‹ › (and the arrow keys) between them; ✕ or Esc closes. */
function openShots(floor: string, pr: number, run: number, shots: PrShot[], at: number) {
  let i = at;
  const img = h('img.prc-big') as HTMLImageElement;
  const cap = h('p.prc-cap');
  const show = () => {
    img.src = shotUrl(floor, pr, run, shots[i]);
    img.alt = shots[i].label;
    cap.textContent = `${i + 1} / ${shots.length} · ${shots[i].label}`;
  };
  const step = (d: number) => {
    i = (i + d + shots.length) % shots.length;
    show();
  };
  const close = () => {
    removeEventListener('keydown', onKey, true);
    box.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const many = shots.length > 1;
  const box = h(
    'div.prc-light',
    { role: 'dialog', 'aria-label': 'Screenshot', onclick: (e: Event) => e.target === box && close() },
    h('button.btn.close.prc-x', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕'),
    many ? h('button.btn.prc-prev', { type: 'button', 'aria-label': 'Previous', onclick: () => step(-1) }, '‹') : null,
    h('figure', {}, img, cap),
    many ? h('button.btn.prc-next', { type: 'button', 'aria-label': 'Next', onclick: () => step(1) }, '›') : null,
  );
  addEventListener('keydown', onKey, true);
  show();
  document.body.append(box);
}
