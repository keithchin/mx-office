// The session screen's live preview: the project's live app (liveapp/, hot reload) in the Live app tab's
// viewer, under a header with a page picker (the app's pages that open by address, from the model at the
// served commit), a role picker (user roles and demo users from the model; demo users are allowed for local
// work), and the asked → visible timer ("asked → visible 41 s · median 52 s", from the session's hooks:
// server/expert/loop.ts). A new served build or a hot reload lights the preview up for a moment ("Updated").
// When nothing serves there's no frame, only why and a Start the app button.

import { store } from '../../state';
import { h, timeAgo } from '../dom';
import { appUrl } from '../liveapp';
import { liveViewer, type LiveViewer } from '../liveapp/viewer';
import { previewOff } from '../../../shared/liveapp/not-running';
import { loopWords, type LoopView, type PreviewChoices } from '../../../shared/expert';
import type { LiveAppState } from '../../../shared/protocol';
import { getChoices } from './api';

const CHANGED_MS = 2500;
const ROLE_KEY = 'mxo.expert.role.';

export interface Preview {
  el: HTMLElement;
  draw(live: LiveAppState | null): void;
  loop(v: LoopView | undefined): void;
  /** Ticks the "reloaded … ago" line. */
  tick(): void;
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);

/** A small sparkline of the newest asked → visible times. */
function spark(ms: number[]): SVGSVGElement | null {
  if (ms.length < 2) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const w = 6 * ms.length;
  svg.setAttribute('viewBox', `0 0 ${w} 16`);
  svg.setAttribute('class', 'xs-spark');
  svg.setAttribute('aria-hidden', 'true');
  const max = Math.max(...ms);
  ms.forEach((v, i) => {
    const r = document.createElementNS(NS, 'rect');
    const hgt = Math.max(2, Math.round((v / max) * 16));
    r.setAttribute('x', String(i * 6));
    r.setAttribute('y', String(16 - hgt));
    r.setAttribute('width', '4');
    r.setAttribute('height', String(hgt));
    svg.append(r);
  });
  return svg;
}

