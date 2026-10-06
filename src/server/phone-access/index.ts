// 📱 Phone access: a private tunnel to this office (Microsoft Dev Tunnels, or Cloudflare Tunnel with
// Cloudflare Access; a quick trycloudflare.com tunnel only with a warning, for an hour), switched on by an
// admin from Settings → Connections (http/routes/phone-access.ts). The state machine is manager.ts, the
// CLIs providers.ts; this joins it to the office: settings saved in office-settings.json, the tunnel's
// host trusted for its forwarded headers (origin.ts), the Teams cards' Open buttons (teams-link.ts), and
// every up and down in the audit log. Started (and stopped) by office/timers.ts.

import type { PhoneAccessView, TunnelProvider } from '../../shared/phone-access.js';
import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { officeSettings, updateOfficeSettings } from '../connections/store.js';
import { teamsNotifyOf } from '../notify-teams/index.js';
import { TunnelManager, cleanSaved, type ManagerDeps } from './manager.js';
import { setTunnelUrl } from './origin.js';
import { systemProcs } from './procs.js';
import { linkTeams, unlinkTeams, type PublicUrlSlot } from './teams-link.js';

const OFFICE = { kind: 'office' as const, name: 'Agent Office' };
const LABEL: Record<TunnelProvider, string> = { devtunnel: 'Microsoft Dev Tunnels', cloudflare: 'Cloudflare Tunnel', 'cloudflare-quick': 'Cloudflare quick tunnel' };

/** notify-teams' publicUrl, as the Teams settings keep it. */
function teamsSlot(ctx: Ctx): PublicUrlSlot {
  const t = teamsNotifyOf(ctx).settings;
  return { get: () => t.get().publicUrl, set: (url) => t.patch({ publicUrl: url }, 'Phone access') };
}

export class PhoneAccess {
  readonly manager: TunnelManager;

  constructor(
    private readonly ctx: Ctx,
    deps: Partial<ManagerDeps> = {},
    private readonly slot: PublicUrlSlot = teamsSlot(ctx),
  ) {
    this.manager = new TunnelManager({
      procs: systemProcs,
      port: ctx.cfg.port,
      https: !!ctx.cfg.tls,
      load: () => cleanSaved(officeSettings().phoneAccess),
      save: (s) => void updateOfficeSettings({ phoneAccess: s }),
      ...deps,
      events: {
        up: (url, provider, restarted) => {
          setTunnelUrl(url);
          const owned = linkTeams(this.slot, url, officeSettings().phoneAccessTeamsUrl);
          if (owned !== officeSettings().phoneAccessTeamsUrl) updateOfficeSettings({ phoneAccessTeamsUrl: owned });
          audit.record({ actor: OFFICE, action: 'access.tunnel.up', target: { kind: 'tunnel', id: provider, label: LABEL[provider] }, summary: `Phone access is ${restarted ? 'back ' : ''}up at ${url} (${LABEL[provider]})`, details: { provider, url, restarted }, severity: provider === 'cloudflare-quick' ? 'warning' : 'notice' });
        },
        down: (why, provider, url) => {
          setTunnelUrl(undefined);
          const stopped = !this.manager.settings.on;
          const owned = unlinkTeams(this.slot, url, officeSettings().phoneAccessTeamsUrl, stopped && provider === 'cloudflare-quick');
          if (owned !== officeSettings().phoneAccessTeamsUrl) updateOfficeSettings({ phoneAccessTeamsUrl: owned });
          audit.record({ actor: OFFICE, action: 'access.tunnel.down', target: { kind: 'tunnel', id: provider, label: LABEL[provider] }, summary: `Phone access went down: ${why}`, details: { provider, ...(url ? { url } : {}), why }, severity: 'notice' });
        },
        ...deps.events,
      },
    });
  }

  view(admin: boolean): PhoneAccessView {
    const m = this.manager;
    const s = m.settings;
    const devtunnel = systemProcs.find('devtunnel');
    const cloudflared = systemProcs.find('cloudflared');
    return {
      on: s.on,
      provider: s.provider,
      state: m.state,
      ...(m.url ? { url: m.url } : {}),
      ...(m.signIn ? { signIn: m.signIn } : {}),
      ...(m.account ? { account: m.account } : {}),
      ...((s.provider === 'devtunnel' ? s.devtunnelId : s.provider === 'cloudflare' ? s.cloudflareTunnelId : undefined) ? { tunnelId: s.provider === 'devtunnel' ? s.devtunnelId : s.cloudflareTunnelId } : {}),
      ...(s.hostname ? { hostname: s.hostname } : {}),
      ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}),
      ...(m.privacy ? { privacy: m.privacy } : {}),
      ...(m.error ? { error: m.error } : {}),
      restarts: m.restarts,
      ...(m.since && m.state === 'up' ? { since: m.since } : {}),
      tools: { devtunnel: { found: !!devtunnel, ...(devtunnel ? { path: devtunnel } : {}) }, cloudflared: { found: !!cloudflared, ...(cloudflared ? { path: cloudflared } : {}) } },
      teamsLinked: !!m.url && this.slot.get() === m.url,
      admin,
    };
  }
}

const offices = new WeakMap<object, PhoneAccess>();

/** The office's phone access: made on first use, then the same one. */
export function phoneAccessOf(ctx: Ctx): PhoneAccess {
  let p = offices.get(ctx.cfg);
  if (!p) {
    p = new PhoneAccess(ctx);
    offices.set(ctx.cfg, p);
  }
  return p;
}

/** Back on if it was on when the office stopped; returns what takes the tunnel down with the office. */
export function startPhoneAccess(ctx: Ctx): () => void {
  const p = phoneAccessOf(ctx);
  p.manager.resume();
  return () => p.manager.shutdown();
}
