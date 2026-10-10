import './setup-panel.css';
/**
 * The project setup panel over a toolkit project's board, until its build plan (Stage 4) is
 * confirmed: the toolkit's stages from kickoff to build plan with their gate verdicts, what's next,
 * the questions still open, and a way back into the new-project wizard to change the answers. What
 * it shows comes from the project's files (server/wizard/setup.ts); 🔄 Re-check runs gate-check on
 * the office for fresh verdicts.
 */
import type { Net } from '../net';
import { staleText, type SetupView } from '../../shared/wizard';
import { waitsOnPerson } from '../../shared/progress';
import { h } from './dom';
import { wizardApi } from './wizard/api';
import { openWizard } from './wizard';
import { deliverablesSummary } from './deliverables/summary';
import { toolkitRow } from './toolkit/line';
import { SetupCache } from './setup-cache';

/** Asked again at most this often while nothing's happening; the board re-renders far more often than that. */
const FRESH_MS = 15_000;
const CHECKING_MS = 5_000;
const ICON: Record<string, string> = { PASS: '✅', PENDING: '⏳', FAIL: '⚠️', WAIVED: '↷', MANUAL: '✋', WAITING: '✋' };

/** Each floor's answer, asked for once however many redraws want it at the same moment (setup-cache.ts). */
const cache = new SetupCache<SetupView>(
  (floor) => wizardApi.setup(floor),
  (v) => (v.checking ? CHECKING_MS : FRESH_MS),
  24,
);
/** Per panel element: the floor it's showing, the number of its newest draw, and its gate-check poll. */
const panels = new WeakMap<HTMLElement, { floor?: string; gen: number; timer?: ReturnType<typeof setTimeout> }>();
let hooked = false;

/** What the panel last fetched for `floor`, if anything (the Command Center's "Needs you" reads its ✋ gates). */
export const cachedSetup = (floor: string | undefined): SetupView | undefined => (floor ? cache.peek(floor) : undefined);

export interface SetupPanelDeps {
  net: Net;
  go(floor: string): void;
}

/**
 * Draws the panel into `el` for `floor` (nothing when the floor isn't a toolkit project being set up).
 * Only the newest call for `el` draws: an answer for a floor the panel has moved off since, or one
 * overtaken by a later call, is dropped. `force` asks the office again whatever is kept.
 */
export async function renderSetup(el: HTMLElement, floor: string | undefined, deps: SetupPanelDeps, force = false) {
  if (!hooked) {
    hooked = true;
    // A deleted project's answer goes with it.
    deps.net.onMessage((m) => void (m.t === 'project.deleted' && cache.forget(m.floor)));
  }
  let st = panels.get(el);
  if (!st) panels.set(el, (st = { gen: 0 }));
  const gen = ++st.gen;
  st.floor = floor;
  // One poll per panel at most: a new draw replaces the last one's.
  if (st.timer) clearTimeout(st.timer);
  st.timer = undefined;
  if (!floor) return el.replaceChildren();
  let v: SetupView;
  try {
    v = await cache.get(floor, force);
  } catch {
    if (st.gen === gen) el.replaceChildren();
    return;
  }
  if (st.gen !== gen || st.floor !== floor) return;
  if (!v.show) return el.replaceChildren();
  // While gate-check runs, look again until it's done.
  if (v.checking) st.timer = setTimeout(() => void renderSetup(el, floor, deps, true), CHECKING_MS);
  el.replaceChildren(panel(el, floor, v, deps));
}

/** Lets go of what's kept for `floor` (tests; a deleted project does it by itself). */
export const forgetSetup = (floor: string) => cache.forget(floor);

/** The floor's folder isn't on the default branch, or is behind it: the stages come from the default branch, and this says so. */

function staleCheckout(v: SetupView): HTMLElement | null {
  return v.checkout ? h('p.setup-stale', { role: 'note' }, '⚠️ ', staleText(v.checkout, 'the stages below are')) : null;
}

