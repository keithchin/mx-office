// How the 3D office is drawn: the view (3D, or retro's chunky pixels) and how much drawing it does
// per frame (the quality), for computers the full office is too much for.

export type GraphicsQuality = 'low' | 'medium' | 'high';
/**
 * How the office is shown: the 1D view (/lite, the default: the board and the list of workers), the
 * 2D view (/pixel: the floor from above, in pixel art), or walking around it in 3D or retro.
 */
export type View = '1d' | '2d' | '3d' | 'retro';

export interface Graphics {
  view: View;
  quality: GraphicsQuality;
  /** The most screen pixels drawn per CSS pixel (window.devicePixelRatio is capped at this). */
  maxPixelRatio: number;
  antialias: boolean;
  /** The sun's shadow map size, or 0 for no shadows at all (the shadow pass is skipped). */
  shadowMapSize: number;
  /** The toon outline, which draws every outlined mesh a second time. */
  outline: boolean;
  /** The world's pixels to the window's CSS pixels: under 1, it's drawn small and scaled up blocky (retro, see core/retro.ts). */
  pixelScale: number;
}

type Quality = Omit<Graphics, 'view' | 'pixelScale'>;

export const QUALITY: Record<GraphicsQuality, Quality> = {
  low: { quality: 'low', maxPixelRatio: 1, antialias: false, shadowMapSize: 0, outline: false },
  medium: { quality: 'medium', maxPixelRatio: 1.25, antialias: true, shadowMapSize: 1024, outline: true },
  high: { quality: 'high', maxPixelRatio: 2, antialias: true, shadowMapSize: 2048, outline: true },
};

/** Retro draws the world a third of the pixels across and scales it up blocky; what you read stays sharp. */
const RETRO_PIXEL_SCALE = 1 / 3;

const VIEW_KEY = 'agent-office.view';
const QUALITY_KEY = 'agent-office.graphics';
const isView = (v: unknown): v is View => v === '1d' || v === '2d' || v === '3d' || v === 'retro';
const isQuality = (q: unknown): q is GraphicsQuality => typeof q === 'string' && q in QUALITY;

/** `?<param>=` picks it (and remembers it), otherwise the last one picked, otherwise `fallback`. */
function pick<T extends string>(param: string, key: string, valid: (v: unknown) => v is T, fallback: T): T {
  const asked = new URLSearchParams(location.search).get(param);
  try {
    if (valid(asked)) localStorage.setItem(key, asked);
    const saved = localStorage.getItem(key);
    if (valid(saved)) return saved;
  } catch {
    // No storage (a private window): the URL still counts, for this load.
  }
  return valid(asked) ? asked : fallback;
}

/**
 * The view as it's kept in storage. '2d' used to mean the board at /lite (the 1D view now), so a
 * browser that saved it back then still opens on the board; the pixel office is kept as 'pixel'.
 */
const stored = (v: View): string => (v === '2d' ? 'pixel' : v);
function fromStorage(saved: string | null): View | undefined {
  if (saved === 'pixel') return '2d';
  if (saved === '2d') return '1d';
  return isView(saved) ? saved : undefined;
}

/** `?view=` picks it (and remembers it), otherwise the last one picked, otherwise the 1D view. */
function pickView(): View {
  const asked = new URLSearchParams(location.search).get('view');
  try {
    if (isView(asked)) localStorage.setItem(VIEW_KEY, stored(asked));
    const saved = fromStorage(localStorage.getItem(VIEW_KEY));
    if (saved) return saved;
  } catch {
    // No storage (a private window): the URL still counts, for this load.
  }
  return isView(asked) ? asked : '1d';
}

// Read as this module loads, before main.ts tidies the address bar (see chose3d there).
const chosen: Graphics = (() => {
  const view = pickView();
  const q = QUALITY[pick('gfx', QUALITY_KEY, isQuality, 'high')];
  return { ...q, view, pixelScale: view === 'retro' ? RETRO_PIXEL_SCALE : 1 };
})();

/** This browser's view and quality (see pick). Changing either takes a reload: see switchView. */
export const graphics = (): Graphics => chosen;

/** The page that shows the office in `view`: the 1D and 2D views each have a page of their own. */
export function viewUrl(view: View): string {
  // The flat views say their floor in the address (see shared/address.ts), so switching keeps it.
  let floor: string | null = null;
  try {
    floor = localStorage.getItem('agent-office.floor');
  } catch {
    // No storage: the other view picks the floor itself.
  }
  const on = floor ? `?floor=${encodeURIComponent(floor)}` : '';
  return view === '1d' ? `/lite${on}` : view === '2d' ? `/pixel${on}` : `/?3d=1&view=${view}`;
}

/** Remembers `view` for next time without going anywhere: for the page that already is it. */
export function rememberView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, stored(view));
  } catch {
    // No storage: just this once, then.
  }
}

/** Into the office in `view`, remembered for next time. */
export function switchView(view: View) {
  rememberView(view);
  location.assign(viewUrl(view));
}
