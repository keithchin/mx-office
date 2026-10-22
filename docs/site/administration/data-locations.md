---
title: Data locations
description: Where the office keeps its data, each project's files and the tools it uses, how each store is written (and what that does and doesn't guarantee), and what to back up.
weight: 3
---

## The office's data folder

The office keeps its data in a `.agent-office` folder (mode 0700) under the office's home: `AGENT_OFFICE_HOME` when it's set, otherwise `~/agent-office`, so `~/agent-office/.agent-office/` by default. `scripts\start-office.ps1` sets the home to `%USERPROFILE%\mx-office` (or `-OfficeHome`). A folder that already has `.agent-office/config.json` in it becomes the office when the office is started there. This page calls the data folder `<data>`.

| In it | What |
|---|---|
| `config.json` | The password hash and the session secret |
| `credentials.json` | [Connections](connections.md)' saved tokens and keys: encrypted with Windows DPAPI for the office's user (elsewhere base64 in a 0600 file), with each one's masked tail, who saved it and its last Test |
| `office-settings.json` | Connections' settings: the toolkit folder, the worktree cleanup on or off, the projects whose agents get the Mendix token, the workers' commit identity |
| `accounts.json` | People's accounts |
| `tell-limit.json` | The rate limit on agents' `office-workers tell` messages: the recent sends in the current window, so a restart doesn't reset it (entries older than the window are dropped on read) |
| `governance/autonomy-policy.json` | The office's autonomy policy for new projects (none, limit the levels, or fix one), set under ⚙️ Settings › 👥 Team |
| `autonomy/<project>.json` | How each project's autonomy level was set (chosen in the New project flow, set by the policy, or the default for an older caller; who and when) and the latest change since |
| `floors.json`, `cloning.json` | The list of projects, and the ones being cloned |
| `notify-teams.json`, `notify-teams-state.json` | [Teams notifications](../integrations/teams-notifications.md): the settings (mode 0600; the webhook URL itself is in `credentials.json`, moved there from this file once), and what was posted and held |
| `push-subscriptions.json`, `push-state.json` | [Phone version](../using-the-office/phone-version.md#push-notifications): the phones signed up for push (per person and device, with their Do not disturb and digest; mode 0600), and which red items were pushed |
| `office-settings.json` → `phoneAccess`, `vapidPublicKey` | [Phone access](phone-access.md): on or off, the provider, the Dev Tunnel id, the Cloudflare tunnel and hostname; Web Push's public key (its private half is in `credentials.json`) |
| `keep-awake.json` | Keep awake while agents work: on or off, and the idle minutes |
| `project-run.json` | [⏸ Paused](../using-the-office/resume-and-pause.md) projects (who, when, why, who's waiting on you) and each project's resume pacing |
| `restart-pending.json` | Only between a [🔁 safe restart](running-the-office.md#releasing-and-restarting-safely) and the next start: the projects it paused, to resume |
| `roster/<project>.json` | The team: settings, members, standups, proposals, escalations, held prompts, the outbox, spend, subagents |
| `judge/<project>.jsonl` | Jeff · Router's verdicts |
| `chatter/<project>.jsonl`, `chatter/<project>.state.json` | [Team chatter](../using-the-office/command-center.md#team-chatter): the newest 1000 messages, and what the sources have already turned into messages |
| `audit/<project>.jsonl`, `audit/_office.jsonl`, `audit/archive/` | The [audit log](../using-the-office/audit-log.md): append-only, hash-chained; old lines archived by month |
| `answers/<project>.jsonl` | The answer history: every revision of every decision you answered (escalations, questions, stuck items, proposals, model change requests, tells), full text, hash-chained, each line fsync'd, never rewritten |
| `decisions/<project>.json` | The decision cards' **Separate** choices (the cards themselves are built afresh from their sources) |
| `asks/<project>.json` | The project's surfaced asks: what the agents left waiting on the Project Manager in their files and branches, as Needs you shows it |
| `questions/<project>.json` | [Questions](../using-the-office/questions.md): the batches of questions for the Project Manager and what became of them |
| `stuck/<project>.json` | [Stuck detection](../using-the-office/stuck-detection.md): what was raised, snoozed or dismissed |
| `followthrough/<project>.json` | Recorded as given: what the office last found of each answered escalation's record (the outcome, the recorded text and where: path, commit, blob, working copy / branch / main), and the follow-throughs you dismissed. Worked out again on the next look |
| `change-answer/` | Change answer: each replaced revision's follow-through finding as it was when the answer changed, and changed answers waiting to be handed on |
| `tasks/<project>.jsonl` | Task ids: a line per task the office handed an agent (its `tsk_` id, where it came from, its first line, its issue) and per event on one (assigned or reassigned to a worker with that attempt's `exe_` id, completed, cancelled, superseded). Append only, hash-chained, never rewritten; the roster only points at it |
| `dispatch/<project>.json` | Each attempt to hand an answer on (typed, held for a turn, an issue): its exact text, worker, session and state, written before and after the attempt. `agent-office dispatch status` lists the unsettled ones (see [Rolling back](running-the-office.md#rolling-back-to-an-older-build)) |
| `review-gate/<project>.json` | The [review gate](../using-the-office/review-gate.md)'s note of where the default branch was last seen, to spot direct and force pushes |
| `budget/<project>.json` | [Budget](../using-the-office/budget.md): the project's spend ledger and settings |
| `acceptance/<project>.jsonl` | [Acceptance records](../using-the-office/progress-and-acceptance.md#acceptance): a hash-chained line per ✅ Accept or ↩ Reopen, never rewritten |
| `testing/<project>.jsonl` | [Testing](../using-the-office/testing.md): the test-run records, append-only and hash-chained (the office doesn't verify this chain) |
| `testing/<project>.verify.json` | The project's verification policy and waivers |
| `testing/quality/<project>.jsonl`, `testing/evidence/<project>/` | The Quality card's records, and the raw report, lint and JUnit files |
| `testing/work/<project>/` | The office's own throwaway copies of a commit: `quality`, `tests`, and the walkthroughs' recording workspace `instance-rec` with its log |
| `walkthroughs/<project>/settings.json`, `walkthroughs/<project>/<recording>/` | [Walkthroughs](../using-the-office/walkthroughs.md): the project's settings (record automatically, narrate, demo user), and each recording's `manifest.json`, video, captions and step screenshots |
| `incidents/incidents.jsonl`, `incidents/settings.json` | [Incidents](../using-the-office/incidents.md): a hash-chained line per change (a small *recur* line when a rule fires into an open incident again), and the detection rules' settings |
| `security/<project>.json` | The [security baseline](../using-the-office/security-baseline.md): the project's security policy when it isn't the default (who, when, why), the app's security as read per commit and the `mx check` results per commit. Its copy of the app for mx check is `testing/work/<project>/instance-mxcheck` |
| `signoff/<project>.json` | ✋ Stage sign-offs given in the office and sent to the team lead, kept until PROJECT.md's Decisions has the CONFIRMED row ([Command Center](../using-the-office/command-center.md#needs-you)) |
| `profiles.json`, `profile-notes.json` | [Agent profiles](../using-the-office/agents.md): profiles, which seat each is on and the moves; admins' notes |
| `portfolios.json` | [Clients](../using-the-office/clients.md) and their projects |
| `context-manifests/<project>.jsonl`, `context-manifests/<project>.design.jsonl`, `context-manifests/dismissed.json` | What each agent session was offered (the client's brain, the design line), and the brain-change cards you dismissed |
| `design-systems/` | [Design systems](../using-the-office/design-systems.md): each published version as a folder of its own with a digest (never changed after publishing), and `projects.json`, which version each project uses |
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
| `wizard/operations/<setup>.json` | Each setup's operation records: creating and deleting its GitHub repository and its folder, written before and after each one (see [How each store is written](#how-each-store-is-written)). Renamed `.retired` when Cancel & undo removes the setup |
| `wizard-drafts/<id>/` | New project briefs in progress: `draft.json` (the brief, the chat, the approval, the planning spend) and `files/` (the attached documents). Removed when the project's setup finishes, when it's discarded, or after two weeks unused |
| `live/<project>/`, `live/<project>.log`, `live/<project>.ready.json` | The [live app](../using-the-office/live-app.md)'s clone, its log, and which milestones it already told you were ready (so a restart doesn't tell you twice). The commit the app runs isn't saved anywhere |
| `live-app.json` | Live app settings (optional) |
| `deleted/<project>-<date-time>/`, `deleted/jobs/<project>.json` | [Deleted or removed projects](../using-the-office/delete-project.md#whats-archived-and-where): the archive of each one's office data, and a deletion that stopped part way (to carry on) |
| `projects/ids.json` | Each project's stable `prj_` id, with the ones retired when a project was deleted |
| `pr-shots/` | Downloaded CI screenshots |
| `homes/<id>/signins.json` | People's own sign-ins |
| `hook-port`, `agent-office-mcp.json` | How workers reach the office |

## How each store is written

Not every file is written the same way, and the difference matters after a crash. "Crash" here means the office's process stopping at any moment (killed, crashed, restarted). None of these ways claims to survive a power cut or a Windows crash in the moment after a write.

| Way | How | What it guarantees | Used for |
|---|---|---|---|
| **Critical write** | A temporary file, flushed to the disk (fsync), renamed over the old one; the folder flushed where Windows allows it (usually it doesn't). The office waits for it, and a failed write stops what depended on it | A reader sees the old file or the new one, never half; the office never acts as if it wrote what it didn't | `wizard/operations/`, `dispatch/`, `profiles.json`, `profile-notes.json`, `portfolios.json`, `design-systems/`, `context-manifests/dismissed.json`, `change-answer/<project>.pending.json`, the roster at answer, escalation and hand-off points |
| **Durable write** | A temporary file, fsync, rename (some keep a `.bak` copy too) | The same: old or new, never half | `floors.json`, `credentials.json`, `office-settings.json`, `decisions/`, `asks/`, `questions/`, `stuck/`, `followthrough/`, `change-answer/`, `budget/`, `signoff/`, `security/`, `toolkit-pins.json`, `testing/<project>.verify.json`, each project's `workers.json` on shutdown |
| **fsync'd append** | One line appended and flushed, awaited | Each line that was acknowledged is on the disk | `answers/`, the creation of a task in `tasks/` (later task events are appended without waiting) |
| **Background write** | Off the main thread a moment after a change, with fsync before the rename; a failed save is logged and tried with the next change | Old or new, never half, but the newest change can be lost | `roster/` (between the critical points), `flows/`, each project's `workers.json` while running |
| **Atomic rename, no fsync** | A temporary file renamed over the old one, without flushing it to the disk first | A reader never sees half a file; after a crash the newest content may be missing | `restart-pending.json`, `project-run.json`, `keep-awake.json`, `live/<project>.ready.json`, `review-gate/`, each project's `queue.json` |
| **Plain append or write** | Appended or written in place, no temporary file, no flush | None: a crash mid-write can leave a partial line or a broken file | `audit/`, `incidents/`, `acceptance/`, `testing/<project>.jsonl`, `context-manifests/<project>.jsonl`, `walkthroughs/` |

When a store can't be read, only a missing file counts as empty. A file that's locked blocks writes to it and opens an incident; a corrupt one is moved aside as `.corrupt-<time>` and the store recovers from its `.bak` or `.tmp` copy where there is one.

The setup's operation records (`wizard/operations/`) are the office's only memory of something it did outside (a repository created on GitHub, a folder deleted), so they use the critical write: if the write fails, the office doesn't send the command (or, when the command already ran, pauses the setup until it has looked again). If a power cut ever loses one, the office still never deletes on a guess; it finds an outcome it can't confirm and asks you to check it.

The hash chains (audit log, answers, tasks, incidents, acceptance, testing) show tampering only when something checks them: the audit log, incidents and acceptance are checked when you view them; the testing records' chain isn't checked by the office.

See also [State and sources of truth](../architecture/state-and-truth.md) (which store is the source of truth for what) and [Components](../architecture/components.md).

## Each project's folder {#each-floors-folder}

In `<project checkout>\.agent-office\`:

| File | What |
|---|---|
| `workers.json` | The project's workers and their saved sessions (restored on start). It also holds each worker's hook token, in plain text |
| `queue.json` | The task queue |
| `worktrees/` | Each worker's git worktree. Agents can't make one anywhere else, and merged ones no worker has are cleaned up hourly (see [Connections](connections.md#worktree-cleanup)) |

And in the project itself: Playbooks, journals, standups and insight memos. See [Playbooks and journals](../teams-and-agents/playbooks-and-journals.md).

## On the office's machine

A typical layout, with neutral names:

| What | Where |
|---|---|
| The office | Its own checkout, for example `%USERPROFILE%\mx-office-app` (where `scripts\get-mx-office.ps1` puts it) |
| The office's home | `%USERPROFILE%\mx-office` with the launcher, or `AGENT_OFFICE_HOME` |
| Projects | Under the projects folder set in Connections, one folder per repository, for example `<projects folder>\Acme-Org\acme-orders` |
| Toolkit | The folder set in Settings → Connections → Folders |
| mxcli | Wherever First-run setup installed it, or the one on `PATH` |

### On macOS

The same layout with macOS paths (preview):

| What | Where |
|---|---|
| The office | `~/mx-office-app` (where `scripts/get-mx-office.sh` puts it; `MX_OFFICE_DIR` for another) |
| The office's home | `~/mx-office` with `scripts/start-office.sh`, or `AGENT_OFFICE_HOME`; its data in `~/mx-office/.agent-office` |
| Saved credentials | Your login Keychain (service `com.mxoffice.connections`); `credentials.json` in the data folder only names each item |
| Studio Pro | `/Applications/Mendix Studio Pro <version>.app`, one per version (`AGENT_OFFICE_MENDIX_DIR` for another folder of them) |
| Homebrew's programs | `/opt/homebrew/bin` (Apple silicon) or `/usr/local/bin`: the office adds them to its PATH when it was started from Finder or the desktop app |
| The launcher icon | `~/Applications/Mx Office.command` (`scripts/install-shortcut.sh`) |
| The desktop app's own files | `~/Library/Application Support/Mx Office` |

A backup of the data folder doesn't include the Keychain items: after restoring onto another Mac, save the tokens again in Connections (as after moving between Windows users with DPAPI).

## Backups

A project with a GitHub repository has its work there; a [local-only project](../get-started/first-project.md#local-only-not-on-github) has its only copy on this machine, so back up its folder too. To keep the office's own history, back up, with the office stopped:

- the office's data folder (`<home>\.agent-office\`), especially `roster/`, `answers/`, `tasks/`, `audit/`, `acceptance/`, `judge/`, `analysis/`, `ranking/` and `usage.json`;
- each project's `.agent-office\workers.json` and `queue.json`.

> [!WARNING]
> Don't restore a copy of the data into another office that points at the same project folders: it would resume the real agents. See [Test offices](test-offices.md).
