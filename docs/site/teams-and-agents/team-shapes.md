---
title: Team shapes and coverage
description: Solo, Startup or Enterprise - how many agents a project has, which member covers which team, and where relays, standups, subagents and deliverables go on each.
weight: 2
---

A project's team has one of three **shapes**. The shape is the first of two dials the [new-project wizard](../get-started/first-project.md#page-4-team-and-budget) sets; the second is the [budget level](../using-the-office/budget.md#budget-levels) (Lean, Balanced or Fast).

| Shape | Who is hired | Who covers what |
|---|---|---|
| 🧑‍🚀 **Solo** | One **Solo Lead** (Sonnet), with every subagent type | Every team: Analysis, Design, Development, Testing and Management |
| 🚲 **Startup** | A **Chief Analyst** and a **Lead Developer** | The Chief Analyst covers Management, Analysis and Design (Stages P–4); the Lead Developer covers Development and Testing (Stages 5–7). Design and test work is done by their subagents. |
| 🏢 **Enterprise** | A **Project Coordinator** and four **Leads** | Each team covers itself, as described in [The team model](team-model.md) |

Every project made before shapes existed is **Enterprise**, with every team covering itself, and behaves exactly as it always did.

## Team coverage

Each team is covered by its own Lead, or by another member. Wherever the office used to send something to a fixed role, it now sends it to whoever covers the team:

- **Relays.** New escalations, your decisions on proposals and the Leads' subagent news go to whoever covers **Management**: the Project Coordinator, the Startup's Chief Analyst or the Solo Lead. A member is never relayed its own escalation. A decision on a member's own proposal reaches it once, as its own note. (Before coverage, a team without a Coordinator dropped these.)
- **Standups.** Only members who cover a team are asked; nobody absent gets a standup prompt. The compiled page goes to whoever covers Management. On a Solo team, that makes it the Solo Lead's daily note in `docs/standups/<date>.md`. Whoever covers Analysis gets the analyzer numbers and the weekly memo request.
- **Issues and labels.** Labels stay per team (`team:design`). The member covering the team picks the issue up: ▶ Resume counts a team's open issues for whoever covers it. Jeff's triage says who covers the team, for example "→ Design · covered by Sam (Solo Lead)".
- **Subagents.** A team's subagents belong to whoever covers it. On a Startup team, the Chief Analyst dispatches and manages the UI/UX Designer, and the Lead Developer manages the Tester. Their track records are kept under that member.
- **Skills and gates.** A member covering several teams gets the union of those roles' skills. Where two roles share a skill, the **strictest gate wins** (ask over propose over tell over FYI). The Solo Lead keeps its own short list of toolkit skills rather than every role's, so its Playbook stays small.
- **Deliverables.** A member's Playbook lists the deliverables of every team it covers, each under that team's heading and label. On the team pages, the 📦 Deliverables panel says who covers the team, for example "📦 Deliverables · covered by Sam (Solo Lead)".
- **The one writer.** Whoever covers Development is the only one who runs `mxcli exec` against the `.mpr`: the Lead Developer, or the Solo Lead.
- **Team pages and the 2D view.** A covered team's page shows the covering member's card. Its zone's signpost in the 2D view reads "Covered by Sam (Solo lead)". An empty desk is just empty.
- **The Firm.** A reviewer's question to a team goes to whoever covers it. A question for Management goes to whoever covers Management.
- **▶ Resume and ⏸ Pause.** Whoever covers Management gets the Coordinator's relays in its resume brief.
- **The Command Center** talks to whoever covers Management.
- **The budget plan.** The shape changes each stage's cost and who does it (see [Budget](../using-the-office/budget.md#team-shapes-in-the-plan)).

## Where you see it

- The **Team tab** and the **🎛️ Command Center** show the shape and budget level as a chip, for example **🧑‍🚀 Solo · Lean**.
- On a Solo or Startup team, the **org chart** puts whoever covers Management on top. Each card says what else that member covers ("🧩 Also covers 🎨 Design, 🧭 Management"). A **🧩 Coverage** table lists every team and who covers it.

In this version, coverage is read-only: the wizard sets it from the shape. Adding and removing teams on a running project comes next.

## The Solo Lead

The Solo Lead is one generalist agent (role id `solo-lead`, Sonnet by default). It works the toolkit pipeline stage by stage on its own: `small-project-tier.md` when it applies, each stage's gate before the next. It dispatches a subagent for every draft or check (Business Analyst, UI/UX Designer, Developer, Tester) and reviews every result. It escalates whatever needs you: there is nobody else to relay it. Its desk and journal are Development's (`docs/team/development.md`).
