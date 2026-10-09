// ⚙️ Settings › Workers, for the whole office: the worker everyone starts on, how many run at once,
// keeping the computer awake, restarting safely, whether merged workers go home, and the prompts the
// office writes. Admins change them; everyone sees them. No three.js here: the flat Settings page uses it.

import { store } from '../../state';
import { h, timeAgo } from '../dom';
import { agentFields, choiceLabel, officeChoice } from '../provider';
import { openPromptEditor, rewrittenPrompts } from '../prompts';
import { keepAwakeSetting } from '../settings-awake';
import { restartSetting } from '../project-run';
import { framed, setting, together, type Built, type SettingsDeps } from './kit';

/** The worker everyone starts on, unless whoever starts one picks another. Admins pick it. */
export function defaultWorkerSetting({ net }: SettingsDeps): Built {
  const agent = agentFields(store.project, 'office-agent', officeChoice(store.project));
  let touched = false;
  agent.element.addEventListener('change', () => (touched = true));
  agent.element.addEventListener('input', () => (touched = true));
  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const back = h('button.btn', { type: 'button' });
  const actions = h('div.seg', { style: 'margin-top:8px' }, save, back);
  const now = h('p.outside-now');
  const note = h('p.setting-note');
  const paint = () => {
    const admin = store.me.admin;
    const picked = store.prompts.agent;
    const choice = officeChoice(store.project);
    agent.element.classList.toggle('hidden', !admin);
    actions.classList.toggle('hidden', !admin);
    now.classList.toggle('hidden', admin);
    now.textContent = choiceLabel(choice);
    back.classList.toggle('hidden', !picked);
    back.textContent = `Back to ${store.project?.agentCmd.split(' ')[0].split(/[\\/]/).pop() ?? 'the --agent'}`;
    if (!touched) agent.set(choice);
    note.textContent =
      'Every worker starts on this: hired at a desk, handed an issue or a pull request from the boards, taken off the queue, the board agents and meetings. Where you start one, ✏️ Edit picks another just for it.' +
      (picked ? ` Set by ${picked.by} ${timeAgo(picked.at)}.` : ' It’s the agent the office was started with, on its own default model.') +
      (admin ? '' : ' Admins can change it.');
  };
  paint();
  save.addEventListener('click', () => {
    if (!agent.valid()) return;
    touched = false;
    net.send({ t: 'prompts.agent', choice: agent.choice() });
  });
  back.addEventListener('click', () => {
    touched = false;
    net.send({ t: 'prompts.agent', choice: null });
  });
  const offs = [store.on('prompts', paint), store.on('me', paint), store.on('project', paint)];
  return { nodes: [setting('Default worker', 'office', now, agent.element, actions, note)], off: () => offs.forEach((off) => off()) };
}

/** The prompts the office writes for workers by itself, for the whole office. Admins rewrite them. */
export function promptsSetting({ net }: SettingsDeps): Built {
  const open = h('button.btn', { type: 'button', onclick: () => openPromptEditor(net) });
  const note = h('p.setting-note');
  const paint = () => {
    const n = rewrittenPrompts();
    open.textContent = store.me.admin ? '📝 Edit the prompts…' : '📝 Read the prompts…';
    note.textContent =
      'What 🤖 Hand to a worker, 🔍 Review and the boards’ other buttons tell a worker, the note the queue adds to a task, the board agents’ briefs, the meeting room’s parts and the sign writer’s instructions. ' +
      (n ? `${n} of them rewritten.` : 'All as the office wrote them.') +
      (store.me.admin ? '' : ' Admins can rewrite them.');
  };
  paint();
  const offs = [store.on('prompts', paint), store.on('me', paint)];
  return { nodes: [setting('Prompts', 'office', open, note)], off: () => offs.forEach((off) => off()) };
}

