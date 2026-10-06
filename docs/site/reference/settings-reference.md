---
title: Settings reference
description: Every field of a floor's team settings (RosterSettings) - type, default, limits and meaning - as stored in roster/<floor>.json.
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
| `jeff` | `JeffSettings` | `{ waiting: 'shadow', triage: 'shadow', priority: 'on', waitingPolicy: 'agree' }` | Per judgement: `'off'`, `'shadow'` or `'on'` (`priority`: `'off'` or `'on'`). See [Jeff · Router](../automation/jeff-router.md). |
| `subagentCooldownHours` | number | `24` | Hours a benched subagent sits out before it's reinstated; 0 = only by hand. 0 to 720, in tenths. |
| `autonomyByStage` | `AutonomyByStage` | `{ enabled: false, early: 2, build: 3 }` | Autonomy by pipeline stage. On, on a toolkit project, the office sets `autonomy` itself: `early` until the build plan's gate (Stage 4) passes, `build` from then on. See [Autonomy by pipeline stage](../teams-and-agents/autonomy.md#autonomy-by-pipeline-stage). |

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
| Audit: log prompt text | [Audit log](../using-the-office/audit-log.md) tab → **Log prompt text** (admins); `POST /api/audit/settings` | off | Keep the first 80 characters of every prompt a person sends a worker. Off: only its length is logged. |
| Command Center terminal | 1D view's ⚙️ Settings tab → *Your view*, the 3D office's ⚙️ Settings › You, or the console's **Chat | Terminal** toggle; this browser's `localStorage` (`agent-office.pmc-view`) | `chat` | `chat` or `terminal`: how the [Project Coordinator console](../using-the-office/command-center.md#the-project-coordinator-console) shows its screen. Per browser, not per floor. |
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
  jeff: JeffSettings;
  subagentCooldownHours: number;
  autonomyByStage: AutonomyByStage;
}

export interface AutonomyByStage {
  enabled: boolean;
  early: AutonomyLevel;
  build: AutonomyLevel;
}
```
