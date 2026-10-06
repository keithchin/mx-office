// ▶ Resume project's preview and ⏸ Pause project's confirm, each turning into the run's progress once
// it starts (polled; hold and cancel mid-way). Every window has the ✕ and Esc of openModal.

import { agentKey, chosen, estimateLine, type AgentPreview, type ResumeAction, type ResumeChoice, type ResumePreview, type RunAgent, type RunProgress } from '../../../shared/project-run';
import { h, openModal, toast } from '../dom';
import { runAction, runPreview, runView, startPause, startResume } from './api';

const ACTION_LABEL: Record<ResumeAction, string> = { wake: '▶ Wake', rehire: '🔁 Re-hire from handoff', 'send-home': '🏠 Send home', skip: '💤 Leave asleep' };
const STATUS: Record<RunAgent['status'], string> = {
  pending: '⏳ Waiting its turn',
  starting: '🚀 Starting…',
  woken: '✅ Back at work',
  finishing: '⌛ Finishing its turn',
  handoff: '📝 Writing its handoff',
  asleep: '💤 Asleep',
  'waiting-on-you': '🙋 Waiting on you in its terminal',
  skipped: '⏭️ Skipped',
  failed: '⚠️ Couldn’t',
  'sent-home': '🏠 Sent home',
};
const OVER = new Set(['done', 'failed', 'cancelled']);

/** The run's agents, one line each. */
function progressList(r: RunProgress): HTMLElement {
  return h(
    'ol.pr-progress',
    {},
    ...r.agents.map((a) => h('li', { class: `pr-${a.status}` }, h('b', {}, a.name), h('span', {}, STATUS[a.status]), a.note ? h('small', {}, a.note) : null)),
  );
}

/** Turns `body` and `footer` into the floor's latest run, polled until it's over. Returns what stops the polling. */
function showProgress(floor: string, body: HTMLElement, footer: HTMLElement, onDone?: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const hold = h('button.btn', { type: 'button' }, '⏸ Hold');
  const cancel = h('button.btn', { type: 'button' }, '✕ Cancel run');
  const carry = h('button.btn.primary', { type: 'button' }, '▶ Carry on');
  hold.addEventListener('click', () => void runAction(floor, 'hold').then(look));
  cancel.addEventListener('click', () => void runAction(floor, 'cancel').then(look));
  carry.addEventListener('click', () => void runAction(floor, 'continue').then(look));
  async function look() {
    const v = await runView(floor);
    if (stopped) return;
    const r = v?.run;
    if (!r) return;
    const over = OVER.has(r.status);
    const n = (s: RunAgent['status']) => r.agents.filter((a) => a.status === s).length;
    const head = r.kind === 'resume' ? `▶ Resuming: ${n('woken')} of ${r.agents.length} back at work` : `⏸ Pausing: ${n('asleep')} of ${r.agents.length} asleep${n('waiting-on-you') ? `, ${n('waiting-on-you')} waiting on you` : ''}`;
    body.replaceChildren(h('p.pr-head', {}, over ? `${head} · ${r.status === 'done' ? 'finished' : r.status}` : `${head} · ${r.status}`), r.agents.length ? progressList(r) : h('p.pr-dim', {}, 'Nobody to do.'));
    footer.replaceChildren(...(over ? [] : r.status === 'paused' || r.status === 'interrupted' ? [cancel, carry] : [hold, cancel]));
    if (over) onDone?.();
    else timer = setTimeout(() => void look(), 1500);
  }
  void look();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function agentRow(a: AgentPreview, pick: HTMLSelectElement): HTMLElement {
  return h(
    'li.pr-agent',
    { class: a.reasons.length ? 'has-work' : '' },
    h('div.pr-agent-top', {}, h('b', {}, a.name), h('span.pr-title', {}, `${a.title}${a.state === 'benched' ? ' · benched' : ''}`), pick),
    a.reasons.length ? h('ul.pr-reasons', {}, ...a.reasons.map((r) => h('li', { class: `pr-r-${r.kind}` }, r.text))) : h('p.pr-dim', {}, 'Nothing to do: stays asleep'),
    a.checks.length ? h('ul.pr-checks', {}, ...a.checks.map((c) => h('li', { class: `pr-c-${c.kind}` }, `⚠️ ${c.text}`))) : null,
  );
}

/** ▶ Resume project: the preview, then the run. */
export async function openResume(floor: string, after?: () => void) {
  const body = h('div.body.pr-body', {}, h('p.pr-dim', {}, 'Looking at who has work waiting…'));
  const footer = h('footer');
  const el = h('div.modal.pr-modal', { role: 'dialog', 'aria-label': 'Resume project' }, h('header', {}, h('h2', {}, '▶ Resume project')), body, footer);
  let stop: (() => void) | undefined;
  const modal = openModal(el, { doing: 'resuming the project', onClose: () => (stop?.(), after?.()) });
  const p = await runPreview(floor);
  if (!p) return modal.close();
  el.querySelector('h2')!.textContent = `▶ Resume ${p.floorName}`;
  draw(p);

  function draw(p: ResumePreview) {
    const picks = new Map<string, HTMLSelectElement>();
    const choice: ResumeChoice = { mode: 'work' };
    const estimate = h('p.pr-estimate');
    const go = h('button.btn.primary', { type: 'button' }, '▶ Resume');
    const update = () => {
      const c: ResumeChoice = { mode: 'pick', picks: Object.fromEntries([...picks].map(([k, s]) => [k, s.value as ResumeAction])) };
      const n = chosen(p, c).filter((x) => x.action !== 'send-home').length;
      const home = chosen(p, c).filter((x) => x.action === 'send-home').length;
      estimate.textContent = `${estimateLine(n)}${home ? ` · sends ${home} home` : ''} · ${p.pacing.concurrent} at a time, ${p.pacing.gapSec} s apart`;
      go.toggleAttribute('disabled', !!p.blocked || !(n + home));
    };
    const preset = (mode: ResumeChoice['mode']) => {
      choice.mode = mode;
      const set = new Map(chosen(p, { mode }).map((x) => [agentKey(x.agent), x.action]));
      for (const a of p.agents) picks.get(agentKey(a))!.value = mode === 'pick' ? picks.get(agentKey(a))!.value : (set.get(agentKey(a)) ?? 'skip');
      update();
    };
    const withWork = p.agents.filter((a) => a.action !== 'skip').length;
    const modes = h(
      'div.seg.pr-modes',
      { role: 'radiogroup', 'aria-label': 'Who to wake' },
      ...(
        [
          ['work', `Those with work (${withWork})`],
          ['all', `All asleep (${p.agents.length})`],
          ['pick', 'Pick agents'],
        ] as const
      ).map(([m, label]) => {
        const b = h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(m === 'work'), class: m === 'work' ? 'on' : '' }, label);
        b.addEventListener('click', () => {
          modes.querySelectorAll('button').forEach((x) => (x.classList.toggle('on', x === b), x.setAttribute('aria-checked', String(x === b))));
          preset(m);
        });
        return b;
      }),
    );
    const rows = p.agents.map((a) => {
      const s = h('select.pr-pick', { 'aria-label': `What to do with ${a.name}` }, ...a.options.map((o) => h('option', { value: o }, ACTION_LABEL[o]))) as HTMLSelectElement;
      s.value = a.action;
      s.addEventListener('change', () => {
        choice.mode = 'pick';
        modes.querySelectorAll('button').forEach((x, i) => (x.classList.toggle('on', i === 2), x.setAttribute('aria-checked', String(i === 2))));
        update();
      });
      picks.set(agentKey(a), s);
      return agentRow(a, s);
    });
    body.replaceChildren(
      p.blocked ? h('p.pr-blocked', { role: 'alert' }, `⛔ ${p.blocked}`) : '',
      ...p.warnings.map((w) => h('p.pr-warn', {}, `⚠️ ${w}`)),
      p.agents.length ? modes : '',
      p.agents.length ? h('ol.pr-agents', {}, ...rows) : h('p.pr-dim', {}, 'Nobody on this floor is asleep.'),
      p.awake.length ? h('p.pr-dim', {}, `Already awake, left as they are: ${p.awake.join(', ')}`) : '',
      h('p.pr-dim', {}, 'Each is woken with a short brief (what happened while it slept, its open escalations, its branch state, what it’s owed) as your turn. The Coordinator goes first, then the Leads that block the most.'),
      estimate,
    );
    const cancel = h('button.btn', { type: 'button' }, 'Not now');
    cancel.addEventListener('click', () => modal.close());
    footer.replaceChildren(cancel, go);
    go.addEventListener('click', async () => {
      go.setAttribute('disabled', '');
      const c: ResumeChoice = { mode: 'pick', picks: Object.fromEntries([...picks].map(([k, s]) => [k, s.value as ResumeAction])) };
      const r = await startResume(floor, c);
      if (!r) return go.removeAttribute('disabled');
      toast(`▶ Resuming ${p.floorName}`);
      stop = showProgress(floor, body, footer);
    });
    update();
  }
}

