// The gong: the office rings it when a pull request merges or the queue runs dry. (Golf off the balcony,
// darts and axes and the air horn on the roof were the 3D office's, and went with it.)

/** Why the gong rang. */
export type GongWhy = 'merged' | 'queue';

export type RooftopServerMsg =
  /**
   * The gong rings, for everyone on the floor: pull request `pr` merged (confetti
   * over the desk it came from), or the last task on the queue just finished (a bigger party).
   */
  | { t: 'gong'; why: GongWhy; by?: string; pr?: number };
