// The team-lead panel's composer (./panel.ts): the quick actions (Status update, Run standup, What's
// blocked?, Plan next steps), the note while the lead is mid-turn ("send now or after their turn?"), and
// the box "Ask <name>…" with its prompt history on ↑ and ↓. What it sends goes the ways the project
// console's always did: typed in now (worker.prompt), or held by the office until the lead's turn ends
// (the team's `tell … after`); the quick questions and the standup through the "OK to interrupt?" check.
// What you were typing is kept per project (./logic.ts PanelState) as you go between tabs and visits.

import { h } from '../dom';
import { PromptHistory } from '../pm/state';
import { midTurnText, QUICK, sendPlan, type SendPlan } from './logic';
import { isEmptyTell } from '../../../shared/tell-text';

export interface ComposerDeps {
  /** Sends `text` by `plan`; resolves whether it went (the box clears then). */
  send(text: string, plan: SendPlan): Promise<boolean>;
  /** A quick action: a question through the check, or the standup. */
  quick(q: (typeof QUICK)[number]): void;
  /** What you typed changed (kept as the project's draft). */
  draft(text: string): void;
}

export interface ComposerView {
  name: string;
  /** A typed prompt can go in now (the box is shut otherwise). */
  canPrompt: boolean;
  /** The team is in (the standup needs it). */
  team: boolean;
  /** The lead is mid-turn, and how long for ("4 min"); undefined when it isn't. */
  midTurn?: string;
  /** Why the box is shut, or what to do instead; undefined when there's nothing to say. */
  hint?: string;
  bad?: boolean;
}

const ICON: Record<string, string> = { status: '📊', standup: '📋', blocked: '🚧', plan: '🗺️' };

export class Composer {
  readonly el: HTMLElement;
  readonly box: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly hintEl: HTMLElement;
  private readonly turn: HTMLElement;
  private readonly turnText: HTMLElement;
  private readonly cbar: HTMLElement;
  private readonly chips: HTMLButtonElement[];
  private readonly history = new PromptHistory();
  /** The prompt ↑/↓ last put in the box. */
  private recalled: string | undefined;
  private view: ComposerView = { name: 'the lead', canPrompt: false, team: false };
  /** What was in the box when it was last sized. */
  private sized: string | undefined;

  constructor(private readonly deps: ComposerDeps) {
    this.chips = QUICK.map((q) =>
      h('button.lp-qchip', { type: 'button', 'data-q': q.id, title: q.prompt ?? 'Ask every Lead for its standup; the lead compiles the page' }, h('span.lp-qi', { 'aria-hidden': 'true' }, ICON[q.id] ?? ''), q.label),
    ) as HTMLButtonElement[];
    QUICK.forEach((q, i) => this.chips[i].addEventListener('click', () => deps.quick(q)));
    this.turnText = h('span.lp-turn-text');
    const now = h('button.btn.small.lp-now', { type: 'button', onclick: () => void this.submit('now') }, 'Send now');
    const after = h('button.btn.small.lp-after', { type: 'button', onclick: () => void this.submit('after') }, 'After their turn (Enter)');
    this.turn = h('div.lp-turn', { hidden: true, role: 'status' }, this.turnText, h('div.lp-turn-b', {}, now, after));
    this.box = h('textarea.lp-box', { rows: 2, enterkeyhint: 'send', 'aria-label': 'Message' }) as HTMLTextAreaElement;
    this.sendBtn = h('button.lp-send', { type: 'button', 'aria-label': 'Send', title: 'Send (Enter); Shift+Enter for a new line', disabled: true }, '➤') as HTMLButtonElement;
    this.cbar = h('span.lp-cbar-t', {}, 'Enter to send · Shift+Enter for a new line · ↑ for history');
    this.hintEl = h('p.lp-hint', { hidden: true });
    this.el = h(
      'footer.lp-comp',
      {},
      h('div.lp-qa', { role: 'group', 'aria-label': 'Quick actions' }, ...this.chips),
      this.hintEl,
      this.turn,
      h('div.lp-composer', {}, this.box, h('div.lp-cbar', {}, this.cbar, this.sendBtn)),
    );
    this.sendBtn.addEventListener('click', () => void this.submit('enter'));
    this.box.addEventListener('input', () => this.typed());
    this.box.addEventListener('keydown', (e) => this.key(e));
  }

