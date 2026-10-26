// A Mendix Marketplace request in Needs you (server/marketplace/, shared/marketplace.ts): "Add widget File
// Uploader 2.5.1 to dev/receipts?", naming the item, version, publisher and licence where the office could look
// them up, who asked and why. Its own buttons (ui/marketplace/card.ts): Download and add (only when the office
// has a Mendix credential it may use), Use a package file… (always: the path for test offices and people
// without a token), Decline with words. A failed attempt stays on the card with why, to try again. Pure.

import type { NeedItem } from '../needsyou.js';
import { askWords, type MarketplaceRequest, type MarketplaceView } from '../marketplace.js';
import type { Candidate } from './candidates.js';

/** What the card's buttons need besides the request. */
export interface MarketplaceCard {
  request: MarketplaceRequest;
  canDownload: boolean;
  noDownload?: string;
}

export const MARKETPLACE_AFTER =
  'After you answer: Download and add has the office download it with its own Mendix credential; Use a package file… takes a .mpk you downloaded from the Marketplace website. Either way the office checks it is the package asked for, commits it to the agent’s branch as the office and tells the agent. Decline tells the agent, with your words.';

export function marketplaceCandidates(v: MarketplaceView | undefined, floor: string | undefined): Candidate[] {
  if (!v || !floor || v.floor !== floor) return [];
  return v.requests
    .filter((r) => r.status === 'pending' || r.status === 'failed' || r.status === 'working')
    .map((r) => {
      const what = askWords(r);
      const text = `${r.by.name} asks to add ${what} from the Mendix Marketplace${r.branch ? ` to ${r.branch}` : ''}`;
      const need: NeedItem = {
        key: `marketplace-${r.rid}`,
        kind: 'marketplace',
        icon: '🧩',
        text: r.status === 'failed' ? `${text}: the last try failed` : text,
        since: r.at,
        level: r.status === 'working' ? 'info' : 'warn',
        action: 'Review',
        target: { to: 'floor', floor },
      };
      const i = r.info ?? {};
      const facts = [
        { label: `Marketplace item ${r.id}${i.title ? ` (${i.title})` : ''}`, where: `https://marketplace.mendix.com/link/component/${r.id}` },
        { label: `Version: ${r.version ?? `the latest${i.latest ? ` (${i.latest})` : ''}`}` },
        { label: `Publisher: ${i.publisher ?? 'not known (the office couldn’t look it up)'}` },
        { label: `Licence: ${i.licence ?? 'not known: check it on the Marketplace page'}` },
        ...(r.name ? [{ label: `Package name to check: ${r.name}` }] : []),
        { label: `Goes into ${r.by.name}’s folder`, where: r.branch ?? r.folder },
      ];
      return {
        need,
        source: { id: `mkt:${r.rid}`, type: 'other' as const, label: 'Add from Marketplace', text, target: need.target },
        keys: [],
        kind: 'decision' as const,
        prio: 4,
        body: {
          question: `Add ${what} to ${r.branch ?? `${r.by.name}’s folder`}?`,
          detail: `${r.by.name} asked for it${r.why ? `: “${r.why}”` : '.'}${r.status === 'failed' && r.note ? ` The last try failed: ${r.note}` : ''}${r.status === 'working' ? ' The office is adding it now.' : ''}`,
          evidence: facts,
          blocks: [],
          owner: r.by.name,
          after: MARKETPLACE_AFTER,
          notes: [r.name ? '' : 'No package name was given: a package file is checked for its kind and version only.', v.canDownload ? '' : (v.noDownload ?? '')].filter(Boolean),
          marketplace: { request: r, canDownload: v.canDownload, ...(v.noDownload ? { noDownload: v.noDownload } : {}) },
        },
      };
    });
}
