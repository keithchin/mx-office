---
title: Settings reference
description: Every field of a floor's team settings (RosterSettings) - type, default, limits and meaning - as stored in roster/<floor>.json, and the office's Teams notifications and keep-awake settings.
weight: 4
---

A floor's team settings are a `RosterSettings` object (`src/shared/roster/types.ts`), kept in `<office data>/roster/<floor>.json` and edited on the [Settings](../using-the-office/settings.md) tab. A bad value keeps the previous one.

| Field | Type | Default | Limits and meaning |
|---|---|---|---|
| `autonomy` | `1 \| 2 \| 3 \| 4` | `2` (Guided) | 1 Directive, 2 Guided, 3 Delegated, 4 Autonomous. See [Autonomy levels](../teams-and-agents/autonomy.md). |
| `idleMinutes` | number | `0` | Minutes a Lead may sit idle before it's benched; **0 = never automatically**. 0 to 1440. |
| `schedule` | `StandupSchedule` | see below | The daily standup. |
| `costCaps` | `{ 1?: number, 2?: number, 3?: number, 4?: number }` | `{}` | A daily dollar cap per autonomy level; the one for the current level applies; missing = off. Each above 0, in cents, at most 100000. |
| `dryRunIssues` | boolean | `false` | Approved proposals are recorded but no GitHub issue is made. `AGENT_OFFICE_TEAMS_DRY_RUN=1` forces it on. |
| `reviewNudge` | boolean | `true` | Prompt a Lead once to review a subagent's result. See [The review loop](../teams-and-agents/review-loop.md). |
| `backToWork` | boolean | `true` | Nudge a member that stopped with its task open to carry on or escalate (twice per task an hour at most; never at level 1). See [Interruptions and back to work](../teams-and-agents/interruptions.md#back-to-work). |
| `jeff` | `JeffSettings` | `{ waiting: 'shadow', triage: 'shadow', priority: 'on', waitingPolicy: 'agree' }` | Per judgement: `'off'`, `'shadow'` or `'on'` (`priority`: `'off'` or `'on'`). See [Jeff · Router](../automation/jeff-router.md). |
| `subagentCooldownHours` | number | `24` | Hours a benched subagent sits out before it's reinstated; 0 = only by hand. 0 to 720, in tenths. |
| `autonomyByStage` | `AutonomyByStage` | `{ enabled: false, early: 2, build: 3 }` | Autonomy by pipeline stage. On, on a toolkit project, the office sets `autonomy` itself: `early` until the build plan's gate (Stage 4) passes, `build` from then on. See [Autonomy by pipeline stage](../teams-and-agents/autonomy.md#autonomy-by-pipeline-stage). |
| `earlyDrafts` | boolean | `true` | While the Chief Analyst is on Stages 0–2, Design, Development and Testing make small drafts marked as such (`-draft` in the name, a `DRAFT — before Stage 3 gate` banner): low-fi wireframes, a draft domain model and architecture sketch, a test-plan outline. Off: they wait for their stage. Written into the Playbooks. See [Deliverables](../using-the-office/deliverables.md). |
| `maxSubagents` | number | none | At most this many subagents at once per Lead (1 to 10), written into the Leads' Playbooks as guidance. Set by the [budget level](../using-the-office/budget.md#budget-levels): Lean 1, Balanced 2, Fast 4. None: no limit given. |

## AutonomyByStage

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `false` | The stage picks the level (toolkit projects only; anywhere else the level stays as picked). |
| `early` | `1 \| 2 \| 3 \| 4` | `2` (Guided) | The level before the Stage 4 gate passes: analysis, requirements, design. |
| `build` | `1 \| 2 \| 3 \| 4` | `3` (Delegated) | The level once it has. |

## StandupSchedule

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Run the daily standup |
| `time` | `"HH:MM"` | `"09:00"` | Local time, 24 h |
| `timeZone` | IANA zone | `"Asia/Singapore"` | Also the zone of the spend day and the weekly memo |
| `days` | number[] | `[1, 2, 3, 4, 5]` | 0 = Sunday … 6 = Saturday |

## JeffSettings

| Field | Values | Judgement |
|---|---|---|
| `waiting` | `off`, `shadow`, `on` | Is an agent that just ended its turn waiting on the Project Manager? |
| `triage` | `off`, `shadow`, `on` | Which team does a new issue belong to? |
| `priority` | `off`, `on` (default `on`) | How soon should the Project Manager resolve each open escalation? On: the escalation lists are in Jeff's order with a *#1 · resolve first* chip. It only orders lists, so it has no shadow mode. |
| `waitingPolicy` | `agree`, `model` (default `agree`) | With `waiting` on, what it takes for Jeff to raise an escalation: `agree`, his verdict *and* a real ask at the end of the agent's message; `model`, his verdict alone. See [When he escalates](../automation/jeff-router.md#when-he-escalates). |

## Office-wide settings outside the team settings

| Setting | Where | Default | Meaning |
|---|---|---|---|
| Connections: credentials | **☰ → 🔌 Connections** or ⚙️ Settings › 🔌 Connections (admins); `<office data>/credentials.json` (encrypted) | none | The agents' and admin GitHub tokens, the Mendix token, the Jev key; the office password's hash goes in `config.json`. See [Connections](../administration/connections.md). |
| Connections: toolkit folder | Connections › Folders (admins); `<office data>/office-settings.json` (`toolkitDir`) | `AGENT_OFFICE_TOOLKIT_DIR`, else `~/agent-spike/mxcli-project-toolkit` | The mxcli-project-toolkit clone the wizard and the Playbooks use; must have `bin/init-project.sh`. The projects folder next to it is ⚙️ Settings › Building's *Workspace folder*. |
| Connections: Mendix token per project | The Mendix card's ticks (admins); `office-settings.json` (`mendixFloors`) | off | That project's workers hired afterwards get `MENDIX_TOKEN` / `MX_PAT`. |
| Connections: commit identity | git & gh › commit identity (admins); `office-settings.json` (`gitIdentity`) | none | `GIT_AUTHOR_*` / `GIT_COMMITTER_*` for the workers, when git has no identity of its own. |
| Connections: worktree cleanup | Worktree cleanup › On / Off (admins); `office-settings.json` (`sweep`) | on | Hourly removal of merged worktrees no worker has, under each floor's `.agent-office/worktrees/`. |
| Audit: log prompt text | [Audit log](../using-the-office/audit-log.md) tab → **Log prompt text** (admins); `POST /api/audit/settings` | off | Keep the first 80 characters of every prompt a person sends a worker. Off: only its length is logged. |
| Incidents: detection rules | Audit log → **🚨 Incidents** → **⚙️ Detection rules** (admins); `<office data>/incidents/settings.json`; `POST /api/incidents/settings` | all on; see [the defaults](../using-the-office/incidents.md#automatic-detection) | Each rule on or off, with its count, minutes or dollars. Changing them is logged (`settings.change`). |
| Incidents: dedupe window | The same window, *Same incident if seen again within (hours)*; `settings.json` (`dedupeHours`) | 24 | A rule firing again on the same floor while its incident is still open, within this many hours, counts into that incident instead of opening a new one. |
| Test mode | `--test-mode` or `AGENT_OFFICE_TEST_MODE=1`; on by itself under `scratch/test-offices` or a folder named `test-office…` (not a plain `scratch`) | off | No real agent CLI starts, only a fake `--agent`. See [Test offices](../administration/test-offices.md#running-a-test-office-safely). |
| Command Center terminal | ⚙️ Settings › 🧍 You (the 1D view's tab, `/lite?tab=settings&section=you`), the 3D office's ⚙️ Settings › You, or the console's **Chat | Terminal** toggle; this browser's `localStorage` (`agent-office.pmc-view`) | `chat` | `chat` or `terminal`: how the [Project Coordinator console](../using-the-office/command-center.md#the-project-coordinator-console) shows its screen. Per browser, not per floor. |
| Team phone: Do not disturb | The [📱 Team phone](../using-the-office/team-phone.md#phone-settings)'s ⚙ → *Do not disturb*; this browser's `localStorage` (`agent-office.phone.alerts`) | off | Off, until turned off, 1 hour, or until 9:00 tomorrow: no desktop alerts or sound meanwhile (the badge still counts). Quiets the workers' and escalations' alerts too, on the 1D and 2D views. |
| Team phone: Digest | The phone's ⚙ → *Digest*; `agent-office.phone.alerts` | off | Bundle alerts that aren't urgent into one every 15, 30 or 60 minutes; urgent ones still come at once. |
| Team phone: Sound | The phone's ⚙ → *Sound*; `agent-office.phone.alerts` | on | A short sound with an alert for something that needs you. |
| Team phone: open, wide, last channel | The phone's button, **⤢**, the channel list; `agent-office.phone.open`, `.phone.wide`, `.phone.screen` | closed | Whether this browser had the phone open, widened, and on which channel. |
| Team phone: what you've read | Opening a channel or DM; the office's `<office data>/phone/reads.json` (per account, or per browser on the shared password), mirrored in `agent-office.phone.reads` | — | The unread counts and the grey dot. |
| Command Center: folded sections | A section heading in the summary, the setup panel's **Hide / Show**, the console's escalation bar (**Show ▾ / Back to the chat ▴**); `agent-office.cc-fold`, `agent-office.cc-setup`, `agent-office.pmc-escalations` | open (the setup panel folds once its gates are fine, or on a window under 820 px tall; the escalation cards stay behind their bar) | Which parts of the [Command Center](../using-the-office/command-center.md) this browser keeps folded. |
| ▶ Resume project pacing | Team settings › **▶ Resume project** (admins); `<office data>/project-run.json` (`pacing.<floor>`) | 2 at once, 45 s apart | `concurrent` (1 to 6): most agents starting at once; `gapSec` (5 to 600): seconds between wakes. A wake counts once its session is up. See [Resume and pause](../using-the-office/resume-and-pause.md#order-and-pacing). |
| 🔁 Restart safely | ⚙️ Settings › 🤖 Workers (admins); `POST /api/office/restart` | timeout 10 min | `build` (run `npm run build` first, offered when the office's checkout has new commits), `timeoutMin` (1 to 120). Needs `AGENT_OFFICE_LAUNCHER_LOOP=1` from a looping launcher to restart rather than only exit. See [Releasing and restarting safely](../administration/running-the-office.md#releasing-and-restarting-safely). |
| The Firm: each reviewer's model | `/firm` → the model picker on each reviewer's card (admins); `<office data>/firm/firm.json` | Fable 5.1 | The model a Reviewer Agent runs on unless the audit wizard picks another. See [The Firm](../using-the-office/the-firm.md). |

## The types, as in the code

```ts
export interface RosterSettings {
  autonomy: AutonomyLevel;
  idleMinutes: number;
  schedule: StandupSchedule;
  costCaps: Partial<Record<AutonomyLevel, number>>;
  dryRunIssues: boolean;
  reviewNudge: boolean;
  backToWork: boolean;
  jeff: JeffSettings;
  subagentCooldownHours: number;
  autonomyByStage: AutonomyByStage;
  earlyDrafts: boolean;
  maxSubagents?: number;
}

export interface AutonomyByStage {
  enabled: boolean;
  early: AutonomyLevel;
  build: AutonomyLevel;
}
```

## Office settings: Teams and keep-awake

Set in **⚙️ Settings** (the 1D view's tab: › 🔔 Notifications and › 🤖 Workers; the 3D office's ⚙️ window has them too; admins), for the whole office, each in its own file in the office's data folder. A bad value is refused with a reason and nothing changes.

### notify-teams.json ([Teams notifications](../integrations/teams-notifications.md))

| Field | Type | Default | Meaning |
|---|---|---|---|
| `url` | string | none | The Teams Workflows webhook URL. https only (plain http only to this machine, for a stub). A secret: never sent to a browser (Settings shows a hint) nor written to the audit log. Only while Connections isn't open: otherwise it's in `credentials.json` (the `teams-webhook` credential, encrypted), moved there from this file once. |
| `floors` | `'all' | string[]` | `'all'` | Which floors post (floor ids). |
| `level` | `'needs' | 'digest'` | `'needs'` | Red items only, or those and a daily digest per floor. |
| `quiet` | `{ start: 'HH:MM', end: 'HH:MM' }` | none | Hold cards back between these times on the office computer's clock (may span midnight); one catch-up card follows. |
| `pausedUntil` | ms | none | Hold cards back until then (the ⏸️ buttons: 1, 4 or 12 hours; at most a week). |
| `publicUrl` | string | none | The office's address from outside: each card's Open button goes to `<publicUrl>/lite?floor=<id>`. Empty: no button. |
| `by`, `at` | string, ms | | Who changed it last, and when. |

What was posted is in `notify-teams-state.json` (posted item ids, items held back, each floor's last digest), so a restart posts nothing twice.

### keep-awake.json ([keep-awake](../administration/running-the-office.md#keep-it-awake-and-the-lid))

| Field | Type | Default | Meaning |
|---|---|---|---|
| `on` | boolean | `true` | Keep the computer from sleeping while agents work. |
| `idleMinutes` | number | `10` | Minutes of everything idle before it may sleep again. Whole minutes, 1 to 240. |
| `by`, `at` | string, ms | | Who changed it last, and when. |

## Office settings: budget

The [Budget](../using-the-office/budget.md)'s office-wide settings live in `budget/office.json` in the office's data folder. Admins change them on the Budget tab.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `fx.currency` | string | `'SGD'` | The local currency shown beside dollars (ISO 4217, three letters). `'USD'` shows dollars only. |
| `fx.mode` | `'daily' | 'manual'` | `'daily'` | Fetch the ECB reference rate once a day (frankfurter, no key), or use the rate typed in. |
| `fx.manualRate` | number | none | Units of the currency per US dollar, used in manual mode. |
| `fxLast` | object | none | The last rate fetched: `currency`, `rate`, `asOf` (the rate's day), `fetchedDay`, `error` if the last fetch failed. A failed fetch keeps the last good rate. |
| `threshold` | number | `80` | The office default alert threshold, %, for projects that don't set their own. |
| `ledger` | object | | Background calls that served no floor (the office's own). |

Each project's `budget/<floor>.json` holds:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `settings.total` | number | none | The project's total budget, USD. None: spend is shown with no budget. |
| `settings.threshold` | number | the office's | Alert at this % of the budget (1 to 99). |
| `settings.autoPause` | boolean | `true` | Pause the project at 100 %. |
| `settings.level` | `'lean' | 'balanced' | 'fast' | 'manual'` | none | The budget level last applied. |
| `settings.updatedBy`, `updatedAt` | string, ms | | Who changed the settings last, and when. |
| `plan` | object | made on first look | The expected plan: `lines` (`id`, `stage`, `label`, `usd`, `days`, `basis`: default/history/firm/edited, `editedBy`), `start`, `end`, `basis`, `edited`. |
| `alerts` | array | `[]` | The alerts raised against the current budget (`threshold`, `full`, `forecast`), one each. Raising the budget clears them. |
| `pausedAt` | ms | none | When the budget paused the project (put back after a restart). |
| `ledger` | object | | Daily rollups kept forever, 30 days of detailed rows, the stage timeline, and what each worker had spent when it was last booked. |
