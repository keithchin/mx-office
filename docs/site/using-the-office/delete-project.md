---
title: Delete or remove a project
description: The Danger zone at the bottom of a project's Settings - Remove from office (folder and repository kept) or Delete project (the local folder and the GitHub repository too, if you tick them) - behind a GitHub-style confirmation where you type the repository's name. What each does, what is archived first, and the guards.
weight: 13.2
---

Deleting a project works the way deleting a GitHub repository does: it's at the bottom of the project's settings, in a red **Danger zone**, and the button stays disabled until you type the project's name.

Open the project, then **⚙️ Settings › ⚠️ Danger zone** ([section=danger](/lite?tab=settings&section=danger)). It's listed for admins only (the same admins who can pause a project or change its team). On `/home` in the Portal look, a project card's **⋯ → Delete…** opens the same dialog.

## Remove from office or delete

| | **Remove from office** | **Delete this project** |
|---|---|---|
| Every agent of the project stopped and sent home | yes | yes |
| The worktrees the office made (under the project's `.agent-office/worktrees/`) removed | yes | yes |
| The office's data for it archived, then removed | yes | yes |
| Taken off the office (`floors.json`), its project id retired | yes | yes |
| The local folder | kept | deleted, if you tick **Also delete the local folder** |
| The GitHub repository | kept | deleted, if you tick **Also delete the GitHub repository** |

Both boxes start unticked, so **Delete this project** with nothing ticked does what Remove from office does. A Mendix app in the Portal (and its Team Server repository) is never deleted by the office: the dialog says so, with a link to the Portal, so you can clean it up there.

## The confirmation

The dialog (✕ or Esc closes it) is titled **Delete &lt;name&gt;**. A red box says exactly what will happen: how many agents are stopped, how many worktrees go (and how many hold uncommitted or unpushed work), where the data is archived, and whether the folder and the repository are kept or deleted. Then: *To confirm, type **acme/shop** in the box below* (the repository, owner/name; a project with no repository uses its id). The red button is disabled until the box says exactly that, case and all. The office checks the name again before it does anything.

Worktrees with work nobody pushed are listed by branch, with their uncommitted files and unpushed commits, and you must tick **Remove them anyway** too. Uncommitted changes in them are lost. A branch with commits on no remote stays in the repository when the folder stays (only its worktree goes), so those commits aren't lost.

Once started, the dialog shows the steps as they run: stopping the agents, removing the worktrees, archiving the office data, removing it, deleting the folder, deleting the repository, taking the project off the office. Everyone who had the project open goes to `/home`, with a toast *Deleted &lt;name&gt;*.

## What's archived, and where

Before anything is removed, a copy goes to `<office data>/deleted/<project>-<date-time>/` (the office's data folder, see [Data locations](../administration/data-locations.md)):

- `office/`: the project's team (roster), chatter, budget ledger, acceptance records and the live app's log;
- `project-agent-office/`: the project's own `.agent-office` folder (workers, queue, boards, pictures), without the worktrees;
- `toolkit-pin.json` (its entry in the toolkit pin book), `incidents.jsonl` (the incidents that named it), `floor.json` (what `floors.json` had) and `manifest.json` (every step and what it did).

To bring a removed project back, add its repository again (its folder is reused when it's still where the projects folder clones it) and copy back what you need from the archive. It comes back as a new project: a deleted project's `prj_` id is never used again, and an evidence trace for it says *deleted on &lt;date&gt;*.

The [audit log](audit-log.md) is never deleted: a `project.delete` event records who did it, which mode, what was ticked, where the archive is and each step's result. The incident log is hash-chained, so it isn't cut either.

## The guards

- Nothing starts while a ⏸ pause or ▶ resume of the project, a 🔁 safe restart, or a toolkit update is under way.
- The local folder is only deleted when it's inside the office's projects folder (⚙️ Settings › 🛠️ Advanced), isn't a junction or symbolic link (nor reached through one), isn't the project the office was started in, and doesn't hold the office's own data or code. Every junction inside it is unlinked first without being followed, so a `node_modules` junction's target is never touched. Read-only files and long paths are handled; if a file is locked (Studio Pro, an editor, a terminal in that folder), the step stops and says so, and **Retry** carries on.
- The GitHub repository is only deleted when the office's GitHub token has the `delete_repo` scope (asked with `gh`). Otherwise the box is off with *the token can't delete repositories; delete it on GitHub*, and a link to the repository's settings page.
- In [test mode](../administration/test-offices.md) a folder is only deleted under `scratch/test-offices` (or a `test-office…` folder), and never a real GitHub repository.
- If a step fails, the job stops there and says why. Opening the dialog again shows *A deletion stopped part way* and **Retry** carries on from that step (with what was asked the first time), even after a restart.

Archiving a project (hidden from Home, agents stopped, everything kept) isn't available yet: ⏸ [Pause project](resume-and-pause.md) stops its agents and keeps everything.
