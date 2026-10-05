// A floor's whole scene in art pixels, a frame of it at a time: the still office, what moves about it,
// the desks and the people at them, Jeff's room, then the color theme's tint over all of it. The 2D
// view (pixel.ts) draws its floor with it, and the home page's overview every floor (snapshot.ts).

import type { Theme } from '../../shared/protocol';
import type { ColorTheme } from '../ui/colortheme';
import type { Frame } from './frame';
import { drawPeople, type Cast, type People } from './people';
import { drawMoving } from './props';
import { drawRouter } from './router-room';
import { tintScene } from './tint';

export interface SceneState {
  /** The office's holiday theme, the jukebox playing, someone sharing their screen (the TV). */
  theme: Theme | null;
  music: boolean;
  sharing: boolean;
  colorTheme: ColorTheme;
}

/** Draws the scene into `ag` (the frame's size) over `still` (drawOffice's picture), and says where everyone is. */
export function paintScene(ag: CanvasRenderingContext2D, frame: Frame, still: HTMLCanvasElement, s: SceneState, cast: Cast, now: number): People {
  ag.imageSmoothingEnabled = false;
  ag.drawImage(still, 0, 0);
  drawMoving(ag, frame, { now, theme: s.theme, music: s.music, sharing: s.sharing });
  const people = drawPeople(ag, frame, cast, now);
  // Jeff's room first, so the theme tints it with the rest of the scene.
  drawRouter(ag, frame, now);
  tintScene(ag, frame, s.colorTheme);
  return people;
}
