---
title: Set up on a new machine
description: From a fresh Windows machine to a working office in about 20 minutes. The prerequisites with links, clone, install and build, start-office.ps1, the first-run setup screen, the desktop shortcut and troubleshooting.
weight: 1
aliases: [/docs/new-machine, /docs/install]
---

This page takes a Windows machine with nothing on it to a running office with its first project. It takes about 20 minutes, most of it installing programs. You don't edit any file by hand: the office asks for everything in its **first-run setup** screen.

## Before you begin

Install these first. The setup screen checks each one again later and shows a green or red row for it, so you can also install a missing one then.

| What | Why the office needs it | Get it |
| --- | --- | --- |
| **Node.js 22.5 or newer** | Runs the office (its `node:sqlite` reads Mendix models). | [nodejs.org](https://nodejs.org/en/download) or `winget install OpenJS.NodeJS.LTS` |
| **Git for Windows** (with Git Bash) | Clones projects and gives each agent its own worktree. Git Bash runs the toolkit's scripts. | [git-scm.com](https://git-scm.com/download/win) or `winget install Git.Git` |
| **GitHub CLI** (`gh`), signed in | Lists your repositories, opens issues and pull requests. | [cli.github.com](https://cli.github.com) or `winget install GitHub.cli`, then `gh auth login` |
| **Claude Code** (`claude`), signed in | Every agent is a Claude Code session. | [Claude Code setup](https://docs.claude.com/en/docs/claude-code/setup), then run `claude` once and sign in |
| **Mendix Studio Pro** | Builds and checks the apps. New projects start on 11.12. | [Mendix Marketplace](https://marketplace.mendix.com/link/studiopro/) |
| **mxcli** | How agents read and change Mendix models. | [mxcli releases](https://github.com/mendixlabs/mxcli/releases) |
| **jq** | The toolkit's scripts read JSON with it. | `winget install jqlang.jq` |
| PostgreSQL (optional) | Only for the **🌐 Live app**. Everything else works without it. | [postgresql.org](https://www.postgresql.org/download/windows/) |

You also need a GitHub account (or organization) for the projects, and a Mendix account for the Mendix token.

> [!TIP]
> After you install a program, open a **new** PowerShell window. A window that was open before doesn't see the program on its PATH yet.

## Step 1: Clone, install and build

In PowerShell:

```powershell
git clone https://github.com/keithchin/mx-office.git
cd mx-office
npm install
npm run build
```

`npm install` takes a few minutes the first time. You can also skip the last two commands: the launcher in the next step runs them when the build is missing.

## Step 2: Start the office

```powershell
.\scripts\start-office.ps1
```

The launcher:

- keeps the office's data in `%USERPROFILE%\mx-office` and clones new projects there. Use `-OfficeHome D:\office` for another folder;
- listens on port 4600. Use `-Port 4610` for another port;
- builds the office first if there is no `dist` folder yet;
- opens the office in your browser, already signed in, once it is up;
- starts the office again after **🔁 Restart safely** (⚙️ Settings › Agents).

Keep the PowerShell window open. **Closing it stops the office and its agents.** Run the launcher again when the office is already running and it only opens the browser.

> [!NOTE]
> The launcher doesn't read any token or password file. The office keeps those itself, encrypted for your Windows user, in [🔌 Connections](../administration/connections.md). Environment variables that are already set (`AGENT_OFFICE_HOME`, `GH_TOKEN`, `AGENT_OFFICE_PASSWORD` and the others) still win, so an older launcher script keeps working.

If PowerShell refuses to run the script ("running scripts is disabled on this system"), run it as `powershell -ExecutionPolicy Bypass -File .\scripts\start-office.ps1`, or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Step 3: The first-run setup

A new office opens on **🚀 First-run setup** (`/setup`). It has six steps. Each step is saved as you go, so a reload or a restart opens on the same step.

1. **Welcome.** Set the office password (at least 8 characters) and, if you like, your name. Anyone who signs in with the password is an admin. The office keeps only its hash.
2. **Prerequisites.** A row for each program in the table above: green when it is there, red with a fix and an install link when it isn't. **Required** and **Optional** say which ones a project needs. Press **🔄 Re-check** after you install something (restart the office after installing a program, so it is on its PATH). If mxcli is somewhere the office doesn't look, give its path in the mxcli row.
3. **GitHub.** The organization (or your user name) new projects are created in, and the two tokens: the **agents' token** for the projects' repositories, and the **admin token** that only creates new repositories. Each card explains the exact permissions, links to GitHub's form with them filled in, and has a **🧪 Test** button.
4. **Mendix.** Your Mendix personal access token, and the Studio Pro version new projects start on.
5. **Toolkit.** Pick the folder of an existing clone of the mxcli project toolkit, or clone it: the upstream is filled in, or type your organization's fork. The clone runs in the background and shows git's progress.
6. **Done.** A summary, then **✨ Create your first project** (opens the [new-project wizard](first-project.md)) or **📚 Open docs**.

Only admins can do the steps. Everything you set here can be changed later in **⚙️ Settings › 🔌 Connections**, which also has **🚀 Run setup again**.

## Step 4: A desktop shortcut

```powershell
.\scripts\install-shortcut.ps1
```

This puts a **Mx Office** shortcut on the desktop and in the Start menu. It runs `start-office.ps1` from this folder: it starts the office, or opens it when it is already running. Pass `-OfficeHome` or `-Port` to have the shortcut use them, `-NoDesktop` for the Start menu only, and `-Remove` to take the shortcuts away again.

## Next steps

- [Create your first project](first-project.md) with the wizard.
- [Quick start](quick-start.md): hire the team, give the first task, answer the first escalation.
- [Running the office](../administration/running-the-office.md): restarts, keeping the computer awake, updates.

## Troubleshooting

**The office opens in a Windows Terminal tab, or closes with it.** When Windows Terminal is your default terminal, the shortcut opens there. That works the same way: keep the tab open. To use the classic console window instead, set *Windows Terminal → Settings → Startup → Default terminal application* to *Windows Console Host*.

**Cloning or a worktree fails with "Filename too long".** Mendix projects and their worktrees can have long paths. Optionally allow long paths for Git once, in an administrator PowerShell:

```powershell
git config --system core.longpaths true
```

**The first start, or the first check of a program, is slow.** Microsoft Defender scans each new program the first time it runs: Node, `gh`, `claude`, mxcli and the toolkit's scripts. The first start of the office and the first prerequisite check can take a minute. Later starts are quick.

**"Port 4600 is in use by another program".** Something else listens on that port. Start the office on another one: `.\scripts\start-office.ps1 -Port 4610`, and reinstall the shortcut with the same `-Port`.

**A row stays red after you installed the program.** The office only sees programs that were on its PATH when it started. Close the office's window, open a new PowerShell, and start the office again.

**The setup page doesn't open by itself.** It opens on its own only on an office with no projects yet, while its password is still the generated one or its projects folder isn't there. An office that already has projects never opens it by itself. Open `/setup` yourself, or use **⚙️ Settings › 🔌 Connections › 🚀 Run setup again**.

More problems and their fixes are on [The office and the browser](../troubleshooting/office-and-browser.md).
