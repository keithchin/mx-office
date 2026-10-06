// The console's Chat view (ui/pm/console.ts): the worker's conversation as messages instead of its
// screen. What you sent on one side, its replies on the other with its icon and color, its tool calls
// as compact rows (logic.ts folds runs of them), and what it's asking you as a highlighted card that
// sends you to its terminal: a choice is never answered from here. Fed by the office reading its
// Claude Code transcript (server/convo/, kept by state/slices/convo.ts); for a worker with no transcript
// (Codex, OpenCode…) it shows the terminal's own text instead.
//
// Only the newest rows are on the page (Show earlier adds more), and a redraw only rebuilds the rows
// that changed. No three.js here: the 1D view imports it.

import type { ConvoMsg, ConvoToolStatus } from '../../../../shared/protocol/convo';
import { h } from '../../dom';
import { markdownFile } from '../../markdown';
import { chatItems, screenText, type ChatItem, type Convo, type ToolMsg } from './logic';
import './chat.css';

/** How many rows are on the page at first, and how many more each Show earlier adds. */
export const PAGE = 200;

/** Who the agent is, as the office shows it. */
export interface ChatWho {
  name: string;
  icon: string;
  color?: string;
}

/** What the view shows now. */
export interface ChatState {
  workerId: string;
  who: ChatWho;
  /** The worker's status: working shows the typing dots, needs_input the card. */
  status?: string;
  /** What it's doing or asking, in a line (WorkerInfo.activity). */
  activity?: string;
  convo: Convo | undefined;
}

export interface ChatDeps {
  /** Opens the worker's full terminal, to answer what it's asking. */
  openTerminal(): void;
  /** The terminal's lines, for the fallback. */
  lines(): string[];
}

const STATUS_WORD: Record<ConvoToolStatus, string> = { running: 'running', ok: 'done', error: 'failed' };

export class ChatView {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly earlier: HTMLButtonElement;
  private readonly rows: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fallback: HTMLElement;
  private readonly plain: HTMLElement;
  /** Each row on the page by its item's id, with what it was drawn from. */
  private readonly drawn = new Map<string, { sig: string; el: HTMLElement }>();
  private limit = PAGE;
  private state: ChatState | undefined;
  private plainFrame = 0;
  /** Whether the list is scrolled to its newest row, so it stays there as rows come and the box changes size. */
  private pinned = true;

  constructor(private readonly deps: ChatDeps) {
    this.earlier = h('button.btn.small.pmc-earlier', { type: 'button', onclick: () => this.showEarlier() }, 'Show earlier');
    this.rows = h('div.pmc-rows');
    this.list = h('div.pmc-chat-list', { role: 'log', 'aria-label': 'Conversation', tabindex: '0' }, this.earlier, this.rows);
    this.status = h('div.pmc-chat-status', { role: 'status', 'aria-live': 'polite' });
    this.plain = h('pre.pmc-plain', { tabindex: '0', 'aria-label': "The terminal's text" });
    this.fallback = h('div.pmc-fallback', {}, h('p.pmc-fallback-note', {}, 'Chat view needs Claude Code transcripts; showing terminal text.'), this.plain);
    this.el = h('div.pmc-chat', {}, this.list, this.fallback, this.status);
    this.list.addEventListener('scroll', () => (this.pinned = atBottom(this.list)), { passive: true });
    // The box shrinks when a hint or a card appears below it: the newest row stays in view.
    new ResizeObserver(() => this.pinned && (this.list.scrollTop = this.list.scrollHeight)).observe(this.list);
  }

  /** Draws `s`: only the rows that changed are made again. */
  show(s: ChatState) {
    if (this.state?.workerId !== s.workerId) this.reset();
    this.state = s;
    const c = s.convo;
    const fallback = !!c && !c.available;
    this.fallback.hidden = !fallback;
    this.list.hidden = fallback;
    if (fallback) this.drawPlain();
    else this.drawRows(c);
    this.drawStatus(s, c);
  }

  /** The terminal changed: the fallback's text follows, once a frame at most. */
  terminalChanged() {
    if (this.plainFrame || this.fallback.hidden) return;
    this.plainFrame = requestAnimationFrame(() => {
      this.plainFrame = 0;
      this.drawPlain();
    });
  }

  private reset() {
    this.drawn.clear();
    this.rows.replaceChildren();
    this.limit = PAGE;
    this.pinned = true;
  }

  private showEarlier() {
    const before = this.list.scrollHeight;
    this.limit += PAGE;
    if (this.state) this.show(this.state);
    // Keep the rows you were reading where they were.
    this.list.scrollTop += this.list.scrollHeight - before;
  }

  private drawPlain() {
    const stick = atBottom(this.plain);
    const text = screenText(this.deps.lines());
    if (this.plain.textContent !== text) this.plain.textContent = text || 'Nothing on its screen yet.';
    if (stick) this.plain.scrollTop = this.plain.scrollHeight;
  }

