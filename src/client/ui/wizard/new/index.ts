import './new.css';
/**
 * ✨ New project (docs/site/get-started/first-project.md): a page over the office, in three screens. The
 * start page ("What would you like to build?": how to start, the description, attached documents); the
 * plan, a live project brief drafted with the Chief Analyst on the left and the chat with it on the right
 * (a bottom sheet on a phone), then Approve scope, the functional domains, and one Team & budget card with
 * everything else under Advanced; and the setup's progress once Create project starts it (progress.ts).
 * The brief is a draft kept in the office (server/wizard/planner/), so a reload carries on where it was.
 */
import type { Net } from '../../../net';
import { loadProfile } from '../../../state/persist';
import type { DraftView, PlannerStatus } from '../../../../shared/brief';
import type { JobView, ProjectPlan, WizardInfo } from '../../../../shared/wizard';
import { usdCents } from '../../../../shared/budget/money';
import { h, openModal, toast } from '../../dom';
import { wizardApi } from '../api';
import { progressView, type ProgressView } from '../progress';
import { briefApi, officeToday, setBriefBy } from './api';
import { closeAllDialogs, closeTopDialog, dialogOpen } from './dialog';
import { startView } from './start';
import { planView } from './plan';
import { icon } from './parts';

export interface NewProjectOptions {
  net: Net;
  go(floor: string): void;
  /** Edit a setup's answers instead (the classic form, ../index.ts). */
  edit(job: string): void;
}

/** What every screen of the flow shares. */
export interface Flow {
  info: WizardInfo;
  status: PlannerStatus;
  draft?: DraftView;
  plan: ProjectPlan;
  /** Who's making it (the page's profile name). */
  me: string;
  net: Net;
  /** Fields the person changed by hand, so the brief no longer fills them in. */
  touched: Set<'name' | 'description' | 'tier'>;
  /** The draft changed (from the office): every screen updates what it shows. */
  setDraft(d: DraftView): void;
  /** Keep polling the draft while the Chief Analyst works on it. */
  watch(): void;
  /** Says something to screen readers (the drafting status). */
  say(text: string): void;
  show(view: 'start' | 'plan'): void;
  /** The setup started: its progress takes over. */
  started(job: JobView): void;
  layer: HTMLElement;
  close(): void;
  go(floor: string): void;
}

export function blankPlan(info: WizardInfo): ProjectPlan {
  const me = loadProfile()?.name;
  return {
    kind: 'new',
    owner: info.org,
    name: '',
    description: '',
    private: true,
    mendix: info.defaultMendix,
    entry: 'greenfield',
    tier: 'standard',
    interview: 'steering',
    execApproval: 'auto',
    intake: [],
    clients: [],
    operators: me ? [me] : [],
    roles: ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'],
    discovery: { issue: true, queue: false, model: 'opus' },
    createdByHand: false,
  };
}

const POLL_MS = 800;