export function sessionPreview(deps: { startApp(): void; openLive(): void }): Preview {
  let viewer: LiveViewer | undefined;
  let servedKey = '';
  let servedAt = 0;
  let choicesRev = '';
  let changedTimer: ReturnType<typeof setTimeout> | undefined;
  const pageSel = h('select.xs-sel', { 'aria-label': 'Page of the app', title: 'Open a page of the app' }) as HTMLSelectElement;
  const roleSel = h('select.xs-sel', { 'aria-label': 'See the app as', title: 'See the app as a role (demo users: local work only)' }) as HTMLSelectElement;
  const roleNote = h('span.xs-rolenote', { hidden: true });
  const loopPill = h('span.xs-loop', { title: 'asked → visible: from your prompt to the first preview reload after the next model change' });
  const loopMedian = h('span.xs-loopmed');
  const sparkBox = h('span.xs-sparkbox');
  const reloaded = h('span.xs-reloaded');
  const frameBox = h('div.xs-frame');
  const empty = h('div.xs-empty', { hidden: true });
  const badge = h('span.xs-changed-badge', { 'aria-live': 'polite' }, 'Updated');
  const el = h(
    'section.xs-preview-in',
    { 'aria-label': 'Live preview' },
    h('div.xs-ph', {}, h('span.xs-ph-l', {}, 'Preview'), pageSel, roleSel, h('span.xs-grow'), roleNote),
    h('div.xs-ph2', {}, loopPill, loopMedian, sparkBox, h('span.xs-grow'), reloaded),
    h('div.xs-stagebox', {}, frameBox, empty, badge),
  );

  const floorKey = () => ROLE_KEY + (store.floor ?? '');
  pageSel.addEventListener('change', () => {
    if (pageSel.value) viewer?.go?.(pageSel.value);
  });
  roleSel.addEventListener('change', () => {
    try {
      localStorage.setItem(floorKey(), roleSel.value);
    } catch {
      // only this visit
    }
    drawRole();
    // The app's own sign-in page: sign in there as the demo user picked (the office never handles passwords).
    if (roleSel.value.startsWith('demo:')) viewer?.go?.('/login.html');
  });
  function drawRole() {
    const v = roleSel.value;
    roleNote.hidden = !v.startsWith('demo:');
    roleNote.textContent = v.startsWith('demo:') ? `Sign in as ${v.slice(5)} (demo user, local only)` : '';
  }

  async function loadChoices(rev: string) {
    if (rev === choicesRev) return;
    choicesRev = rev;
    const floor = store.floor;
    const c: PreviewChoices | undefined = floor ? await getChoices(floor, rev) : undefined;
    if (rev !== choicesRev) return;
    const pages = c?.pages ?? [];
    pageSel.replaceChildren(h('option', { value: '' }, pages.length ? 'Pick a page' : 'No pages'), ...pages.map((p) => h('option', { value: p.url, title: p.qn }, p.label)));
    pageSel.disabled = !pages.length;
    let saved = '';
    try {
      saved = localStorage.getItem(floorKey()) ?? '';
    } catch {
      saved = '';
    }
    const demo = c?.demoUsers ?? [];
    const roles = c?.roles ?? [];
    roleSel.replaceChildren(
      h('option', { value: '' }, 'As you are signed in'),
      ...(demo.length ? [h('optgroup', { label: c?.demoOn === false ? 'Demo users (off in the app)' : 'Demo users' }, ...demo.map((d) => h('option', { value: `demo:${d.user}` }, `${d.user}${d.roles.length ? ` · ${d.roles.join(', ')}` : ''}`)))] : []),
      ...(roles.length ? [h('optgroup', { label: 'User roles' }, ...roles.map((r) => h('option', { value: `role:${r}`, disabled: true, title: 'Sign in as a user with this role' }, r)))] : []),
    );
    roleSel.disabled = !demo.length && !roles.length;
    if (saved && [...roleSel.options].some((o) => o.value === saved)) roleSel.value = saved;
    drawRole();
  }

  function changed() {
    el.classList.add('xs-changed');
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => el.classList.remove('xs-changed'), CHANGED_MS);
  }

  return {
    el,
    draw(s) {
      const url = s && s.status === 'running' && s.served ? appUrl(s) : undefined;
      if (s && url && s.served) {
        viewer ??= liveViewer();
        if (frameBox.firstChild !== viewer.el) frameBox.replaceChildren(viewer.el);
        frameBox.hidden = false;
        empty.hidden = true;
        const at = Math.max(s.served.builtAt, s.lastUpdate?.ok ? s.lastUpdate.at : 0);
        const key = `${s.floor}|${s.served.sha}|${at}`;
        const where = viewer.where?.();
        // The same app keeps its page across a hot reload; the frame is pointed at it again so it shows the change.
        viewer.show(url, `${s.served.sha}|${s.since ?? ''}`, `running ${short(s.served.sha)}`);
        if (servedKey && key !== servedKey && servedKey.startsWith(`${s.floor}|`)) {
          if (where) viewer.go?.(where.path);
          changed();
        }
        servedKey = key;
        servedAt = at;
        void loadChoices(s.served.sha);
      } else {
        viewer?.hide();
        frameBox.hidden = true;
        empty.hidden = false;
        servedAt = 0;
        const off = previewOff(s ?? undefined);
        const busy = s?.status === 'starting' || s?.status === 'updating';
        empty.replaceChildren(
          h('h3', {}, busy ? 'The app is starting' : 'The app isn’t running'),
          h('p', {}, busy ? 'It shows here as soon as it answers.' : (off?.line ?? 'Start it to see your changes here.')),
          !busy && s?.available !== false ? h('button.btn.primary', { type: 'button', onclick: deps.startApp }, 'Start the app') : h('button.btn', { type: 'button', onclick: deps.openLive }, 'Open the Live app page'),
        );
      }
      this.tick();
    },
    loop(v) {
      const pending = v?.pending;
      loopPill.classList.toggle('timing', !!pending);
      loopPill.replaceChildren(h('span.xs-loop-k', {}, 'asked → visible'), ' ', h('b', {}, pending ? (pending.changed ? 'reloading…' : 'timing…') : loopWords(v?.lastMs)));
      loopMedian.textContent = v?.medianMs !== undefined ? `median ${loopWords(v.medianMs)}${v.count > 1 ? ` · ${v.count} changes` : ''}` : 'no change timed yet';
      sparkBox.replaceChildren(spark(v?.recent ?? []) ?? '');
    },
    tick() {
      reloaded.textContent = servedAt ? `reloaded ${timeAgo(servedAt)}` : '';
    },
  };
}
