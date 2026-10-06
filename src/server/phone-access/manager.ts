// The tunnel's state machine: off → (signin) → starting → up, back through restarting whenever the CLI
// drops while it's meant to be on (2 s, 5 s, 15 s, 30 s, then every minute), and off again when it's
// switched off, the quick tunnel's hour is up, or a named tunnel turns out to be open to anyone. What
// must survive a restart (on or off, the provider, the Dev Tunnel id, the Cloudflare tunnel and
// hostname) is saved through `deps.save`; a quick tunnel is never brought back after a restart.
// Everything outside (the CLIs, the clock, timers, the privacy check) comes in through `deps`.

import { QUICK_TTL_MS, isTunnelProvider, looksPrivate, type PrivacyCheck, type TunnelProvider, type TunnelSignIn, type TunnelState } from '../../shared/phone-access.js';
import type { Proc, Procs } from './procs.js';
import { adapterFor, type TunnelAdapter, type TunnelSaved } from './providers.js';

export interface SavedAccess extends TunnelSaved {
  on: boolean;
  provider: TunnelProvider;
}

export const DEFAULT_ACCESS: SavedAccess = { on: false, provider: 'devtunnel' };

export interface TunnelEvents {
  /** Reachable at `url` (first time, or again after a drop). */
  up(url: string, provider: TunnelProvider, restarted: boolean): void;
  /** Not reachable any more, and why. */
  down(why: string, provider: TunnelProvider, url: string | undefined): void;
}

export interface ManagerDeps {
  procs: Procs;
  port: number;
  https?: boolean;
  load(): SavedAccess;
  save(s: SavedAccess): void;
  events?: Partial<TunnelEvents>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  adapter?: (p: TunnelProvider) => TunnelAdapter;
  checkPrivacy?: (url: string) => Promise<PrivacyCheck>;
}

