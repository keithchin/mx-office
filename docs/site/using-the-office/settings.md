---
title: Settings
description: A floor's team settings - autonomy level, idle benching, review loop, early drafts, subagent cool-down, standup schedule, cost caps, dry run and Jeff (including his priority sort) - and the office's Teams notifications and keep-awake.
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
| **Deliverables** | Early drafts while the Chief Analyst is on Stages 0–2 | **On** |
| **Subagents** | Reinstate a benched subagent after N hours (0 = only by hand) | **24** |
| **Daily standup** | Scheduled · time · time zone · days | **On, 09:00, Asia/Singapore, Mon–Fri** |
| **Daily cost cap** | A dollar cap for each autonomy level | **Blank** (no cap) |
| **Issues** | Dry run: record approvals without making GitHub issues | **Off** |
| **Jeff · Router** | *Waiting on you* and *Triage*: Off · Shadow · On; *Priority*: Off · On; *When to escalate*: Only a real ask · His say-so | **Shadow, Shadow, On, Only a real ask** |

Below them, under **Your view (just you)**: **Command Center terminal**, *Chat (default)* or *Terminal*, the view the [Project Coordinator console](command-center.md#the-project-coordinator-console) opens in. Anyone can change it, it applies at once (no 💾 Save), and it's kept in this browser only.

## What each one does

- **Autonomy** sets how often agents need you. Changing it rewrites every hired member's Playbook and tells the ones at work. See [Autonomy levels](../teams-and-agents/autonomy.md).
- **By pipeline stage** (toolkit projects only) lets the office pick the level: the first one until the Stage 4 gate passes, the second from then on, changed as if you had picked it. While it's on, the level buttons only show the level. See [Autonomy by pipeline stage](../teams-and-agents/autonomy.md#autonomy-by-pipeline-stage).
- **Benching** is **off by default**: Leads are benched only when you click 🪑 Bench. Set a number of minutes to bench idle Leads automatically. See [Benching and handoffs](../teams-and-agents/benching-and-handoffs.md).
- **Review loop**: when a Lead's turn ends right after one of its subagents came back, the office prompts it once to review the result. See [The review loop](../teams-and-agents/review-loop.md).
- **Deliverables → Early drafts**: while the Chief Analyst is still on Stages 0–2, Design, Development and Testing make small drafts marked as drafts (low-fi wireframes, a draft domain model and architecture sketch, a test-plan outline), to revise once the BRDs are confirmed. Off: they wait for their stage. Changing it rewrites the hired Leads' Playbooks. See [Deliverables](deliverables.md#early-drafts).
- **Subagents**: how long a benched subagent sits out. See [Subagents](../automation/subagents.md).
- **Daily standup**: see [Standup](standup.md).
- **Daily cost cap**: one cap per autonomy level, for this floor. Only the cap for the current level counts. When it's spent, hiring stops on this floor until midnight (in the standup's time zone). See [Models and costs](../teams-and-agents/models-and-costs.md).
- **Dry run**: approved proposals are recorded, but no GitHub issue is made. Good for trying the office out. `AGENT_OFFICE_TEAMS_DRY_RUN=1` turns it on for the whole office.
- **Jeff · Router**: *Waiting on you* (when an agent ends its turn: is it waiting on you? On: he escalates it if it didn't), *Triage* (which team is a new issue for? On: he labels unlabelled issues he's sure about), and *Priority* (how soon should you resolve each escalation? On: your escalations are listed in his order, #1 first). *When to escalate* says what it takes for *Waiting on you* to raise one: by default his verdict *and* a real ask at the end of the agent's message, or his verdict alone. See [Jeff · Router](../automation/jeff-router.md#when-he-escalates).

All fields with their exact names and limits: [Settings reference](../reference/settings-reference.md).

## The office's ⚙️ Settings: Teams and keep-awake

Two settings for the whole office live in the 3D office's **☰ → ⚙️ Settings** window rather than on this tab. Admins change them; everyone sees them.

- **🔔 Notifications → Microsoft Teams**: the Teams Workflows webhook (masked once saved), **📨 Send a test card**, which floors post, *Needs you only* or *Needs you + daily digest*, quiet hours, a pause (1, 4 or 12 hours) and the public office address for each card's Open button. See [Teams notifications](../integrations/teams-notifications.md).
- **🤖 Workers → Keep awake while agents work** (on by default): the computer doesn't sleep while any worker on any floor is working or a queued task, Firm audit or gate-check runs, and may again once everything has been idle for the set minutes (10). It says what it's doing (*Keeping this computer awake: 3 agents working*) and how to set *When I close the lid* to *Do nothing* so work carries on with the lid closed. See [Running the office](../administration/running-the-office.md#keep-it-awake-and-the-lid).
