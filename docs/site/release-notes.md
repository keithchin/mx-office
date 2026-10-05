---
title: Release notes
description: What changed in the App Factory fork of Agent Office, newest first.
weight: 99
aliases: [/docs/changelog]
---

Our fork's changes, newest first. Upstream Agent Office's own history is on GitHub (AgentSystemLabs/agent-office).

## October 2026

### 5 October

- **Documentation site** at `/docs`: these pages, with search, in the office's themes. ☰ → 📖 Documentation, and 📚 Docs on /home.
- **Escalation cards** show who raised them: the agent's 2D character, big, with its name and role, and what it needs in a speech bubble.
- **Skills per agent** and a **subagent track record**: gates by autonomy level, warn / bench / swap model / reinstate.
- **Worker rankings**: every agent graded A–F, with specialist duties for team roles; a Lead's review turnaround and quality come from its subagent reviews.
- **2D Overview** on /home: every floor at once in pixel art.
- **Waiting on another floor**: the jump lands on that floor's Command Center; Needs you lists agents that finished a turn nobody has looked at.
- **Needs you's Answer →** lands on the escalation in one step.
- **Jeff · Router**: the office's quick judge (Jev, with a Claude Haiku fallback), in Shadow mode by default.
- **Top bar**: ☰ menu, view dropdown, tab badges, and the 2D view follows the color theme.
- **Git tab**: the branch railway map.
- **Leads are benched only when you say so** (idle benching off by default). A Lead waiting on you is never benched. The board keeps each column's scroll when it redraws.
- **Needs you** strip on the Command Center.
- The team's **Org chart, Standup, Approvals and Settings** are main tabs of the 1D view.
- **Command Center** tab, first and by default (setup panel, project summary, Project Coordinator console).
- Pick the **model** in the hire window (Sonnet 5.5, Opus 5.5, Haiku 4.5, Fable 5.1).
- **Team boards** per team, **team zones** in the 2D view, the **PM console**.
- **New-project wizard** with the toolkit setup panel.
- **Color themes**: Default, Dark, Terminal.
- The address says where you are (`?floor=`, `?tab=`).
- Fix: a floor restoring its saved workers no longer breaks the team, so floors always come up.
- **Project teams**: Project Coordinator and four Leads with subagents, Playbooks, journals, standups, autonomy levels.

### 4 October

- **Live app**: the Mendix app from `main`, started by admins.
- **Analysis** tab and the project summary.
- **2D view** at `/pixel`, and the **1D view** as the default.
- **Retro** view, and graphics presets (`?gfx=low|medium|high`).
