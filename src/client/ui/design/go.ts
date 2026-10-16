// The design system card's buttons (shared/decisions/design.ts), from any page that shows Needs you: an admin's
// Adopt or Keep existing design goes to the office; View (anyone else) opens the project's Design gallery.

import type { NeedTarget } from '../../../shared/needsyou';
import { store } from '../../state';
import { toast } from '../dom';
import { designApi } from './api';
import { designNeedChanged } from './feed';

export async function goDesign(t: Extract<NeedTarget, { to: 'design' }>): Promise<void> {
  if (t.act === 'open' || !store.me.admin) return location.assign('/lite?tab=design');
  toast(t.act === 'adopt' ? 'Adopting: applying the theme on a branch of its own…' : 'Keeping the existing design…');
  const r = await designApi.act({ action: t.act, floor: t.floor });
  designNeedChanged();
  if (r.error) return void toast(`Couldn’t: ${r.error}`, 'warn');
  toast(t.act === 'adopt' ? 'Committed on its own branch (agent-office/design-…): a candidate until that branch is merged into the default branch.' : 'Kept: the project’s design is as it was.');
}
