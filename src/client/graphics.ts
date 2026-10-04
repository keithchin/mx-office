// How the 3D office is drawn: the view (3D, or retro's chunky pixels) and how much drawing it does
// per frame (the quality), for computers the full office is too much for.

export type GraphicsQuality = 'low' | 'medium' | 'high';
/** How the office is shown: the 2D view (/lite, the default), or walking around it in 3D or retro. */
export type View = '2d' | '3d' | 'retro';

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
const isView = (v: unknown): v is View => v === '2d' || v === '3d' || v === 'retro';
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

// Read as this module loads, before main.ts tidies the address bar (see chose3d there).
const chosen: Graphics = (() => {
  const view = pick('view', VIEW_KEY, isView, '2d');
  const q = QUALITY[pick('gfx', QUALITY_KEY, isQuality, 'high')];
  return { ...q, view, pixelScale: view === 'retro' ? RETRO_PIXEL_SCALE : 1 };
})();

/** This browser's view and quality (see pick). Changing either takes a reload: see switchView. */
export const graphics = (): Graphics => chosen;

/** Into the office in `view`, remembered for next time. */
export function switchView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // No storage: just this once, then.
  }
  location.assign(view === '2d' ? '/lite' : `/?3d=1&view=${view}`);
}
