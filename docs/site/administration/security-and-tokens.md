---
title: Security & tokens
description: The office password and who is admin, the agents' and admin GitHub tokens, the Mendix token, the Jev key, what workers can and can't see, what the office doesn't isolate, and why the docs are behind the sign-in.
weight: 2
---

## Connections first

The tokens, the Jev key and the office password are managed from **☰ → 🔌 Connections** (admins): encrypted with Windows DPAPI in the office's data folder (on macOS: in your login Keychain, [below](#on-macos-the-keychain); on Linux: a `0600` file), with a Test button each. See [Connections](connections.md). The office looks for each one in Connections first, then its environment variable, then the files below, so the files still work (and **📥 Import from files** moves them into Connections in one click).

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

## On macOS: the Keychain

On a Mac (preview) each saved value is a generic password item of its own in the **login Keychain** of the user the office runs as: service `com.mxoffice.connections`, account `<12 hex characters of the office's credentials.json path>/<credential>` (so two offices on one Mac never share an item), the value base64-encoded as the item's password. `credentials.json` keeps only the account name, the masked tail, who saved it and when. You can see the items in **Keychain Access** (search `com.mxoffice`); deleting one there makes that credential *can't be decrypted here* in Connections, and removing a credential in Connections deletes its item.

The office uses Apple's own `/usr/bin/security`, never a native module, and keeps the value off every command line (where `ps` shows it to any user on the Mac): `security add-generic-password … -w <value>` would put it there, and `-w` with no value asks on a terminal the office doesn't have. So it starts `security -i` (its interactive mode, which reads commands from stdin) and writes `add-generic-password -U -s com.mxoffice.connections -a <account> -X <hex>` to its stdin, the value as hexadecimal (`-X`), then reads the item back with `find-generic-password … -w` (the answer on stdout, read only by the office) to check it was saved. Items `/usr/bin/security` made are readable by it again without a Keychain prompt.

- **Moving in**: values an older office (or the Linux-style file) kept base64-encoded in `credentials.json` move into the Keychain the first time the office opens it, and their base64 copies leave the file.
- **Fallback**: when the Keychain won't take a value (locked, or the office runs over SSH with no desktop session), the value is kept in the `0600` file instead and its Connections card says so; the office tries to move it in again at its next start. `AGENT_OFFICE_KEYCHAIN=0` keeps a Mac office on the file on purpose.
- **Linux** stays as it was: base64 in a `0600` file, said on the page.

## Who is admin

Anyone who signs in with the **shared office password** is an admin, that is, the Project Manager. Admin-only actions: hiring and benching team members, approvals and escalation answers, settings, the live app's start and stop, creating projects, changing team labels, re-analysing.

People can also have their own accounts (**☰ → 🔑 Accounts**, admin only), with their own Claude and GitHub sign-ins. An account is `admin` or `member`; a session on the shared password **without** an account is always an admin (`src/server/office/people.ts`).

**The server decides, per action.** Each route checks for itself whether it needs an admin; there is no central list. Most project changes do, but not all: on the team routes, **tell** (a question to the lead), **nudge** (an idle member back to its task) and **standup** are open to any signed-in person, members included (`ADMIN_ONLY` in `src/server/http/routes/roster.ts`). Hiding an admin-only page or button for a member is a convenience: a link can still open an admin page, and it's the server's check that refuses the action.

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

Taking a value out of the environment keeps it out of an agent's way; it doesn't keep it from an agent that goes looking. See the next section.

## What the office doesn't isolate

The office organises agents; it doesn't contain them. Know these limits before you give it real credentials or put several clients on one machine:

