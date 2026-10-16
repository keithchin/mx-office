// Terminal output the shape of a long Claude Code session, for the fake agent's FAKE_FLOOD (fake-agent.mjs):
// wide lines (tool output and diffs past 200 columns), truecolor and background-coloured runs, bold and
// italic text, and the TUI's own glyphs (● ⎿ ✻ │ ─ ╭ ╮ ✓ ⚠ and a few emoji). A big replay of exactly this
// is what froze the live Command Center's terminal (the terminal-freeze pass, 2026-10-16): every glyph
// in every variant is one more width xterm's DOM renderer measures, and every byte is parsed in one go.
// Deterministic: the same `seed` gives the same text.

const GLYPHS = ['●', '⎿', '✻', '✶', '✳', '·', '│', '─', '╭', '╮', '╰', '╯', '↑', '↓', '→', '✓', '✗', '⚠', 'é', 'ü', 'ñ', 'ß', '…', '📝', '🔧', '✅'];
const WORDS = 'const order invoice approval await return export function module test expect describe import from status pending merged review build deploy branch commit lint typecheck render'.split(' ');

/** About `kb` KB of session output, `\r\n` line ends, starting at line `seed`. */
export function floodText(kb, seed = 0) {
  const want = Math.max(1, kb) * 1024;
  let out = '';
  let n = seed;
  const word = () => WORDS[(n * 7 + out.length) % WORDS.length];
  const words = (k) => Array.from({ length: k }, (_, i) => WORDS[(n * 13 + i * 5) % WORDS.length]).join(' ');
  while (out.length < want) {
    n++;
    const g = GLYPHS[n % GLYPHS.length];
    const rgb = `${(n * 37) % 256};${(n * 91) % 256};${(n * 53) % 256}`;
    switch (n % 6) {
      case 0: // a tool call and its result, wide
        out += `\x1b[38;2;${rgb}m●\x1b[39m \x1b[1mBash\x1b[22m(npm test -- --grep ${word()}-${n})\r\n  ⎿  ${words(32)} ${g}\r\n`;
        break;
      case 1: // a diff line on a background colour, past 200 columns
        out += `\x1b[48;2;${(n * 3) % 64};${40 + (n % 40)};${(n * 5) % 64}m\x1b[38;5;${n % 256}m ${String(n).padStart(5)} + ${words(28)} \x1b[0m\r\n`;
        break;
      case 2: // italic and bold prose
        out += `\x1b[3m${words(18)}\x1b[23m \x1b[1;3m${word()}\x1b[0m ${g} ${words(10)}\r\n`;
        break;
      case 3: // the box the TUI draws round its prompt
        out += `╭${'─'.repeat(120)}╮\r\n│ ${g} ${words(14).padEnd(117).slice(0, 117)}│\r\n╰${'─'.repeat(120)}╯\r\n`;
        break;
      case 4: // a spinner line redrawn in place
        out += `\x1b[38;2;${rgb}m${GLYPHS[(n + 2) % 6]}\x1b[39m Working… (${n % 60}s · ↑ ${n * 3} tokens)\x1b[K\r\x1b[2K`;
        break;
      default: // plain wide output
        out += `${words(40)} ✓\r\n`;
    }
  }
  return out;
}
