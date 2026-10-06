---
title: Phone access
description: Reach the office from your phone, from anywhere, without Tailscale or a VPN - a private Microsoft Dev Tunnel (or Cloudflare Tunnel with Access), set up once from Settings → Connections.
weight: 2.5
---

**📱 Phone access** gives your phone a private way into the office from anywhere: a tunnel from the internet to the office's port on this computer, set up once from **⚙️ Settings → 🔌 Connections → 📱 Phone access** (admins). The phone then opens the [phone version](../using-the-office/phone-version.md) at `/m`, and the Teams cards' **Open** buttons go there too.

There are two ways in, and a quick test mode:

| | Who gets through the tunnel | Address |
| --- | --- | --- |
| **Microsoft Dev Tunnels** (recommended) | Only the Microsoft account that set it up (your work account), then the office password | `https://<id>-4600.<region>.devtunnels.ms`, the same every time |
| **Cloudflare Tunnel + Access** | Whoever your Cloudflare Access policy lets in (an email one-time PIN, or your SSO), then the office password | Your own hostname, e.g. `https://office.example.com` |
| **Quick tunnel** (test only) | Anyone with the address reaches the sign-in page: only the office password stands in the way | A random `https://….trycloudflare.com`, new each time, for an hour |

Whichever you pick:

