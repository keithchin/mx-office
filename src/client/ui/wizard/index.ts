import './wizard.css';
/**
 * The new-project wizard (✨ New project on the home page): a project's setup with the mxcli
 * project toolkit, a page at a time, instead of only cloning a repository that's already there.
 * It collects a plan (the repository, the entry mode, the intake answers, the client and team), hands
 * it to the office to run, and shows the setup's progress. Opened again on a setup, it edits its
 * answers. No three.js here: the flat views open it.
 */
import type { Net } from '../../net';
import { loadProfile } from '../../state/persist';
import type { JobView, ProjectPlan, WizardInfo } from '../../../shared/wizard';
import { h, openModal, toast } from '../dom';
import { wizardApi } from './api';
import { entryPage, intakePage, PAGES, pageProblem, projectPage, reviewPage, teamPage, type PageCtx } from './forms';
import { progressView, type ProgressView } from './progress';

export interface WizardOptions {
  net: Net;
  /** Edit this setup's answers (from a floor's setup panel), starting on this page. */
  job?: string;
  page?: number;
  /** A floor with no setup of the wizard's (set up by hand): edit it as an existing-app project. */
  floor?: string;
  /** Go to a floor once it's there. */
  go(floor: string): void;
}

const DRAFT_KEY = 'agent-office.wizard-draft';

function blankPlan(info: WizardInfo): ProjectPlan {
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
    interview: 'attended',
    execApproval: 'auto',
    intake: [],
    clients: [],
    operators: me ? [me] : [],
    roles: ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'],
    discovery: { issue: true, queue: false, model: 'opus' },
    createdByHand: false,
  };
}

/** A draft from earlier in this tab, so closing the window by accident loses nothing. */
function savedDraft(): ProjectPlan | undefined {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ProjectPlan) : undefined;
  } catch {
    return undefined;
  }
}
function saveDraft(d: ProjectPlan | undefined) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Just for this window, then.
  }
}

