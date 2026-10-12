// The Chief Analyst's side of the New project plan: who it is and what it's doing, the Interview style
// (Steering, Assist, Auto: the toolkit's interview-mode.sh modes, written to PROJECT.md), the conversation,
// and a box to message it. A message is a planning call: it answers in a few sentences and updates the
// brief, and what it changed is highlighted there. On a phone it's a bottom sheet over the brief.
import { INTERVIEW_MODE_INFO, INTERVIEW_MODES, type InterviewMode } from '../../../../shared/wizard';
import type { DraftView } from '../../../../shared/brief';
import { h, toast } from '../../dom';
import { briefApi } from './api';
import { caAvatar, icon } from './parts';
import type { Flow } from './index';

const STYLE_WORD: Record<InterviewMode, string> = { steering: 'Steering', assist: 'Assist', auto: 'Auto' };
const BUSY: Record<NonNullable<DraftView['busy']>, string> = { brief: 'Drafting the brief…', chat: 'Updating the brief…', domains: 'Mapping functional domains…' };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w][0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

export function chatPanel(flow: Flow) {
  const sub = h('div.nw-chat-s', {}, 'Planning this project with you');
  const toggle = h('button.nw-iconbtn.nw-sheet-toggle', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'nw-chat', 'aria-label': 'Open the chat' }, icon('chev'));
  const head = h('div.nw-chat-h', {}, caAvatar(), h('div.nw-grow', {}, h('div.nw-chat-t', {}, 'Chief Analyst'), sub), toggle);
  const seg = INTERVIEW_MODES.map((m) => h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-style': m }, STYLE_WORD[m]));
  const why = h('p.nw-why', {});
  const styleBox = h('div.nw-style', {}, h('span.nw-lbl', { id: 'nw-style-l' }, 'Interview style'), h('div.nw-seg', { role: 'radiogroup', 'aria-labelledby': 'nw-style-l' }, ...seg), why);
  const msgs = h('div.nw-msgs', { 'aria-live': 'polite' });
  const input = h('textarea', { id: 'nw-chat-in', rows: 2, placeholder: 'Ask or tell the Chief Analyst…' }) as HTMLTextAreaElement;
  const send = h('button.nw-send', { type: 'submit', 'aria-label': 'Send', disabled: true }, icon('send')) as HTMLButtonElement;
  const hint = h('span.nw-grow', {}, 'Enter to send · Shift+Enter for a new line');
  const composer = h('form.nw-composer', {}, h('label.nw-sr', { for: 'nw-chat-in' }, 'Message the Chief Analyst'), input, h('div.nw-cbar', {}, hint, send));
  const el = h('aside.nw-chat', { id: 'nw-chat', 'aria-label': 'Chief Analyst chat' }, head, styleBox, msgs, composer);
  let drawn = -1;
  let busyDrawn: string | undefined;

  const setStyle = (m: InterviewMode) => {
    seg.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === m)));
    const info = INTERVIEW_MODE_INFO[m];
    why.textContent = `${info.does[0].toUpperCase()}${info.does.slice(1)}.`;
    flow.plan.interview = m;
  };
  seg.forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.style as InterviewMode;
      setStyle(m);
      if (flow.draft) void briefApi.update(flow.draft.id, { interview: m }).then((d) => flow.setDraft(d), () => undefined);
    }),
  );

  const openSheet = (open: boolean) => {
    el.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close the chat' : 'Open the chat');
  };
  head.addEventListener('click', (e) => {
    if (!matchMedia('(max-width: 760px)').matches) return;
    e.stopPropagation();
    openSheet(!el.classList.contains('open'));
  });

  const canSend = () => !!flow.draft?.brief && !flow.draft.busy && !flow.draft.manual && flow.status.available;
  const sync = () => (send.disabled = !input.value.trim() || !canSend());
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), composer.requestSubmit());
  });
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !flow.draft || !canSend()) return;
    input.value = '';
    sync();
    try {
      flow.setDraft(await briefApi.chat(flow.draft.id, text));
    } catch (err) {
      input.value = text;
      sync();
      toast((err as Error).message, 'warn');
    }
  });

  const avatarYou = () => h('span.nw-av', {}, initials(flow.me));

  function update() {
    const d = flow.draft;
    if (!d) return;
    setStyle(d.interview);
    if (d.chat.length !== drawn) {
      for (const m of d.chat.slice(Math.max(0, drawn))) {
        const who = m.who === 'you' ? h('div.nw-who', {}, avatarYou(), 'You') : h('div.nw-who', {}, caAvatar(true), 'Chief Analyst');
        const files = m.files?.length ? h('div.nw-chips', {}, ...m.files.map((f) => h('span.nw-chip', {}, icon('file'), h('span.nw-fn', {}, f)))) : null;
        const changed = m.changed?.length ? h('div.nw-pill.done', {}, icon('check'), `${m.changed.length} item${m.changed.length === 1 ? '' : 's'} changed in the brief`) : null;
        msgs.append(h(`div.nw-msg${m.who === 'you' ? '.me' : ''}`, {}, who, h('div.nw-body', {}, m.text.length > 400 && m.who === 'you' ? `${m.text.slice(0, 400)}…` : m.text), files, changed));
      }
      drawn = d.chat.length;
      msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
    }
    // What it's doing now: a typing indicator and a status pill, as the mockup shows.
    const busy = d.busy ? BUSY[d.busy] : d.status === 'drafting' ? BUSY.brief : undefined;
    if (busy !== busyDrawn) {
      msgs.querySelector('.nw-working')?.remove();
      if (busy) {
        msgs.append(h('div.nw-msg.nw-working', {}, h('div.nw-who', {}, caAvatar(true), 'Chief Analyst'), h('div.nw-typing', { 'aria-label': 'Chief Analyst is working' }, h('i'), h('i'), h('i')), h('div.nw-pill', { role: 'status' }, h('span.nw-spin', { 'aria-hidden': 'true' }), busy)));
        msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
        flow.say(busy);
      }
      busyDrawn = busy;
    }
    sub.textContent = busy ?? (d.manual ? 'Not drafting: you’re filling in the brief yourself' : d.approved ? 'Scope approved' : 'Planning this project with you');
    const off = d.manual ? 'You’re filling in the brief yourself, so the Chief Analyst isn’t drafting here. It starts from your brief in Discovery.' : !flow.status.available ? `The Chief Analyst can’t answer right now: ${flow.status.why}.` : '';
    input.disabled = !!off || !d.brief;
    input.placeholder = off || 'Ask or tell the Chief Analyst…';
    hint.textContent = off ? '' : `Enter to send · Shift+Enter for a new line · planning so far $${d.spent.toFixed(2)} of $${d.cap.toFixed(2)}`;
    sync();
  }

  return {
    el,
    update,
    prefill(text: string) {
      openSheet(true);
      input.value = text;
      input.focus();
      input.setSelectionRange(text.length, text.length);
      sync();
    },
    /** Esc with the phone's sheet open closes the sheet (true when it did). */
    escape() {
      if (!el.classList.contains('open')) return false;
      openSheet(false);
      return true;
    },
  };
}
