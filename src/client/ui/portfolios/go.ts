// A company brain card's button (shared/decisions/brain.ts), from any page that shows Needs you: an admin's
// Rehire for a fresh session, Dismiss or Wire again goes to the office (ui/portfolios/feed.ts); anyone else
// is taken to Home › Portfolios to see the portfolio.

import type { NeedTarget } from '../../../shared/needsyou';
import { store } from '../../state';
import { toast } from '../dom';
import { brainAct } from './feed';

const DONE: Record<Extract<NeedTarget, { to: 'brain' }>['act'], string> = {
  rehire: 'Benching first (handoff note), then each is hired again with a fresh session.',
  dismiss: 'Dismissed: the sessions carry on as they were prepared.',
  rewire: 'Wired again and checked.',
  'dismiss-wiring': 'Dismissed.',
};

export async function goBrain(t: Extract<NeedTarget, { to: 'brain' }>): Promise<void> {
  if (!store.me.admin) return location.assign('/home?tab=portfolios');
  const err = await brainAct(t.floor, t.act);
  toast(err ? `Couldn't: ${err}` : DONE[t.act], err ? 'warn' : 'info');
}
