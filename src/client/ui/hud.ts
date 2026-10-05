import './hud.css';
import { h, openModal } from './dom';
import { HELP_ROWS } from './help';

export function openHelp() {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Controls' },
    h('header', {}, h('h2', {}, '🎮 Controls'), close),
    h('div.body', {}, h('div.help-grid', {}, ...HELP_ROWS.flatMap(([k, v]) => [h('span.key', {}, k), h('span', {}, v)])), h('p.help-docs', {}, h('a', { href: '/docs/reference/keyboard-shortcuts', target: '_blank', rel: 'noopener' }, '📖 Every shortcut, and the full documentation →'))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
}
