---
title: Data locations
description: Where the office keeps its data, each project's files, the projects and tools on the office laptop, and what to back up.
weight: 3
---

## The office's data folder

The office keeps its data in a `.agent-office` folder. On the office laptop the launcher runs the office on the mx-spike project, so it's `agent-spike\mx-spike\.agent-office\`. (By default it's `~/agent-office/.agent-office/`, or `AGENT_OFFICE_HOME`.)

| In it | What |
|---|---|
| `config.json` | The password hash and the session secret |
| `credentials.json` | [Connections](connections.md)' saved tokens and keys: encrypted with Windows DPAPI for the office's user (elsewhere base64 in a 0600 file), with each one's masked tail, who saved it and its last Test |
| `office-settings.json` | Connections' settings: the toolkit folder, the worktree cleanup on or off, the projects whose agents get the Mendix token, the workers' commit identity |
| `accounts.json` | People's accounts |
| `floors.json` | The list of projects |
| `notify-teams.json`, `notify-teams-state.json` | [Teams notifications](../integrations/teams-notifications.md): the settings (mode 0600; the webhook URL itself is in `credentials.json`, moved there from this file once), and what was posted and held |
| `push-subscriptions.json`, `push-state.json` | [Phone version](../using-the-office/phone-version.md#push-notifications): the phones signed up for push (per person and device, with their Do not disturb and digest; mode 0600), and which red items were pushed |
| `office-settings.json` → `phoneAccess`, `vapidPublicKey` | [Phone access](phone-access.md): on or off, the provider, the Dev Tunnel id, the Cloudflare tunnel and hostname; Web Push's public key (its private half is in `credentials.json`) |
| `keep-awake.json` | Keep awake while agents work: on or off, and the idle minutes |
| `project-run.json` | [⏸ Paused](../using-the-office/resume-and-pause.md) projects (who, when, why, who's waiting on you) and each project's resume pacing |
| `restart-pending.json` | Only between a [🔁 safe restart](running-the-office.md#releasing-and-restarting-safely) and the next start: the projects it paused, to resume |
| `roster/<project>.json` | The team: settings, members, standups, proposals, escalations, spend, subagents |
| `judge/<project>.jsonl` | Jeff · Router's verdicts |
| `chatter/<project>.jsonl`, `chatter/<project>.state.json` | [Team chatter](../using-the-office/command-center.md#team-chatter): the newest 1000 messages, and what the sources have already turned into messages |
| `audit/<project>.jsonl`, `audit/_office.jsonl`, `audit/archive/` | The [audit log](../using-the-office/audit-log.md): append-only, hash-chained; old lines archived by month |
| `answers/<project>.jsonl` | The answer history: every revision of every decision you answered (escalations, questions, stuck items, proposals, model change requests, tells), full text, hash-chained, each line fsync'd, never rewritten |
| `followthrough/<project>.json` | Recorded as given: what the office last found of each answered escalation's record (the outcome, the recorded text and where: path, commit, blob, working copy / branch / main), and the follow-throughs you dismissed. Worked out again on the next look |
| `tasks/<project>.jsonl` | Task ids: a line per task the office handed an agent (its `tsk_` id, where it came from, its first line, its issue) and per event on one (assigned or reassigned to a worker with that attempt's `exe_` id, completed, cancelled, superseded). Append only, hash-chained, never rewritten; the roster only points at it |
| `dispatch/<project>.json` | Each attempt to hand an answer on (typed, held for a turn, an issue): its exact text, worker, session and state, written before and after the attempt. `agent-office dispatch status` lists the unsettled ones (see [Rolling back](running-the-office.md#rolling-back-to-an-older-build)) |
| `acceptance/<project>.jsonl` | [Acceptance records](../using-the-office/progress-and-acceptance.md#acceptance): a hash-chained line per ✅ Accept or ↩ Reopen, never rewritten |
| `incidents/incidents.jsonl`, `incidents/settings.json` | [Incidents](../using-the-office/incidents.md): a hash-chained line per change, and the detection rules' settings |
| `firm/firm.json`, `firm/engagements/<id>/`, `firm/reports/<id>.json` and `.md` | [The Firm](../using-the-office/the-firm.md): reviewers' models, each audit with its reviewers' isolated folders, delivered reports |
| `analysis/runs.jsonl` | Analysed runs (the Analysis tab) |
| `perf/profiles/` | CPU profiles of the office's own server (`.cpuprofile`, the last 10): recorded by hand on the Test Mode page or by the office itself after a returning stall ([Performance budgets](performance-budgets.md#live-warnings-in-the-real-office)) |
| `ranking/` | Ranking history and highlights |
| `usage.json` | Spend and token usage |
| `chat.jsonl`, `scrollback/` | Chat and terminal history |
| `pty-host.json`, `pty-host.log` (each project's `.agent-office/`) | The workers' terminal host: its connection token and its log ([Performance budgets](performance-budgets.md)) |
| `flows/<workflow>/<run>.json`, `flows/_cache/` | [Workflow](../automation/workflows.md) runs, each checkpointed after every step (the new-project wizard's setups are `flows/new-project/`), and cached step results |
| `toolkit-pins.json` | Which [toolkit commit](toolkit-versions.md) each project is pinned to, and when the toolkit fork was last fetched (each project's committed `agent-office.project.json` has the same, with its history) |
| `wizard/` | New-project wizard jobs saved before the workflow engine (taken in on first use and renamed `.json.migrated`) |
| `wizard/operations/<setup>.json` | Each setup's operation records: creating and deleting its GitHub repository and its folder, written before and after each one (see [Durable records](#durable-records)). Renamed `.retired` when Cancel & undo removes the setup |
| `wizard-drafts/<id>/` | New project briefs in progress: `draft.json` (the brief, the chat, the approval, the planning spend) and `files/` (the attached documents). Removed when the project's setup finishes, when it's discarded, or after two weeks unused |
| `live/<project>/`, `live/<project>.log` | The live app's clone and log |
| `live-app.json` | Live app settings (optional) |
| `deleted/<project>-<date-time>/`, `deleted/jobs/<project>.json` | [Deleted or removed projects](../using-the-office/delete-project.md#whats-archived-and-where): the archive of each one's office data, and a deletion that stopped part way (to carry on) |
| `projects/ids.json` | Each project's stable `prj_` id, with the ones retired when a project was deleted |
| `pr-shots/` | Downloaded CI screenshots |
| `homes/<id>/signins.json` | People's own sign-ins |
| `hook-port`, `agent-office-mcp.json` | How workers reach the office |

## Durable records

Most of the office's files are written in the background: the newest version is saved a moment later, and a failed save is logged and tried again with the next change. That's fine for anything the office can work out again (checkpoints, caches, views).

The setup's operation records (`wizard/operations/`) are written differently, because they're the office's only memory of something it did outside (a repository created on GitHub, a folder deleted). Each write goes to a temporary file that's flushed to the disk, then renamed over the old one, and the office waits for it: if the write fails, the office doesn't send the command (or, when the command already ran, pauses the setup until it has looked again). The folder is flushed too where Windows allows it (usually it doesn't).

What that guarantees: **the records survive the office stopping at any moment** (a crash, being killed, a restart), and a reader always sees a whole record, the old one or the new one. What it doesn't claim: surviving a power cut or a Windows crash in the moment after a write. If that ever happens, the office still never deletes on a guess; it finds an outcome it can't confirm and asks you to check it.

## Each project's folder {#each-floors-folder}

In `<project checkout>\.agent-office\`:

| File | What |
|---|---|
| `workers.json` | The project's workers and their saved sessions (restored on start) |
| `queue.json` | The task queue |
| `worktrees/` | Each worker's git worktree. Agents can't make one anywhere else, and merged ones no worker has are cleaned up hourly (see [Connections](connections.md#worktree-cleanup)) |

And in the project itself: Playbooks, journals, standups and insight memos. See [Playbooks and journals](../teams-and-agents/playbooks-and-journals.md).

## On the office laptop

| What | Where |
|---|---|
| The office | `agent-spike\agent-office-src` (github.com/keithchin/mx-office, public) |
| Launcher and shortcut | `agent-spike\start-office.ps1`, `agent-spike\open-agent-office.ps1`, icon `agent-office.ico` |
| Projects | `agent-spike\mx-spike` (AI-Taskforce-Labs/mx-spike) · `agent-office\AI-Taskforce-Labs\travel-approval` |
| Toolkit | `agent-spike\mendix-toolkit` (was `agent-spike\mxcli-project-toolkit`; Settings → Connections → Folders overrides it) |
| mxcli | `agent-spike\tools\mxcli\mxcli.exe` (was `agent-spike\bin\mxcli.exe`) |
| Scripts | `agent-spike\queue-runs.mjs`, `add-floor.mjs`, `token-check.mjs` |

## Backups

Projects themselves are on GitHub. To keep the office's own history, back up, with the office stopped:

- the office's data folder (`mx-spike\.agent-office\`), especially `roster/`, `judge/`, `analysis/`, `ranking/` and `usage.json`;
- each project's `.agent-office\workers.json` and `queue.json`.

> [!WARNING]
> Don't restore a copy of the data into another office that points at the same project folders: it would resume the real agents. See [Test offices](test-offices.md).