/** The most workers the office runs at once, across every floor. Admins set it. */
export function limitSetting({ net }: SettingsDeps): Built {
  const input = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Most workers at once', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const save = h('button.btn.primary', { type: 'button' }, 'Set limit');
  const clear = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'machine.limit', limit: null }) });
  const row = h('div.webhook', {}, input, save, clear);
  const note = h('p.setting-note');
  const paint = () => {
    const m = store.machine;
    const admin = store.me.admin;
    row.classList.toggle('hidden', !admin);
    input.placeholder = m.ceiling ? `1 to ${m.ceiling}` : 'e.g. 6';
    clear.textContent = m.ceiling ? `Back to ${m.ceiling}` : 'No limit';
    clear.classList.toggle('hidden', !m.set);
    const now =
      m.limit === undefined
        ? `No limit: the office hires a worker for every free seat. ${m.workers} ${m.workers === 1 ? 'is' : 'are'} here now, across every floor.`
        : `At most ${m.limit} worker${m.limit === 1 ? '' : 's'} at once, across every floor (${m.workers} now), shells and board agents too. Hiring past that is refused.`;
    const from = m.set ? ` Set by ${m.set.by} ${timeAgo(m.set.at)}.` : '';
    const cap = m.ceiling ? ` The office was started with --max-workers ${m.ceiling}, so it can't go any higher.` : '';
    note.textContent = now + from + cap + (admin ? '' : ' Admins can change it.');
  };
  paint();
  const send = () => {
    const n = Number(input.value.trim());
    if (!input.value.trim() || !Number.isInteger(n) || n < 1) return input.focus();
    net.send({ t: 'machine.limit', limit: n });
    input.value = '';
  };
  save.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
  const offs = [store.on('machine', paint), store.on('me', paint)];
  return { nodes: [setting('Worker limit', 'office', row, note)], off: () => offs.forEach((off) => off()) };
}

/** Whether a worker whose pull request merged goes home by itself, for everyone. */
export function leaveOnMergeSetting({ net }: SettingsDeps): Built {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': 'Agents whose pull request merged' });
  const note = h('p.setting-note');
  const paint = () => {
    const { on, by, at } = store.leaveOnMerge;
    row.replaceChildren(
      ...(
        [
          [true, '🏠 Go home by themselves'],
          [false, '🪑 Stay until sent home'],
        ] as const
      ).map(([value, label]) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(on === value), class: on === value ? 'on' : '', onclick: () => store.leaveOnMerge.on !== value && net.send({ t: 'leaveOnMerge.set', on: value }) }, label)),
    );
    const now = on
      ? 'Once a worker’s pull request merges, it goes home as soon as it isn’t working or waiting on you and nobody has its terminal open, and its worktree and branch are deleted. A worktree with uncommitted changes, or commits that aren’t on GitHub, is kept.'
      : 'A worker whose pull request merged stays at its desk, outlined in purple, until someone sends it home. Turned on, the ones already merged go too.';
    note.textContent = `${now} It’s the same for everyone in the building${by ? `, set by ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paint();
  return { nodes: [setting('Agents whose pull request merged', 'office', row, note)], off: store.on('leaveOnMerge', paint) };
}

/** Keep awake while agents work (settings-awake.ts), fetched from the office. */
export function keepAwakeBuilt(): Built {
  const a = keepAwakeSetting(framed('Keep awake while agents work', 'office'));
  a.section.id = 'settings-keep-awake';
  return { nodes: [a.section], off: a.off };
}

/** 🔁 Restart safely (ui/project-run/settings.ts), admins. */
export function restartBuilt(): Built {
  const r = restartSetting(framed('🔁 Restart safely', 'office'));
  r.section.id = 'settings-restart';
  return { nodes: [r.section], off: r.off };
}

/** Everything under Workers, in the 3D window's order. */
export const workersSettings = (d: SettingsDeps): Built => together(defaultWorkerSetting(d), limitSetting(d), keepAwakeBuilt(), restartBuilt(), leaveOnMergeSetting(d), promptsSetting(d));
