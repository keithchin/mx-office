---
title: The team model
description: The Project Manager, the Project Coordinator, the four Leads and their subagents - each role's mission, rules and default model.
weight: 1
---

## The roles

| Role | Mission | Its subagents | Toolkit skills it works from (examples) |
|---|---|---|---|
| **Project Manager: you** | The final say. Approve proposals, merges and milestones; answer escalations; set the autonomy level. | none | none |
| 🧭 **Project Coordinator** | Keeps the plan, coordinates the Leads, runs the daily standup, summarises escalations for you. | none | conversion-runbook, iterative-build-loop, close-the-loop |
| 🎨 **Lead Designer** | Reviews and approves design changes: Atlas design system, wireframes, page layouts. | UI/UX Designers | design-artifacts, ui-review-loop, learned-page-patterns |
| 🛠️ **Lead Developer** | Does all the programming. **The only one who writes to the Mendix model** (`mxcli exec`). | Developers (draft and check MDL) | architecture-blueprint, walking-skeleton, mdl-cookbook-microflows |
| 🧪 **Lead Tester** | Approves testing and improves the test framework. Mission: fewest bugs, highest quality. | Testers (unit tests `tests/*.test.mdl`, Playwright `tests/e2e`) | testing-shape, e2e-harness-base, journey-proof |
| 📈 **Chief Analyst** | High-quality business requirements (the BRD), analysis of each app's development cycle, R&D. Writes a weekly insight memo. | Business Analysts, Data Analysts | interview-protocol, brd-generation, app-analysis |

This is the **Enterprise** team. A Solo or Startup team has fewer agents, and each team is covered by one of them: see [Team shapes and coverage](team-shapes.md). There, the 🧑‍🚀 **Solo Lead** (role id `solo-lead`) runs the whole project alone with every subagent type, and is the one writer of the `.mpr`.

The **Project Coordinator** (role id `pm`) is an agent. The **Project Manager** is always the human: anyone signed in with the office password, that is, an admin.

**⚖️ Jeff · Router** sits beside the Coordinator on the org chart. He is staff, not an agent: you can't hire or bench him. See [Jeff · Router](../automation/jeff-router.md).

## Names and models

- Each role gets a name when the roster is made (Ada, Grace, Linus…). Rename it with ✏️ on its card.
- Every role starts on **Sonnet 5.5**. Change the model in the hire window (dropdown) or with **🧠** on the card; it applies from the next hire. The Data Analyst subagent defaults to Haiku.
- Names and models are per project.

## Rules every role follows

They are written into each role's **Playbook** in the project. See [Playbooks and journals](playbooks-and-journals.md).

- **One writer per Mendix app.** Only the Lead Developer applies changes to the `.mpr`. Everyone else drafts, checks and reviews. The Lead Tester may write, but only under `tests/`.
- **Review loop.** A Lead reviews every subagent result and continues, sends it back, or escalates. See [The review loop](review-loop.md).
- **Skills and gates.** Each member's skills say what it may do and how: ask you, propose, tell the Coordinator, or FYI. See [Skills and gates](../automation/skills.md).
- **Team journals.** Each team writes dated entries to `docs/team/<team>.md`: kickoffs, reviews, handoffs, proposals.
- **Team labels.** Each team's work carries a `team:<team>` label.

## Hiring and staffing

Hire members on the [Org chart](../using-the-office/org-chart.md). Hiring is admin-only. A member that was benched comes back as a fresh session, primed with its handoff note. See [Benching and handoffs](benching-and-handoffs.md).