/** ⏸ Pause project: what it does, then the run. `awake`: the agents it'd wind down (the page's own list). */
export function openPause(floor: string, name: string, awake: string[], after?: () => void) {
  const go = h('button.btn.primary', { type: 'button' }, '⏸ Pause project');
  const no = h('button.btn', { type: 'button' }, 'Not now');
  const body = h(
    'div.body.pr-body',
    {},
    h('p', {}, 'Every agent on this floor finishes the turn it’s on (never interrupted), writes a short handoff note, and goes to sleep with its session kept, so ▶ Resume project carries it on.'),
    h('p', {}, 'One waiting on a question in its terminal is left alone and listed as waiting on you: nothing is typed into it.'),
    h('p', {}, 'While it’s paused the office sends this floor’s agents nothing of its own (nudges, standups, relays, review nudges, Firm interviews). What you send still goes through and wakes just that agent.'),
    awake.length ? h('p.pr-dim', {}, `Awake now: ${awake.join(', ')}`) : h('p.pr-dim', {}, 'Nobody is awake: it only holds the office’s prompts.'),
    h('p.pr-dim', {}, 'It’s the clean way to stop before a restart, a release or a migration.'),
  );
  const footer = h('footer', {}, no, go);
  const el = h('div.modal.pr-modal', { role: 'dialog', 'aria-label': 'Pause project' }, h('header', {}, h('h2', {}, `⏸ Pause ${name}`)), body, footer);
  let stop: (() => void) | undefined;
  const modal = openModal(el, { doing: 'pausing the project', onClose: () => (stop?.(), after?.()) });
  no.addEventListener('click', () => modal.close());
  go.addEventListener('click', async () => {
    go.setAttribute('disabled', '');
    const r = await startPause(floor);
    if (!r) return go.removeAttribute('disabled');
    toast(`⏸ Pausing ${name}`);
    stop = showProgress(floor, body, footer);
  });
  setTimeout(() => go.focus(), 30);
}

/** The floor's run in a window of its own (the progress chip). */
export function openProgress(floor: string, title: string) {
  const body = h('div.body.pr-body');
  const footer = h('footer');
  const el = h('div.modal.pr-modal', { role: 'dialog', 'aria-label': title }, h('header', {}, h('h2', {}, title)), body, footer);
  let stop: (() => void) | undefined;
  openModal(el, { onClose: () => stop?.() });
  stop = showProgress(floor, body, footer);
}
