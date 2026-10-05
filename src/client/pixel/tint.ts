// The 2D view's office in the flat views' color theme (ui/colortheme.ts): Default as it's drawn, Dark
// at night (the room in a blue dusk, each lamp a warm pool in it), Terminal on a green phosphor screen
// (every colour turned to the one green, its brightness kept). Laid over the art canvas each frame,
// after the people and before the names, which stay sharp and readable on top.

import type { ColorTheme } from '../ui/colortheme';
import { lamps } from './light';
import type { Frame } from './frame';

/** Tints the art canvas `g` (the frame's size) for `theme`. */
export function tintScene(g: CanvasRenderingContext2D, f: Frame, theme: ColorTheme) {
  if (theme === 'default') return;
  g.save();
  if (theme === 'dark') {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#5b64a6';
    g.fillRect(0, 0, f.width, f.height);
    // The lamps light their patch again.
    g.globalCompositeOperation = 'lighter';
    for (const l of lamps(f)) {
      const r = l.r * 1.4;
      const glow = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      glow.addColorStop(0, `rgba(${l.color}, ${Math.min(0.5, l.strength * 3)})`);
      glow.addColorStop(1, `rgba(${l.color}, 0)`);
      g.fillStyle = glow;
      g.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
  } else {
    // Every colour the one green, at its own brightness, then a little darker, like a screen's glow.
    g.globalCompositeOperation = 'color';
    g.fillStyle = '#33ff66';
    g.fillRect(0, 0, f.width, f.height);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#8fcf9c';
    g.fillRect(0, 0, f.width, f.height);
  }
  g.restore();
}
