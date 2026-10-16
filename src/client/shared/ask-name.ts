// "Who is it?": your name, the first time this browser comes in on the shared password. The page's
// loading screen (#ao-boot, ui/loading/boot.ts) sits above everything, so while the page waits on the
// person it steps aside (bootWait): the prompt is seen, focused and typed into, Enter sends it, and the
// screen comes back for the rest of the load. It sat on top of the prompt at 40 % for good on a first
// visit (a fresh browser profile, 16 Oct 2026).
import { h, openModal } from '../ui/dom';
import { bootWait } from '../ui/loading/boot';

export function askName(done: (name: string) => void) {
  const input = h('input', { type: 'text', maxlength: 24, placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'nickname' }) as HTMLInputElement;
  const form = h(
    'form.modal.lite-name',
    { 'aria-label': 'Who is it?' },
    h('header', {}, h('h2', {}, '👋 Who is it?')),
    h('div.body', {}, h('p', {}, 'Your teammates see this name on what you type and send.'), input),
    h('footer', {}, h('button.btn.primary', { type: 'submit' }, 'Come on in')),
  );
  bootWait(true);
  const modal = openModal(form, { escCloses: false, backdropCloses: false });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return input.focus();
    modal.close();
    bootWait(false);
    done(name);
  });
  input.focus();
  setTimeout(() => input.focus(), 30);
}
