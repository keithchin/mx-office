// The 2D view's office in the flat views' color theme (ui/colortheme.ts): Default as it's drawn, Dark
// at night (the room in a blue dusk, each lamp a warm pool in it), Terminal on a green phosphor screen
// (every colour turned to the one green, its brightness kept), Clean (Light) as drawn with its colours
// a touch quieter, and Clean (Dark) at a grey, colourless night (the Portal pair as the Clean pair). Laid over the art canvas each frame,
// after the people and before the names, which stay sharp and readable on top.

import type { ColorTheme } from '../ui/colortheme';
import { lamps } from './light';
import type { Frame } from './frame';

/** Tints the art canvas `g` (the frame's size) for `theme`. */
export function tintScene(g: CanvasRenderingContext2D, f: Frame, theme: ColorTheme) {
  if (theme === 'default') return;
  g.save();
  if (theme === 'clean-light' || theme === 'portal-light') {
    // A little of the colour out, nothing else: a light grey laid over in 'saturation'.
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = 0.18;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, f.width, f.height);
  } else if (theme === 'clean-dark' || theme === 'portal-dark') {
    // Night without a colour cast: half the colour out, then a neutral grey multiplied in, and the lamps
    // a soft white pool each.
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = 0.45;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, f.width, f.height);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#5c5c5c';
    g.fillRect(0, 0, f.width, f.height);
    g.globalCompositeOperation = 'lighter';
    for (const l of lamps(f)) {
      const r = l.r * 1.3;
      const glow = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      glow.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.28, l.strength * 2)})`);
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = glow;
      g.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
  } else if (theme === 'dark') {
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
