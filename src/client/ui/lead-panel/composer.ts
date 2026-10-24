// The team-lead panel's composer (./panel.ts): the quick actions (Status update, Run standup, What's
// blocked?, Plan next steps), the note while the lead is mid-turn ("send now or after their turn?"), and
// the box "Ask <name>…" with its prompt history on ↑ and ↓. What it sends goes the ways the project
// console's always did: typed in now (worker.prompt), or held by the office until the lead's turn ends
// (the team's `tell … after`); the quick questions and the standup through the "OK to interrupt?" check.
// What you were typing is kept per project (./logic.ts PanelState) as you go between tabs and visits.
//
// Docked in a view (./dock.ts, the Developer view): a chip for what's selected there above the box (✕ takes
// it off, "+ Context" puts the current selection back) and Ask | Request a change. Request a change (the
// default with a chip on) sends to the view's request, one record (DC-n), even while the lead can't take a
// prompt: it queues. Ask sends to the lead as above, with what the chip points at said first.

import { h } from '../dom';
import { PromptHistory } from '../pm/state';
import { midTurnText, QUICK, sendPlan, type SendPlan } from './logic';
import { isEmptyTell } from '../../../shared/tell-text';
import type { ContextChip } from './dock';

export interface ComposerDeps {
  /** Sends `text` by `plan`; resolves whether it went (the box clears then). */
  send(text: string, plan: SendPlan): Promise<boolean>;
  /** A quick action: a question through the check, or the standup. */
  quick(q: (typeof QUICK)[number]): void;
  /** What you typed changed (kept as the project's draft). */
  draft(text: string): void;
  /** Docked: a request for a change (with the chip), resolves whether it went. */
  request?(text: string, chip: ContextChip | undefined): Promise<boolean>;
  /** Docked: the view's current selection ("+ Context"). */
  context?(): ContextChip | undefined;
  /** Docked: what a question with a chip tells the lead it's about. */
  about?(chip: ContextChip): string;
}

