// An agent's terminal on the phone, read-only: its conversation as the Command Center's Chat view shows it
// (ui/pm/chat/, read off its transcript by server/convo/). Nothing typed on the phone goes into a
// terminal: answering an agent is a message (its DM) or an escalation's buttons. ✕ or Esc closes.

import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, toast } from '../ui/dom';
import { ChatView } from '../ui/pm/chat/view';
import '../ui/pm/console.css';

export function openReadOnlyChat(net: Net, workerId: string, dm: (id: string) => void) {
  const w = store.workers.get(workerId);
  if (!w) return void toast('That agent isn’t on this floor', 'warn');
  const view = new ChatView({ openTerminal: () => toast('The terminal is read-only on the phone: send the agent a message instead'), lines: () => [] });
  const draw = () => {
    const now = store.workers.get(workerId);
    view.show({ workerId, who: { name: now?.name ?? w.name, icon: '🤖', color: now?.color }, status: now?.status, activity: now?.activity, convo: store.convo.get(workerId) });
  };
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const modal = openModal(
    h(
      'div.modal.m-sheet.m-chat',
      { role: 'dialog', 'aria-label': `${w.name}: terminal, read-only` },
      h('header', {}, h('h2', {}, `🖥️ ${w.name}`), h('span.m-chip', {}, 'read-only'), close),
      h('div.body.pmc', {}, view.el),
      h('footer', {}, h('button.btn.primary', { type: 'button', onclick: () => (modal.close(), dm(workerId)) }, `💬 Message ${w.name}`)),
    ),
    {
      doing: '📱 reading a terminal',
      reading: true,
      onClose: () => {
        offConvo();
        offWorkers();
        net.send({ t: 'convo.unwatch', workerId });
      },
    },
  );
  close.addEventListener('click', () => modal.close());
  const offConvo = store.on('convo', draw);
  const offWorkers = store.on('workers', draw);
  net.send({ t: 'convo.watch', workerId });
  draw();
}
