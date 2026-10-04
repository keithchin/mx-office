// A project's setup as it runs: each step with how it went, the log of what the commands said, and
// Retry when a step failed. It polls the office while the setup is running and stops once it ends.
import type { JobView, StepStatus } from '../../../shared/wizard';
import { h } from '../dom';
import { wizardApi } from './api';

const ICON: Record<StepStatus, string> = { pending: '○', running: '⏳', done: '✅', skipped: '↷', failed: '❌' };
const POLL_MS = 1200;

export interface ProgressView {
  el: HTMLElement;
  /** The buttons for the window's footer. */
  actions: HTMLElement;
  stop(): void;
}

export function progressView(first: JobView, go: (floor: string) => void, edit: () => void): ProgressView {
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
  const actions = h('span.wz-actions', {}, back, retry, enter);

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
      render();
      void poll();
    } catch (err) {
      error.classList.remove('hidden');
      error.textContent = `❌ ${(err as Error).message}`;
    } finally {
      retry.disabled = false;
    }
  });
  enter.addEventListener('click', () => job.floor && go(job.floor));
  back.addEventListener('click', edit);

  render();
  timer = setTimeout(() => void poll(), job.status === 'running' ? POLL_MS : 0);
  return {
    el: h('div.wz-page.wz-progress', {}, title, steps, error, h('h3.wz-h', {}, 'Log'), log),
    actions,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
