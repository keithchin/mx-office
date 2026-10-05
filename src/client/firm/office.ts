// The Firm's office, in a small pixel picture: dark wood, navy walls, brass lamps, a desk per
// reviewer. Idle reviewers sit at their desks; the ones on an engagement get up and walk out of the
// door "to the client", again and again while it runs. Still for anyone who prefers less motion.

import type { ReviewerRole } from '../../shared/firm/roles';
import { drawBust } from './portraits';

/** The picture's grid: one grid pixel is SCALE canvas pixels. */
const GW = 200;
const GH = 64;
const SCALE = 4;
const DOOR_X = 184;
/** How long one walk to the door takes, and the pause before the next. */
const WALK_MS = 5200;

export interface OfficeHandle {
  update(people: ReviewerRole[], away: Set<string>): void;
  stop(): void;
}

export function firmOffice(): { el: HTMLCanvasElement; handle: OfficeHandle } {
  const c = document.createElement('canvas');
  c.width = GW * SCALE;
  c.height = GH * SCALE;
  c.className = 'firm-office';
  c.setAttribute('role', 'img');
  const ctx = c.getContext('2d')!;
  let people: ReviewerRole[] = [];
  let away = new Set<string>();
  let raf = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x * SCALE), Math.round(y * SCALE), Math.round(w * SCALE), Math.round(h * SCALE));
  };

  function room() {
    // Navy wall with wainscot, wood floor.
    px(0, 0, GW, 40, '#1d2a44');
    px(0, 28, GW, 12, '#3a2a1f');
    px(0, 28, GW, 1, '#c9a14a');
    px(0, 40, GW, GH - 40, '#5a3d29');
    for (let x = 0; x < GW; x += 16) px(x, 40, 1, GH - 40, '#4a3222');
    for (let y = 44; y < GH; y += 6) px(0, y, GW, 0.5, '#4f3524');
    // Bookshelves, a framed sign, brass lamps.
    for (const bx of [6, 150]) {
      px(bx, 6, 22, 22, '#2a1d16');
      for (let row = 0; row < 3; row++) for (let b = 0; b < 9; b++) px(bx + 1 + b * 2.3, 8 + row * 7, 1.8, 5, ['#9b2c2c', '#2f5d7c', '#c9a14a', '#3b6b4a', '#6b4e8a'][(b + row * 2) % 5]);
    }
    px(70, 6, 60, 13, '#c9a14a');
    px(71, 7, 58, 11, '#141c2e');
    ctx.fillStyle = '#e8d29a';
    ctx.font = `bold ${7 * SCALE}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText('THE FIRM', 100 * SCALE, 15.5 * SCALE);
    for (const lx of [40, 140]) {
      px(lx, 10, 2, 6, '#c9a14a');
      px(lx - 2, 8, 6, 3, '#e8d29a');
    }
    // The door out to the clients, ajar.
    px(DOOR_X, 12, 14, 28, '#2a1d16');
    px(DOOR_X + 1, 13, 12, 27, '#7a5232');
    px(DOOR_X + 10, 26, 1.5, 1.5, '#c9a14a');
    ctx.fillStyle = '#e8d29a';
    ctx.font = `bold ${3.4 * SCALE}px sans-serif`;
    ctx.fillText('CLIENTS →', (DOOR_X + 7) * SCALE, 10 * SCALE);
  }

  const deskX = (i: number) => 14 + i * 24;

  function frame(t: number) {
    room();
    people.forEach((p, i) => {
      const x = deskX(i);
      const out = away.has(p.id);
      // The desk, the chair behind it, a lamp and papers.
      px(x - 2, 36, 18, 3, '#6b4423');
      px(x - 1, 39, 2, 9, '#4a2f1a');
      px(x + 13, 39, 2, 9, '#4a2f1a');
      px(x + 11, 33, 1, 3, '#c9a14a');
      px(x + 9.5, 32, 4, 1.5, '#e8d29a');
      px(x + 1, 35, 5, 1, '#f4f1ea');
      if (!out) {
        // At the desk: the bust peeks over it.
        drawBust(ctx, p.look, (x + 2) * SCALE, 16 * SCALE, SCALE * 0.5);
        px(x - 2, 36, 18, 3, '#6b4423');
        return;
      }
      // On an engagement: walking from the desk to the door, then gone for a beat.
      px(x + 3, 28, 8, 8, '#2a1d16');
      const phase = still ? 0.92 : ((t + i * 900) % (WALK_MS + 1800)) / WALK_MS;
      if (phase > 1) return;
      const wx = x + 4 + (DOOR_X + 2 - x - 4) * phase;
      const bob = still ? 0 : Math.abs(Math.sin(phase * 30)) * 0.8;
      drawBust(ctx, p.look, wx * SCALE, (30 - bob) * SCALE, SCALE * 0.5);
      px(wx + 3, 44 - bob, 2.2, 6, '#1b1b2a');
      px(wx + 7, 44 - bob, 2.2, 6, '#1b1b2a');
      // A briefcase.
      px(wx + 11, 41 - bob, 4, 3, '#7a4a1e');
    });
    if (!still && away.size) raf = requestAnimationFrame(frame);
  }

  const handle: OfficeHandle = {
    update(p, a) {
      people = p;
      away = a;
      c.setAttribute('aria-label', `The Firm's office: ${p.length - [...a].filter((id) => p.some((x) => x.id === id)).length} at their desks, ${a.size} out with a client`);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
    },
  };
  return { el: c, handle };
}
