// A project's setup as it runs: "Here's how I'll set up <name>", the fourteen steps in five friendly
// groups that tick in order (shared/setup-groups.ts, drawn by groups.ts), the running group open. When a
// step fails its group turns red with the step's error, Retry (which first says what would stop it, a
// paused project with Resume) and Cancel & undo for admins (cancel.ts). Once it's done, "<name> is
// ready" with Open project, Open in Studio Pro (when the office can open the new floor's .mpr: the
// project page's own action, ui/studio/, through its `&open=studio` link) and View setup details (every
// group open, and the log). It polls the office while the setup is running and stops once it ends.
import type { JobView } from '../../../shared/wizard';
import type { SetupBlocker } from '../../../shared/setup-cancel';
import type { StudioInfo } from '../../../shared/studio';
import { failHeadline, plainError, setupGroups } from '../../../shared/setup-groups';
import { h, toast } from '../dom';
import { startResume } from '../project-run/api';
import { projectUrl } from '../viewpick';
import { wizardApi, type CallError } from './api';
import { openCancelDialog } from './cancel';
import { groupsView } from './groups';
import { operationBox } from './operation';

const POLL_MS = 1200;
const COMPASS =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.6 5.4 9 9 5.4 10.6 7 7z" fill="currentColor"/></svg>';
const TICK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface ProgressView {
  el: HTMLElement;
  /** The buttons for the window's footer. */
  actions: HTMLElement;
  stop(): void;
}

/** Whether the office can open the new floor's Mendix project in Studio Pro from here (admins). */
async function studioReady(floor: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/studio?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok) return false;
    const info = (await res.json()) as StudioInfo;
    return info.hasMpr && info.available && info.admin;
  } catch {
    return false;
  }
}