export type ComposerMode = 'ask' | 'change';

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
  /** Docked in a view: its chip, the mode, and whether the person picked the mode for this chip. */
  private docked = false;
  private chip: ContextChip | undefined;
  mode: ComposerMode = 'ask';
  private picked = false;
  private readonly ctxRow: HTMLElement;
  private readonly ctxAdd: HTMLButtonElement;
  private readonly modeRow: HTMLElement;
  private readonly modeBtns: HTMLButtonElement[];
  private readonly foot: HTMLElement;

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
    this.ctxAdd = h('button.lp-ctx-add', { type: 'button', title: 'Attach what’s selected now (a page, or the element picked on it)' }, '+ Context') as HTMLButtonElement;
    this.ctxAdd.addEventListener('click', () => {
      const c = deps.context?.();
      if (c) this.setChip(c, true);
      this.box.focus();
    });
    this.ctxRow = h('div.lp-ctx', { hidden: true, 'aria-label': 'Context', role: 'group' });
    this.modeBtns = (['ask', 'change'] as const).map((m) =>
      h('button.lp-mode', { type: 'button', role: 'radio', 'data-mode': m, title: m === 'ask' ? 'A question for the lead: nothing is changed' : 'A change to the app: kept as DC-n and queued, with the context attached' }, m === 'ask' ? 'Ask' : 'Request a change'),
    ) as HTMLButtonElement[];
    this.modeBtns.forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode as ComposerMode, true)));
    this.modeRow = h('div.lp-modes', { role: 'radiogroup', 'aria-label': 'Send as', hidden: true }, ...this.modeBtns);
    this.foot = h('p.lp-foot', { hidden: true });
    this.el = h(
      'footer.lp-comp',
      {},
      h('div.lp-qa', { role: 'group', 'aria-label': 'Quick actions' }, ...this.chips),
      this.hintEl,
      this.turn,
      h('div.lp-composer', {}, this.ctxRow, this.box, h('div.lp-cbar', {}, this.modeRow, this.cbar, this.sendBtn)),
      this.foot,
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

  // ---- Docked in a view ------------------------------------------------------------------------------
  /** Docked (with the line under the box), or not. */
  setDock(on: boolean, footer?: string) {
    this.docked = on;
    this.el.classList.toggle('lp-docked', on);
    this.modeRow.hidden = !on;
    this.foot.hidden = !on || !footer;
    this.foot.textContent = footer ?? '';
    if (!on) ((this.chip = undefined), (this.mode = 'ask'), (this.picked = false));
    else if (!this.view.canPrompt) this.mode = 'change';
    this.drawCtx();
    this.paint();
  }

  /** The chip (undefined: none). A new chip makes Request a change the mode, unless the person picks Ask. */
  setChip(c: ContextChip | undefined, explicit = false) {
    if (!this.docked) return;
    if (c?.key === this.chip?.key && !explicit) return;
    this.chip = c;
    if (c) ((this.mode = 'change'), (this.picked = false));
    else if (!this.picked) this.mode = this.view.canPrompt ? 'ask' : 'change';
    this.drawCtx();
    this.paint();
  }

  get context(): ContextChip | undefined {
    return this.chip;
  }

  setMode(m: ComposerMode, picked = false) {
    this.mode = m;
    if (picked) this.picked = true;
    this.paint();
  }

  /** The box, focused, with `chip` attached and `mode` picked. */
  focusWith(chip: ContextChip | undefined, mode: ComposerMode) {
    if (chip) this.setChip(chip, true);
    this.setMode(mode);
    this.box.focus();
  }

  /** The chip row (the context it points at, and "+ Context"). */
  drawCtx() {
    const c = this.chip;
    this.ctxRow.hidden = !this.docked;
    if (!this.docked) return;
    const x = c ? h('button.lp-ctx-x', { type: 'button', 'aria-label': `Remove ${c.label}`, title: 'Remove this context' }, '✕') : null;
    x?.addEventListener('click', () => {
      this.chip = undefined;
      if (!this.picked) this.mode = this.view.canPrompt ? 'ask' : 'change';
      this.drawCtx();
      this.paint();
      this.ctxAdd.focus();
    });
    const icon = c?.kind === 'widget' ? '⌖' : c?.kind === 'page' ? '📄' : '◇';
    this.ctxRow.replaceChildren(...(c ? [h('span.lp-ctx-chip', { title: c.title ?? c.label, 'data-chip': c.key }, h('span.lp-ctx-i', { 'aria-hidden': 'true' }, icon), h('span.lp-ctx-t', {}, c.label), x!)] : []), this.ctxAdd);
    const sel = this.deps.context?.();
    this.ctxAdd.disabled = !sel;
    this.ctxAdd.hidden = !!c && c.key === sel?.key;
  }

  /** The mode buttons, the box's words and whether it can send, after a mode, chip or view change. */
  private paint() {
    const change = this.docked && this.mode === 'change';
    this.el.classList.toggle('lp-asking-change', change);
    for (const b of this.modeBtns) {
      const on = b.dataset.mode === this.mode;
      b.setAttribute('aria-checked', String(on));
      b.disabled = b.dataset.mode === 'ask' && !this.view.canPrompt;
    }
    const v = this.view;
    this.box.disabled = !(v.canPrompt || change);
    this.box.placeholder = change ? (this.chip ? `Describe the change to ${this.chip.label}…` : 'Describe a change to the app…') : `Ask ${v.name}…`;
    this.box.setAttribute('aria-label', change ? 'Request a change' : `Message to ${v.name}`);
    this.sendBtn.setAttribute('aria-label', change ? 'Send the change request' : `Send to ${v.name}`);
    this.typed(false);
  }

  /** What it last showed: the panel draws on every worker update, and only a change touches the page. */
  private shown = '';
  show(v: ComposerView) {
    const key = JSON.stringify(v);
    if (key === this.shown) return;
    this.shown = key;
    this.view = v;
    this.hintEl.textContent = v.hint ?? '';
    this.hintEl.hidden = !v.hint;
    this.hintEl.classList.toggle('bad', !!v.bad);
    for (const b of this.chips) b.disabled = b.dataset.q === 'standup' ? !v.team : !v.canPrompt;
    if (this.docked && !v.canPrompt && this.mode === 'ask') this.mode = 'change';
    this.paint();
  }

  /** The mid-turn note and the send button follow what's in the box. */
  private typed(save = true) {
    // An untouched "About …:" prefill (a card's Ask button) is nothing to send yet (shared/tell-text.ts).
    const filled = !isEmptyTell(this.box.value);
    const change = this.docked && this.mode === 'change';
    this.sendBtn.disabled = !filled || !(this.view.canPrompt || change);
    const mid = filled && !!this.view.midTurn && this.view.canPrompt && !change;
    this.turn.hidden = !mid;
    if (mid) this.turnText.textContent = `⏳ ${midTurnText(this.view.name, this.view.midTurn!)}`;
    this.cbar.textContent = change ? 'Enter sends it as a change · it queues if the team is busy' : mid ? 'Enter sends after their turn · Shift+Enter for a new line' : this.docked ? 'Enter to send · Shift+Enter for a new line' : 'Enter to send · Shift+Enter for a new line · ↑ for history';
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
    const change = this.docked && this.mode === 'change' && !!this.deps.request;
    if (isEmptyTell(text) || !(this.view.canPrompt || change)) return;
    if (change) this.sendBtn.disabled = true;
    const about = this.docked && this.chip && this.deps.about ? `${this.deps.about(this.chip)}\n\n` : '';
    const ok = change ? await this.deps.request!(text, this.chip) : await this.deps.send(`${about}${text}`, sendPlan(!!this.view.midTurn, choice));
    if (change) this.typed(false);
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
