// The session pane's terminal: the real `claude` running in the project folder (the office's terminal host,
// server/expert/session.ts), drawn in an xterm themed for the session screen (its font, colours and padding)
// and fully interactive: keys and pastes go straight to the pty, nothing else is ever typed into it. It
// attaches as a viewer of the session's worker (the snapshot, then what follows), fits the pane and claims
// the pty's size when you type, the way the full terminal window does (ui/terminal.ts). It's made only while
// the pane is laid out and let go when the screen hides (a hidden xterm froze the page: pm/term-park.ts).

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Net } from '../../net';
import type { ServerMsg } from '../../../shared/protocol';
import { store } from '../../state';
import { holdTerminal, terminalHeld } from '../term-holds';
import { naturalKey } from '../termkeys';
import { keepWidths, reuseWidths } from '../term-widths';
import { writeInSlices } from '../term-write';
import { TERM_THEME_PORTAL_DARK } from '../termtheme';

/** The session's colours: the mockup's navy screen in both Portal themes, slate ink, the portal's blue cursor. */
export const SESSION_THEME = { ...TERM_THEME_PORTAL_DARK, background: '#0f172a', foreground: '#e2e8f0', cursor: '#60a5fa', selectionBackground: '#1e3a8a' };

export interface SessionTerm {
  /** Shows `workerId`'s session (attaching), or nothing. */
  show(workerId: string | undefined): void;
  /** The pane was laid out again (the divider moved, the window resized). */
  fit(): void;
  /** The screen went away: detach and let go. */
  drop(): void;
  focus(): void;
}

export function sessionTerm(net: Net, host: HTMLElement): SessionTerm {
  let term: Terminal | undefined;
  let fitter: FitAddon | undefined;
  let workerId: string | undefined;
  let release: (() => void) | undefined;
  let ready = false;
  let lastSent = '';
  let frame = 0;

  const sendSize = (typing = false) => {
    if (!term || !fitter || !ready || !workerId) return;
    const w = store.workers.get(workerId);
    // Someone else is in it too (the pop-out, a phone): only typing claims the size.
    if (!typing && (w?.viewers.length ?? 0) > 1) return;
    try {
      fitter.fit();
    } catch {
      return;
    }
    const key = `${term.cols}x${term.rows}`;
    if (w && (w.cols !== term.cols || w.rows !== term.rows) && key !== lastSent) {
      lastSent = key;
      net.send({ t: 'term.resize', workerId, cols: term.cols, rows: term.rows });
    }
  };

  const onMsg = (msg: ServerMsg) => {
    if (!term || !workerId) return;
    if (msg.t === 'term.data' && msg.workerId === workerId) writeInSlices(term, msg.data);
    else if (msg.t === 'term.snapshot' && msg.workerId === workerId) {
      const t = term;
      t.reset();
      t.resize(msg.cols, msg.rows);
      writeInSlices(t, msg.data, () =>
        setTimeout(() => {
          if (term !== t) return;
          ready = true;
          sendSize();
          t.scrollToBottom();
          keepWidths(t);
        }, 0),
      );
    }
  };
  net.onMessage(onMsg);

  const make = () => {
    const t = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: SESSION_THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });
    fitter = new FitAddon();
    t.loadAddon(fitter);
    t.loadAddon(new WebLinksAddon());
    t.open(host);
    reuseWidths(t);
    t.attachCustomKeyEventHandler((e) => {
      // ⌘⌫, Ctrl+⌫, Shift+Enter and friends edit the prompt the way your own terminal does (termkeys.ts).
      const natural = e.type === 'keydown' && !e.isComposing ? naturalKey(e) : undefined;
      if (natural === undefined) return true;
      e.preventDefault();
      t.input(natural);
      return false;
    });
    t.onData((data) => {
      if (!workerId) return;
      sendSize(true);
      net.send({ t: 'term.input', workerId, data });
    });
    return t;
  };

  const detach = () => {
    if (workerId && term) {
      release?.();
      release = undefined;
      if (!terminalHeld(workerId)) net.send({ t: 'worker.detach', workerId });
    }
    keepWidths(term);
    term?.dispose();
    term = undefined;
    fitter = undefined;
    ready = false;
    lastSent = '';
  };

  return {
    show(id) {
      if (id === workerId && term) return;
      detach();
      workerId = id;
      host.replaceChildren();
      if (!id) return;
      term = make();
      release = holdTerminal(id);
      net.send({ t: 'worker.attach', workerId: id });
    },
    fit() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => sendSize());
    },
    drop() {
      detach();
      workerId = undefined;
    },
    focus: () => term?.focus(),
  };
}
