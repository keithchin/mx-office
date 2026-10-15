// Two settings: how ▶ Resume project paces its wakes (the team settings: at most N starting at once,
// a gap apart), and ⚙️ Settings → 🔁 Restart safely: pause every project, wait until no agent is
// mid-turn, optionally build the office's new commits, then restart through a looping launcher.

import { DEFAULT_RESTART_TIMEOUT_MIN, LAUNCHER_ENV, LAUNCHER_SNIPPET, PACING_BOUNDS, type RestartView } from '../../../shared/project-run';
import { buildLabel, countdown, runningLine } from '../../../shared/build-info';
import { when } from '../version/logic';
import { h } from '../dom';
import { restartAction, restartView, runView, savePacing } from './api';

/** The team settings' "Resume pacing" rows for `floor` (admins save). */
export function pacingSection(floor: string, admin: boolean): HTMLElement {
  const num = (label: string, [min, max]: readonly [number, number]) => h('input.ro-num', { type: 'number', min, max, step: 1, disabled: !admin, 'aria-label': label }) as HTMLInputElement;
  const at = num('Agents starting at once', PACING_BOUNDS.concurrent);
  const gap = num('Seconds between wakes', PACING_BOUNDS.gapSec);
  const save = h('button.btn.small', { type: 'button', disabled: !admin }, 'Save');
  void runView(floor).then((v) => {
    if (!v) return;
    at.value = String(v.pacing.concurrent);
    gap.value = String(v.pacing.gapSec);
  });
  save.addEventListener('click', async () => {
    const p = await savePacing(floor, { concurrent: Number(at.value), gapSec: Number(gap.value) });
    if (p) ((at.value = String(p.concurrent)), (gap.value = String(p.gapSec)), (save.textContent = '✓ Saved'), setTimeout(() => (save.textContent = 'Save'), 1500));
  });
  return h(
    'div.pr-pacing',
    {},
    h('h4', {}, '▶ Resume project'),
    h('p.ro-row', {}, 'Wake at most ', at, ` agents at once (${PACING_BOUNDS.concurrent.join('–')}), `, gap, ` seconds apart (${PACING_BOUNDS.gapSec.join('–')}). `, save),
    h('p.ro-sub', {}, 'A wake counts as started once its session is up. Defaults: 2 at once, 45 seconds apart.'),
  );
}

const PHASE: Record<RestartView['phase'], string> = {
  idle: 'Not restarting.',
  pausing: 'Pausing every project…',
  waiting: 'Not restarted yet: waiting for agents to finish their turn.',
  'timed-out': 'Not restarted yet: still waiting, past the time limit.',
  building: 'Not restarted yet: building the latest version (npm run build)…',
  exiting: 'Exiting now, not restarted yet: this page reconnects when the new office is up and says which version it runs.',
  failed: 'Stopped.',
  cancelled: 'Cancelled: the projects it paused were resumed.',
};

/** What the office runs, and a newer build ready. */
function versionLine(v: RestartView): string {
  const run = v.running ? `${runningLine(v.running, when)}.` : '';
  const ready = v.ready ? ` A newer build is ready (${buildLabel(v.ready)}): restart to use it.` : '';
  return `${run}${ready}`;
}

/** "It asks what to do in 6:05", or how far past the limit it is. */
function clockLine(v: RestartView, skew: number): string {
  if (v.deadline === undefined) return '';
  const left = v.deadline - (Date.now() + skew);
  return left > 0 ? ` It asks what to do in ${countdown(left)} (limit ${v.timeoutMin} min).` : ` ${countdown(-left)} past the ${v.timeoutMin}-minute limit: it goes on by itself once nobody is busy, or choose below.`;
}