  private drawRows(c: Convo | undefined) {
    const stick = this.pinned;
    const items = c ? chatItems(c.messages) : [];
    const shown = items.slice(-this.limit);
    this.earlier.hidden = items.length <= shown.length;
    const who = this.state ? `${this.state.who.name}|${this.state.who.icon}|${this.state.who.color ?? ''}` : '';
    const keep = new Set<string>();
    let at: ChildNode | null = this.rows.firstChild;
    for (const it of shown) {
      keep.add(it.id);
      const sig = who + JSON.stringify(it);
      let d = this.drawn.get(it.id);
      if (!d || d.sig !== sig) {
        const el = this.row(it);
        // A folded run you opened stays open as it grows.
        if (d?.el instanceof HTMLDetailsElement && el instanceof HTMLDetailsElement) el.open = d.el.open;
        if (d) {
          d.el.replaceWith(el);
          if (at === d.el) at = el;
        }
        d = { sig, el };
        this.drawn.set(it.id, d);
      }
      if (d.el !== at) this.rows.insertBefore(d.el, at);
      at = d.el.nextSibling;
    }
    for (const [id, d] of this.drawn) {
      if (keep.has(id)) continue;
      d.el.remove();
      this.drawn.delete(id);
    }
    if (!shown.length) this.rows.replaceChildren(h('p.pmc-chat-empty', {}, c ? 'Nothing said yet. Ask away below.' : 'Loading the conversation…'));
    else this.rows.querySelector(':scope > .pmc-chat-empty')?.remove();
    if (stick) this.list.scrollTop = this.list.scrollHeight;
  }

  private row(it: ChatItem): HTMLElement {
    if (it.kind === 'tools') return toolRow(it);
    const m = it.msg;
    const who = this.state!.who;
    if (m.kind === 'user') return h('div.pmc-msg.pmc-user', {}, h('div.pmc-bubble', {}, h('span.pmc-by', {}, 'Prompt', when(m)), h('div.pmc-text', {}, m.text)));
    if (m.kind === 'agent') {
      return h(
        'div.pmc-msg.pmc-agent',
        { style: who.color ? `--who:${who.color}` : undefined },
        avatar(who),
        h('div.pmc-bubble', {}, h('span.pmc-by', {}, who.name, when(m)), markdownFile(m.text)),
      );
    }
    return askCard(m, who, m.answered ? undefined : () => this.deps.openTerminal());
  }

  private drawStatus(s: ChatState, c: Convo | undefined) {
    const items = c?.available ? c.messages : [];
    const last = items[items.length - 1];
    const asking = last?.kind === 'ask' && !last.answered;
    if (s.status === 'needs_input' && !asking) {
      this.status.replaceChildren(
        h(
          'div.pmc-card.pmc-need',
          {},
          h('p.pmc-card-h', {}, `🙋 ${s.who.name} needs you`),
          h('p.pmc-card-q', {}, s.activity ?? 'It is waiting on a permission or an answer in its terminal.'),
          openButton(() => this.deps.openTerminal()),
        ),
      );
    } else if (s.status === 'working' || s.status === 'starting') {
      this.status.replaceChildren(
        h('div.pmc-typing', {}, h('span.pmc-dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', {}, `${s.who.name} is ${s.status === 'starting' ? 'starting' : 'working'}`, s.activity && s.status === 'working' ? h('span.pmc-typing-what', {}, ` · ${s.activity}`) : '')),
      );
    } else this.status.replaceChildren();
  }
}

const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;

/** "14:02" on a message, when the transcript said when. */
function when(m: ConvoMsg) {
  if (!m.at) return '';
  const d = new Date(m.at);
  return h('time.pmc-when', { datetime: d.toISOString(), title: d.toLocaleString() }, d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
}

/** The agent's icon on its color; in the Clean themes (no emoji) its initial instead. */
function avatar(who: ChatWho) {
  return h('span.pmc-av', { 'aria-hidden': 'true' }, h('span.pmc-av-emo', {}, who.icon), h('span.pmc-av-ini', {}, (who.name.trim()[0] ?? '?').toUpperCase()));
}

function openButton(open: () => void) {
  return h('button.btn.small.primary.pmc-answer', { type: 'button', onclick: open, title: 'A choice is answered in its terminal, not from the chat' }, 'Open terminal to answer');
}

function askCard(m: Extract<ConvoMsg, { kind: 'ask' }>, who: ChatWho, open: (() => void) | undefined) {
  return h(
    'div.pmc-card.pmc-ask',
    { class: open ? '' : 'answered' },
    h('p.pmc-card-h', {}, open ? `❓ ${who.name} is asking you` : `${who.name} asked`, when(m)),
    h('p.pmc-card-q', {}, m.question),
    m.options.length ? h('ul.pmc-card-opts', {}, ...m.options.map((o) => h('li', {}, o))) : '',
    open ? openButton(open) : h('p.pmc-card-done', {}, 'Answered'),
  );
}

function toolLine(t: Pick<ToolMsg, 'summary' | 'status' | 'preview'>, label = t.summary) {
  return [
    // The mark itself is the sheet's (chat.css), so the Clean themes don't take it for an emoji.
    h('span.pmc-tool-mark', { class: `pmc-mark-${t.status}`, role: 'img', 'aria-label': STATUS_WORD[t.status], title: STATUS_WORD[t.status] }),
    h('span.pmc-tool-what', {}, label),
    t.status === 'error' && t.preview ? h('span.pmc-tool-why', {}, t.preview) : '',
  ];
}

function toolRow(it: Extract<ChatItem, { kind: 'tools' }>): HTMLElement {
  const cls = `pmc-${it.status}`;
  if (it.tools.length === 1) {
    const t = it.tools[0];
    return h('div.pmc-tool', { class: cls, title: t.preview ?? t.summary }, ...toolLine(t));
  }
  return h(
    'details.pmc-tool.pmc-tools',
    { class: cls },
    h('summary', {}, ...toolLine({ summary: it.label, status: it.status }, it.label)),
    h('ul', {}, ...it.tools.map((t) => h('li', { class: `pmc-${t.status}`, title: t.preview ?? t.summary }, ...toolLine(t)))),
  );
}