- **The office password is always asked.** Risky actions from the phone (merge, hire, raise a cap, approve a merge-order escalation) ask for it again unless you signed in within the last 10 minutes. The same goes for the desktop pages (the 3D office, /lite, /pixel, /home) opened **through the tunnel**: merging a PR, hiring (a role, a desk, or a station by asking it), raising a team cap or a budget (or switching its auto-pause off, resuming it, applying a level), approving a merge-order, security, data-loss or budget-overrun escalation, ▶ Resume / ⏸ Pause project and 🔁 Restart safely, changing Connections (credentials, folders, the Teams webhook, Phone access itself; switching it off never asks), opening Studio Pro and resolving an incident. Without a fresh sign-in the office answers 401 `{ reauth: true }` (or, over the socket, sends the action back), the page asks for the password in a window of its own (✕ or Esc cancels) and does it once the password is accepted. The office's own address (localhost, the LAN, the tailnet) never asks.
- **Sign-ins are rate-limited per phone** (the tunnel passes on the phone's address, and the office trusts that only from its own tunnel), and the session cookie is `Secure` on the tunnel's https address.
- **Everything is in the audit log**: the tunnel going up and down (`access.tunnel.*`), who switched it on or off, every action from the phone (`phone.*`), and every password typed again (`login.reauth.*`).
- **Nothing public goes up by itself.** A Dev Tunnel is created private (never `--allow-anonymous`); a named Cloudflare tunnel is checked once it's up, and switched straight off if a visitor who isn't signed in could get through. The quick tunnel needs its warning ticked every time, switches off after an hour, and never comes back after a restart.
- **The office keeps running with the lid closed** while agents work ([keep awake](running-the-office.md)), so the tunnel stays reachable.

## Microsoft Dev Tunnels (once)

Dev Tunnels is Microsoft's own tunnel service: the same one VS Code's port forwarding uses. Your company's Microsoft (Entra) sign-in is what lets you through, so no new account, and nothing for IT to open.

1. **Install the Dev Tunnels CLI** on the office's computer (VS Code's built-in `code tunnel` is for remote VS Code, not for a web page, so it can't be used):

   ```powershell
   winget install Microsoft.devtunnel
   ```

   Restart the office afterwards so it finds `devtunnel` (or set `AGENT_OFFICE_DEVTUNNEL` to its full path).
2. In the office: **⚙️ Settings → 🔌 Connections → 📱 Phone access**, pick **Microsoft Dev Tunnels**, and press the switch (**⚪ Off → On**).
3. The card says **🔑 Sign in with Microsoft** with a code. Press the button (it opens `microsoft.com/devicelogin`), type the code, and sign in with **your work account**. That's the only account the tunnel will let in.
4. The office creates a persistent private tunnel with its port on it, hosts it, and the card turns **🟢 Up** with the address and a **QR code**. It checks the tunnel stops a visitor who isn't signed in (🔒 *Checked*).
5. **Test from your phone**: scan the QR with the iPhone camera, sign in with your Microsoft work account, then the office password. Then [install the phone version](../using-the-office/phone-version.md#install-it-on-an-iphone).

The tunnel's id is kept in `.agent-office/office-settings.json`, so the address stays the same across office restarts. The office brings the tunnel back by itself whenever it drops (after 2 s, 5 s, 15 s, 30 s, then every minute) and when the office starts again. A Dev Tunnel that nobody uses for 30 days expires; switching phone access on again makes a new one (a new address).

## Cloudflare Tunnel with Cloudflare Access (once)

Use this when Dev Tunnels isn't allowed, or you want the office on your own hostname. You need a domain on Cloudflare (a free plan is enough) and `cloudflared` on the office's computer (`winget install Cloudflare.cloudflared`; the office also finds it in `C:\Program Files (x86)\cloudflared`).

1. In **📱 Phone access**, pick **Cloudflare Tunnel + Access**, type the hostname the office should be on (for example `office.example.com`) and press **Save**.
2. Press the switch. The card shows **🔑 Open Cloudflare**: open the link, sign in to Cloudflare, and pick the domain. (This is `cloudflared tunnel login`; it saves `~/.cloudflared/cert.pem`.)
3. The office creates a named tunnel (`cloudflared tunnel create agent-office-…`) and points the hostname at it (`cloudflared tunnel route dns`).
4. **Put Cloudflare Access in front of it**, in the Cloudflare dashboard:
   1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
   2. Application domain: your hostname (`office.example.com`). Session duration: as you like (24 h is fine).
   3. Add a policy: **Action: Allow**, **Include: Emails** = your work email (or **Emails ending in** your company's domain, or your SSO group).
   4. Login methods: **One-time PIN** (a code by email), or your identity provider if your company connected one.
   5. Save.
5. Switch phone access on again. Until Access answers, the office switches the tunnel straight off with *Cloudflare Access isn't protecting …*; once it does, the card turns **🟢 Up** with 🔒 *Checked*.
6. **Test from your phone**: scan the QR, pass Cloudflare Access (the PIN arrives by email), then the office password.

## Quick tunnel (a test only)

For trying the phone version once, without any account: pick **Quick tunnel**, read the warning, tick *I understand*, and switch it on. You get a random `trycloudflare.com` address for one hour. **Anyone who finds the address reaches the office's sign-in page**, so only use it with a strong office password, and switch it off when you're done. Its address changes every time, so the Teams cards' Open buttons only work while it's up (and the office takes the address out of the Teams settings when it stops).

## Teams cards and the office address

When the tunnel comes up, its address goes into **⚙️ Settings → Notifications → Microsoft Teams → Office address**, so each card's **Open** button works from your phone. An address you typed there yourself is left alone.

## When it doesn't work

| What you see | What to do |
| --- | --- |
| *The devtunnel CLI is not installed* | `winget install Microsoft.devtunnel`, then restart the office. |
| *Sign-in didn't finish* | The code expired (15 minutes): switch it on again for a new one. |
| *Cloudflare Access isn't protecting …* | Add the Access application (step 4 above), then switch it on again. |
| *The Dev Tunnel lets anyone in* | Someone added anonymous access: `devtunnel access reset <id>`, then switch it on again. |
| 🔁 *Reconnecting…* for long | The computer lost its network, or went to sleep: check keep-awake and the Wi-Fi. |

## Where things are kept

- `.agent-office/office-settings.json`: `phoneAccess` (on or off, the provider, the Dev Tunnel id, the Cloudflare tunnel id and hostname) and `phoneAccessTeamsUrl`.
- The Dev Tunnels sign-in is the `devtunnel` CLI's own (in your Windows profile); Cloudflare's is `~/.cloudflared/`.
- Nothing about the tunnel is a secret the office keeps: the sign-ins belong to the CLIs.
