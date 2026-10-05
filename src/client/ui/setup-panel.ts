import './setup-panel.css';
/**
 * The project setup panel over a toolkit project's board, until its build plan (Stage 4) is
 * confirmed: the toolkit's stages from kickoff to build plan with their gate verdicts, what's next,
 * the questions still open, and a way back into the new-project wizard to change the answers. What
 * it shows comes from the project's files (server/wizard/setup.ts); 🔄 Re-check runs gate-check on
 * the office for fresh verdicts. No three.js: the 1D view draws it.
 */
import type { Net } from '../net';
import type { SetupView } from '../../shared/wizard';
import { h } from './dom';
import { wizardApi } from './wizard/api';
import { openWizard } from './wizard';

/** Asked again at most this often while nothing's happening; the board re-renders far more often than that. */
const FRESH_MS = 15_000;
const CHECKING_MS = 5_000;
const ICON: Record<string, string> = { PASS: '✅', PENDING: '⏳', FAIL: '⚠️', WAIVED: '↷', MANUAL: '✋' };

let last: { floor: string; at: number; view: SetupView } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** What the panel last fetched for `floor`, if anything (the Command Center's "Needs you" reads its ✋ gates). */
export const cachedSetup = (floor: string | undefined): SetupView | undefined => (floor && last?.floor === floor ? last.view : undefined);

export interface SetupPanelDeps {
  net: Net;
  go(floor: string): void;
}

/** Draws the panel into `el` for `floor` (nothing when the floor isn't a toolkit project being set up). */
export async function renderSetup(el: HTMLElement, floor: string | undefined, deps: SetupPanelDeps, force = false) {
  if (!floor) return el.replaceChildren();
  const fresh = last && last.floor === floor && Date.now() - last.at < (last.view.checking ? CHECKING_MS : FRESH_MS);
  if (!fresh || force) {
    try {
      last = { floor, at: Date.now(), view: await wizardApi.setup(floor) };
    } catch {
      return el.replaceChildren();
    }
  }
  const v = last!.view;
  if (!v.show) return el.replaceChildren();
  if (timer) clearTimeout(timer);
  // While gate-check runs, look again until it's done.
  if (v.checking) timer = setTimeout(() => void renderSetup(el, floor, deps, true), CHECKING_MS);
  el.replaceChildren(panel(el, floor, v, deps));
}

function panel(el: HTMLElement, floor: string, v: SetupView, deps: SetupPanelDeps): HTMLElement {
  const recheck = h('button.btn', { type: 'button', disabled: v.checking, title: "Runs the toolkit's gate-check over the project (about a minute) so these verdicts are fresh" }, v.checking ? '⏳ Checking gates…' : '🔄 Re-check gates');
  recheck.addEventListener('click', async () => {
    recheck.disabled = true;
    recheck.textContent = '⏳ Checking gates…';
    await wizardApi.recheck(floor).catch(() => undefined);
    void renderSetup(el, floor, deps, true);
  });
  const editAt = (page: number) => () => void openWizard({ net: deps.net, go: deps.go, ...(v.job ? { job: v.job, page } : { floor, page }) });
  const chips = [v.entry && `🧭 ${v.entry}`, v.tier && `📏 ${v.tier} tier`].filter((s): s is string => !!s);
  return h(
    'section.setup-panel',
    { 'aria-label': 'Project setup' },
    h(
      'div.setup-head',
      {},
      h('h3', {}, '🧰 Project setup'),
      ...chips.map((c) => h('span.setup-chip', {}, c)),
      h('span.setup-grow'),
      h('button.btn', { type: 'button', onclick: editAt(1), title: 'Entry mode and size tier, in the new-project wizard' }, '🧭 Entry mode'),
      h('button.btn', { type: 'button', onclick: editAt(2), title: 'The intake answers, in the new-project wizard' }, '📝 Intake'),
      h('button.btn', { type: 'button', onclick: editAt(3), title: 'Client and team, in the new-project wizard' }, '👥 Team'),
      recheck,
    ),
    h(
      'ol.setup-stages',
      {},
      ...v.stages.map((s) =>
        h('li', { class: `setup-stage ${s.status.toLowerCase()}`, title: s.detail ?? s.status }, h('span.setup-stage-id', {}, s.id), h('span.setup-stage-title', {}, s.title), h('span.setup-stage-status', {}, `${ICON[s.status] ?? '•'} ${s.status}`)),
      ),
    ),
    v.next ? h('p.setup-next', {}, h('strong', {}, 'Next: '), v.next) : null,
    v.questions.length
      ? h('details.setup-questions', {}, h('summary', {}, `❓ ${v.questions.length} open question${v.questions.length === 1 ? '' : 's'}`), h('ul', {}, ...v.questions.map((q) => h('li', {}, q))))
      : null,
    h('p.setup-foot', {}, `This panel goes away once Stage 4 (the build plan) is confirmed.${v.checkedAt ? ` Gates last checked ${new Date(v.checkedAt).toLocaleTimeString()}.` : ''}`),
  );
}
