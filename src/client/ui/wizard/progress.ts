// A project's setup as it runs: each step with how it went, the log of what the commands said, and
// Retry when a step failed (which first says what would stop it, a paused project with Resume), and
// Cancel & undo for admins. It polls the office while the setup is running and stops once it ends.
import type { JobView, StepStatus } from '../../../shared/wizard';
import type { SetupBlocker } from '../../../shared/setup-cancel';
import { h, toast } from '../dom';
import { startResume } from '../project-run/api';
import { wizardApi, type CallError } from './api';
import { openCancelDialog } from './cancel';

const ICON: Record<StepStatus, string> = { pending: '○', running: '⏳', done: '✅', skipped: '↷', failed: '❌' };
const POLL_MS = 1200;

export interface ProgressView {
  el: HTMLElement;
  /** The buttons for the window's footer. */
  actions: HTMLElement;
  stop(): void;
}

export function progressView(first: JobView, go: (floor: string) => void, admin: boolean, edit: () => void): ProgressView {
  let job = first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const title = h('h3.wz-h', {});
  const steps = h('ol.wz-steps', {});
  const log = h('pre.wz-log', { 'aria-label': 'Setup log', tabindex: '0' });
  const error = h('p.wz-warn.hidden', {});
  const retry = h('button.btn.primary', { type: 'button' }, '🔁 Retry from the failed step');
  const enter = h('button.btn.primary', { type: 'button' }, '🗂️ Go to the floor');
  const back = h('button.btn', { type: 'button' }, '✏️ Edit answers');
  const cancel = h('button.btn.us-danger', { type: 'button', title: 'Cancel this setup and undo what it did (the project off the office; the folder and the repository when ticked)' }, 'Cancel & undo…');
  const actions = h('span.wz-actions', {}, back, cancel, retry, enter);
  const blockerBox = h('div.us-blocker.hidden', { role: 'status' });
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

  const render = () => {
    const failed = job.steps.find((s) => s.status === 'failed');
    title.textContent = job.status === 'done' ? `✨ ${job.plan.name} is set up` : job.status === 'failed' ? `Stopped at: ${failed?.label ?? 'a step'}` : `Setting up ${job.plan.owner}/${job.plan.name}…`;
    steps.replaceChildren(
      ...job.steps.map((s) =>
        h('li', { class: `wz-step ${s.status}` }, h('span.wz-step-icon', { 'aria-hidden': 'true' }, ICON[s.status]), h('span.wz-step-label', {}, s.label), s.detail ? h('small', {}, s.detail) : null),
      ),
    );
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.textContent = job.log.join('\n');
    if (atEnd) log.scrollTop = log.scrollHeight;
    error.classList.toggle('hidden', !failed);
    error.textContent = failed ? `❌ ${failed.detail ?? 'It failed'}. Fix the cause (the log above says what the command said), then Retry: the steps already done are skipped.` : '';
    retry.classList.toggle('hidden', job.status !== 'failed');
    cancel.classList.toggle('hidden', !admin || job.status === 'running' || job.status === 'done');
    enter.classList.toggle('hidden', !job.floor || job.status === 'running');
    back.classList.toggle('hidden', job.status === 'running');
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

  retry.addEventListener('click', async () => {
    retry.disabled = true;
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
      retry.disabled = false;
    }
  });
  enter.addEventListener('click', () => job.floor && go(job.floor));
  back.addEventListener('click', edit);
  cancel.addEventListener('click', () => openCancelDialog(job.id, `${job.plan.owner}/${job.plan.name}`, {
      done: () =>
        void wizardApi.job(job.id).then((j) => ((job = j), render()), () => {
          // Gone: the setup was cancelled and undone.
          stopped = true;
          title.textContent = `${job.plan.owner}/${job.plan.name}: cancelled and undone`;
          actions.replaceChildren();
        }),
    }));

  render();
  timer = setTimeout(() => void poll(), job.status === 'running' ? POLL_MS : 0);
  return {
    el: h('div.wz-page.wz-progress', {}, title, steps, error, blockerBox, h('h3.wz-h', {}, 'Log'), log),
    actions,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
