// "Open Chat view" from the team phone: a worker's conversation as the Command Center console's Chat
// view shows it (ui/pm/chat/, read off its transcript by server/convo/), in a window of its own with a
// ✕ and Esc. It watches the worker while open; the console's own watch (the Coordinator) is left alone.

import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { ChatView } from '../pm/chat/view';
import '../pm/console.css';

export function openChatWindow(net: Net, workerId: string, openTerminal: (id: string) => void, keepWatching: boolean) {
  const w = store.workers.get(workerId);
  if (!w) return;
  const view = new ChatView({ openTerminal: () => (modal.close(), openTerminal(workerId)), lines: () => [] });
  const draw = () => {
    const now = store.workers.get(workerId);
    view.show({ workerId, who: { name: now?.name ?? w.name, icon: '🤖', color: now?.color }, status: now?.status, activity: now?.activity, convo: store.convo.get(workerId) });
  };
  const body = h('div.body.tp-chatwin-body.pmc', {}, view.el);
  const modal = openModal(
    h('div.modal.tp-chatwin', { role: 'dialog', 'aria-label': `${w.name}: Chat view` }, h('header', {}, h('h2', {}, `💬 ${w.name}`), h('button.btn.small', { type: 'button', onclick: () => (modal.close(), openTerminal(workerId)) }, 'Open terminal')), body),
    {
      onClose: () => {
        offConvo();
        offWorkers();
        if (!keepWatching) net.send({ t: 'convo.unwatch', workerId });
      },
    },
  );
  const offConvo = store.on('convo', draw);
  const offWorkers = store.on('workers', draw);
  net.send({ t: 'convo.watch', workerId });
  draw();
}
