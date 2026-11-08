---
title: Expert mode and the Session screen
description: One person's own Claude Code session in the project folder, with the live app beside it, the phases above it and the office round it - no coordinator, no roster, and the office never types into the session.
weight: 2.7
---

**Expert mode** is for someone who already builds Mendix apps with Claude Code, mxcli and the mxcli project toolkit and wants to keep working exactly that way, with the office's preview, phases and (soon) background proof round it. A project in Expert mode has no Project Coordinator, no Leads and no roster: the session is yours, and subagents, skills, slash commands and plan mode are whatever Claude Code and the toolkit in the folder give you.

Every project is in **Team mode** unless it says otherwise; projects from before Expert mode stay as they were.

## Start a new project in Expert mode

**✨ New project** first asks **How do you want to build?**

- **Expert mode**: your own Claude session, with the office in the background. For experienced builders making new apps.
- **Team mode**: a governed agent team. For rebuilds, migrations, governed delivery, and people new to Mendix. **Continue** goes on to the brief-first flow ([Create your first project](../get-started/first-project.md)), unchanged.

(From a client's page, **＋ New project** goes straight to Team mode.)

The Expert wizard is one page in three sections (admins only, like every setup):

1. **App**: the project name (the folder and the Team Server app take its lower-case form, like `order-desk`), the **Mendix version** (11.12.4 by default, from the same list the Team wizard shows), and **Create on Team Server** or **Connect existing app** (paste the App ID from the Portal: the app's Settings › General). The Mendix account from Settings › Connections shows *Mendix account connected*; the wizard never asks for a token. Without one, it says *Connect in Settings*.
2. **Tools and safety**: the **toolkit version** (*Latest release*, the newest commit of the office's toolkit clone, or one of the commits before it) and the **mxcli version** (*Latest release*, the mxcli the office runs). The toolkit is pinned for the project as in Team mode; the mxcli version goes into the project's `.claude/toolkit.env` as `MXCLI_VERSION`, for the toolkit's bootstrap. **Git, with auto-commit and push to Team Server** is always on. **Demo users, local only** is on by default: fine while you build; Lock in will block Deploy until seed users replace them.
3. **Budget and brief**: the **budget** in USD (the alert comes at 80 %, and the session pauses at 100 %: always on), the **model** (**Sonnet** by default, **Opus** one switch away; it becomes the session's `--model`, and `/model` in the session still works), and an optional one-paragraph **brief**. The brief is saved to `docs/project-brief.md` in the project. The office never sends it to the session: ask the session to read it, or just start talking.

**Create and open session** runs the same setup as Team mode: the app on Team Server (made, or the existing one connected and checked), the clone, the Mendix app made with the picked Studio Pro, the toolkit's scaffold at its pin and the pre-commit hook, then the first commit pushed to Team Server. There is no GitHub repository (as Team Server without a mirror), no intake answers, no register rows, no gate-check, no Discovery issue and no team. The project is marked Expert mode as soon as it's cloned, the model, demo users and mxcli pin are saved in `agent-office.project.json` (under `expert`), and the budget is set. The progress shows in five groups (Team Server app, Mendix app, Toolkit and mxcli, Settings and first push, Session); a failed step shows its error with **Retry** and **Cancel & undo**, as in Team mode, and Cancel & undo never deletes the Team Server app. When it's done, the project's Session screen opens and the session starts in the folder, on the chosen model, with nothing typed into it.

A test office never calls the Mendix Portal: there, the project's origin is the test office's local stand-in, and the first group says so.

## Open an existing toolkit project

On **➕ Add a project**, admins have **Open existing toolkit project**. Type the full path of the app's folder on the office's machine (a folder with the mxcli project toolkit in it) and press **Check folder**. The office refuses its own folders, system folders, a whole drive and your whole home folder.

### The readiness check

The office looks at the folder and shows one row per check, each with a green tick, an amber or a red mark and one plain line:

| Check | What it looks at |
|---|---|
| Toolkit | The toolkit's skills, subagents and project scripts, which toolkit commit the project is on (PROJECT.md's `Toolkit commit:` line, else an estimate from the copied scripts) and whether it is pinned. Not pinned means a toolkit update would change the project. |
| mxcli | Which mxcli the session uses: the copy in the folder, the one on the PATH, or the office's; and its version. |
| Mendix version | The version the `.mpr` was saved with, and whether that Studio Pro is installed here. |
| Git repository | Commits on the current branch, uncommitted changes and the last commit's subject. |
| Team Server remote | Whether the folder has a Team Server remote. An existing GitHub `origin` is fine; remote addresses are never shown. |
| Demo users | On or off, and how many. Demo users are fine for local work; they are the only thing that blocks a Deploy at Lock in. |
| Tests | Microflow tests (`@test` in `tests/*.test.mdl`), journeys and e2e scripts. Amber when there are no microflow tests. |
| Budget | Whether the project has a budget. |
| Lint baseline | The findings in `.claude/lint-baseline.json`. It is taken as the baseline, so sessions show only new findings. |

**The check never writes to the folder.** It reads files, runs only git commands that read (without optional locks), reads the `.mpr` from a temporary copy and asks mxcli only for its version. Each check has a time limit, and the result is kept for a minute. **Check again** looks afresh.

**Nothing is required to attach.** **Attach and open session** makes the Expert-mode project and opens its Session screen. If the folder is already an Expert project, the button is **Open session**.

### Fixes

Each fix runs only when you press its button, and writes only what it says:

- **Pin `<commit>`**: writes the toolkit pin into `agent-office.project.json`.
- **Add Team Server remote**: creates a new app in the Mendix Portal or uses an existing one by its App ID, adds a `teamserver` remote and records the app in `agent-office.project.json`. Any existing remote, such as a GitHub `origin`, stays as it is. Nothing is committed or pushed: the session's background proof pushes its branch there. It uses the Mendix account in **Settings › Connections**.
- **Switch to seed users** and **Ask session to add**: these are model changes the session should make. The office notes them (in its own data, not in the folder) and the row says **Ask the session after attaching**.
- **Set budget**: a total in US dollars with auto-pause at 100 %. Before the folder is attached it is kept and set on the project when you attach.

Importing past spend from earlier local sessions is not offered yet.

## The Session screen

Arriving on an Expert-mode project opens **General › Session**. The Overview, Roadmap, Documents, Budget, Testing and Monitoring pages are still in the navigation; the team's own pages (Team, Team boards, Board, Approvals, Standup) and the team-lead panel are not shown on an Expert-mode project.

- **Header**: the folder's branch, the app's Mendix version, the toolkit pin (or *toolkit not pinned*), the mxcli the office runs, and the session's state from its hooks: *Working*, *Idle · waiting for you*, *Needs you*, *Starting* or *Not running*. **Lock in** is there but not yet working.
- **Phase strip**: for a phased project, the phase in progress (rows done, spend against its estimate, the next checkpoint) and a chip per phase. A click opens the [Roadmap](phased-delivery.md). A project delivered in one go has no strip.
- **Live preview** (left): the project folder itself, run in place with hot reload, the way `mxcli run --watch` runs in your own folder: the session's working copy as it is, uncommitted changes included. When the session changes the model, mxcli's watch reloads the running app and the preview shows it. There is no checkout of main and no auto-refresh for an Expert-mode project; start and stop it here or on the [Live app](live-app.md) page. Pick a **page** of the app (those that open by address, read from the model at the running version) or a **demo user** to sign in as (demo users are fine for local work; the office never handles their passwords). After a new build or a hot reload the preview lights up with *Updated*.
- **asked → visible**: from the prompt you submit to the first preview reload after the next model change. A model change is a toolkit `bin/exec.sh`, an `mxcli exec` or `apply`, or the `.mpr` (or its `mprcontents`) changing while the session works. The header shows the last time and the median of this session ("asked → visible 41 s · median 52 s").
- **Session** (right): the real interactive `claude`, started in the project folder with no prompt, in a terminal coloured for the screen. Type in it as you would in your own terminal. The office never types into it: after an office restart it comes back with `--resume` and waits for you. **↗** pops it out into a window of its own; **⇄** swaps the sides.
- **Background proof** (bottom): the last commit on the session branch (`session/main`) and its push, the budget meter, stuck status and the decision count. A push that fails shows here, not as a dialog.

### The split

Drag the divider between the preview and the session (a grip shows on hover); both sides stay at least 320 px wide. Double-click it (or press Enter on it) for half and half; with the divider focused, the arrow keys move it (Shift for bigger steps) and Home and End go to the limits. **App | Both | Chat** in the header show the preview only, both, or the session only. The split, the focus and the side are remembered per project in your browser. Folding the navigation to icons (**«** or **[**) gives both sides more room.

## Notes

- The session runs on the office's own Claude sign-in or key, like any agent the office starts.
