// The team phone's composer: a box at the bottom of a channel, a DM or a thread. Enter sends (Shift+Enter
// for a new line). A line under it says where the message goes before it's sent (the floor's Project
// Coordinator, the @mentioned agent, every Lead with @team and what that costs, the thread's agent, the
// escalation it answers), from the same routeMessage the office uses. Typing @ offers the floor's
// agents and @team, picked with the arrows and Enter or Tab. No three.js.

import { parseMention, routeMessage, teamWarning, type PhoneAgent, type PhonePlace } from '../../../shared/phone';
import { h, toast } from '../dom';
import { sendMessage, type SendReply } from './api';

export interface ComposeTarget {
  floor: string;
  place: PhonePlace;
  /** The agents on that floor (only known for the floor you're on; elsewhere the office works it out). */
  agents: PhoneAgent[];
  /** The escalation's thread: the line says it answers it. */
  escalation?: string;
}

export interface Composer {
  el: HTMLElement;
  /** Where the next message goes, or undefined when this view can't be written in (All projects). */
  target(t: ComposeTarget | undefined, why?: string): void;
  focus(): void;
}

export function composer(onSent: (r: SendReply, t: ComposeTarget) => void): Composer {
  let tgt: ComposeTarget | undefined;
  let picks: { label: string; insert: string; sub?: string }[] = [];
  let at = 0;
  const box = h('textarea.tp-box', { rows: 1, placeholder: 'Message', 'aria-label': 'Message', 'aria-autocomplete': 'list', 'aria-controls': 'tp-ac', maxlength: 4000 }) as HTMLTextAreaElement;
  const send = h('button.btn.primary.tp-send', { type: 'submit', 'aria-label': 'Send', title: 'Send (Enter)' }, 'Send') as HTMLButtonElement;
  const hint = h('p.tp-hint', { 'aria-live': 'polite' });
  const list = h('ul.tp-ac', { id: 'tp-ac', role: 'listbox', 'aria-label': 'Mention', hidden: true });
  const form = h('form.tp-compose', {}, list, hint, h('div.tp-row', {}, box, send)) as HTMLFormElement;

  function grow() {
    box.style.height = 'auto';
    box.style.height = `${Math.min(140, box.scrollHeight)}px`;
  }

  /** The @word being typed at the start, if the caret is still in it. */
  function typingMention(): string | undefined {
    const v = box.value;
    const m = /^@([^\s,:]*)$/.exec(v.slice(0, box.selectionStart ?? v.length));
    return m ? m[1] : undefined;
  }

  function drawPicks() {
    const q = typingMention();
    if (q === undefined || !tgt) {
      picks = [];
    } else {
      const ql = q.toLowerCase();
      const team = 'team'.startsWith(ql) ? [{ label: '@team', insert: '@team ', sub: teamWarning(tgt.agents) ?? 'Every Lead (none at work)' }] : [];
      picks = [...team, ...tgt.agents.filter((a) => a.name.toLowerCase().startsWith(ql)).map((a) => ({ label: `@${a.name}`, insert: `@${a.name} `, sub: a.role === 'pm' ? 'Project Coordinator' : a.role ? 'Lead' : 'agent' }))].slice(0, 7);
    }
    at = Math.min(at, Math.max(0, picks.length - 1));
    list.hidden = !picks.length;
    box.setAttribute('aria-expanded', String(!!picks.length));
    list.replaceChildren(
      ...picks.map((p, i) =>
        h('li.tp-ac-item', { role: 'option', id: `tp-ac-${i}`, 'aria-selected': String(i === at), onmousedown: (e: Event) => (e.preventDefault(), choose(i)) }, h('b', {}, p.label), p.sub ? h('small', {}, p.sub) : null),
      ),
    );
    if (picks.length) box.setAttribute('aria-activedescendant', `tp-ac-${at}`);
    else box.removeAttribute('aria-activedescendant');
  }

  function choose(i: number) {
    const p = picks[i];
    if (!p) return;
    const rest = box.value.replace(/^@[^\s,:]*\s*/, '');
    box.value = p.insert + rest;
    box.setSelectionRange(p.insert.length, p.insert.length);
    picks = [];
    drawPicks();
    drawHint();
    box.focus();
  }

  /** Where it goes, in a line; a warning for @team. */
  function drawHint() {
    hint.classList.remove('tp-warn', 'tp-bad');
    if (!tgt) return;
    const text = box.value.trim();
    if (!text) {
      hint.textContent = tgt.escalation ? 'Your reply answers the escalation' : '';
      return;
    }
    const { mention } = parseMention(text, tgt.agents);
    if (!tgt.agents.length && tgt.place.in === 'channel' && !mention) {
      hint.textContent = "Goes to that floor's Project Coordinator";
      return;
    }
    const r = routeMessage(text, tgt.place, tgt.agents);
    if (!r.ok) {
      // Only once there's something after the mention: "@He" is still being typed.
      if (mention && !/\s/.test(text)) return void (hint.textContent = '');
      hint.textContent = r.why;
      hint.classList.add('tp-bad');
      return;
    }
    if (r.group === 'team') {
      hint.textContent = `⚠️ ${teamWarning(tgt.agents)}: ${r.to.map((a) => a.name).join(', ')}`;
      hint.classList.add('tp-warn');
      return;
    }
    if (r.resolve) return void (hint.textContent = `Answers the escalation, and ${r.to[0]?.name ?? 'the agent'} is told`);
    hint.textContent = `To ${r.to.map((a) => a.name + (a.role === 'pm' ? ' (Project Coordinator)' : '')).join(', ')}${r.note ? ` · ${r.note}` : ''}`;
  }

  box.addEventListener('input', () => {
    grow();
    drawPicks();
    drawHint();
  });
  box.addEventListener('keydown', (e) => {
    if (picks.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      at = (at + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length;
      return drawPicks();
    }
    if (picks.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
      e.preventDefault();
      return choose(at);
    }
    if (picks.length && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      picks = [];
      return drawPicks();
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  box.addEventListener('blur', () => setTimeout(() => ((picks = []), drawPicks()), 120));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = tgt;
    const text = box.value.trim();
    if (!t || !text || send.disabled) return;
    send.disabled = true;
    try {
      const r = await sendMessage(t.floor, text, t.place);
      box.value = '';
      grow();
      drawHint();
      onSent(r, t);
    } catch (err) {
      toast(`Couldn't send it: ${(err as Error).message}`, 'warn');
    } finally {
      send.disabled = false;
    }
  });

  return {
    el: form,
    target(t, why) {
      tgt = t;
      form.hidden = !t && !why;
      box.disabled = !t;
      send.disabled = !t;
      box.placeholder = t ? (t.escalation ? 'Reply to the escalation…' : t.place.in === 'dm' ? 'Message' : t.place.in === 'thread' ? 'Reply in the thread…' : `Message ${t.agents.find((x) => x.role === 'pm')?.name ?? 'the team'}, or @someone`) : (why ?? '');
      drawPicks();
      drawHint();
    },
    focus: () => box.focus(),
  };
}
