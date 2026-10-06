---
title: Security & tokens
description: The office password and who is admin, the agents' and admin GitHub tokens, the Mendix token, the Jev key, what workers can and can't see, and why the docs are behind the sign-in.
weight: 2
---

## Connections first

The tokens, the Jev key and the office password are managed from **☰ → 🔌 Connections** (admins): encrypted with Windows DPAPI in the office's data folder, with a Test button each. See [Connections](connections.md). The office looks for each one in Connections first, then its environment variable, then the files below, so the files still work (and **📥 Import from files** moves them into Connections in one click).

## Secret files (the old way)

| File | What | Read by |
|---|---|---|
| `~/.agent-office-password` | The office password | The launcher, into `AGENT_OFFICE_PASSWORD` |
| `~/.agent-office-gh-token` | The **agents' GitHub token** | The launcher, into `GH_TOKEN` / `GITHUB_TOKEN` for the office and its workers |
| `~/.agent-office-admin-gh-token` | The **admin GitHub token** | The server only, just before the wizard's `gh repo create` (`AGENT_OFFICE_ADMIN_GH_TOKEN_FILE` to move it) |
| `~/.agent-office-jev-key` | Jeff's **Jev key** | The server, by path (`AGENT_OFFICE_JEV_KEY_FILE`) |
| `~/Mendix/.env` (`MX_PAT=`) | The **Mendix personal access token** | The server, when Connections has none (the toolkit's own convention) |

> [!CAUTION]
> Never print, paste, commit or screenshot these files. Refer to them by path only. If one leaks, revoke it on GitHub (or TypeSafe, or Mendix) and replace it in Connections.

## Who is admin

Anyone who signs in with the **shared office password** is an admin, that is, the Project Manager. Admin-only actions: hiring and benching team members, approvals and escalation answers, settings, the live app's start and stop, creating projects, changing team labels, re-analysing.

People can also have their own accounts (**☰ → 🔑 Accounts**, admin only), with their own Claude and GitHub sign-ins.

## The agents' token

- **Fine-grained**, owner **AI-Taskforce-Labs**, **all repositories**, with **Contents**, **Issues** and **Pull requests** read and write.
- It can't create or delete repositories, or change the organization.
- Covering all repositories means a new project needs no token change.

## The admin token

- Fine-grained, owner the organization, all repositories, **Administration** and **Contents** read and write.
- The server reads it just before use and doesn't keep it. It's passed only to the one `gh repo create` process, never put in the office's environment, and blanked out of logs and errors (as is anything that looks like a GitHub token).
- The wizard page only checks *that* there is one (in Connections or the file); it never sees the token. Without one, it offers a box that saves the token straight into Connections.

## The Mendix token

- A personal access token from Mendix user settings, with `mx:app:create` for creating apps.
- The wizard can read it. Workers get it (`MENDIX_TOKEN`, `MX_PAT`) only on a project where an admin ticked **Give agents the Mendix token** in Connections; everywhere else both variables are taken out of the workers' environment.

## What workers can't see

The office removes from every worker's environment: the Jev key variables (`TYPESAFE_API_KEY` and all `AGENT_OFFICE_*` settings), the Mendix token (`MENDIX_TOKEN`, `MX_PAT`) unless it's switched on for that project, and, for workers that run as a signed-in person, the office's own GitHub token. The admin token and the office password never reach a worker.

## The Firm's reviewers can't write

The Firm's Reviewer Agents get no GitHub tokens, SSH agent or credential manager, work in a clone with no remote, and have deny rules for `git push`, GitHub writes, `gh api`, and reading `~/.agent-office*` and `~/.ssh`. See [The Firm → Isolation](../using-the-office/the-firm.md#isolation-no-shared-context-no-bias).

## The audit log

The [audit log](../using-the-office/audit-log.md) records sign-ins, settings changes, hires, escalations, approvals, GitHub actions and The Firm's steps, hash-chained so an edit shows. It never records token values; prompt text only when an admin turns it on. Exporting it is admin-only and is itself logged.

## The docs are behind the sign-in

`/docs` uses the same sign-in as the rest of the office, because these pages name token files, folders and ports. The original upstream docs in the repository (`docs/*.md`) stay readable on GitHub.

## The office is local

By default the server listens on `127.0.0.1` only. To share it, see the upstream guides in the repository (`docs/self-hosting.md`, `docs/tunnel.md`): HTTPS, a reverse proxy, or a tunnel.

## Reaching it from your phone

[📱 Phone access](phone-access.md) opens a private tunnel to the office, from Settings → Connections:

- **Microsoft Dev Tunnels** are created private: only the Microsoft account that set them up gets through (never `--allow-anonymous`). **Cloudflare Tunnel** is meant to sit behind **Cloudflare Access**; the office checks that a visitor who isn't signed in is stopped, and switches the tunnel off if not. A **quick tunnel** is public, needs its warning accepted every time, and switches itself off after an hour.
- The office password is still asked, whichever tunnel. The session cookie is `Secure` on the tunnel's https address; the office trusts the forwarded headers (the phone's address, https, the host) only for requests from its own tunnel, so sign-in attempts are rate-limited per phone.
- **Risky actions from the phone** (merge, hire, raise a cap, approve a merge-order escalation) need a second tap and the password again, unless you signed in within the last 10 minutes. The office enforces it, not just the page.
- **Risky actions from a desktop page through the tunnel** need the same fresh sign-in (anyone with the tunnel's address and a cookie could open the 3D office or /lite too). They are: merging a PR, hiring (a role, a desk, or a station by asking it), raising a team cap or a budget (or switching its auto-pause off, resuming it, applying a level), approving a merge-order, security, data-loss or budget-overrun escalation, ▶ Resume / ⏸ Pause project and 🔁 Restart safely, changing Connections (credentials, folders, the Teams webhook, Phone access itself; switching it off never asks), opening Studio Pro and resolving an incident. Without a fresh sign-in the office answers 401 `{ reauth: true }` (or, over the socket, sends the action back), the page asks for the password in a window of its own (✕ or Esc cancels) and does it once the password is accepted. The office's own address (localhost, the LAN, the tailnet) never asks.
- The audit log has the tunnel going up and down (`access.tunnel.*`), who switched it, every action from the phone (`phone.*`) and every password typed again (`login.reauth.*`).
- **Web Push**: the private VAPID key is in Connections (DPAPI); pushes are encrypted per phone and only ever sent to the known push services (Apple, Google, Mozilla, Microsoft), never to an address a browser makes up.
