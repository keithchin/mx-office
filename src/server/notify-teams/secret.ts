// Where the Teams webhook URL is kept. Its `sig=` query lets anyone post to the channel, so it's a
// secret: never sent to a browser (only a hint), never in the audit log.
//
// For now it sits in the office's own settings file for Teams (.agent-office/notify-teams.json, mode
// 0600). The seam: once Settings → Connections (DPAPI-encrypted credentials with a resolver) is in the
// office, `useSecretSlot` hands this module a slot backed by it, and nothing else here changes.

export interface SecretSlot {
  /** What ⚙️ Settings says about where it is. */
  readonly where: 'settings-file' | 'credential-store';
  get(): string | undefined;
  set(value: string | undefined): void;
}

let override: SecretSlot | undefined;

/** Keep the webhook URL in a credential store instead of the settings file (Connections wires this). */
export function useSecretSlot(slot: SecretSlot | undefined) {
  override = slot;
}

/** The slot in use: the credential store when one was handed over, else `fallback` (the settings file). */
export const secretSlot = (fallback: SecretSlot): SecretSlot => override ?? fallback;

/** Where a webhook goes without its secret parts: "prod-12.westeurope.logic.azure.com/…/aB3x". */
export function webhookHint(raw: string): string {
  try {
    const u = new URL(raw);
    const tail = u.pathname.replace(/\/+$/, '').slice(-4);
    return `${u.host}/…${tail}`;
  } catch {
    return '(saved)';
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Why `raw` can't be a Teams webhook, if it can't: https only (plain http just for a stub on this machine). */
export function checkWebhookUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "That isn't a link. Paste the HTTP POST URL from the Teams workflow.";
  }
  if (raw.length > 2000) return 'That link is too long';
  if (u.protocol === 'https:') return undefined;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return undefined;
  return 'The webhook has to be an https link';
}
