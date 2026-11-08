import '../new/new.css';
import './expert.css';
/**
 * The start of ✨ New project (docs/site/get-started/first-project.md): "How do you want to build?", Expert mode or
 * Team mode, each with one honest line on who it suits. Team mode carries on into the brief-first flow (../new/)
 * unchanged. Expert mode is the thin Expert wizard (./form.ts) on the same page, then the setup's progress
 * (../progress.ts), then the project's Session screen with the real `claude` in the folder. A full page over the
 * office like the Team flow, with a ✕ top right; ✕ and Esc give focus back to where New project was opened from.
 */
import type { Net } from '../../../net';
import type { JobView } from '../../../../shared/wizard';
import type { ExpertForm } from '../../../../shared/expert-setup';
import { isExpertPlan } from '../../../../shared/expert-setup';
import { h, openModal, toast } from '../../dom';
import { store } from '../../../state';
import { wizardApi } from '../api';
import { progressView, type ProgressView } from '../progress';
import { icon } from '../new/parts';
import { openExistingProject } from '../../expert/open';
import { expertForm } from './form';

export interface ModeChoiceOptions {
  net: Net;
  go(floor: string): void;
  /** Team mode: the brief-first flow, opened once this page has closed. */
  team(): void;
}

type Mode = 'expert' | 'team';
const MODES: { id: Mode; title: string; line: string; ico: string }[] = [
  { id: 'expert', title: 'Expert mode', line: 'Your own Claude session, with the office in the background. For experienced builders making new apps.', ico: 'doc' },
  { id: 'team', title: 'Team mode', line: 'A governed agent team. For rebuilds, migrations, governed delivery, and people new to Mendix.', ico: 'team' },
];

const POLL_MS = 1200;

/** The small picture on each card: a session beside a live app, or a team with a gate. */
function picture(mode: Mode): HTMLElement {
  if (mode === 'expert') {
    return h('div.xw-pic', { 'aria-hidden': 'true' }, h('span.xw-term', {}, h('i'), h('i'), h('i.ok'), h('i.ac'), h('b')), h('span.xw-app', {}, h('i.bar'), h('i'), h('i'), h('i')));
  }
  return h('div.xw-pic', { 'aria-hidden': 'true' }, h('span.xw-team', {}, h('i.co', {}, 'Co'), h('i.ca', {}, 'CA'), h('i.dv', {}, 'Dev'), h('i.dv2', {}, 'Dev'), h('i.qa', {}, 'QA'), h('i.gate', {}, 'Gate')));
}

