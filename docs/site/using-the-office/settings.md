---
title: Settings
description: A floor's team settings - autonomy level, idle benching, review loop, subagent cool-down, standup schedule, cost caps, dry run and Jeff (including his priority sort).
weight: 13
---

The **⚙️ Settings** tab holds the floor's team settings. Only admins can change them. Click **💾 Save settings** when done.

![Settings](../images/settings.png)

| Section | Setting | Default |
|---|---|---|
| **Autonomy** | 1 Directive · 2 Guided · 3 Delegated · 4 Autonomous | **2 Guided** |
| **Autonomy** | By pipeline stage: one level until the build plan (Stage 4) passes, another after | **Off** (2 Guided, then 3 Delegated, when on) |
| **Benching** | Bench a Lead after N idle minutes (0 = only by hand) | **0** (off) |
| **Review loop** | Nudge a Lead to review its subagent's result | **On** |
| **Subagents** | Reinstate a benched subagent after N hours (0 = only by hand) | **24** |
| **Daily standup** | Scheduled · time · time zone · days | **On, 09:00, Asia/Singapore, Mon–Fri** |
| **Daily cost cap** | A dollar cap for each autonomy level | **Blank** (no cap) |
| **Issues** | Dry run: record approvals without making GitHub issues | **Off** |
| **Jeff · Router** | *Waiting on you* and *Triage*: Off · Shadow · On; *Priority*: Off · On; *When to escalate*: Only a real ask · His say-so | **Shadow, Shadow, On, Only a real ask** |

## What each one does

- **Autonomy** sets how often agents need you. Changing it rewrites every hired member's Playbook and tells the ones at work. See [Autonomy levels](../teams-and-agents/autonomy.md).
- **By pipeline stage** (toolkit projects only) lets the office pick the level: the first one until the Stage 4 gate passes, the second from then on, changed as if you had picked it. While it's on, the level buttons only show the level. See [Autonomy by pipeline stage](../teams-and-agents/autonomy.md#autonomy-by-pipeline-stage).
- **Benching** is **off by default**: Leads are benched only when you click 🪑 Bench. Set a number of minutes to bench idle Leads automatically. See [Benching and handoffs](../teams-and-agents/benching-and-handoffs.md).
- **Review loop**: when a Lead's turn ends right after one of its subagents came back, the office prompts it once to review the result. See [The review loop](../teams-and-agents/review-loop.md).
- **Subagents**: how long a benched subagent sits out. See [Subagents](../automation/subagents.md).
- **Daily standup**: see [Standup](standup.md).
- **Daily cost cap**: one cap per autonomy level, for this floor. Only the cap for the current level counts. When it's spent, hiring stops on this floor until midnight (in the standup's time zone). See [Models and costs](../teams-and-agents/models-and-costs.md).
- **Dry run**: approved proposals are recorded, but no GitHub issue is made. Good for trying the office out. `AGENT_OFFICE_TEAMS_DRY_RUN=1` turns it on for the whole office.
- **Jeff · Router**: *Waiting on you* (when an agent ends its turn: is it waiting on you? On: he escalates it if it didn't), *Triage* (which team is a new issue for? On: he labels unlabelled issues he's sure about), and *Priority* (how soon should you resolve each escalation? On: your escalations are listed in his order, #1 first). *When to escalate* says what it takes for *Waiting on you* to raise one: by default his verdict *and* a real ask at the end of the agent's message, or his verdict alone. See [Jeff · Router](../automation/jeff-router.md#when-he-escalates).

All fields with their exact names and limits: [Settings reference](../reference/settings-reference.md).
