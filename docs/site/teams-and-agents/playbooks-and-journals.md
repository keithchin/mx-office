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

Each Playbook also has a **Your deliverables** section: the files that role hands over per toolkit stage, at the exact paths the [📄 Documents](../using-the-office/deliverables.md) view checks (the BRD report and a BRD PDF, `use-cases.xlsx` and a Mermaid process flow for the Chief Analyst; the design system, one wireframe per screen and a storyboard for the Lead Designer; the blueprint, domain model, ADRs, build plan and module briefs for the Lead Developer; the test plan, journeys and evidence report for the Lead Tester), how to make them on the office's machine (`office-workers export-pdf` and `screenshot`, `py` with openpyxl and matplotlib, Mermaid), where its reports go (the toolkit's analyst reports stay in `reports/`, every other team's in `reports/<team>/`), and to keep them on a branch with a pull request so they merge. With **Early drafts** on (the default), Design, Development and Testing also get the rules for their small marked drafts before Stage 3.
Each Playbook also has **Blockers only the Project Manager can clear**. Whoever covers Management (the Project Coordinator, or the Lead on a Solo or Startup team) runs a **blocker sweep** at every standup and at least once a day while it works: anything only the Project Manager or the client can resolve (a decision, a named owner, an access, a stale pull request that needs a person) that has blocked work for more than a day is raised with `office-workers escalate`, with options and a recommendation, never just worked around; it lists them under **Blocked on you** in the standup summary. Every Lead that works around a blocker says so in its handoff and journal and tells the lead. The office's own [stuck detection](../using-the-office/stuck-detection.md) is the net under this.

The Playbooks point at the toolkit's own skills in the toolkit clone (`AGENT_OFFICE_TOOLKIT_DIR`), rather than copying them. See [The toolkit](../integrations/toolkit.md).

> [!TIP]
> Read a team's journal from the [Team boards](../using-the-office/team-boards.md) tab, or open any of these files from **☰ → 📚 Project docs**.
