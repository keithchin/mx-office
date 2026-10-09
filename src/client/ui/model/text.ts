// Text for the diagrams: Studio Pro's font (Segoe UI on Windows, the nearest sans elsewhere),
// measured with a canvas so captions wrap and names cut off where Studio Pro's would, and escaped
// for the SVG the renderers build as strings.

export const FONT_FAMILY = "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif";
export const FONT_SIZE = 11.5;
export const LINE = 15;

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

/** The width of `text` at `size` px (an estimate when there's no canvas, as in tests). */
export function measure(text: string, size = FONT_SIZE, weight = 400): number {
  const key = `${size}|${weight}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  let w: number;
  if (ctx) {
    ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
    w = ctx.measureText(text).width;
  } else w = text.length * size * 0.52;
  if (cache.size > 5000) cache.clear();
  cache.set(key, w);
  return w;
}

/** `text` broken into lines no wider than `max`, at most `maxLines` (the last ends in "…" when cut). */
export function wrap(text: string, max: number, maxLines: number, size = FONT_SIZE): string[] {
  const out: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size) <= max || !line) {
        line = next;
        // A single word too long for the line is cut where it fits.
        while (measure(line, size) > max && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut), size) > max) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  const lines = out.filter((l, i) => l || i < out.length - 1);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsis(`${kept[maxLines - 1]} ${lines[maxLines]}`, max, size);
  return kept;
}

/** `text` cut to fit `max` px with "…" (Studio Pro's long attribute names). */
export function ellipsis(text: string, max: number, size = FONT_SIZE): string {
  if (measure(text, size) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`, size) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** A number for SVG: at most two decimals. */
export const n = (v: number): string => String(Math.round(v * 100) / 100);
