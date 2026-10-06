// What each tunnel provider's CLI is asked, and what's read back from it (shared/phone-access.ts parses).
// Microsoft Dev Tunnels: sign in with a device code, one persistent tunnel (private to the signed-in
// account: never --allow-anonymous) with the office's port on it, hosted by `devtunnel host`. Cloudflare:
// `cloudflared tunnel login`, a named tunnel routed to your hostname (Cloudflare Access in front of it is
// set up once in its dashboard), run with `cloudflared tunnel run`; or a quick trycloudflare.com tunnel.

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { cloudflareLoginUrl, cloudflareTunnelId, deviceCode, devtunnelAccount, devtunnelId, devtunnelUrl, quickTunnelUrl, type TunnelProvider, type TunnelSignIn } from '../../shared/phone-access.js';
import type { Procs } from './procs.js';

/** What a provider keeps between runs (in office-settings.json, through the manager). */
export interface TunnelSaved {
  devtunnelId?: string;
  cloudflareTunnelId?: string;
  hostname?: string;
}

export interface HostCommand {
  args: string[];
  /** The address, once the output says it's reachable. */
  urlFrom(output: string): string | undefined;
}

export interface TunnelAdapter {
  tool: 'devtunnel' | 'cloudflared';
  /** Signed in: who as (true when the CLI doesn't say), or false. */
  signedIn(cli: string): Promise<string | boolean>;
  /** Starts the CLI's sign-in: `prompt` gets the link (and code), the promise why it failed, if it did. */
  signIn(cli: string, prompt: (s: TunnelSignIn) => void): Promise<string | undefined>;
  /** Makes what has to exist before hosting (the tunnel, its port, its DNS route): what to keep, or why not. */
  prepare(cli: string, saved: TunnelSaved): Promise<{ saved: TunnelSaved } | { error: string }>;
  host(saved: TunnelSaved): HostCommand;
}

const tail = (out: string) => out.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 300) || 'no output';

/** Runs the sign-in CLI, reading its output for the prompt; resolves when it exits. */
function signInWith(procs: Procs, cli: string, args: string[], parse: (out: string) => TunnelSignIn | undefined, prompt: (s: TunnelSignIn) => void, timeoutMs = 15 * 60_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = '';
    let told = false;
    const p = procs.spawn(cli, args);
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.onOutput((t) => {
      out = (out + t).slice(-16_384);
      const s = told ? undefined : parse(out);
      if (s) ((told = true), prompt(s));
    });
    p.onExit((code) => {
      clearTimeout(timer);
      resolve(code === 0 ? undefined : `Sign-in didn't finish: ${tail(out)}`);
    });
  });
}

export function devtunnelAdapter(procs: Procs, port: number, https: boolean): TunnelAdapter {
  return {
    tool: 'devtunnel',
    async signedIn(cli) {
      const r = await procs.run(cli, ['user', 'show'], 30_000);
      return devtunnelAccount(r.out) ?? false;
    },
    // Microsoft (Entra or personal) with a device code, so it works from a page: no browser opens on the office's machine.
    signIn: (cli, prompt) => signInWith(procs, cli, ['user', 'login', '-d'], deviceCode, prompt),
    async prepare(cli, saved) {
      let id = saved.devtunnelId;
      if (id) {
        const shown = await procs.run(cli, ['show', id], 30_000);
        if (shown.code !== 0) id = undefined;
      }
      if (!id) {
        // Private by default: only the account that made it may connect. Never --allow-anonymous.
        const made = await procs.run(cli, ['create', '--expiration', '30d', '--description', 'Agent Office phone access', '--json'], 60_000);
        id = made.code === 0 ? devtunnelId(made.out) : undefined;
        if (!id) return { error: `devtunnel couldn't create the tunnel: ${tail(made.out)}` };
      }
      const ported = await procs.run(cli, ['port', 'create', id, '-p', String(port), '--protocol', https ? 'https' : 'http'], 60_000);
      if (ported.code !== 0 && !/already exists|conflict/i.test(ported.out)) return { error: `devtunnel couldn't add port ${port}: ${tail(ported.out)}` };
      return { saved: { ...saved, devtunnelId: id } };
    },
    host: (saved) => ({ args: ['host', saved.devtunnelId!], urlFrom: (out) => (/Ready to accept connections|Connect via browser/i.test(out) ? devtunnelUrl(out, port) : undefined) }),
  };
}

/** Where cloudflared keeps its login (cert.pem): there means signed in. */
export const cloudflaredHome = (env: NodeJS.ProcessEnv = process.env) => path.join(env.USERPROFILE ?? os.homedir(), '.cloudflared');

export function cloudflareAdapter(procs: Procs, port: number, https: boolean, certExists: () => boolean = () => existsSync(path.join(cloudflaredHome(), 'cert.pem'))): TunnelAdapter {
  const origin = `${https ? 'https' : 'http'}://127.0.0.1:${port}`;
  return {
    tool: 'cloudflared',
    signedIn: async () => certExists(),
    signIn: (cli, prompt) => signInWith(procs, cli, ['tunnel', 'login'], cloudflareLoginUrl, prompt),
    async prepare(cli, saved) {
      if (!saved.hostname) return { error: 'Type the hostname the office should be on first (e.g. office.example.com)' };
      let id = saved.cloudflareTunnelId;
      if (!id) {
        const made = await procs.run(cli, ['tunnel', 'create', `agent-office-${randomBytes(3).toString('hex')}`], 60_000);
        id = made.code === 0 ? cloudflareTunnelId(made.out) : undefined;
        if (!id) return { error: `cloudflared couldn't create the tunnel: ${tail(made.out)}` };
      }
      const routed = await procs.run(cli, ['tunnel', 'route', 'dns', id, saved.hostname], 60_000);
      if (routed.code !== 0 && !/already (exists|configured)/i.test(routed.out)) return { error: `cloudflared couldn't point ${saved.hostname} at the tunnel: ${tail(routed.out)}` };
      return { saved: { ...saved, cloudflareTunnelId: id } };
    },
    host: (saved) => ({
      args: ['tunnel', '--no-autoupdate', 'run', '--url', origin, ...(https ? ['--no-tls-verify'] : []), saved.cloudflareTunnelId!],
      urlFrom: (out) => (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(out) ? `https://${saved.hostname}` : undefined),
    }),
  };
}

/** The quick tunnel: no account, no setup, a new random address each time. */
export function quickAdapter(port: number, https: boolean): TunnelAdapter {
  const origin = `${https ? 'https' : 'http'}://127.0.0.1:${port}`;
  return {
    tool: 'cloudflared',
    signedIn: async () => true,
    signIn: async () => undefined,
    prepare: async (_cli, saved) => ({ saved }),
    host: () => ({ args: ['tunnel', '--no-autoupdate', '--url', origin, ...(https ? ['--no-tls-verify'] : [])], urlFrom: quickTunnelUrl }),
  };
}

export function adapterFor(provider: TunnelProvider, procs: Procs, port: number, https: boolean): TunnelAdapter {
  if (provider === 'devtunnel') return devtunnelAdapter(procs, port, https);
  if (provider === 'cloudflare') return cloudflareAdapter(procs, port, https);
  return quickAdapter(port, https);
}