function panel(el: HTMLElement, floor: string, v: SetupView, deps: SetupPanelDeps): HTMLElement {
  const recheck = h('button.btn', { type: 'button', disabled: v.checking, title: "Admins: runs the toolkit's gate-check.sh over this project (about a minute) so these verdicts are fresh" }, v.checking ? '⏳ Checking gates…' : '🔄 Re-check gates');
  recheck.addEventListener('click', async () => {
    recheck.disabled = true;
    recheck.textContent = '⏳ Checking gates…';
    await wizardApi.recheck(floor).catch(() => undefined);
    void renderSetup(el, floor, deps, true);
  });
  const editAt = (page: number) => () => void openWizard({ net: deps.net, go: deps.go, ...(v.job ? { job: v.job, page } : { floor, page }) });
  // A gate gate-check fails only for a missing sign-off (a ✋ gate, or the shipped 'Confirmed by:' placeholder) is
  // waiting on a person, not broken: shown as such so a project that has barely started doesn't look failed.
  const nextId = v.next?.match(/^Stage (\w+)/)?.[1];
  const nextWaits = waitsOnPerson(v.next);
  const waiting = (s: SetupView['stages'][number]) => s.status === 'FAIL' && (waitsOnPerson(s.detail) || (s.id === nextId && nextWaits));
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
      ...(v.admin ? [] : [h('span.setup-chip', { title: 'Only admins (operators) can edit the setup answers or re-check the gates' }, '🔒 view only')]),
      h('button.btn', { type: 'button', onclick: editAt(1), title: 'Entry mode and size tier, in the new-project wizard' }, '🧭 Entry mode'),
      h('button.btn', { type: 'button', onclick: editAt(2), title: 'The intake answers, in the new-project wizard' }, '📝 Intake'),
      h('button.btn', { type: 'button', onclick: editAt(3), title: 'Client and team, in the new-project wizard' }, '👥 Team'),
      v.admin ? recheck : null,
    ),
    staleCheckout(v),
    toolkitRow(floor, () => void renderSetup(el, floor, deps, true)),
    h(
      'ol.setup-stages',
      {},
      ...v.stages.map((s) => {
        const status = waiting(s) ? 'WAITING' : s.status;
        return h('li', { class: `setup-stage ${status.toLowerCase()}`, title: s.detail ?? s.status }, h('span.setup-stage-id', {}, s.id), h('span.setup-stage-title', {}, s.title), h('span.setup-stage-status', {}, `${ICON[status] ?? '•'} ${status === 'WAITING' ? 'NEEDS SIGN-OFF' : status}`));
      }),
    ),
    deliverablesSummary(floor, () => void renderSetup(el, floor, deps)),
    v.next ? h('p.setup-next', {}, h('strong', {}, nextWaits ? 'Next, once the team has it ready, your sign-off: ' : 'Next: '), v.next) : null,
    v.questions.length
      ? h('details.setup-questions', {}, h('summary', {}, `❓ ${v.questions.length} open question${v.questions.length === 1 ? '' : 's'}`), h('ul', {}, ...v.questions.map((q) => h('li', {}, q))))
      : null,
    h(
      'details.setup-questions',
      {},
      h('summary', {}, 'ℹ️ What does Re-check gates do?'),
      h(
        'p.setup-help',
        {},
        v.readFrom
          ? `The stage verdicts above are read from ${v.readFrom}, the project's default branch on GitHub, not from whatever branch this floor's folder is on. The office fetches it every minute and a half or so, and whenever it moves (a pull request merged) it runs the toolkit's gate-check.sh on it in a temporary checkout that it deletes afterwards, so the verdicts follow what has merged. Re-check gates runs that now. It never writes to or commits in the floor's folder, changes answers or decisions, starts agents or pushes anything. Admins only, because it runs a script on the office's machine.`
          : "The stage verdicts above come from the project's gate dashboard (index.html), which the toolkit's gate-check.sh writes whenever an agent runs it. Re-check gates runs gate-check.sh now, on the office's machine, over this floor's checkout. It takes about a minute, rewrites index.html and the 'Current stage' line in PROJECT.md (left uncommitted, for the next commit), and the panel then shows the fresh verdicts. It doesn't change answers or decisions, start agents, or push anything. Admins only, because it runs a script and writes files in the project.",
      ),
    ),
    h('p.setup-foot', {}, `This panel goes away once Stage 4 (the build plan) is confirmed.${v.checkedAt ? ` Gates last checked ${new Date(v.checkedAt).toLocaleTimeString()}.` : ''}`),
  );
}
