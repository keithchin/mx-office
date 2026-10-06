---
title: The toolkit
description: The mxcli-project-toolkit - its stages from P (kickoff) to 7 (cutover), the ✋ gates that need a CONFIRMED decision, and how the office shows them.
weight: 3
---

The **mxcli-project-toolkit** (by Maurits, MendixMau; our private copy is in AI-Taskforce-Labs) is the process every project follows. It ships 120+ skills the roles read, scripts for setting up a project, and a gate check.

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

A **✋ gate** needs an explicit `CONFIRMED` decision in the project's `PROJECT.md` (`## Decisions`). The agents record it only when you (or the client) say so.

## In the office

- The **wizard** creates a new project's Mendix app at the repository's root (`mx create-project`), runs the toolkit's `init-project.sh`, installs its pre-commit hook, writes `intake.md`, records the Stage P decisions and runs `gate-check.sh`. See [Create your first project](../get-started/first-project.md).
- The Command Center's **🧰 Project setup** panel shows stages **P to 4** with their status (from `intake.md` and the gate check), the next step and open questions, and **🔄 Re-check gates**. It goes away once Stage 4 is confirmed. See [Command Center](../using-the-office/command-center.md#project-setup).
- Everything the office starts for a floor (its agents and shells, queue workers, **🔄 Re-check gates**, the wizard's toolkit runs, the live app) gets the keys in the floor's `.claude/toolkit.env` (`MXBUILD_PATH` and the rest) over the office's own environment. The toolkit's scripts let the environment win over `toolkit.env`, so without this an `MXBUILD_PATH` the office was started with would build every project with that one mxbuild. A floor without `toolkit.env` keeps the office's environment.
- A **✋ MANUAL** stage puts *Stage X waits for your sign-off* in Needs you.
- The project summary's phase dots follow `PROJECT.md`.

## Where it is

`C:\Users\<you>\agent-spike\mendix-toolkit` (`agent-spike\mxcli-project-toolkit` before the layout change; Settings → Connections → Folders or `AGENT_OFFICE_TOOLKIT_DIR` override it). Its `upstream` remote is MendixMau's repository, with push disabled.

> [!NOTE]
> Our copy fixes a Windows problem where commits hung in the toolkit's pre-commit hook (a path loop). Always set projects up from our copy. See [Agents and GitHub problems](../troubleshooting/agents-and-github.md).