export function openModeChoice(opts: ModeChoiceOptions) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let mode: Mode = 'expert';
  // The Expert form's answers, kept while this page is open (Back to mode choice, Edit after a failure).
  const keep: { form?: ExpertForm } = {};
  let poll: ReturnType<typeof setTimeout> | undefined;
  let progress: ProgressView | undefined;
  const section = h('span.nw-section', {}, 'New project');
  const x = h('button.nw-iconbtn.nw-close', { type: 'button', 'aria-label': 'Close New project', title: 'Close' }, icon('x'));
  const bar = h('header.nw-bar', {}, h('span.nw-wordmark', {}, 'Mx', h('b', {}, 'Office')), h('span.nw-tsep', { 'aria-hidden': 'true' }), section, h('span.nw-grow'), x);
  const main = h('main.nw-main', {});
  const layer = h('div.nw.xw', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New project' }, bar, main);

  const show = (el: HTMLElement, focus?: HTMLElement | null) => {
    main.replaceChildren(el);
    el.scrollTop = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    setTimeout(() => focus?.focus({ preventScroll: true }), 40);
  };

  function choice() {
    section.textContent = 'New project';
    const cards = MODES.map((m) => {
      const card = h(
        'button.xw-card',
        { type: 'button', role: 'radio', 'aria-checked': String(m.id === mode), 'data-mode': m.id },
        h('span.xw-card-h', {}, icon(m.ico), h('h2', {}, m.title), h('span.xw-radio', { 'aria-hidden': 'true' })),
        h('p.xw-line', {}, m.line),
        picture(m.id),
      );
      card.addEventListener('click', () => {
        mode = m.id;
        for (const c of cards) c.setAttribute('aria-checked', String(c.dataset.mode === mode));
      });
      card.addEventListener('dblclick', () => go());
      return card;
    });
    const group = h('div.xw-cards', { role: 'radiogroup', 'aria-label': 'How do you want to build?' }, ...cards);
    // Arrow keys move between the two cards, as in a radio group.
    group.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      mode = mode === 'expert' ? 'team' : 'expert';
      for (const c of cards) c.setAttribute('aria-checked', String(c.dataset.mode === mode));
      cards.find((c) => c.dataset.mode === mode)?.focus();
    });
    const cont = h('button.btn.primary', { type: 'button', id: 'xw-continue' }, 'Continue', icon('chev'));
    cont.addEventListener('click', () => go());
    const cancel = h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel');
    const existing = store.me.admin
      ? h('button.nw-link', { type: 'button', onclick: () => (modal.close(), openExistingProject({ go: opts.go })) }, icon('folder'), 'Open an existing toolkit project')
      : h('span');
    const view = h(
      'section.nw-view.xw-mode',
      { 'aria-label': 'How do you want to build?' },
      h(
        'div.xw-in',
        {},
        h('p.xw-crumb', {}, 'Projects / New project'),
        h('h1', {}, 'How do you want to build?'),
        h('p.xw-lede', {}, 'Both modes use the same toolkit, the same Team Server app and the same budget.'),
        group,
        h('div.xw-foot', {}, existing, h('span.nw-grow'), cancel, cont),
      ),
    );
    show(view, cards.find((c) => c.dataset.mode === mode));
  }

  function go() {
    if (mode === 'team') {
      modal.close();
      opts.team();
      return;
    }
    section.textContent = 'New project · Expert mode';
    void expertForm({ back: choice, started, keep }).then((v) => (v ? show(v.el, v.focus) : choice()));
  }

  /** The setup started: its progress, then the Session screen once it's done. */
  function started(job: JobView) {
    section.textContent = 'Setting up';
    progress?.stop();
    progress = progressView(job, (floor) => (modal.close(), opts.go(floor)), store.me.admin, () => go());
    const page = h('section.nw-view.nw-progress', { 'aria-label': 'Setting up the project' }, h('div.nw-progress-in', {}, progress.el, h('div.nw-progress-acts', {}, progress.actions)));
    show(page);
    const id = job.id;
    // Done: straight into the project's Session screen (it starts the session there, with nothing typed into it).
    const tick = async () => {
      poll = undefined;
      const j = await wizardApi.job(id).catch(() => undefined);
      if (!modal || closed) return;
      if (j?.status === 'done' && j.floor && isExpertPlan(j.plan)) {
        toast(`${j.plan.expert?.title || j.plan.name} is ready: opening the session`);
        const floor = j.floor;
        poll = setTimeout(() => (modal.close(), opts.go(floor)), 900);
        return;
      }
      if (!j || j.status === 'running') poll = setTimeout(() => void tick(), POLL_MS);
    };
    poll = setTimeout(() => void tick(), POLL_MS);
  }

  let closed = false;
  const modal = openModal(layer, {
    doing: '✨ setting up a new project',
    escCloses: false,
    closeButton: false,
    backdropCloses: false,
    onClose: () => {
      closed = true;
      if (poll) clearTimeout(poll);
      progress?.stop();
      document.documentElement.classList.remove('nw-open');
      if (opener && document.contains(opener)) opener.focus();
    },
  });
  modal.backdrop.classList.add('nw-backdrop');
  document.documentElement.classList.add('nw-open');
  x.addEventListener('click', () => modal.close());
  layer.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    modal.close();
  });
  choice();
}
