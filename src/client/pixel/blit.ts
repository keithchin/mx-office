// Putting pixel art on the screen with every pixel square (pixel.ts, and the home page's overview).
// At a whole-step zoom it goes straight on with no smoothing; between steps it's blown up a whole
// number of times past the size wanted first, then smoothed down the last little way, so no pixel is
// ever more than one screen pixel off its neighbours.

/**
 * Draws `art` onto `g` at device pixel (x, y), `s` device pixels to an art pixel, using `buffer` for
 * the in-between sizes. Over `maxBuffer` pixels the buffer would get, it just goes on unsmoothed.
 */
export function blitCrisp(g: CanvasRenderingContext2D, art: HTMLCanvasElement, buffer: HTMLCanvasElement, x: number, y: number, s: number, maxBuffer = Infinity) {
  const k = Math.max(1, Math.ceil(s - 1e-6));
  const dx = Math.round(x), dy = Math.round(y), dw = Math.round(art.width * s), dh = Math.round(art.height * s);
  g.imageSmoothingEnabled = false;
  if (Math.abs(s - Math.round(s)) < 1e-6 || art.width * art.height * k * k > maxBuffer) {
    g.drawImage(art, dx, dy, dw, dh);
    return;
  }
  if (buffer.width !== art.width * k || buffer.height !== art.height * k) {
    buffer.width = art.width * k;
    buffer.height = art.height * k;
  }
  const bg = buffer.getContext('2d')!;
  bg.imageSmoothingEnabled = false;
  bg.drawImage(art, 0, 0, buffer.width, buffer.height);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(buffer, dx, dy, dw, dh);
  g.imageSmoothingEnabled = false;
}
