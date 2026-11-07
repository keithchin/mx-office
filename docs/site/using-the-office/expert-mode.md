---
title: Expert mode and the Session screen
description: One person's own Claude Code session in the project folder, with the live app beside it, the phases above it and the office round it - no coordinator, no roster, and the office never types into the session.
weight: 2.7
---

**Expert mode** is for someone who already builds Mendix apps with Claude Code, mxcli and the mxcli project toolkit and wants to keep working exactly that way, with the office's preview, phases and (soon) background proof round it. A project in Expert mode has no Project Coordinator, no Leads and no roster: the session is yours, and subagents, skills, slash commands and plan mode are whatever Claude Code and the toolkit in the folder give you.

Every project is in **Team mode** unless it says otherwise; projects from before Expert mode stay as they were.

## Open an existing toolkit project

On **➕ Add a project**, admins have **Open existing toolkit project**. Type the full path of the app's folder on the office's machine (a folder with the mxcli project toolkit in it) and press **Open session**. The office makes it an Expert-mode project and opens its Session screen. There are no readiness checks yet: the office only refuses its own folders, system folders, a whole drive and your whole home folder.

## The Session screen

Arriving on an Expert-mode project opens **General › Session** (the Overview and the other pages are still in the navigation). The team-lead panel is not shown on an Expert-mode project.

- **Header**: the folder's branch, the app's Mendix version, the toolkit pin (or *toolkit not pinned*), the mxcli the office runs, and the session's state from its hooks: *Working*, *Idle · waiting for you*, *Needs you*, *Starting* or *Not running*. **Lock in** is there but not yet working.
- **Phase strip**: for a phased project, the phase in progress (rows done, spend against its estimate, the next checkpoint) and a chip per phase. A click opens the [Roadmap](phased-delivery.md). A project delivered in one go has no strip.
- **Live preview** (left): the project's live app, the same one as the [Live app](live-app.md) page. Pick a **page** of the app (those that open by address, read from the model at the running version) or a **demo user** to sign in as (demo users are fine for local work; the office never handles their passwords). After a new build or a hot reload the preview lights up with *Updated*.
- **asked → visible**: from the prompt you submit to the first preview reload after the next model change (a toolkit `bin/exec.sh` or `mxcli exec`). The header shows the last time and the median of this session ("asked → visible 41 s · median 52 s").
- **Session** (right): the real interactive `claude`, started in the project folder with no prompt, in a terminal coloured for the screen. Type in it as you would in your own terminal. The office never types into it: after an office restart it comes back with `--resume` and waits for you. **↗** pops it out into a window of its own; **⇄** swaps the sides.
- **Background proof** (bottom): the last commit and its push, the budget, stuck status and decisions. Until the background proof part is installed it says *coming soon*.

### The split

Drag the divider between the preview and the session (a grip shows on hover); both sides stay at least 320 px wide. Double-click it (or press Enter on it) for half and half; with the divider focused, the arrow keys move it (Shift for bigger steps) and Home and End go to the limits. **App | Both | Chat** in the header show the preview only, both, or the session only. The split, the focus and the side are remembered per project in your browser. Folding the navigation to icons (**«** or **[**) gives both sides more room.

## Notes

- The preview runs the project's main branch, as the Live app page does: a change shows once it reaches main and the live app has picked it up.
- The session runs on the office's own Claude sign-in or key, like any agent the office starts.
