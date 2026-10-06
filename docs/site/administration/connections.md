---
title: Connections
description: The 🔌 Connections page - the agents' and admin GitHub tokens, the Mendix token, the Jev key and the office password in one place, encrypted, with a Test button each; git & gh; the office's folders; and the hourly worktree cleanup.
weight: 2
---

**🔌 Connections** is where an admin gives the office everything it signs in with, from the office itself: no dot-files to write, no launcher to edit, no restart. Open it from **☰ → 🔌 Connections**, **⚙️ Settings → 🔌 Connections**, the **🔌 Connections** button on the home page, or the wizard when the admin token is missing. Only admins (operators) see it.

## The credentials

| Card | What it's for | What to give it |
|---|---|---|
| 🤖 **GitHub token for agents** | git and gh for the office and every worker (`GH_TOKEN` / `GITHUB_TOKEN`) | Fine-grained, owner your organization, **All repositories**, **Contents**, **Issues**, **Pull requests**: read and write |
| 🛡️ **GitHub admin token** | Creating project repositories from the ✨ New project wizard, nothing else | Fine-grained, owner your organization, **All repositories**, **Administration** and **Contents**: read and write |
| 🧱 **Mendix personal access token** | The Mendix platform: creating the app (`mx:app:create`), later Team Server and deploys | Scopes `mx:app:create`; `mx:deployment:read` lets **Test** list your apps |
| ⚖️ **Jev key** | Jeff · Router asks Jev by TypeSafe AI instead of Haiku | A TypeSafe AI API key |
| 🔒 **Office password** | The shared password (it signs people in as admins) | At least 8 characters |

Each card shows:

- **Status**: ✅ Connected, ➖ Missing, ⛔ Invalid (refused, expired, or saved on another machine) or ⏳ Expiring (a GitHub token within 14 days of its expiry date).
- **Where the value in use comes from**: *Saved here*, an environment variable (for example *GH_TOKEN (from ~/.agent-office-gh-token)*, which the launcher sets), or a file. Only the last four characters are ever shown.
- **🧪 Test**: a cheap read call. For a GitHub token: who it signs in as, its expiry date, the repositories it sees and their owners, whether it reaches every project in the building, and (agents' token) whether it can read contents, issues and pull requests. Fine-grained tokens don't report their permissions, so write access can't be read back: GitHub's token page shows it. For the Mendix token: whether Mendix takes it (Mendix doesn't report scopes). For the Jev key: one tiny Jev call. A new value is tested as soon as it's saved.
- **➕ Add / ♻️ Replace / Remove**, and **What it's for and how to make one**: the exact permissions and a **Create on GitHub** link with the form filled in (name, owner, expiry, permissions; you still pick *All repositories*).

The Mendix card also has **Give agents the Mendix token**, one tick per project, **off by default**: only that project's workers hired afterwards get `MENDIX_TOKEN` and `MX_PAT`. Everywhere else the office takes both variables out of the workers' environment, even if it was started with them. The wizard can always read it (for the Mendix Projects API).

## Where it's kept

Saved values go in `credentials.json` in the office's data folder (never in a repository).

- **On Windows** each value is encrypted with **DPAPI for the Windows user the office runs as** (`System.Security.Cryptography.ProtectedData`, through a PowerShell child; no native module). The file is useless to another user or on another machine; a value saved elsewhere shows as *can't be decrypted here*.
- **Elsewhere** there's no DPAPI, so values are kept base64-encoded in a file only the office's user can read (`0600`), and the page says so.

Values reach the office once, in the body of a save, and never go back to a browser, a log or the [audit log](../using-the-office/audit-log.md): the log records *GitHub token for agents replaced by Ana*, not the token. `credentials.json` also keeps, unencrypted, each value's masked tail, who saved it and when, and the last Test's result with a short one-way fingerprint of the value it tested.

## The order the office looks in

For each credential, the first that has a value wins:

1. **Connections** (`credentials.json`).
2. **The environment variable** the office was started with: `GH_TOKEN` / `GITHUB_TOKEN`, `AGENT_OFFICE_ADMIN_GH_TOKEN_FILE` (a path), `MENDIX_TOKEN` / `MX_PAT`, `AGENT_OFFICE_JEV_KEY_FILE` (a path) or `TYPESAFE_API_KEY`, `AGENT_OFFICE_PASSWORD`.
3. **The dot-file**: `~/.agent-office-gh-token`, `~/.agent-office-admin-gh-token`, `~/Mendix/.env` (`MX_PAT=`), `~/.agent-office-jev-key`, `~/.agent-office-password`.

So an office started the old way, with `start-office.ps1`, keeps working unchanged. The office password is the exception to "a value": only its hash is kept. Changing it here writes a new hash to `config.json` (and drops the generated plaintext password if it was still there); from then on it beats `AGENT_OFFICE_PASSWORD`. Everyone on the shared password is signed out, except you. **Use the launcher's again** hands it back.

## Import from files

When the dot-files are there, a banner offers **📥 Import from files**: one click saves each value into Connections (the password as its hash) and lists the files you can now delete.

> [!WARNING]
> `start-office.ps1` stops if `~/.agent-office-gh-token` is missing. Make that check optional in the launcher before you delete the file.

## git & gh

**🔍 Check git & gh** looks at the office's machine: whether git and gh are installed (with the `winget` command if not), whether gh signs in with the agents' token, and whether git has a name and email for commits. gh runs with the token in its own environment and an empty, throwaway `GH_CONFIG_DIR`, so your own gh login is never read or changed; git's global config is only read.

If git has no identity, set one for the workers' commits there: it goes into their environment as `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL`, and git's own settings stay as they are.

## Folders

- **Projects folder**: where new projects are cloned (`<folder>/<owner>/<repo>`); the same setting as ⚙️ Settings › Building › *Workspace folder*.
- **Toolkit folder**: the mxcli-project-toolkit clone the wizard runs and the Playbooks point at. It must contain `bin/init-project.sh`. Picked here, it beats `AGENT_OFFICE_TOOLKIT_DIR`; **Default** goes back to the variable or `~/agent-spike/mxcli-project-toolkit`.

## Worktrees stay in the project

Agents used to make git worktrees in `AppData\Local\Temp\<name>` or next to the project (`agent-spike\leslie-brd`), where the office never saw or cleaned them. Now every Claude worker has a hook (`bin/worktree-guard.js`, beside Studio mode's guard) that refuses `git worktree add` anywhere but the floor's `.agent-office/worktrees/`, and tells the agent the exact path to use. The Playbooks say so too.

## Worktree cleanup

Every hour (the first time ten minutes after the office starts), and on **▶ Run now**, the office looks at each floor's worktrees under `.agent-office/worktrees/` and removes the ones where:

- no worker of the office has it any more (sent home, gone),
- its branch is merged into origin's copy of the project's branch or origin's default branch (a merge, a fast-forward, or a squash or rebase merge: the content is there),
- it has no uncommitted or untracked changes and isn't locked.

Its branch goes too, and each removal is in the audit log (`worktree.removed`). Before git deletes the folder, every symlink and junction inside it is unlinked without being followed, so a `node_modules` junction's target is never touched. Everything else is kept, with the reason on the page; worktrees made outside `.agent-office/worktrees/` are only listed. **🟢 On / ⚪ Off** switches it (on by default).