- **Agents run as the office's own operating-system user**, with no sandbox from the office. What an agent can read, write or run is bounded by that user's rights and by its provider's own permission layer (for Claude Code: its permission mode, its rules and the project's `.claude` settings), not by the office. The office adds `--permission-mode acceptEdits` only for a Claude model that Claude Code's auto mode isn't offered for (Haiku), and none when `--agent-args` set a mode (`src/server/providers/claude.ts`). An agent can read other projects' folders, the office's data folder and the secret files above.
- **The hook tokens are in plain text.** Each worker reports to the office's loopback hook port with a token of its own, kept in `<project>/.agent-office/workers.json` next to the worktrees. Any agent that reads that file could report as another worker.
- **One GitHub identity for many agents.** Agents have no GitHub accounts of their own: they use the agents' token above or, in an office with accounts, the GitHub sign-in of the person who hired them. GitHub can't tell those agents apart, and the token's scope is the only limit on what they can do there.
- **Commit authors are set, not proven.** The office gives each agent's commits its own author name through environment variables ([Review gate](../using-the-office/review-gate.md#each-agent-commits-as-itself)); an agent can change them.
- **Connections' encryption protects against other people, not against the agents.** DPAPI ties `credentials.json` to the office's Windows user and machine: another user or another computer can't read it. Code running as the same user, which includes every agent, can ask Windows to decrypt it.
- **Clients, teams and roles are labels, not walls.** They organise prompts and records; nothing stops one project's agent from reading another client's folder by its path.
- **The office's merge gate covers its own Merge button only.** The PR window refuses a pull request whose current head has no independent review that counts (an admin can override it, audited); an agent's own `gh pr merge` goes around it. The office posts the verdict as the `mx-office/review` status and shows whether the default branch requires it; only branch protection on GitHub requiring that status blocks every merge, and a person sets it up there ([Review gate](../using-the-office/review-gate.md#the-merge-gate), [Branch protection](../integrations/branch-protection.md)). The office never writes branch protection.
- **The Firm's reviewers are the only isolated agents** (next section): their own folder with a clone pinned to one commit and no remote, no GitHub token or git credentials, and deny rules. That is still the same operating-system user, not an OS-level sandbox.

See [Trust and authority](../architecture/trust-and-authority.md) for which rules the office enforces, which are hooks it installs, and which are only instructions to agents.

## The apps' own security

This page is about the office. The security of the Mendix apps the teams build has a page of its own: [Security baseline](../using-the-office/security-baseline.md). In short, the office reads each app's security level, strict mode, demo users, anonymous access and entity access rules from the model on main, runs Mendix's own `mx check` at a commit, and refuses your sign-off of Stage 4 and later and ✅ Accept while the project's policy (Production security before the build, by default) isn't met at that commit. A new app made by ✨ New project starts at Production with strict mode off (recommended: switch it on once the widgets are vetted). None of this proves an app is secure, and it doesn't stop an agent's merge.

## The Firm's reviewers can't write

The Firm's Reviewer Agents get no GitHub tokens, SSH agent or credential manager, work in a clone with no remote, and have deny rules for `git push`, GitHub writes, `gh api`, and reading `~/.agent-office*` and `~/.ssh`. See [The Firm → Isolation](../using-the-office/the-firm.md#isolation-no-shared-context-no-bias).

## The audit log

The [audit log](../using-the-office/audit-log.md) records sign-ins, settings changes, hires, escalations, approvals, GitHub actions and The Firm's steps, hash-chained so an edit shows. It never records token values; prompt text only when an admin turns it on. Exporting it is admin-only and is itself logged.

## The docs are behind the sign-in

`/docs` uses the same sign-in as the rest of the office, because these pages name token files, folders and ports. The older pages in the repository (`docs/*.md`) stay readable on GitHub.

## The office is local

By default the server listens on `127.0.0.1` only. Running it on a server for a whole team isn't supported in Mx Office; to reach it from your phone, use [Phone access](phone-access.md).

## Reaching it from your phone

[📱 Phone access](phone-access.md) opens a private tunnel to the office, from Settings → Connections:

- **Microsoft Dev Tunnels** are created private: only the Microsoft account that set them up gets through (never `--allow-anonymous`). **Cloudflare Tunnel** is meant to sit behind **Cloudflare Access**; the office checks that a visitor who isn't signed in is stopped, and switches the tunnel off if not. A **quick tunnel** is public, needs its warning accepted every time, and switches itself off after an hour.
- The office password is still asked, whichever tunnel. The session cookie is `Secure` on the tunnel's https address; the office trusts the forwarded headers (the phone's address, https, the host) only for requests from its own tunnel, so sign-in attempts are rate-limited per phone.
- **Risky actions from the phone** (merge, hire, raise a cap, approve a merge-order escalation) need a second tap and the password again, unless you signed in within the last 10 minutes. The office enforces it, not just the page.
- **Risky actions from a desktop page through the tunnel** need the same fresh sign-in (anyone with the tunnel's address and a cookie could open /lite too). They are: merging a PR, hiring (a role, a desk, or a station by asking it), raising a team cap or a budget (or switching its auto-pause off, resuming it, applying a level), approving a merge-order, security, data-loss or budget-overrun escalation, ▶ Resume / ⏸ Pause project and 🔁 Restart safely, changing Connections (credentials, folders, the Teams webhook, Phone access itself; switching it off never asks), opening Studio Pro and resolving an incident. Without a fresh sign-in the office answers 401 `{ reauth: true }` (or, over the socket, sends the action back), the page asks for the password in a window of its own (✕ or Esc cancels) and does it once the password is accepted. The office's own address (localhost, the LAN, the tailnet) never asks.
- The audit log has the tunnel going up and down (`access.tunnel.*`), who switched it, every action from the phone (`phone.*`) and every password typed again (`login.reauth.*`).
- **Web Push**: the private VAPID key is in Connections (DPAPI); pushes are encrypted per phone and only ever sent to the known push services (Apple, Google, Mozilla, Microsoft), never to an address a browser makes up.
