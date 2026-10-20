// ＋ New project on the Clients page (clients/view.ts): on a client's page and in its card's ⋯ menu, for whoever
// can create projects (admins). It opens ✨ New project made for that client (the client preset and shown), where
// Start from another app offers what the client's existing apps have (ui/wizard/new/adopt-card.ts).

import type { PortfolioView } from '../../shared/portfolios';
import { h } from '../ui/dom';

/** Opens ✨ New project for a client. */
export type NewProjectFor = (client: { id: string; label: string }) => void;

export function newProjectButton(p: Pick<PortfolioView, 'id' | 'label'>, open: NewProjectFor): HTMLButtonElement {
  const b = h('button.btn.primary.cl-newproj', { type: 'button', title: `A new project for ${p.label}: it can start from one of the client’s apps (design system, toolkit, role skills)` }, '＋ New project') as HTMLButtonElement;
  b.onclick = () => open({ id: p.id, label: p.label });
  return b;
}
