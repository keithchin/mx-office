// Which projects are Expert projects: the project record's `mode` (owned by the session shell); absent is Team mode.
import { isExpertMode } from '../../shared/expert-proof.js';

/** Whether the project is an Expert project: its record's `mode` is 'expert' (absent: a Team project). */
export const isExpertProject = (floor: { def?: unknown } | undefined): boolean => isExpertMode(floor?.def as { mode?: unknown } | undefined);
