// What the surfaced asks' look finds besides AWAITING-PM items (server/asks/service.ts): one detector per
// kind of thing the Project Manager would otherwise only hear of by asking. Pure: the service hands it
// what was read (sources.ts) and what the office knows of main.

import type { AskAct, AskItem, BranchStandup } from '../../shared/asks.js';
import type { Read } from './sources.js';

/** The files the detectors read from every place (besides the team journals). */
export const DETECT_FILES: string[] = [];

export interface DetectInput {
  reads: readonly Read[];
  now: number;
}

export interface Detected {
  items: AskItem[];
  standup?: BranchStandup;
}

/** Everything the look found, the warn ones first. */
export function detectAsks(_i: DetectInput): Detected {
  return { items: [] };
}

/** What a button sends whoever covers Management, as the Project Manager. */
export function actMessage(_act: AskAct, _it: AskItem, _by: string): string | undefined {
  return undefined;
}
