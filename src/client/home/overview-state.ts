// The ⏸ / ▶ state icon on a floor's banner in Home's 2D Overview (home/overview.ts): the same states as
// the project cards' icon (home/run-state.ts), drawn as shapes on the canvas rather than emoji, so it
// reads the same in every theme, the Clean ones included.

import type { CardStateKind } from './run-state-logic';

export interface StateColors {
  card: string;
  line: string;
  good: string;
  amber: string;
  ink: string;
}

/** A round badge `size` across with its top-left at (x, y): ⏸ bars, ▶ a triangle, or an amber hourglass. */
export function drawRunState(g: CanvasRenderingContext2D, kind: CardStateKind, x: number, y: number, size: number, c: StateColors) {
  const r = size / 2, cx = x + r, cy = y + r;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = kind === 'running' ? c.good : kind === 'paused' ? c.card : c.amber;
  g.fill();
  g.lineWidth = Math.max(1, size / 12);
  g.strokeStyle = c.line;
  g.stroke();
  g.fillStyle = c.ink;
  const u = size / 10;
  if (kind === 'paused') {
    g.fillRect(cx - 2.2 * u, cy - 2.6 * u, 1.5 * u, 5.2 * u);
    g.fillRect(cx + 0.7 * u, cy - 2.6 * u, 1.5 * u, 5.2 * u);
  } else if (kind === 'running') {
    g.beginPath();
    g.moveTo(cx - 1.6 * u, cy - 2.8 * u);
    g.lineTo(cx + 2.8 * u, cy);
    g.lineTo(cx - 1.6 * u, cy + 2.8 * u);
    g.closePath();
    g.fill();
  } else {
    // An hourglass: two triangles point to point.
    g.beginPath();
    g.moveTo(cx - 2.2 * u, cy - 2.8 * u);
    g.lineTo(cx + 2.2 * u, cy - 2.8 * u);
    g.lineTo(cx - 2.2 * u, cy + 2.8 * u);
    g.lineTo(cx + 2.2 * u, cy + 2.8 * u);
    g.closePath();
    g.fill();
  }
}
