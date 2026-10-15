// Needs you's input on a page, the same for every surface that shows it (the Command Center's strip, the
// team phone, the phone version; the Overview card and the lead panel's count read the strip's snapshot):
// the store's workers, PRs and floors, plus every per-floor feed (incidents, stuck, surfaced asks,
// questions, the decision cards' Separate choices), through the one builder (shared/decisions/input.ts).
// What only a page knows (the setup panel, the live app, the Firm, Studio mode, the budget) it hands in.
// No fetch of its own: each feed fetches once per floor and again when the audit log says so.

import type { NeedsInput } from '../../../shared/needsyou';
import type { ServerMsg } from '../../../shared/protocol';
import type { RosterView } from '../../../shared/roster/types';
import { needsInputOf } from '../../../shared/decisions/input';
import { store } from '../../state';
import { incidentBriefs, incidentFeedMessage, onIncidentsChanged } from '../incidents/feed';
import { onStuckChanged, stuckFeedMessage, stuckNeed } from '../stuck/feed';
import { asksFeedMessage, asksNeed, onAsksChanged } from '../asks/feed';
import { onQuestionsChanged, questionsFeedMessage, questionsNeed } from '../questions/feed';
import { decisionsFeedMessage, decisionSplits, onDecisionsChanged } from '../decisions/feed';
import { dispatchFeedMessage } from '../dispatch/feed';
import { followFeedMessage } from '../followthrough/feed';
import { brainFeedMessage, brainNeed, onBrainChanged } from '../portfolios/feed';

/** What a page knows that the feeds don't. */
export type PageNeeds = Partial<Pick<NeedsInput, 'setup' | 'live' | 'firm' | 'studio' | 'budget'>>;

/** The floor's Needs-you input, from the store, every feed and what the page hands in. */
export function pageNeedsInput(floor: string | undefined, roster: RosterView | undefined, page: PageNeeds): NeedsInput {
  return needsInputOf({
    floor,
    workers: store.workers.values(),
    roster,
    pulls: store.pulls.items,
    floors: store.floors,
    setup: page.setup,
    live: page.live,
    firm: page.firm,
    studio: page.studio,
    incidents: incidentBriefs(),
    budget: page.budget,
    stuck: stuckNeed(floor),
    asks: asksNeed(floor),
    questions: questionsNeed(floor),
    splits: decisionSplits(floor),
    brain: brainNeed(floor),
  });
}

/** Calls `fn` whenever any feed Needs you reads changes. */
export function onNeedsFeeds(fn: () => void): void {
  onIncidentsChanged(fn);
  onStuckChanged(fn);
  onAsksChanged(fn);
  onQuestionsChanged(fn);
  onDecisionsChanged(fn);
  onBrainChanged(fn);
}

/** Hands every message from the office to each feed (they fetch again when the audit log says theirs changed). */
export function needsFeedsMessage(msg: ServerMsg): void {
  incidentFeedMessage(msg);
  stuckFeedMessage(msg);
  asksFeedMessage(msg);
  questionsFeedMessage(msg);
  decisionsFeedMessage(msg);
  dispatchFeedMessage(msg);
  followFeedMessage(msg);
  brainFeedMessage(msg);
}