export const RESTART_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/** A request with no sign-in to the tunnel's address: does a sign-in wall answer it? */
export async function checkPrivacy(url: string, f: typeof fetch = fetch): Promise<PrivacyCheck> {
  try {
    const r = await f(`${url}/api/health`, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'agent-office-phone-access-check' } });
    if (looksPrivate(r.status, r.headers.get('location'))) return 'private';
    return r.status === 200 ? 'public' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export class TunnelManager {
  private saved: SavedAccess;
  state: TunnelState = 'off';
  url?: string;
  signIn?: TunnelSignIn;
  account?: string;
  error?: string;
  privacy?: PrivacyCheck;
  expiresAt?: number;
  since?: number;
  restarts = 0;
  /** Bumped by every start and stop, so what an old run finds out later is ignored. */
  private gen = 0;
  private proc?: Proc;
  private retryTimer?: unknown;
  private expiryTimer?: unknown;
  private failures = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;

  constructor(private readonly deps: ManagerDeps) {
    this.saved = cleanSaved(deps.load());
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref?.());
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
  }

  get settings(): Readonly<SavedAccess> {
    return this.saved;
  }

  private persist(patch: Partial<SavedAccess>) {
    this.saved = { ...this.saved, ...patch };
    this.deps.save(this.saved);
  }

  private adapter(): TunnelAdapter {
    return (this.deps.adapter ?? ((p) => adapterFor(p, this.deps.procs, this.deps.port, !!this.deps.https)))(this.saved.provider);
  }

  /** At the office's start: back on if it was on (never a quick tunnel: its warning is accepted each time). */
  resume() {
    if (!this.saved.on) return;
    if (this.saved.provider === 'cloudflare-quick') return this.persist({ on: false });
    void this.start();
  }

  /** Another provider or hostname; only while it's off. */
  configure(p: { provider?: TunnelProvider; hostname?: string }): string | undefined {
    if (this.saved.on && (p.provider !== undefined || p.hostname !== undefined)) return 'Switch phone access off first';
    const patch: Partial<SavedAccess> = {};
    if (p.provider !== undefined) patch.provider = p.provider;
    // A new hostname keeps the tunnel: the next start routes the new name to it too.
    if (p.hostname !== undefined) patch.hostname = p.hostname;
    this.persist(patch);
    this.error = undefined;
    return undefined;
  }

  /** Switches it on. A quick tunnel needs its warning accepted, every time. */
  start(opts: { acceptRisk?: boolean } = {}): string | undefined {
    if (this.saved.provider === 'cloudflare-quick' && !opts.acceptRisk && !this.saved.on) return 'Read and accept the warning first: a quick tunnel has nothing in front of the office but its password';
    const cli = this.deps.procs.find(this.adapter().tool);
    if (!cli) return this.adapter().tool === 'devtunnel' ? 'The devtunnel CLI is not installed: winget install Microsoft.devtunnel, then try again' : 'cloudflared is not installed: winget install Cloudflare.cloudflared, then try again';
    this.halt();
    const gen = ++this.gen;
    this.persist({ on: true });
    this.restarts = 0;
    this.failures = 0;
    this.error = undefined;
    this.privacy = undefined;
    this.expiresAt = undefined;
    if (this.saved.provider === 'cloudflare-quick') {
      this.expiresAt = this.now() + QUICK_TTL_MS;
      this.expiryTimer = this.setTimer(() => gen === this.gen && this.stop('The quick tunnel’s hour is up'), QUICK_TTL_MS);
    }
    void this.run(gen, cli, false);
    return undefined;
  }

  /** Switches it off (`why` goes to the audit log). */
  stop(why = 'Switched off') {
    this.persist({ on: false });
    this.halt(why);
    this.state = 'off';
    this.signIn = undefined;
    this.expiresAt = undefined;
  }

  /** The office is stopping: the CLI goes with it, and it comes back on at the next start if it was on. */
  shutdown() {
    this.halt('The office stopped');
    this.state = 'off';
  }

  /** Kills the CLI and every timer; says it went down if it was up. */
  private halt(why = 'Restarting') {
    this.gen++;
    const wasUp = this.state === 'up' ? this.url : undefined;
    this.proc?.kill();
    this.proc = undefined;
    if (this.retryTimer !== undefined) this.clearTimer(this.retryTimer);
    if (this.expiryTimer !== undefined) this.clearTimer(this.expiryTimer);
    this.retryTimer = this.expiryTimer = undefined;
    if (wasUp) this.deps.events?.down?.(why, this.saved.provider, wasUp);
    if (this.saved.provider === 'cloudflare-quick') this.url = undefined;
  }

  private fail(gen: number, error: string) {
    if (gen !== this.gen) return;
    this.gen++;
    this.proc?.kill();
    this.proc = undefined;
    this.state = 'error';
    this.error = error;
    this.signIn = undefined;
    this.persist({ on: false });
  }

  private async run(gen: number, cli: string, restarted: boolean) {
    const a = this.adapter();
    this.state = restarted ? 'restarting' : 'starting';
    let who: string | boolean;
    try {
      who = await a.signedIn(cli);
    } catch (err) {
      return this.fail(gen, (err as Error).message);
    }
    if (gen !== this.gen) return;
    if (who === false) {
      this.state = 'signin';
      const err = await a.signIn(cli, (s) => gen === this.gen && (this.signIn = s));
      if (gen !== this.gen) return;
      this.signIn = undefined;
      if (err) return this.fail(gen, err);
      who = await a.signedIn(cli);
      if (gen !== this.gen) return;
      if (who === false) return this.fail(gen, 'Still not signed in');
    }
    this.account = typeof who === 'string' ? who : undefined;
    this.state = restarted ? 'restarting' : 'starting';
    const prepared = await a.prepare(cli, this.saved);
    if (gen !== this.gen) return;
    if ('error' in prepared) return this.fail(gen, prepared.error);
    const { devtunnelId, cloudflareTunnelId, hostname } = prepared.saved;
    this.persist({ devtunnelId, cloudflareTunnelId, hostname });
    this.host(gen, cli, a, restarted);
  }

  private host(gen: number, cli: string, a: TunnelAdapter, restarted: boolean) {
    const cmd = a.host(this.saved);
    const proc = this.deps.procs.spawn(cli, cmd.args);
    this.proc = proc;
    let out = '';
    proc.onOutput((t) => {
      if (gen !== this.gen) return;
      out = (out + t).slice(-32_768);
      if (this.state === 'up') return;
      const url = cmd.urlFrom(out);
      if (!url) return;
      this.state = 'up';
      this.url = url;
      this.since = this.now();
      this.failures = 0;
      this.deps.events?.up?.(url, this.saved.provider, restarted);
      void this.lookPrivate(gen, url);
    });
    proc.onExit((code) => {
      if (gen !== this.gen) return;
      const wasUp = this.state === 'up';
      this.proc = undefined;
      const last = out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 200);
      if (wasUp) this.deps.events?.down?.(`The tunnel dropped (exit ${code})`, this.saved.provider, this.url);
      if (this.saved.provider === 'cloudflare-quick') this.url = undefined;
      const delay = RESTART_DELAYS_MS[Math.min(this.failures, RESTART_DELAYS_MS.length - 1)];
      this.failures++;
      this.state = 'restarting';
      this.error = last ? `It stopped: ${last}` : `It stopped (exit ${code})`;
      this.retryTimer = this.setTimer(() => {
        if (gen !== this.gen) return;
        this.retryTimer = undefined;
        this.restarts++;
        void this.run(gen, cli, true);
      }, delay);
    });
  }

  /** A named tunnel open to anyone is switched off at once; never left up silently. */
  private async lookPrivate(gen: number, url: string) {
    if (this.saved.provider === 'cloudflare-quick') return void (this.privacy = 'public');
    const p = await (this.deps.checkPrivacy ?? checkPrivacy)(url);
    if (gen !== this.gen) return;
    this.privacy = p;
    if (p !== 'public') return;
    const why =
      this.saved.provider === 'cloudflare'
        ? `Cloudflare Access isn’t protecting ${this.saved.hostname}: anyone could reach the office’s sign-in page. Add the Access application (see the steps), then switch it on again.`
        : `The Dev Tunnel lets anyone in (anonymous access is on). Run: devtunnel access reset ${this.saved.devtunnelId ?? '<id>'}, then switch it on again.`;
    this.halt('Switched off: not private');
    this.state = 'error';
    this.error = why;
    this.persist({ on: false });
  }
}

export function cleanSaved(v: unknown): SavedAccess {
  const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x.length > 0 && x.length < 300 ? x : undefined);
  return {
    on: s.on === true,
    provider: isTunnelProvider(s.provider) ? s.provider : 'devtunnel',
    ...(str(s.devtunnelId) ? { devtunnelId: str(s.devtunnelId) } : {}),
    ...(str(s.cloudflareTunnelId) ? { cloudflareTunnelId: str(s.cloudflareTunnelId) } : {}),
    ...(str(s.hostname) ? { hostname: str(s.hostname) } : {}),
  };
}
