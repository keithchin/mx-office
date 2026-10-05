---
title: Settings
description: A floor's team settings - autonomy level, idle benching, review loop, subagent cool-down, standup schedule, cost caps, dry run and Jeff.
weight: 13
---

The **⚙️ Settings** tab holds the floor's team settings. Only admins can change them. Click **💾 Save settings** when done.

![Settings](../images/settings.png)

| Section | Setting | Default |
|---|---|---|
| **Autonomy** | 1 Directive · 2 Guided · 3 Delegated · 4 Autonomous | **2 Guided** |
| **Benching** | Bench a Lead after N idle minutes (0 = only by hand) | **0** (off) |
| **Review loop** | Nudge a Lead to review its subagent's result | **On** |
| **Subagents** | Reinstate a benched subagent after N hours (0 = only by hand) | **24** |
| **Daily standup** | Scheduled · time · time zone · days | **On, 09:00, Asia/Singapore, Mon–Fri** |
| **Daily cost cap** | A dollar cap for each autonomy level | **Blank** (no cap) |
| **Issues** | Dry run: record approvals without making GitHub issues | **Off** |
| **Jeff · Router** | *Waiting on you* and *Triage*: Off · Shadow · On | **Shadow, Shadow** |

## What each one does

- **Autonomy** sets how often agents need you. Changing it rewrites every hired member's Playbook and tells the ones at work. See [Autonomy levels](../teams-and-agents/autonomy.md).
- **Benching** is **off by default**: Leads are benched only when you click 🪑 Bench. Set a number of minutes to bench idle Leads automatically. See [Benching and handoffs](../teams-and-agents/benching-and-handoffs.md).
- **Review loop**: when a Lead's turn ends right after one of its subagents came back, the office prompts it once to review the result. See [The review loop](../teams-and-agents/review-loop.md).
- **Subagents**: how long a benched subagent sits out. See [Subagents](../automation/subagents.md).
- **Daily standup**: see [Standup](standup.md).
- **Daily cost cap**: one cap per autonomy level, for this floor. Only the cap for the current level counts. When it's spent, hiring stops on this floor until midnight (in the standup's time zone). See [Models and costs](../teams-and-agents/models-and-costs.md).
- **Dry run**: approved proposals are recorded, but no GitHub issue is made. Good for trying the office out. `AGENT_OFFICE_TEAMS_DRY_RUN=1` turns it on for the whole office.
- **Jeff · Router**: see [Jeff · Router](../automation/jeff-router.md).

All fields with their exact names and limits: [Settings reference](../reference/settings-reference.md).
