// The window's size and place, kept between runs (only where a screen still is), the taskbar's overlay
// badge drawn as a bitmap (a red disc with the count; no canvas in Electron's main process), and the
// pages the window shows while there's no office to show: starting, stopped unexpectedly, and the
// problems that stop it starting. Their buttons are links the app catches (screens.ts). Pure.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindow extends Rect {
  maximized?: boolean;
}

export const DEFAULT_SIZE = { width: 1400, height: 900 };

/** The saved place when it's on a screen and sensible, else the default size (centred by Electron). */
export function fitBounds(saved: SavedWindow | undefined, screens: readonly Rect[]): { bounds: Partial<Rect> & { width: number; height: number }; maximized: boolean } {
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(ok) || saved.width < 400 || saved.height < 300) return { bounds: { ...DEFAULT_SIZE }, maximized: !!saved?.maximized };
  // At least 100 x 50 px of the title bar on some screen.
  const visible = screens.some((s) => {
    const w = Math.min(saved.x + saved.width, s.x + s.width) - Math.max(saved.x, s.x);
    const top = saved.y >= s.y - 10 && saved.y < s.y + s.height - 50;
    return w >= 100 && top;
  });
  if (!visible) return { bounds: { width: Math.min(saved.width, DEFAULT_SIZE.width), height: Math.min(saved.height, DEFAULT_SIZE.height) }, maximized: !!saved.maximized };
  return { bounds: { x: saved.x, y: saved.y, width: saved.width, height: saved.height }, maximized: !!saved.maximized };
}

// A 3 x 5 pixel font: the digits and a plus.
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

/** "1"…"9", then "9+". */
export const badgeLabel = (n: number) => (n > 9 ? '9+' : String(Math.max(0, Math.floor(n))));

/**
 * The overlay badge as a size x size BGRA bitmap (Electron's nativeImage.createFromBitmap): a red disc,
 * the count in white. 32 px, shown at 16 (scale factor 2).
 */
export function badgeBitmap(n: number, size = 32): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x: number, y: number, b: number, g: number, r: number, a: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
    buf[i + 3] = a;
  };
  const c = (size - 1) / 2;
  const rad = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      // Soft edge: a pixel's worth of anti-aliasing.
      const a = Math.max(0, Math.min(1, rad - d));
      if (a > 0) put(x, y, 0x2d, 0x2d, 0xd6, Math.round(a * 255));
    }
  }
  const text = badgeLabel(n);
  const scale = text.length > 1 ? Math.floor(size / 11) : Math.floor(size / 8);
  const w = (text.length * 4 - 1) * scale;
  const h = 5 * scale;
  const x0 = Math.round((size - w) / 2);
  const y0 = Math.round((size - h) / 2);
  [...text].forEach((ch, k) => {
    const g = GLYPHS[ch];
    if (!g) return;
    for (let gy = 0; gy < 5; gy++)
      for (let gx = 0; gx < 3; gx++)
        if (g[gy][gx] === '1') for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(x0 + (k * 4 + gx) * scale + sx, y0 + gy * scale + sy, 0xff, 0xff, 0xff, 0xff);
  });
  return buf;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export interface PageAction {
  label: string;
  /** An action link for the app (screens.ts act()), or an https link (opened in the browser). */
  href: string;
  primary?: boolean;
}

export interface PageSpec {
  title: string;
  /** Paragraphs (plain text). */
  lines: string[];
  actions?: PageAction[];
  /** A block of log lines, shown as they are. */
  log?: string;
  /** A spinner: something's under way. */
  busy?: boolean;
}

/** A small page of the app's own, as a data: URL's HTML (no script: its buttons are links). */
export function pageHtml(p: PageSpec): string {
  const actions = (p.actions ?? []).map((a) => `<a class="btn${a.primary ? ' primary' : ''}" href="${esc(a.href)}">${esc(a.label)}</a>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Mx Office</title><style>
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1c2330;--muted:#5b6475;--card:#fff;--line:#d9dee7;--accent:#0b6bcb}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e8ebf0;--muted:#a0a8b6;--card:#1d2128;--line:#2f3642;--accent:#4c9ef0}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Segoe UI",system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:28px 32px;max-width:760px;width:calc(100% - 64px);box-sizing:border-box}
h1{font-size:20px;margin:0 0 12px}p{margin:8px 0;color:var(--muted)}
pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:10px;max-height:300px;overflow:auto;font:12px/1.4 Consolas,monospace;white-space:pre-wrap;word-break:break-all}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.btn{padding:7px 16px;border-radius:6px;border:1px solid var(--line);color:var(--fg);text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.spin{width:22px;height:22px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:s 1s linear infinite;margin-bottom:12px}@keyframes s{to{transform:rotate(360deg)}}
</style></head><body><main>${p.busy ? '<div class="spin"></div>' : ''}<h1>${esc(p.title)}</h1>${p.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${p.log ? `<pre>${esc(p.log)}</pre>` : ''}${actions ? `<div class="row">${actions}</div>` : ''}</main></body></html>`;
}

export const dataUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
