// The project manager console's terminal (ui/pm/console.ts): the PM's screen, live and read-only, the
// way a card's hover preview shows one (ui/kanban-preview.ts). It attaches as a viewer, draws the
// snapshot and what follows into a small xterm at the PTY's own size, and scales that down to the
// column's width with the newest lines at the box's foot. It never sends a resize: the PTY's size belongs to
// whoever has the full terminal open. While it shows a terminal it holds it (ui/term-holds.ts), so the
// full window or a hover preview closing doesn't stop its output. It only draws while its box is laid
// out: hidden (the Chat view, the escalation cards) it's parked, taking in output but drawing nothing
// (term-park.ts says why: a hidden xterm froze the page).

import { Terminal } from '@xterm/xterm';
import type { Net } from '../../net';
import type { ServerMsg } from '../../../shared/protocol';
import { openTerminalFor } from '../terminal';
import { termTheme } from '../termtheme';
import { holdTerminal } from '../term-holds';
import { termPlacement } from './term-park';

/** The narrowest it's scaled for, in columns, and the smallest scale (about 7.5px type at 12px). */
const MIN_COLS = 60;
const MIN_SCALE = 0.62;
/** Lines kept above the screen, for the Chat view's plain-text fallback (ui/pm/chat/). */
const SCROLLBACK = 1000;

export class PmTerminal {
  private term: Terminal | null = null;
  private workerId: string | null = null;
  private release: (() => void) | null = null;
  private fitFrame = 0;
  /** Whether `term` has been opened in the box (has a renderer); a parked one hasn't. */
  private opened = false;
  private readonly ro = new ResizeObserver(() => (this.place(), this.fit()));

  constructor(
    private readonly net: Net,
    /** Where it's drawn: a box of a fixed height in the console's body. */
    readonly host: HTMLElement,
  ) {
    this.ro.observe(host);
    // The 🎨 theme changed: the screen follows (green on black in the Terminal theme).
    new MutationObserver(() => {
      if (this.term) this.term.options.theme = termTheme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /** Which worker it shows now. */
  get showing(): string | null {
    return this.workerId;
  }

  /** Shows `workerId`'s terminal (attaching), or nothing (detaching); the same one again is a no-op. */
  show(workerId: string | null) {
    if (workerId === this.workerId) return;
    this.drop();
    if (!workerId) return;
    this.workerId = workerId;
    this.release = holdTerminal(workerId);
    this.term = this.make();
    this.opened = false;
    // Attaching twice from one page is harmless (the full window may have it already): the office
    // keeps one viewer per connection, and answers with a snapshot either way.
    this.net.send({ t: 'worker.attach', workerId });
    // Parked until placed: the console calls place() once it has shown or hidden the box.
  }

  private make() {
    return new Terminal({ disableStdin: true, cursorBlink: false, fontSize: 12, scrollback: SCROLLBACK, theme: termTheme(), allowProposedApi: false });
  }

  /**
   * Opens the terminal in its box once the box is laid out, and parks it again when the box isn't
   * (term-park.ts). The console calls it right after showing or hiding the box, before the next frame
   * could draw into a hidden one; the box's ResizeObserver catches anything else that hides it.
   */
  place() {
    if (!this.term || !this.workerId) return;
    const todo = termPlacement(this.opened, { width: this.host.clientWidth, height: this.host.clientHeight });
    if (todo === 'open') {
      this.term.open(this.host);
      this.opened = true;
      this.fitSoon();
    } else if (todo === 'park') {
      // An opened xterm can't give its renderer back: a fresh, unopened one takes over, and a new
      // snapshot fills it (the Chat view's fallback reads its lines).
      this.term.dispose();
      this.host.replaceChildren();
      this.term = this.make();
      this.opened = false;
      this.net.send({ t: 'worker.attach', workerId: this.workerId });
    }
  }

  /** After a reconnect the office has forgotten what this page watched: ask again. */
  reattach() {
    if (this.workerId) this.net.send({ t: 'worker.attach', workerId: this.workerId });
  }

  /** The PTY changed size (the full window resized it): follow, so its lines don't wrap. */
  sizeTo(cols: number, rows: number) {
    if (!this.term || (this.term.cols === cols && this.term.rows === rows)) return;
    this.term.resize(cols, rows);
    this.fit();
  }

  /** Every server message: the shown terminal's snapshot and output. */
  route(msg: ServerMsg) {
    if (!this.term || !('workerId' in msg) || msg.workerId !== this.workerId) return;
    if (msg.t === 'term.snapshot') {
      this.term.reset();
      this.term.resize(msg.cols, msg.rows);
      this.term.write(msg.data, () => (this.fit(), this.onWrite?.()));
    } else if (msg.t === 'term.data') this.term.write(msg.data, () => (this.fitSoon(), this.onWrite?.()));
  }

  /** Hears each write once it's on the screen (the Chat view's fallback reads the text again). */
  onWrite: (() => void) | undefined;

  /** Every line it has, the scrollback's and the screen's, as text. */
  lines(): string[] {
    const buf = this.term?.buffer.active;
    if (!buf) return [];
    const out: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      const text = line?.translateToString(true) ?? '';
      // A long line the screen wrapped is one line of text again.
      if (line?.isWrapped && out.length) out[out.length - 1] += text;
      else out.push(text);
    }
    return out;
  }

  /** Output comes in bursts: placing the screen once a frame is plenty. */
  private fitSoon() {
    if (this.fitFrame) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0;
      this.fit();
    });
  }

  /** Lets go of the terminal: detaches, unless the full window has the same one open. */
  drop() {
    const id = this.workerId;
    this.release?.();
    this.release = null;
    if (id && openTerminalFor() !== id) this.net.send({ t: 'worker.detach', workerId: id });
    this.term?.dispose();
    this.term = null;
    this.opened = false;
    this.workerId = null;
    this.host.replaceChildren();
  }

  /**
   * The screen scaled down to fit the box's width (see below). A tall screen doesn't fit the box, so it's
   * shifted up until its newest line (the cursor's, or the last one with anything on it, whichever
   * is lower) sits at the box's foot: that's where an agent's latest output and its prompt are.
   */
  private fit() {
    const term = this.term;
    const screen = this.host.querySelector<HTMLElement>('.xterm-screen');
    const inner = this.host.firstElementChild as HTMLElement | null;
    if (!term || !this.opened || !screen || !inner || !screen.offsetWidth) return;
    const buf = term.buffer.active;
    let last = buf.cursorY;
    let used = MIN_COLS;
    for (let y = term.rows - 1; y >= 0; y--) {
      const text = buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '';
      if (y > last && text.trim()) last = y;
      used = Math.max(used, text.length);
    }
    // Scaled to the columns in use, not the PTY's whole width (someone's wide window would make it
    // unreadable), and never below a readable size: what's past the box's right edge is cut off.
    const colPx = screen.offsetWidth / term.cols;
    const scale = Math.max(MIN_SCALE, Math.min(1, this.host.clientWidth / (Math.min(used, term.cols) * colPx)));
    const rowPx = (screen.offsetHeight / term.rows) * scale;
    inner.style.transform = `scale(${scale})`;
    inner.style.height = `${screen.offsetHeight}px`;
    inner.style.top = `${Math.min(0, this.host.clientHeight - (last + 1) * rowPx)}px`;
  }
}
