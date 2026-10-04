// How much drawing the 3D office does per frame, for computers it's too much for.

export type GraphicsQuality = 'retro' | 'low' | 'medium' | 'high';

export interface Graphics {
  quality: GraphicsQuality;
  /** The most screen pixels drawn per CSS pixel (window.devicePixelRatio is capped at this). */
  maxPixelRatio: number;
  antialias: boolean;
  /** The sun's shadow map size, or 0 for no shadows at all (the shadow pass is skipped). */
  shadowMapSize: number;
  /** The toon outline, which draws every outlined mesh a second time. */
  outline: boolean;
  /** Scaled up blocky rather than smoothed: chunky pixels, for a 16-bit look at a fraction of the pixels. */
  pixelated: boolean;
}

export const GRAPHICS: Record<GraphicsQuality, Graphics> = {
  retro: { quality: 'retro', maxPixelRatio: 0.34, antialias: false, shadowMapSize: 512, outline: true, pixelated: true },
  low: { quality: 'low', maxPixelRatio: 1, antialias: false, shadowMapSize: 0, outline: false, pixelated: false },
  medium: { quality: 'medium', maxPixelRatio: 1.25, antialias: true, shadowMapSize: 1024, outline: true, pixelated: false },
  high: { quality: 'high', maxPixelRatio: 2, antialias: true, shadowMapSize: 2048, outline: true, pixelated: false },
};

const KEY = 'agent-office.graphics';
const isQuality = (q: unknown): q is GraphicsQuality => typeof q === 'string' && q in GRAPHICS;

/**
 * This browser's choice: `?gfx=low|medium|high` picks it (and remembers it), otherwise the last one
 * picked, otherwise high. It's read once, as the renderer is made: changing it takes a reload.
 */
export function graphics(): Graphics {
  const asked = new URLSearchParams(location.search).get('gfx');
  try {
    if (isQuality(asked)) localStorage.setItem(KEY, asked);
    const saved = localStorage.getItem(KEY);
    if (isQuality(saved)) return GRAPHICS[saved];
  } catch {
    // No storage (a private window): the URL still counts, for this load.
    if (isQuality(asked)) return GRAPHICS[asked];
  }
  return GRAPHICS.high;
}
