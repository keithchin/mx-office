---
title: Workers and worktrees
description: What a worker is, its statuses, why each works in its own git worktree, and what happens when it goes home.
weight: 2
---

## A worker is a Claude Code session

A **worker** (or *agent*) is a Claude Code session running at a desk on a floor. The office starts it, shows its live terminal, records its cost and tokens, and notices when it needs you. Every worker has:

- a **name** and, for team members, a **role**;
- a **model**: Haiku 4.5, Sonnet 5.5, Opus 5.5 or Fable 5.1 (and a reasoning effort);
- a **status** and a **cost**.

Team members (the Project Coordinator and the Leads) are workers too. Their **subagents** are not: they run inside the Lead's session. See [The team model](../teams-and-agents/team-model.md).

## Statuses

| Status | Meaning |
|---|---|
| Starting | The session is coming up. |
| Working | Busy on its task. |
| 🙋 Needs input | Asking a question or for a permission. Answer it in its terminal. |
| ✅ Done | Finished its turn. If nobody has opened it since, it shows as *finished, not looked at yet*. |
| Idle | Waiting for its next task. |
| 💤 Asleep | The session stopped (for example after a restart). Open it to wake it with its memory. |
| 🪑 Benched | A team member whose session was cleared after a handoff note. Hire it again to bring it back. |

## Worktrees: one copy of the repo per worker

Most workers get their own **git worktree**: a separate checkout of the repository on its own branch, under `<floor>/.agent-office/worktrees/`. Agents don't trip over each other's files, and each one's work becomes a branch and a pull request.

The **🌳 Git** tab draws every branch as a railway line, with the worker standing at its tip. See [Git tab](../using-the-office/git.md).

## Going home

Sending a worker **home** frees its desk. By default the office deletes its worktree and branch, unless they hold work that isn't on GitHub yet. Then it keeps them and says so. Agents can send each other home with `office-workers home`. See [office-workers CLI](../reference/office-workers-cli.md).

## Restarts

On Windows, workers are child processes of the office server. **Restarting the office stops every running worker.** Their sessions are saved, and when the office comes back they are resumed from their saved session. See [Running the office](../administration/running-the-office.md#restarting).