/** ⚙️ Settings → 🔁 Restart safely, made by `frame` from what goes in it, and what to call when Settings closes. */
export function restartSetting(frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  const ver = h('p.pr-version');
  const now = h('p.awake-now');
  const who = h('ul.pr-waiting.hidden');
  const noLoop = h('p.pr-noloop.hidden');
  const latest = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const timeout = h('input.ro-num', { type: 'number', min: 1, max: 120, step: 1, value: DEFAULT_RESTART_TIMEOUT_MIN, 'aria-label': 'Timeout in minutes' }) as HTMLInputElement;
  const go = h('button.btn.primary', { type: 'button' }, '🔁 Restart safely');
  const opts = h('div.pr-restart-opts', {}, h('label', {}, latest, ' Restart on the latest build (runs npm run build first)'), h('label', {}, 'Give up waiting after ', timeout, ' minutes'), go);
  const choices = h('div.seg.pr-restart-choices');
  const log = h('pre.pr-log');
  const note = h('div.setting-note');
  const section = frame([ver, now, who, noLoop, opts, choices, log, note]);
  let v: RestartView | undefined;
  let skew = 0;

  const take = (r: RestartView) => ((v = r), (skew = (r.now ?? Date.now()) - Date.now()), paint());
  const act = async (a: 'start' | 'wait' | 'anyway' | 'cancel') => {
    const r = await restartAction(a, a === 'start' ? { build: latest.checked, timeoutMin: Number(timeout.value) } : {});
    if (r) take(r);
  };
  go.addEventListener('click', () => void act('start'));
  const btn = (label: string, a: 'wait' | 'anyway' | 'cancel', cls = '') => h(`button.btn${cls}`, { type: 'button', onclick: () => void act(a) }, label);
  const paint = () => {
    if (!v) return void (now.textContent = 'Loading…');
    const busy = v.phase === 'pausing' || v.phase === 'waiting' || v.phase === 'timed-out' || v.phase === 'building' || v.phase === 'exiting';
    const waiting = v.phase === 'waiting' || v.phase === 'timed-out';
    ver.textContent = versionLine(v);
    const slept = v.slept && waiting ? ` The computer slept (or the office froze) ${when(v.slept.from)}–${when(v.slept.to)}: nothing could move then.` : '';
    now.textContent = `${PHASE[v.phase]}${waiting ? clockLine(v, skew) : ''}${slept}${v.error ? ` ${v.error}` : ''}`;
    now.classList.toggle('on', busy);
    who.replaceChildren(...(waiting ? v.waitingOn.map((w) => h('li', {}, w)) : []));
    who.classList.toggle('hidden', !waiting || !v.waitingOn.length);
    opts.classList.toggle('hidden', busy);
    go.textContent = v.loop ? '🔁 Restart safely' : '⏸ Pause, wait, then stop the office';
    noLoop.textContent = v.loop ? '' : `This office can’t restart by itself: it wasn’t started by a launcher with the restart loop (${LAUNCHER_ENV}=1). The button pauses every project, waits, and stops the office; then start it again by hand with start-office.ps1.`;
    noLoop.classList.toggle('hidden', v.loop);
    go.toggleAttribute('disabled', !v.admin);
    latest.disabled = !v.newCommits || !v.admin;
    if (!v.newCommits) latest.checked = false;
    const anyway = `${v.loop ? 'Restart' : 'Stop'} anyway${v.waitingOn.length ? ` (interrupts ${v.waitingOn.length})` : ''}`;
    // Only admins choose (the office refuses anyone else too).
    choices.replaceChildren(
      ...(!v.admin ? [] : v.phase === 'timed-out' ? [btn('Keep waiting', 'wait'), btn(anyway, 'anyway', '.danger'), btn('Cancel', 'cancel')] : v.phase === 'waiting' ? [btn(anyway, 'anyway', '.danger'), btn('Cancel', 'cancel')] : v.phase === 'failed' ? [btn('Cancel', 'cancel')] : []),
    );
    log.textContent = v.log ?? '';
    log.classList.toggle('hidden', !v.log);
    note.replaceChildren(
      h('p', {}, 'Pauses every project (agents finish their turn, hand off and sleep; one asking you something is left as it is), waits until no agent is mid-turn, then restarts the office. The projects it paused are resumed when it’s back; a project you paused yourself stays paused. It says it restarted only once the new office answers, with the version it runs.'),
      v.loop
        ? h('p', {}, '✓ Started by a launcher that restarts it (exit code 75).')
        : h('div', {}, h('p', {}, h('strong', {}, 'start-office.ps1 needs the restart loop. '), 'Without it this only pauses, waits and exits; start the office again by hand. A launcher that loops:'), h('pre.pr-log', {}, LAUNCHER_SNIPPET)),
      v.admin ? '' : h('p', {}, 'Admins can restart the office.'),
    );
  };
  const load = async () => {
    const r = await restartView();
    if (r) take(r);
  };
  paint();
  void load();
  const timer = setInterval(() => void load(), 2_000);
  // The countdown moves every second between looks.
  const clock = setInterval(() => v?.deadline !== undefined && paint(), 1_000);
  return {
    section,
    off: () => {
      clearInterval(timer);
      clearInterval(clock);
    },
  };
}
