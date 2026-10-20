---
title: The toolkit
description: The mxcli-project-toolkit - its stages from P (kickoff) to 7 (cutover), the ✋ gates that need a CONFIRMED decision, where the office's clone comes from, and how the office shows it.
weight: 3
---

The **mxcli-project-toolkit** is the process every project follows. It is an open-source toolkit with a public upstream repository on GitHub; the office can also run from a fork of it. It ships 120+ skills the roles read, scripts for setting up a project, and a gate check.

## The stages

| Stage | Name | Gate |
|---|---|---|
| **P** | Kickoff | |
| **0** | Triage & scope | ✋ |
| **1** | Analysis | |
| **2** | Requirements | |
| **3** | Architecture & design | ✋ |
| **4** | Build plan | ✋ |
| **5** | Build | |
| **6** | Test | |
| **7** | Cutover | |

A **✋ gate** needs an explicit `CONFIRMED` decision in the project's `PROJECT.md` (`## Decisions`). The agents record it only when you (or the client) say so. A ✋ gate is not the same as a team member's [skill gate](../automation/skills.md) (ask, propose, tell or FYI).

## In the office

- The **wizard** creates a new project's Mendix app at the repository's root (`mx create-project`), runs the toolkit's `init-project.sh`, installs its pre-commit hook, writes `intake.md`, records the Stage P decisions and runs `gate-check.sh`. See [Create your first project](../get-started/first-project.md).
- The Command Center's **🧰 Project setup** panel shows stages **P to 4** with their status (from `intake.md` and the gate check), the next step and open questions, and **🔄 Re-check gates**. It goes away once Stage 4 is confirmed. See [Command Center](../using-the-office/command-center.md#project-setup).
- Everything the office starts for a project (its agents and shells, queue workers, **🔄 Re-check gates**, the wizard's toolkit runs, the live app) gets the keys in the project's `.claude/toolkit.env` (`MXBUILD_PATH` and the rest) over the office's own environment. The toolkit's scripts let the environment win over `toolkit.env`, so without this an `MXBUILD_PATH` the office was started with would build every project with that one mxbuild. A project without `toolkit.env` keeps the office's environment. The wizard writes `MXCLI_VERSION=nightly` there: there is no per-project mxcli version.
- Each project runs on its **own pinned commit** of the toolkit (a read-only copy in the pins folder next to the clone, `<clone>-pins/<sha12>`), not on whatever the shared clone is on, and its session-start ritual no longer pulls. The setup panel's Toolkit line and the progress bar's 🧰 chip show the commit and the newer ones on the clone's `origin`; **Update toolkit** previews the gate verdicts with the new commit before moving the pin. See [Toolkit versions](../administration/toolkit-versions.md).
- A **✋ MANUAL** stage puts *Stage X waits for your sign-off* in Needs you once it's the stage in play (every stage before it PASS or WAIVED). gate-check can't certify such a stage from files (it reports Stage 5, Build, MANUAL from the first run): its verdict is a CONFIRMED row in PROJECT.md's Decisions. **Sign off** tells the team lead *Signed off: Stage X* with that row to add.
- The project summary's phase dots follow `PROJECT.md`.

## Where it is

The office uses the folder picked in **Settings → Connections → Folders**, else `AGENT_OFFICE_TOOLKIT_DIR`, else the first of these in your home folder that exists: `mendix-toolkit` (where first-run setup clones it), `agent-spike\mendix-toolkit`, `agent-spike\mxcli-project-toolkit`. Projects run from pins of it in the `-pins` folder next to it.

**Where the clone comes from.** First-run setup offers to clone the toolkit for you. Its Git URL field starts on the **public upstream repository**; you can type a fork's URL instead. Git makes the URL you cloned the clone's `origin`.

**Remotes.** The office never adds, changes or pushes to the clone's remotes. It reads two, if they're there:

- `origin`: fetched for the Toolkit line and for new projects' pins (a new project starts on `origin`'s default branch, or on the clone's HEAD when that has commits `origin` hasn't). With no `origin`, nothing is fetched: new projects start on the clone's HEAD, and the Toolkit line counts newer commits up to that HEAD.
- `upstream`: only compared, so the Toolkit window can say how far `origin` is behind (and ahead of) it. See [Syncing a fork with upstream](../administration/toolkit-versions.md#syncing-a-fork-with-upstream).

A clone made by first-run setup has only `origin`; a fork you set up by hand may have both.

> [!NOTE]
> Some toolkit versions had a Windows problem where commits hung in the toolkit's pre-commit hook (a path loop). If commits hang, check that your toolkit commit has the fix. See [Agents and GitHub problems](../troubleshooting/agents-and-github.md#commits-hang-in-a-toolkit-project).

## See also

- [Toolkit versions](../administration/toolkit-versions.md): pins, Update toolkit, and syncing a fork.
- [Reusable skills and knowledge](../architecture/reusable-skills-and-knowledge.md): how toolkit skills, company brains and lessons relate.
- [Components](../architecture/components.md).
