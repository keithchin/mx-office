// Which journeys get recorded by themselves when the live app says a milestone is ready (release 57's
// readiness news): only with the project's switch on, only for a milestone that is ready in the running
// build right now, only the journeys of it that passed against that very build, never one already recorded
// (or queued) by itself for that commit. A milestone that is merely built ("not yet verified") or whose
// journey failed records nothing. Pure.

import type { LiveReadiness } from '../liveapp/readiness.js';

export interface AutoInput {
  readiness: LiveReadiness;
  milestone: string;
  /** The commit the news was about. */
  sha: string;
  autoRecord: boolean;
  /** Journey ids already recorded automatically (or queued) at this commit. */
  done: ReadonlySet<string>;
}

export function autoJourneys(i: AutoInput): string[] {
  if (!i.autoRecord || !i.readiness.sha || i.readiness.sha !== i.sha) return [];
  const m = i.readiness.milestones.find((x) => x.id === i.milestone);
  if (!m || m.state !== 'ready') return [];
  return m.journeys.filter((j) => j.result === 'passed' && !i.done.has(j.id)).map((j) => j.id);
}
