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

/** An editor's light terminal, for the Clean (Light) theme (styles/theme-clean.css): on its --code-bg. */
export const TERM_THEME_CLEAN_LIGHT = {
  background: '#f8f8f8',
  foreground: '#3b3b3b',
  cursor: '#005fb8',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#107c10',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

/** An editor's dark terminal, for the Clean (Dark) theme: on its --code-bg. */
export const TERM_THEME_CLEAN_DARK = {
  background: '#181818',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

/** The colors for a terminal opened now: green while the 1D view wears its Terminal theme (ui/colortheme.ts), an editor's in a Clean theme, the usual ones otherwise. */
export function termTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'terminal' ? TERM_THEME_GREEN : t === 'clean-light' ? TERM_THEME_CLEAN_LIGHT : t === 'clean-dark' ? TERM_THEME_CLEAN_DARK : TERM_THEME;
}