export function progressView(first: JobView, go: (floor: string) => void, admin: boolean, edit: () => void): ProgressView {
  let job = first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let shownFail: string | undefined;
  let readyFor: string | undefined;
  const name = () => job.plan.name;

  const titleText = h('span', {});
  const title = h('h3.sg-title', {}, h('span.sg-ca', {}), titleText);
  title.firstElementChild!.innerHTML = COMPASS;
  const lede = h('p.sg-lede', {});
  const groups = groupsView(setupGroups(job));
  const end = h('div.sg-end', {});
  const log = h('pre.wz-log', { 'aria-label': 'Setup log', tabindex: '0' });
  const details = h('button.sg-link', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sg-logwrap' }, 'View setup details');
  const logWrap = h('div.sg-logwrap.hidden', { id: 'sg-logwrap' }, h('h3.wz-h', {}, 'Log'), log);
  const tools = h('div.sg-tools', {}, details);
  const error = h('p.wz-warn.hidden', {});
  const enter = h('button.btn', { type: 'button' }, 'Open project');
  const back = h('button.btn', { type: 'button' }, '✏️ Edit answers');
  // A setup that isn't running and hasn't failed (its answers edited) can still be cancelled from here.
  const idleCancel = h('button.btn.us-danger', { type: 'button', title: 'Cancel this setup and undo what it recorded creating' }, 'Cancel & undo…');
  const actions = h('span.wz-actions', {}, back, idleCancel, enter);
  const blockerBox = h('div.us-blocker.hidden', { role: 'status' });

  let detailsOpen = false;
  const showDetails = (open: boolean) => {
    detailsOpen = open;
    for (const b of [details, end.querySelector<HTMLButtonElement>('.sg-link')]) {
      if (!b) continue;
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'Hide setup details' : 'View setup details';
    }
    logWrap.classList.toggle('hidden', !open);
    if (job.status === 'done') groups.openAll(open);
    if (open) log.scrollTop = log.scrollHeight;
  };
  details.addEventListener('click', () => showDetails(!detailsOpen));

  /** Why Retry can't go now, with Resume when the project is paused (admins). */
  const showBlocker = (b: SetupBlocker) => {
    blockerBox.classList.remove('hidden');
    const resume = b.resume && admin ? (h('button.btn', { type: 'button' }, 'Resume project') as HTMLButtonElement) : null;
    resume?.addEventListener('click', () => {
      resume.disabled = true;
      startResume(b.resume!, { mode: 'work' }).then(
        () => (toast(`Resuming ${job.plan.name}: Retry once it's running`), blockerBox.classList.add('hidden')),
        (err: Error) => (toast(err.message, 'error'), (resume.disabled = false)),
      );
    });
    blockerBox.replaceChildren(h('span', {}, b.text), ...(resume ? [resume] : []));
  };

  const retryNow = async (btn: HTMLButtonElement) => {
    btn.disabled = true;
    try {
      job = await wizardApi.retry(job.id);
      blockerBox.classList.add('hidden');
      render();
      void poll();
    } catch (err) {
      if ((err as CallError).blocker) return showBlocker((err as CallError).blocker!);
      error.classList.remove('hidden');
      error.textContent = `❌ ${(err as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  };

  const cancelNow = () =>
    openCancelDialog(job.id, `${job.plan.owner}/${job.plan.name}`, {
      done: () =>
        void wizardApi.job(job.id).then(
          (j) => ((job = j), render()),
          () => {
            // Gone: the setup was cancelled and undone.
            stopped = true;
            titleText.textContent = `${job.plan.owner}/${job.plan.name}: cancelled and undone`;
            lede.textContent = 'Only what this setup recorded creating was removed. Your answers are still in the wizard.';
            for (const g of setupGroups(job)) groups.slot(g.id).replaceChildren();
            actions.replaceChildren();
          },
        ),
    });

  /** The failed group's box: the step's error in plain words, Retry and Cancel & undo. */
  const failBox = (label: string, detail: string | undefined) => {
    const retry = h('button.btn.primary', { type: 'button' }, 'Retry') as HTMLButtonElement;
    retry.addEventListener('click', () => void retryNow(retry));
    const cancel = admin ? h('button.btn.us-danger', { type: 'button', title: 'Cancel this setup and undo what it recorded creating' }, 'Cancel & undo…') : null;
    cancel?.addEventListener('click', cancelNow);
    return {
      retry,
      el: h(
        'div.sg-fail',
        { role: 'alert' },
        h('p', {}, h('b', {}, failHeadline(label))),
        h('p', {}, detail ? `${plainError(detail)}.`.replace(/\.\.$/, '.') : 'It failed.'),
        h('p', {}, 'Fix the cause (View setup details has what the command said), then Retry: the steps already done are skipped.'),
        h('div.sg-acts', {}, retry, cancel, admin ? h('small', {}, 'Cancel & undo only removes what this setup recorded creating.') : null),
        blockerBox,
      ),
    };
  };

  const readyCard = async (floor: string) => {
    readyFor = floor;
    const open = h('button.btn.primary', { type: 'button' }, '→ Open project') as HTMLButtonElement;
    open.addEventListener('click', () => go(floor));
    const studioSlot = h('span.sg-studio', {});
    const link = h('button.sg-link', { type: 'button', 'aria-expanded': String(detailsOpen), 'aria-controls': 'sg-logwrap' }, detailsOpen ? 'Hide setup details' : 'View setup details');
    link.addEventListener('click', () => showDetails(!detailsOpen));
    const skipped = job.steps.filter((s) => s.status === 'skipped').length;
    const sum = [
      `Repository ${job.plan.owner}/${job.plan.name}`,
      job.issue ? `Discovery issue #${job.issue}` : null,
      skipped ? `${skipped} step${skipped === 1 ? '' : 's'} skipped (open a step to see why)` : null,
    ].filter(Boolean);
    const big = h('div.sg-big', {});
    big.innerHTML = TICK;
    end.replaceChildren(h('div.sg-ready', { role: 'status' }, big, h('h3', {}, `${name()} is ready`), h('p.sg-sum', {}, sum.join(' · ')), h('div.sg-acts', {}, open, studioSlot), link));
    tools.classList.add('hidden');
    setTimeout(() => {
      if (!open.isConnected) return;
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // The window's own body scrolls to the card (scrollIntoView would also nudge the window itself).
      const body = end.closest<HTMLElement>('.wz-body');
      body?.scrollTo({ top: body.scrollHeight, behavior: calm ? 'auto' : 'smooth' });
      open.focus({ preventScroll: true });
    }, 60);
    if (await studioReady(floor)) {
      if (readyFor !== floor || !studioSlot.isConnected) return;
      const studio = h('a.btn', { href: projectUrl(floor) + '&open=studio', title: 'Opens the project page and asks to open its .mpr in Studio Pro on the office’s computer' }, 'Open in Studio Pro');
      studioSlot.replaceChildren(studio);
    }
  };

  const render = () => {
    const views = setupGroups(job);
    groups.update(views);
    const failedGroup = views.find((g) => g.status === 'failed');
    if (job.status === 'done') {
      titleText.textContent = `Here’s how I set up ${name()}`;
      lede.textContent = 'All five steps are done. Open any step to see what ran.';
    } else if (job.operation && job.status !== 'running') {
      titleText.textContent = 'Setup is paused';
      lede.textContent = `Office isn’t sure whether one action for ${name()} finished. Nothing after it runs until that’s settled.`;
    } else if (job.status === 'failed') {
      titleText.textContent = 'Setup stopped at one step';
      lede.textContent = `One thing needs you before ${name()} can be set up. Nothing after this step has run.`;
    } else {
      titleText.textContent = `Here’s how I’ll set up ${name()}`;
      lede.textContent = job.status === 'idle' ? 'Waiting to carry on: Retry starts it from the first step not done.' : 'Five steps, a few minutes in a real office. You can close this window: setup carries on.';
    }
    // The failure box, made once per failure so focus and the blocker stay put while it's showing.
    // An operation the office couldn't confirm takes the failure's place: Check again (and Use this existing …), never Retry.
    const op = job.status !== 'running' ? job.operation : undefined;
    const failKey = op
      ? `op:${op.op}:${op.state}:${op.provenance}:${op.text}`
      : failedGroup?.failed
        ? `${failedGroup.id}:${failedGroup.failed.id}:${failedGroup.failed.detail ?? ''}`
        : undefined;
    if (failKey !== shownFail) {
      for (const g of views) groups.slot(g.id).replaceChildren();
      if (op) {
        const at = failedGroup ?? views.find((g) => g.steps.some((s) => s.id === (op.kind === 'repo-create' ? 'repo' : 'clone'))) ?? views[0];
        const box = operationBox(op, { id: job.id, admin, changed: (j) => ((job = j), render(), job.status === 'running' && void poll()) });
        groups.slot(at.id).append(box);
        setTimeout(() => box.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }), 30);
      } else if (failedGroup?.failed) {
        const box = failBox(failedGroup.failed.label, failedGroup.failed.detail);
        groups.slot(failedGroup.id).append(box.el);
        // Said by the box's role=alert; Retry takes focus when it fails in front of you.
        if (shownFail !== undefined || first.status === 'running') setTimeout(() => box.retry.isConnected && box.retry.focus({ preventScroll: true }), 30);
      }
      shownFail = failKey;
    }
    if (job.status === 'done' && job.floor) {
      if (readyFor !== job.floor) void readyCard(job.floor);
    } else if (readyFor) {
      readyFor = undefined;
      end.replaceChildren();
      tools.classList.remove('hidden');
    }
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.textContent = job.log.join('\n');
    if (atEnd) log.scrollTop = log.scrollHeight;
    if (job.status !== 'failed') error.classList.add('hidden');
    enter.classList.toggle('hidden', !job.floor || job.status === 'running' || job.status === 'done');
    back.classList.toggle('hidden', job.status === 'running');
    idleCancel.classList.toggle('hidden', !admin || job.status !== 'idle');
  };

  const poll = async () => {
    if (stopped) return;
    try {
      job = await wizardApi.job(job.id);
      render();
    } catch {
      // A blip: try again next time.
    }
    if (job.status === 'running' && !stopped) timer = setTimeout(() => void poll(), POLL_MS);
  };

  enter.addEventListener('click', () => job.floor && go(job.floor));
  back.addEventListener('click', edit);
  idleCancel.addEventListener('click', cancelNow);

  render();
  timer = setTimeout(() => void poll(), job.status === 'running' ? POLL_MS : 0);
  return {
    el: h('div.wz-page.sg-page', {}, title, lede, groups.el, groups.live, error, end, tools, logWrap),
    actions,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
