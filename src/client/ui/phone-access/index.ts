// 📱 Phone access, a card in 🔌 Connections (server/phone-access/, http/routes/phone-access.ts): switch a
// private tunnel to this office on or off, pick Microsoft Dev Tunnels (private to your Microsoft account),
// Cloudflare Tunnel with Cloudflare Access, or a throwaway quick tunnel behind a big warning; sign in with
// Microsoft (the device code) or Cloudflare from here; and once it's up, its address and a QR code to scan
// with the phone. The QR is drawn here (shared/qr.ts): no CDN, no library. Admins only.

import { QUICK_TTL_MS, type PhoneAccessPatch, type PhoneAccessView, type TunnelProvider } from '../../../shared/phone-access';
import { qrSvg } from '../../../shared/qr';
import { loadProfile } from '../../state/persist';
import { h, timeAgo, toast } from '../dom';
import './phone-access.css';

async function call(body?: PhoneAccessPatch): Promise<PhoneAccessView> {
  const r = await fetch('/api/phone-access', { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify({ ...body, by: loadProfile()?.name }) : undefined });
  const j = (await r.json().catch(() => ({}))) as PhoneAccessView & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `The office said ${r.status}`);
  return j;
}

const PROVIDERS: { id: TunnelProvider; label: string; note: string }[] = [
  { id: 'devtunnel', label: 'Microsoft Dev Tunnels', note: 'Recommended. Private: only your Microsoft (work) account gets through, then the office password.' },
  { id: 'cloudflare', label: 'Cloudflare Tunnel + Access', note: 'Your own hostname on a Cloudflare domain, with Cloudflare Access (an email PIN or your SSO) in front.' },
  { id: 'cloudflare-quick', label: 'Quick tunnel (test only)', note: 'A random trycloudflare.com address for an hour. Nothing in front but the office password.' },
];

const STATE: Record<PhoneAccessView['state'], string> = { off: '⚪ Off', signin: '🔑 Waiting for you to sign in', starting: '⏳ Starting…', up: '🟢 Up', restarting: '🔁 Reconnecting…', error: '⚠️ Stopped' };

function copyButton(text: string, label = 'Copy') {
  return h('button.btn.small', { type: 'button', onclick: () => void navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => undefined) }, label);
}

function cloudflareSteps(host: string | undefined): HTMLElement {
  const name = host ?? 'office.example.com';
  return h(
    'details.pa-steps',
    {},
    h('summary', {}, 'One-time Cloudflare setup (about 5 minutes)'),
    h(
      'ol',
      {},
      h('li', {}, 'Have a domain on Cloudflare (a free plan is enough), and pick a hostname on it for the office: ', h('code', {}, name), '.'),
      h('li', {}, 'Type the hostname below and press ', h('b', {}, 'Switch on'), ': the office runs ', h('code', {}, 'cloudflared tunnel login'), ' (open the link it shows, pick the domain), creates the tunnel and points the hostname at it.'),
      h('li', {}, 'In the Cloudflare dashboard: ', h('b', {}, 'Zero Trust → Access → Applications → Add an application → Self-hosted'), '. Application domain: ', h('code', {}, name), '.'),
      h('li', {}, 'Add a policy: ', h('b', {}, 'Allow'), ', Include ', h('b', {}, 'Emails'), ' = your work email (or your SSO group). Login method: ', h('b', {}, 'One-time PIN'), ' or your identity provider.'),
      h('li', {}, 'Save, then switch phone access on again. The office checks that Access answers first, and switches the tunnel off if anyone could get through.'),
    ),
  );
}

