// 📱 Phone access (server/phone-access/, Settings → Connections): a private tunnel from the internet to
// this office, so a phone can reach /m without Tailscale or a VPN. What the card shows and sends, and
// the pure parsing of what the tunnel CLIs print (their addresses, a Microsoft device code), which the
// tests read without running them.

/**
 * devtunnel: Microsoft Dev Tunnels, private to the signed-in Microsoft (Entra) account.
 * cloudflare: a named Cloudflare Tunnel on your own hostname, with Cloudflare Access in front.
 * cloudflare-quick: a throwaway trycloudflare.com address with nothing in front but the office password:
 * only with the big warning, for an hour at most.
 */
export type TunnelProvider = 'devtunnel' | 'cloudflare' | 'cloudflare-quick';
export const TUNNEL_PROVIDERS: readonly TunnelProvider[] = ['devtunnel', 'cloudflare', 'cloudflare-quick'];
export const isTunnelProvider = (v: unknown): v is TunnelProvider => TUNNEL_PROVIDERS.includes(v as TunnelProvider);

/**
 * off: not running. signin: waiting for someone to sign in (a device code, a Cloudflare login link).
 * starting: the CLI is up, no address yet. up: reachable at `url`. restarting: it dropped and comes back
 * in a moment. error: it gave up (why in `error`).
 */
export type TunnelState = 'off' | 'signin' | 'starting' | 'up' | 'restarting' | 'error';

/** The quick tunnel's longest life. */
export const QUICK_TTL_MS = 60 * 60_000;

/** A sign-in the CLI is waiting for: open the link, type the code (Microsoft), or just open it (Cloudflare). */
export interface TunnelSignIn {
  url: string;
  code?: string;
  /** What the CLI said, for the card. */
  text: string;
}

/** Whether the address refuses a visitor who hasn't signed in to Microsoft / Cloudflare Access. */
export type PrivacyCheck = 'private' | 'public' | 'unknown';

export interface ToolState {
  /** Found on this machine (where), or not. */
  found: boolean;
  path?: string;
  version?: string;
}

export interface PhoneAccessView {
  /** Switched on (it may still be starting). */
  on: boolean;
  provider: TunnelProvider;
  state: TunnelState;
  url?: string;
  signIn?: TunnelSignIn;
  /** Who the CLI is signed in as (Dev Tunnels), when it says. */
  account?: string;
  /** The persistent Dev Tunnel's id, or the Cloudflare tunnel's name: kept across restarts. */
  tunnelId?: string;
  /** The Cloudflare hostname the named tunnel is routed to. */
  hostname?: string;
  /** When the quick tunnel switches itself off. */
  expiresAt?: number;
  /** The last look at whether it's private. */
  privacy?: PrivacyCheck;
  error?: string;
  /** Times it came back by itself since it was switched on. */
  restarts: number;
  since?: number;
  tools: { devtunnel: ToolState; cloudflared: ToolState };
  /** Teams cards' Open buttons go to the tunnel's address (notify-teams' publicUrl). */
  teamsLinked: boolean;
  /** Whoever's looking can change it. */
  admin: boolean;
}

/** What a POST to /api/phone-access may change. */
export interface PhoneAccessPatch {
  on?: boolean;
  provider?: TunnelProvider;
  /** The Cloudflare hostname (named tunnel), e.g. office.example.com. */
  hostname?: string;
  /** The quick tunnel's warning was read and accepted (needed every time it's switched on). */
  acceptRisk?: boolean;
  /** Start signing in (Dev Tunnels: Microsoft; Cloudflare: `cloudflared tunnel login`). */
  signIn?: boolean;
}

// ---- What the CLIs print ---------------------------------------------------------------------------------

/** A Dev Tunnels address for the port: "https://abc123x-4600.euw.devtunnels.ms". */
export function devtunnelUrl(text: string, port?: number): string | undefined {
  const all = [...text.matchAll(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.devtunnels\.ms\/?/gi)].map((m) => m[0].replace(/\/$/, ''));
  // The CLI prints the inspect address too ("…-4600-inspect…"): never that one.
  const usable = all.filter((u) => !/-inspect\./i.test(u));
  return (port ? usable.find((u) => new RegExp(`-${port}\\.`).test(u)) : undefined) ?? usable[0];
}

/** A quick tunnel's address: "https://some-words-here.trycloudflare.com". */
export function quickTunnelUrl(text: string): string | undefined {
  return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text)?.[0];
}

/** A Microsoft device code sign-in: "…open the page https://microsoft.com/devicelogin and enter the code ABCD1234…". */
export function deviceCode(text: string): TunnelSignIn | undefined {
  const url = /https:\/\/(?:www\.)?microsoft\.com\/devicelogin|https:\/\/login\.microsoft(?:online)?\.com\/[^\s]*device[^\s]*|https:\/\/github\.com\/login\/device/i.exec(text)?.[0];
  const code = /\b(?:code|enter)\s+([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})?)\b/i.exec(text)?.[1];
  if (!url || !code) return undefined;
  return { url, code: code.toUpperCase(), text: text.trim().split(/\r?\n/).find((l) => l.includes(code)) ?? text.trim() };
}

/** Cloudflare's login link: "Please open the following URL and log in with your Cloudflare account: https://dash.cloudflare.com/argotunnel?…". */
export function cloudflareLoginUrl(text: string): TunnelSignIn | undefined {
  const url = /https:\/\/dash\.cloudflare\.com\/argotunnel\?\S+/i.exec(text)?.[0];
  return url ? { url, text: 'Open the link and pick the zone (your domain) the office’s hostname is on.' } : undefined;
}

/** The Dev Tunnel id `devtunnel create` printed ("Tunnel ID : agent-office-x7.euw"), or its JSON's. */
export function devtunnelId(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { tunnel?: { tunnelId?: string } };
    if (j?.tunnel?.tunnelId) return j.tunnel.tunnelId;
  } catch {
    // plain text
  }
  return /Tunnel\s*ID\s*:\s*([a-z0-9][a-z0-9.-]{2,})/i.exec(text)?.[1];
}

/** Who `devtunnel user show` says is signed in, if anyone. */
export function devtunnelAccount(text: string): string | undefined {
  if (/not logged in/i.test(text)) return undefined;
  return /Logged in as\s+(\S+)/i.exec(text)?.[1]?.replace(/\.$/, '');
}

/** A named Cloudflare tunnel's id from `cloudflared tunnel create` ("Created tunnel agent-office with id 6ff4…"). */
export function cloudflareTunnelId(text: string): string | undefined {
  return /with id ([0-9a-f-]{36})/i.exec(text)?.[1];
}

/** A hostname a named tunnel may be routed to: a.b.c, nothing else. */
export function cleanHostname(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const h = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) ? h : undefined;
}

/** Whether an answer to a request with no sign-in came from a sign-in wall (Microsoft, GitHub or Cloudflare Access). */
export function looksPrivate(status: number, location: string | null | undefined): boolean {
  if (status === 401 || status === 403) return true;
  if (status >= 300 && status < 400 && location) return /cloudflareaccess\.com|login\.microsoftonline\.com|github\.com\/login|devtunnels\.ms\/.*(auth|login)|tunnels\.api\.visualstudio\.com|\/cdn-cgi\/access\//i.test(location);
  return false;
}