export async function openNewProject(opts: NewProjectOptions) {
  let info: WizardInfo;
  let status: PlannerStatus;
  let latest: DraftView | null = null;
  try {
    [info, status, latest] = await Promise.all([wizardApi.info(), briefApi.status(), briefApi.latest().then((r) => r.draft).catch(() => null)]);
  } catch (err) {
    toast(`Couldn't open New project: ${(err as Error).message}`, 'error');
    return;
  }
  const opener = document.activeElement as HTMLElement | null;
  setBriefBy(loadProfile()?.name ?? '');
  const live = h('div.nw-sr', { 'aria-live': 'polite', role: 'status' });
  const spend = h('span.nw-spend', { title: 'What the office has spent today, planning included' }, h('span.nw-spend-l', {}, 'Office '), h('b', {}, '…'), h('span.nw-spend-l', {}, ' today'));
  const section = h('span.nw-section', {}, 'New project');
  const x = h('button.nw-iconbtn.nw-close', { type: 'button', 'aria-label': 'Close New project', title: 'Close (your draft is kept)' }, icon('x'));
  const bar = h('header.nw-bar', {}, h('span.nw-wordmark', {}, 'Mx', h('b', {}, 'Office')), h('span.nw-tsep', { 'aria-hidden': 'true' }), section, h('span.nw-grow'), spend, x);
  const main = h('main.nw-main', {});
  const layer = h('div.nw', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New project' }, bar, live, main);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let progress: ProgressView | undefined;
  let views: { start?: ReturnType<typeof startView>; plan?: ReturnType<typeof planView> } = {};
  let current: 'start' | 'plan' | 'progress' | undefined;

  const refreshSpend = () => void officeToday().then((v) => (spend.querySelector('b')!.textContent = v === undefined ? '—' : usdCents(v)));

  const flow: Flow = {
    info,
    status,
    draft: undefined,
    plan: blankPlan(info),
    me: loadProfile()?.name ?? 'an admin',
    net: opts.net,
    touched: new Set(),
    layer,
    setDraft(d) {
      const was = flow.draft;
      flow.draft = d;
      if (was && was.spent !== d.spent) refreshSpend();
      views.start?.update();
      views.plan?.update(was);
      if (d.busy || d.status === 'drafting') flow.watch();
    },
    watch() {
      if (timer) return;
      const tick = async () => {
        timer = undefined;
        const id = flow.draft?.id;
        if (!id || current === 'progress') return;
        const d = await briefApi.get(id).catch(() => undefined);
        if (d && flow.draft?.id === id) flow.setDraft(d);
        if (d && (d.busy || d.status === 'drafting') && !timer) timer = setTimeout(tick, POLL_MS);
      };
      timer = setTimeout(tick, POLL_MS);
    },
    say(text) {
      live.textContent = '';
      setTimeout(() => (live.textContent = text), 30);
    },
    show(view) {
      if (current === view) return;
      const next = view === 'start' ? (views.start ??= startView(flow, { resume: latest })) : (views.plan ??= planView(flow));
      next.update();
      const prev = main.firstElementChild as HTMLElement | null;
      current = view;
      section.textContent = 'New project';
      next.el.classList.remove('in');
      if (prev && prev !== next.el) prev.remove();
      main.append(next.el);
      next.el.scrollTop = 0;
      requestAnimationFrame(() => requestAnimationFrame(() => next.el.classList.add('in')));
      next.focus();
    },
    started(job) {
      current = 'progress';
      if (timer) clearTimeout(timer);
      timer = undefined;
      views = {};
      progress?.stop();
      // The setup's own progress view (progress.ts: the five groups, the failure box, the ready card) takes over.
      progress = progressView(job, (floor) => (flow.close(), opts.go(floor)), info.admin, () => (flow.close(), opts.edit(job.id)));
      section.textContent = 'Setting up';
      const another = h('button.btn', { type: 'button', title: 'Leave this setup to carry on, and start another project' }, '➕ Another project');
      another.addEventListener('click', () => {
        progress?.stop();
        progress = undefined;
        flow.draft = undefined;
        flow.plan = blankPlan(info);
        flow.touched.clear();
        latest = null;
        current = undefined;
        flow.show('start');
      });
      const page = h('section.nw-view.nw-progress', { 'aria-label': 'Setting up the project' }, h('div.nw-progress-in', {}, progress.el, h('div.nw-progress-acts', {}, another, progress.actions)));
      main.replaceChildren(page);
      requestAnimationFrame(() => page.classList.add('in'));
      flow.say('The project setup started');
    },
    close() {
      modal.close();
    },
    go: opts.go,
  };

  const modal = openModal(layer, {
    doing: '✨ setting up a new project',
    escCloses: false,
    closeButton: false,
    backdropCloses: false,
    onClose: () => {
      if (timer) clearTimeout(timer);
      progress?.stop();
      closeAllDialogs();
      document.documentElement.classList.remove('nw-open');
      if (opener && document.contains(opener)) opener.focus();
    },
  });
  modal.backdrop.classList.add('nw-backdrop');
  document.documentElement.classList.add('nw-open');
  x.addEventListener('click', () => flow.close());
  // Esc: the top dialog first (a field that handles Esc itself stops it), then the flow, which keeps the draft.
  layer.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (dialogOpen()) closeTopDialog();
    else if (!views.plan?.escape()) flow.close();
  });
  refreshSpend();
  flow.show('start');
}