export async function openWizard(opts: WizardOptions) {
  let info: WizardInfo;
  let editing: JobView | undefined;
  try {
    info = await wizardApi.info();
    if (opts.job) editing = await wizardApi.job(opts.job);
  } catch (err) {
    toast(`Couldn't open the new-project wizard: ${(err as Error).message}`, 'error');
    return;
  }
  let draft: ProjectPlan = editing ? structuredClone(editing.plan) : { ...blankPlan(info), ...(opts.floor ? {} : savedDraft()) };
  if (opts.floor && !editing) {
    // A project set up by hand: its repository and the answers already in its intake.
    const got = await wizardApi.answers(opts.floor).catch(() => undefined);
    const [owner, name] = (got?.repo ?? '').split('/');
    draft = { ...draft, kind: 'change', entry: 'existing-app-change', owner: owner ?? info.org, name: name ?? '', intake: got?.answers ?? [], discovery: { issue: false, queue: false, model: 'opus' } };
  }
  let page = Math.min(opts.page ?? 0, PAGES.length - 1);
  let progress: ProgressView | undefined;

  const nav = h('nav.wz-nav', { 'aria-label': 'Wizard steps' });
  const body = h('div.body.wz-body', {});
  const problem = h('span.grow', {});
  const back = h('button.btn', { type: 'button' }, '← Back');
  const next = h('button.btn.primary', { type: 'button' }, 'Next →');
  const footer = h('footer', {}, problem, back, next);
  const el = h(
    'div.modal.wizard',
    { role: 'dialog', 'aria-label': 'New project' },
    h('header', {}, h('h2', {}, editing ? `✏️ ${editing.plan.owner}/${editing.plan.name}: setup answers` : '✨ New project')),
    nav,
    body,
    footer,
  );

  const ctx = (): PageCtx => ({ draft, info, net: opts.net, editing: !!editing || !!opts.floor, redraw: render });
  const pages = [projectPage, entryPage, intakePage, teamPage, reviewPage];
  // Pages forward of one that isn't filled in can't be jumped to.
  const reachable = (i: number) => pages.slice(0, i).every((_, j) => !pageProblem(j, ctx()));

  function render() {
    if (progress) return;
    const scroll = body.scrollTop;
    body.replaceChildren(pages[page](ctx()));
    body.scrollTop = scroll;
    chrome();
  }

  // The tabs are made once and only updated: one swapped out between a press and its release (a
  // textarea's change event fires as you click away from it) would swallow the click.
  const tabs = PAGES.map((label, i) => h('button.wz-tab', { type: 'button', onclick: () => ((page = i), render()) }, h('span.wz-tab-n', {}, String(i + 1)), label));

  /** The tabs and the footer, which follow what's typed (the page itself isn't drawn again, so the caret stays put). */
  function chrome() {
    if (progress) return;
    saveDraft(editing || opts.floor ? undefined : draft);
    const c = ctx();
    if (nav.firstChild !== tabs[0]) nav.replaceChildren(...tabs);
    tabs.forEach((t, i) => {
      t.classList.toggle('on', i === page);
      t.classList.toggle('past', i < page);
      t.disabled = !reachable(i);
      if (i === page) t.setAttribute('aria-current', 'step');
      else t.removeAttribute('aria-current');
    });
    const bad = pageProblem(page, c);
    problem.textContent = bad ? `⚠️ ${bad}` : page === PAGES.length - 1 ? 'Esc closes; your answers are kept in this tab' : '';
    back.classList.toggle('hidden', page === 0);
    next.textContent = page < PAGES.length - 1 ? 'Next →' : editing ? '💾 Save changes' : '✨ Create project';
    next.disabled = !!bad || (page === PAGES.length - 1 && !info.admin);
  }
  body.addEventListener('input', () => chrome());
  body.addEventListener('change', () => chrome());

  function showProgress(job: JobView) {
    progress?.stop();
    progress = progressView(
      job,
      (floor) => (modal.close(), opts.go(floor)),
      () => {
        progress?.stop();
        progress = undefined;
        editing = job;
        draft = structuredClone(job.plan);
        page = 2;
        footer.replaceChildren(problem, back, next);
        render();
      },
    );
    nav.replaceChildren(h('span.wz-running', {}, editing ? '✏️ Setup answers' : '⚙️ Project setup'));
    body.replaceChildren(progress.el);
    const another = h('button.btn', { type: 'button', title: 'Leave this setup to carry on, and start another project' }, '➕ Another project');
    another.addEventListener('click', () => {
      progress?.stop();
      progress = undefined;
      editing = undefined;
      draft = blankPlan(info);
      page = 0;
      footer.replaceChildren(problem, back, next);
      render();
    });
    footer.replaceChildren(h('span.grow', {}, 'You can close this window: the setup carries on, and ✨ New project shows it again.'), another, progress.actions);
  }

  back.addEventListener('click', () => ((page = Math.max(0, page - 1)), render()));
  next.addEventListener('click', async () => {
    if (page < PAGES.length - 1) {
      page++;
      return render();
    }
    next.disabled = true;
    try {
      const job = editing ? await wizardApi.edit(editing.id, draft) : await wizardApi.start(draft, loadProfile()?.name);
      saveDraft(undefined);
      showProgress(job);
    } catch (err) {
      problem.textContent = `❌ ${(err as Error).message}`;
      next.disabled = false;
    }
  });

  const modal = openModal(el, { doing: '✨ setting up a new project', backdropCloses: false, onClose: () => progress?.stop() });
  // A setup still going (or stopped) for this office: show it rather than a blank form.
  const open = !editing && !opts.floor ? info.jobs[0] : undefined;
  if (editing && opts.page === undefined) {
    // From the setup panel without a page: how the setup went.
    showProgress(editing);
  } else if (open) {
    const job = await wizardApi.job(open.id).catch(() => undefined);
    if (job) showProgress(job);
    else render();
  } else render();
}