export function phoneAccessSection(): HTMLElement {
  const el = h('section.cx-card.pa', { id: 'cx-phone-access' }, h('p.cx-note', {}, 'Loading phone access…'));
  let v: PhoneAccessView | undefined;
  let accepted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async (patch?: PhoneAccessPatch, done?: string) => {
    try {
      v = await call(patch);
      if (done) toast(`📱 ${done}`);
    } catch (err) {
      toast((err as Error).message, 'warn');
      if (!v) return void el.replaceChildren(h('p.cx-note', {}, `📱 Phone access: ${(err as Error).message}`));
    }
    paint();
  };

  function paint() {
    if (!v) return;
    const s = v;
    clearTimeout(timer);
    if (!s.admin || !s.tools) return void el.replaceChildren(h('p.cx-note', {}, `📱 Phone access is ${s.state === 'up' ? 'on' : 'off'}. Only admins can change it.`));
    // While something is happening, look again every couple of seconds (only while the card is on the page).
    if (s.on && s.state !== 'up' && s.state !== 'error') timer = setTimeout(() => el.isConnected && void run(), 2000);
    else if (s.state === 'up') timer = setTimeout(() => el.isConnected && void run(), 30_000);
    const toggle = h('button.btn', { type: 'button', role: 'switch', 'aria-checked': String(s.on) }, s.on ? '🟢 On' : '⚪ Off');
    toggle.addEventListener('click', () => {
      if (s.on) return void run({ on: false }, 'Phone access off');
      if (s.provider === 'cloudflare-quick' && !accepted) return void toast('Tick the warning first', 'warn');
      void run({ on: true, ...(s.provider === 'cloudflare-quick' ? { acceptRisk: true } : {}) }, 'Phone access switching on');
    });
    const picker = h(
      'fieldset.pa-providers',
      { disabled: s.on },
      h('legend', {}, 'How the phone gets in'),
      ...PROVIDERS.map((p) => {
        const tool = p.id === 'devtunnel' ? s.tools.devtunnel : s.tools.cloudflared;
        return h(
          'label.pa-provider',
          { class: s.provider === p.id ? 'on' : '' },
          h('input', { type: 'radio', name: 'pa-provider', value: p.id, checked: s.provider === p.id, onchange: () => void run({ provider: p.id }) }),
          h('span', {}, h('b', {}, p.label), h('small.cx-note', {}, ` ${p.note}`), tool.found ? null : h('small.pa-missing', {}, p.id === 'devtunnel' ? ' Needs the devtunnel CLI.' : ' Needs cloudflared.')),
        );
      }),
    );
    const parts: (HTMLElement | null)[] = [];
    if (s.provider === 'devtunnel' && !s.tools.devtunnel.found) {
      parts.push(h('div.cx-banner', {}, h('p', {}, h('b', {}, 'Install the Dev Tunnels CLI once'), ' on this computer (VS Code’s own tunnel is only for remote VS Code, not for a web page):'), h('p', {}, h('code', {}, 'winget install Microsoft.devtunnel'), ' ', copyButton('winget install Microsoft.devtunnel')), h('p.cx-note', {}, 'Then restart the office (or open a new terminal) so it finds devtunnel, and switch this on.')));
    }
    if (s.provider === 'cloudflare') {
      const host = h('input', { type: 'text', value: s.hostname ?? '', placeholder: 'office.example.com', spellcheck: 'false', 'aria-label': 'Hostname', disabled: s.on }) as HTMLInputElement;
      parts.push(h('div.cx-two.pa-host', {}, host, h('button.btn', { type: 'button', disabled: s.on, onclick: () => void run({ hostname: host.value.trim() }, 'Hostname saved') }, 'Save')), cloudflareSteps(s.hostname));
    }
    if (s.provider === 'cloudflare-quick') {
      const box = h('input', { type: 'checkbox', checked: accepted, disabled: s.on, onchange: (e: Event) => ((accepted = (e.target as HTMLInputElement).checked), paint()) });
      parts.push(
        h(
          'div.pa-danger',
          { role: 'alert' },
          h('p', {}, h('b', {}, '⚠️ A quick tunnel is public.'), ' Anyone who finds the address reaches the office’s sign-in page; only the office password (and the password again for risky actions) stands in the way. Sign-in attempts are rate-limited and every one is in the audit log.'),
          h('p', {}, `It switches itself off after ${QUICK_TTL_MS / 60_000} minutes, is never brought back after a restart, and gets a new address each time (so the Teams cards’ Open buttons only work while it’s up).`),
          h('label.pa-accept', {}, box, ' I understand: switch on a public quick tunnel for an hour.'),
        ),
      );
    }
    parts.push(h('p.pa-state', {}, h('b', {}, STATE[s.state]), s.account ? ` · signed in as ${s.account}` : '', s.restarts ? ` · reconnected ${s.restarts}×` : '', s.since ? ` · since ${timeAgo(s.since)}` : '', s.expiresAt ? ` · switches off ${new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''));
    if (s.signIn) {
      parts.push(
        h(
          'div.pa-signin',
          {},
          h('p', {}, h('b', {}, s.provider === 'devtunnel' ? 'Sign in with Microsoft' : 'Sign in to Cloudflare'), s.provider === 'devtunnel' ? ' (your work account): open the link and type the code.' : ': open the link and pick your domain.'),
          h('p', {}, h('a.btn.primary', { href: s.signIn.url, target: '_blank', rel: 'noopener' }, s.provider === 'devtunnel' ? '🔑 Sign in with Microsoft' : '🔑 Open Cloudflare'), s.signIn.code ? h('code.pa-code', {}, s.signIn.code) : null, s.signIn.code ? copyButton(s.signIn.code, 'Copy code') : null),
          h('p.cx-note', {}, s.signIn.text),
        ),
      );
    }
    if (s.error) parts.push(h('p.cx-err', { role: 'alert' }, s.error));
    if (s.url && s.state === 'up') {
      const phone = `${s.url}/m`;
      const qr = h('div.pa-qr', { role: 'img', 'aria-label': `QR code for ${phone}` });
      qr.innerHTML = qrSvg(phone, 4);
      parts.push(
        h(
          'div.pa-up',
          {},
          qr,
          h(
            'div',
            {},
            h('p', {}, h('a', { href: phone, target: '_blank', rel: 'noopener' }, phone), ' ', copyButton(phone)),
            h('p.cx-note', {}, s.privacy === 'private' ? '🔒 Checked: a visitor who isn’t signed in is stopped before the office.' : s.privacy === 'public' ? '⚠️ Anyone with the address reaches the office’s sign-in page.' : 'Couldn’t check from here whether it’s private.'),
            h('p.cx-note', {}, s.teamsLinked ? '💬 Teams cards’ Open buttons go here.' : 'Teams cards keep the address set in ⚙️ Settings → Notifications.'),
            h('p.pa-test', {}, h('b', {}, 'Test from your phone: '), 'scan the code with the iPhone camera, ', s.provider === 'devtunnel' ? 'sign in with your Microsoft work account, ' : s.provider === 'cloudflare' ? 'pass Cloudflare Access (the PIN in your email), ' : '', 'then the office password. In Safari: Share → Add to Home Screen, open it from there, ⚙ → Turn on notifications.'),
          ),
        ),
      );
    }
    el.replaceChildren(
      h('div.cx-head', {}, h('span.cx-icon', { 'aria-hidden': 'true' }, '📱'), h('h4', {}, 'Phone access'), toggle),
      h('p.cx-note', {}, 'Reach this office from your phone, from anywhere, without Tailscale or a VPN: a private tunnel to it, and the phone version at /m. The office password is always asked; risky actions ask for it again.'),
      picker,
      ...parts.filter((x): x is HTMLElement => !!x),
    );
  }
  void run();
  return el;
}
