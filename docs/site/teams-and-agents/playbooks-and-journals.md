---
title: Playbooks and journals
description: The files the office writes into each project for the team - Playbooks, subagent definitions, journals, standups, insight memos and lessons.
weight: 6
---

The team's instructions and memory live **in the project repository**, so they're versioned with the app and readable by every agent.

| File | What it is | Written |
|---|---|---|
| `.ai-context/skills/team-<role>/SKILL.md` | The role's **Playbook**: mission, rules, autonomy level, skills and gates, toolkit skills to read. Mirrored to `.claude/skills/team-<role>/SKILL.md`. | At hire, and again when skills, autonomy or subagent standing change |
| `.claude/agents/<id>.md` | Each subagent's definition (model, tools, warnings) | At hire; changed by warn / swap-model |
| `.claude/agents.benched/` | Definitions of benched subagents | On bench |
| `docs/team/<team>.md` | The team's **journal**: dated entries `## YYYY-MM-DD HH:MM — <what>` (kickoffs, reviews, handoffs, proposals) | By the team; seeded if missing |
| `.ai-context/skills/mxcli-field-lessons/SKILL.md` | Hard-won **lessons** (reserved names, MDL pitfalls, Windows limits) | On bench, by the Lead |
| `docs/standups/<date>.md` | The standup page | By the standup |
| `docs/insights/YYYY-Www.md` | The Chief Analyst's weekly insight memo | At the standup, if missing |

The Playbooks point at the toolkit's own skills in the toolkit clone (`AGENT_OFFICE_TOOLKIT_DIR`), rather than copying them. See [The toolkit](../integrations/toolkit.md).

> [!TIP]
> Read a team's journal from the [Team boards](../using-the-office/team-boards.md) tab, or open any of these files from **☰ → 📚 Project docs**.
