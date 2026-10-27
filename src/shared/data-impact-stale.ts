// When a data-impact hold (shared/data-impact.ts) no longer guards anything: the rule behind "Release stale hold"
// (server/data-impact/stale.ts gathers the facts, the route and the dialog use the words). The rebuild run's
// candidate:DC-8 hold kept the change queue waiting for a change the live preview had run since the day before;
// "Take a database dump now" answered "Nothing is held on the live preview", so the only way out was the false
// statement "no data to keep". Pure.

const short = (sha: string) => sha.slice(0, 7);

/** What the office knows about a hold, to tell whether it is stale. */
export interface StaleFacts {
  env: string;
  target: string;
  /** For a candidate:DC-n hold: the change as the record has it now (undefined: no such change). */
  change?: { id: string; over?: string; newest?: string };
  /** The revision the live preview runs (or ran last), and whether it has the hold's target in its history. */
  served?: string;
  servedHas?: boolean;
  /** Whether the target changes the model itself (.mpr, mprcontents/) since it left main: false when all of its model difference came in from main. */
  ownModel?: boolean;
}

/**
 * Why a hold is stale, or undefined when it still guards something: the change it was for is gone or over, a
 * newer candidate replaced it, the target changes no model of its own (what the guard found came in from main,
 * which the live preview's own guard holds), or the live preview already runs a revision that has the target
 * (its data was migrated then).
 */
export function staleReason(f: StaleFacts): string | undefined {
  if (f.env.startsWith('candidate:')) {
    const id = f.env.slice(10);
    if (!f.change) return `${id} no longer exists`;
    if (f.change.over) return `${id} is ${f.change.over}: nothing will apply this candidate any more`;
    if (f.change.newest && f.change.newest !== f.target) return `a newer candidate of ${id} (@${short(f.change.newest)}) replaced @${short(f.target)}`;
    if (f.ownModel === false) return `@${short(f.target)} changes no model of its own: what the guard found came in from main, which the live preview guards itself`;
  }
  if (f.served && f.servedHas) return `the live preview already runs @${short(f.served)}, which has @${short(f.target)}: its data was migrated then`;
  return undefined;
}

/** The reason recorded with a release: the person's words and why the office found the hold stale. */
export const releaseWords = (why: string, reason: string) => `${reason.replace(/\s+/g, ' ').trim().slice(0, 500)} (stale: ${why})`;
