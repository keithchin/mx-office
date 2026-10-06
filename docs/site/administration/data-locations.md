---
title: Data locations
description: Where the office keeps its data, each floor's files, the projects and tools on the Taskforce laptop, and what to back up.
weight: 3
---

## The office's data folder

The office keeps its data in a `.agent-office` folder. On the Taskforce laptop the launcher runs the office on the mx-spike floor, so it's `agent-spike\mx-spike\.agent-office\`. (By default it's `~/agent-office/.agent-office/`, or `AGENT_OFFICE_HOME`.)

| In it | What |
|---|---|
| `config.json` | The password hash and the session secret |
| `credentials.json` | [Connections](connections.md)' saved tokens and keys: encrypted with Windows DPAPI for the office's user (elsewhere base64 in a 0600 file), with each one's masked tail, who saved it and its last Test |
| `office-settings.json` | Connections' settings: the toolkit folder, the worktree cleanup on or off, the projects whose agents get the Mendix token, the workers' commit identity |
| `accounts.json` | People's accounts |
| `floors.json` | The list of floors |
| `roster/<floor>.json` | The team: settings, members, standups, proposals, escalations, spend, subagents |
| `judge/<floor>.jsonl` | Jeff · Router's verdicts |
| `chatter/<floor>.jsonl`, `chatter/<floor>.state.json` | [Team chatter](../using-the-office/command-center.md#team-chatter): the newest 1000 messages, and what the sources have already turned into messages |
| `audit/<floor>.jsonl`, `audit/_office.jsonl`, `audit/archive/` | The [audit log](../using-the-office/audit-log.md): append-only, hash-chained; old lines archived by month |
| `firm/firm.json`, `firm/engagements/<id>/`, `firm/reports/<id>.json` and `.md` | [The Firm](../using-the-office/the-firm.md): reviewers' models, each audit with its reviewers' isolated folders, delivered reports |
| `analysis/runs.jsonl` | Analysed runs (the Analysis tab) |
| `ranking/` | Ranking history and highlights |
| `usage.json` | Spend and token usage |
| `chat.jsonl`, `scrollback/` | Chat and terminal history |
| `flows/<workflow>/<run>.json`, `flows/_cache/` | [Workflow](../automation/workflows.md) runs, each checkpointed after every step (the new-project wizard's setups are `flows/new-project/`), and cached step results |
| `wizard/` | New-project wizard jobs saved before the workflow engine (taken in on first use and renamed `.json.migrated`) |
| `live/<floor>/`, `live/<floor>.log` | The live app's clone and log |
| `live-app.json` | Live app settings (optional) |
| `pr-shots/` | Downloaded CI screenshots |
| `homes/<id>/signins.json` | People's own sign-ins |
| `hook-port`, `agent-office-mcp.json` | How workers reach the office |

## Each floor's folder

In `<floor checkout>\.agent-office\`:

| File | What |
|---|---|
| `workers.json` | The floor's workers and their saved sessions (restored on start) |
| `queue.json` | The task queue |
| `worktrees/` | Each worker's git worktree. Agents can't make one anywhere else, and merged ones no worker has are cleaned up hourly (see [Connections](connections.md#worktree-cleanup)) |

And in the project itself: Playbooks, journals, standups and insight memos. See [Playbooks and journals](../teams-and-agents/playbooks-and-journals.md).

## On the Taskforce laptop

| What | Where |
|---|---|
| The office (our fork) | `agent-spike\agent-office-src` (github.com/keithchin/agent-office, private) |
| Launcher and shortcut | `agent-spike\start-office.ps1`, `agent-spike\open-agent-office.ps1`, icon `agent-office.ico` |
| Floors | `agent-spike\mx-spike` (AI-Taskforce-Labs/mx-spike) · `agent-office\AI-Taskforce-Labs\travel-approval` |
| Toolkit | `agent-spike\mxcli-project-toolkit` |
| mxcli | `agent-spike\bin\mxcli.exe` |
| Scripts | `agent-spike\queue-runs.mjs`, `add-floor.mjs`, `token-check.mjs` |

## Backups

Projects themselves are on GitHub. To keep the office's own history, back up, with the office stopped:

- the office's data folder (`mx-spike\.agent-office\`), especially `roster/`, `judge/`, `analysis/`, `ranking/` and `usage.json`;
- each floor's `.agent-office\workers.json` and `queue.json`.

> [!WARNING]
> Don't restore a copy of the data into another office that points at the same floor folders: it would resume the real agents. See [Test offices](test-offices.md).
