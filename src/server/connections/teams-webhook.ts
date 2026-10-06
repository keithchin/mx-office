// The Teams webhook URL in 🔌 Connections: notify-teams' secret slot (notify-teams/secret.ts) backed by
// the vault, as its 'teams-webhook' credential (DPAPI-encrypted on Windows). Handed over at start by
// startConnections; notify-teams then moves a URL still in notify-teams.json into the vault once and
// takes it out of that file.

import { useSecretSlot, type SecretSlot } from '../notify-teams/secret.js';
import type { Vault } from './vault.js';
import { connectionsVault } from './store.js';

/** A slot over `vault` (the office's own, by default). Reads see a new value at once, before it's encrypted. */
export function teamsWebhookSlot(vault: () => Vault | undefined = connectionsVault): SecretSlot {
  let pending: { value: string | undefined } | undefined;
  return {
    where: 'credential-store',
    get: () => (pending ? pending.value : vault()?.get('teams-webhook')),
    async set(value) {
      const v = vault();
      if (!v) throw new Error('Connections isn’t open in this office');
      const mine = (pending = { value });
      try {
        if (value) await v.set('teams-webhook', value, 'Teams notifications');
        else v.remove('teams-webhook');
      } finally {
        if (pending === mine) pending = undefined;
      }
    },
  };
}

/** Keeps the webhook in Connections from now on (once the vault is open). */
export function wireTeamsWebhook() {
  if (connectionsVault()) useSecretSlot(teamsWebhookSlot());
}
