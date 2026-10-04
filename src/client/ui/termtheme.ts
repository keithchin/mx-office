// The terminals' colors: in a terminal window (ui/terminal.ts), and on the laptops at the desks (features/workers/laptop.ts).

export const TERM_THEME = {
  background: '#1e1f2e',
  foreground: '#e6e6f0',
  cursor: '#ffd166',
  selectionBackground: '#44475a',
  black: '#282a36',
  red: '#ff5c7a',
  green: '#7cf29a',
  yellow: '#ffd166',
  blue: '#6cb6ff',
  magenta: '#d69cff',
  cyan: '#72ddf7',
  white: '#e6e6f0',
  brightBlack: '#6c7086',
  brightRed: '#ff8fa3',
  brightGreen: '#a6f4b8',
  brightYellow: '#ffe29a',
  brightBlue: '#9ccfff',
  brightMagenta: '#e5c1ff',
  brightCyan: '#a5ecfb',
  brightWhite: '#ffffff',
};

/** A green phosphor screen, for the 1D view's Terminal theme (styles/theme-terminal.css): amber and red still stand out in it. */
export const TERM_THEME_GREEN = {
  background: '#000000',
  foreground: '#33ff66',
  cursor: '#33ff66',
  cursorAccent: '#000000',
  selectionBackground: '#1c6e33',
  black: '#0a140c',
  red: '#ff5555',
  green: '#33ff66',
  yellow: '#ffb000',
  blue: '#39d5ff',
  magenta: '#c792ff',
  cyan: '#5cf2c8',
  white: '#b8ffc9',
  brightBlack: '#1f8a3e',
  brightRed: '#ff8080',
  brightGreen: '#8cffad',
  brightYellow: '#ffcc55',
  brightBlue: '#80e5ff',
  brightMagenta: '#ddb8ff',
  brightCyan: '#9dffe3',
  brightWhite: '#eafff0',
};

/** The colors for a terminal opened now: green while the 1D view wears its Terminal theme (ui/colortheme.ts), the usual ones otherwise. */
export function termTheme() {
  return document.documentElement.dataset.theme === 'terminal' ? TERM_THEME_GREEN : TERM_THEME;
}