  /** Puts `text` in the box (a kept draft, or "About …: " from Needs you). */
  set(text: string, focus = false) {
    this.box.value = text;
    this.typed(false);
    if (focus) {
      this.box.focus();
      this.box.setSelectionRange(text.length, text.length);
    }
  }

  /** What it last showed: the panel draws on every worker update, and only a change touches the page. */
  private shown = '';
  show(v: ComposerView) {
    const key = JSON.stringify(v);
    if (key === this.shown) return;
    this.shown = key;
    this.view = v;
    this.box.placeholder = `Ask ${v.name}…`;
    this.box.setAttribute('aria-label', `Message to ${v.name}`);
    this.sendBtn.setAttribute('aria-label', `Send to ${v.name}`);
    this.box.disabled = !v.canPrompt;
    this.hintEl.textContent = v.hint ?? '';
    this.hintEl.hidden = !v.hint;
    this.hintEl.classList.toggle('bad', !!v.bad);
    for (const b of this.chips) b.disabled = b.dataset.q === 'standup' ? !v.team : !v.canPrompt;
    this.typed(false);
  }

  /** The mid-turn note and the send button follow what's in the box. */
  private typed(save = true) {
    // An untouched "About …:" prefill (a card's Ask button) is nothing to send yet (shared/tell-text.ts).
    const filled = !isEmptyTell(this.box.value);
    this.sendBtn.disabled = !filled || !this.view.canPrompt;
    const mid = filled && !!this.view.midTurn && this.view.canPrompt;
    this.turn.hidden = !mid;
    if (mid) this.turnText.textContent = `⏳ ${midTurnText(this.view.name, this.view.midTurn!)}`;
    this.cbar.textContent = mid ? 'Enter sends after their turn · Shift+Enter for a new line' : 'Enter to send · Shift+Enter for a new line · ↑ for history';
    // The box grows with what's in it (measuring forces a layout: only when what's in it changed).
    if (this.box.value !== this.sized) {
      this.sized = this.box.value;
      this.box.style.height = 'auto';
      if (this.box.scrollHeight) this.box.style.height = `${Math.min(this.box.scrollHeight, 140)}px`;
    }
    if (save) this.deps.draft(this.box.value);
  }

  private async submit(choice: 'now' | 'after' | 'enter') {
    const text = this.box.value.trim();
    if (isEmptyTell(text) || !this.view.canPrompt) return;
    const ok = await this.deps.send(text, sendPlan(!!this.view.midTurn, choice));
    if (!ok) return;
    this.history.add(text);
    this.recalled = undefined;
    if (this.box.value.trim() === text) this.set('');
    this.deps.draft('');
    this.box.focus();
  }

  private key(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.submit('enter');
      return;
    }
    // Up at the top of the box (Down at its end), or on a recalled prompt not edited yet, walks what you
    // sent this visit, as a shell does; anywhere else they move the caret through your lines.
    const box = this.box;
    const untouched = this.recalled !== undefined && box.value === this.recalled;
    const atStart = untouched || (box.selectionStart === 0 && box.selectionEnd === 0);
    const atEnd = untouched || box.selectionStart === box.value.length;
    const step = e.key === 'ArrowUp' && atStart ? this.history.back() : e.key === 'ArrowDown' && atEnd ? this.history.forward() : undefined;
    if (step === undefined) return;
    e.preventDefault();
    this.recalled = step;
    this.set(step);
    box.setSelectionRange(step.length, step.length);
    this.deps.draft(step);
  }

  /** Remembers a quick question as sent (↑ brings it back). */
  remember(text: string) {
    this.history.add(text);
  }
}
