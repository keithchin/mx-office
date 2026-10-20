---
title: Glossary
description: The words used in the office and these docs, from Admin to Worktree.
weight: 9
---

| Word | Meaning |
|---|---|
| **Admin** | Anyone signed in with the shared office password, or with an account that has the admin role: the Project Manager. |
| **Agent** | See *Worker*. |
| **App Factory** | What Mx Office is for: an office where agents build Mendix apps. |
| **Approval** | Something waiting for the Project Manager's yes or no: a proposal, an escalation, a subagent action, a merge, a spent cap. |
| **Audit log** | The append-only, hash-chained record of who did what and when, per project and office-wide. A tab on each project and on /home. |
| **Autonomy level** | How often agents need you: 1 Directive, 2 Guided, 3 Delegated, 4 Autonomous. |
| **Bench** | Clear a team member's session after it wrote a handoff note. A benched Lead takes a break in the 2D view. |
| **Board** | A project's Kanban of issues, tasks, workers and PRs. |
| **BRD** | Business requirements document, written by the Chief Analyst. |
| **Building / office** | The whole Mx Office server, with all its projects. |
| **Client** | A company you build for, grouping its projects so their agents are pointed at the same company brain. It organises knowledge; it isn't access control. See [Clients](../using-the-office/clients.md). |
| **Command Center** | The first tab of a project (the Overview in Portal): Needs you, setup, progress, the team, the budget, recent activity. |
| **Company brain** | A client's own folder (usually a private git repository) of accepted conventions, company skills, examples and approved components, with a `README.md` and a `ROUTING.md`. Agents read its live folder; the office doesn't pin it. See [Clients](../using-the-office/clients.md). |
| **Company skill** | A skill file in a company brain's `skills/`: like a toolkit skill, but true only for that company's apps. Reached through the brain's `ROUTING.md`. |
| **Context manifest** | One line the office appends at each hire on a project with a company brain: the brain's snapshot and the routed files with their hashes. It records what the hire was **offered**, never what it read or followed, and has no session id. |
| **Cool-down** | How long a benched subagent sits out (24 hours by default). |
| **Engagement** | One audit by The Firm: its configuration, reviewers, interviews, spend and report. |
| **Engagement Partner** | The Firm's lead reviewer (Eleanor Vance), attached to the Project Coordinator; writes the final report. |
| **Escalation** | A structured question from an agent to you, with urgency, options and a recommendation. |
| **Firm, The** | Independent Reviewer Agents at /firm that audit a project from outside its team. |
| **FYI** | An escalation your autonomy level wouldn't stop for: shown, but no alert. |
| **Gate (skill)** | How a member may use one of its skills (permitted actions): ask, propose, tell or FYI. The office enforces it only for four subagent operations; the rest are Playbook instructions. See [Skills and gates](../automation/skills.md). Not the same as a ✋ gate. |
| **✋ Gate (toolkit)** | A toolkit stage (0, 3, 4) that needs a `CONFIRMED` decision in `PROJECT.md`. Not the same as a skill's gate. |
| **Handoff note** | What a member writes in its journal before it's benched. |
| **Jeff · Router** | The office's quick judge, powered by Jev, with a Claude Haiku fallback. Staff, not an agent. |
| **Jev** | TypeSafe AI's fast "System One" model, which Jeff runs on. |
| **Journal** | A team's dated log, `docs/team/<team>.md`. |
| **Lead** | The visible agent heading a team: Lead Designer, Lead Developer, Lead Tester, Chief Analyst, or the Solo Lead on a Solo team. |
| **Lesson** | A dated, free-form note (a gotcha, a working recipe, a mistake not to repeat) an agent appends to the project's lessons file, usually when it's benched. It stays in the project: the office doesn't review, harvest or promote it. |
| **Live app** | The Mendix app running from `main` on this laptop. |
| **MDL** | Mendix Definition Language, the text format mxcli uses to change a model. |
| **mxcli** | Mendix Labs' command-line tool for Mendix models. There is no per-project mxcli version: new projects' `toolkit.env` says `MXCLI_VERSION=nightly`. |
| **mxcli skill** | An instruction file mxcli itself puts into a project's `.ai-context/skills/`. |
| **Needs you** | The Command Center's list of everything the office knows is waiting for a human. See [Needs you](../using-the-office/needs-you.md). |
| **Outcome unknown** | A hand-off (for example your answer to an escalation) the office may have typed into an agent's terminal but couldn't confirm the agent received. It is never sent again by itself: in Needs you, you choose **Send again**, **It went through** or **Abandon**. See [Command Center](../using-the-office/command-center.md#answers-whose-outcome-is-unknown). |
| **Playbook** | The instruction file the office writes for one role on one project: its rights, its skills and gates, the toolkit skills it reads, journal and lesson rules. Technically a Claude Code skill file, at `.ai-context/skills/team-<role>/SKILL.md` (mirrored under `.claude/skills/`). The office rewrites it (for example after a skill or toolkit change), so change it through the office, not by editing the file. |
| **Priority (Jeff)** | Jeff's ranking of open escalations; the lists show a *#1 · resolve first* chip. |
| **Project** | One app with its own team, board and live app, in one git repository: usually on GitHub, or a bare repository on this machine for a local-only project. |
| **Project Coordinator** | The agent that coordinates the Leads and runs the standup (role id `pm`). |
| **Project Manager** | You, the human. |
| **Proposal** | A suggestion from the standup, for you to approve, reject or change. |
| **Reviewer Agent** | One of The Firm's auditors, working in an isolated clone at a pinned commit. |
| **Review gate** | The office's check of merged agent pull requests for a recorded review, a merge too soon after opening, and similar. It is a **detector**: it flags after the merge and never blocks one. See [Review gate](../using-the-office/review-gate.md). |
| **Review loop** | A Lead reviewing each subagent result, then continuing, revising or escalating. |
| **ROUTING.md** | A company brain's hand-kept table of which file to read for which question. The office reads the paths it routes to (to hash them and notice changes); agents are told to read it first, but nothing makes them. |
| **Scorecard** | The CI comment on a PR summarising checks, score and tests. |
| **Shadow** | A Jeff mode: judge and log, never act. |
| **Skill** | Ambiguous; say which. In the Team tab's 🧰 Skills window, an action a member may take (Manage up, Manage down) with a gate: really a permission. Its 🛠️ Craft group, and elsewhere, a **toolkit skill**. Also a **company skill**, an **mxcli skill**, or (technically) a **Playbook**. See [Skills and gates](../automation/skills.md#which-skill-is-which). |
| **Standup** | The daily team report at 09:00 SGT on weekdays. |
| **Subagent** | A team member running inside a Lead's Claude Code session. It doesn't count as a reviewer of pull requests. |
| **Task id** | `tsk_<ulid>`, given to most work the office hands an agent and shown as a `Task: tsk_…` line. Not every prompt gets one: a quick question from the team-lead panel, for example, doesn't. See [Escalations](../teams-and-agents/escalations.md). |
| **Team chatter** | The Command Center's thread of what the agents say to each other, from real exchanges only. |
| **Team-lead panel** | Docked on the right of every project tab: the agent who covers Management (Project Coordinator, Chief Analyst or Solo Lead), its chat or terminal, and a box to ask it things. |
| **Toolkit** | The mxcli-project-toolkit: stages P to 7, skills, gate checks. |
| **Toolkit pin** | The one toolkit commit a project runs on: a read-only (by convention) checkout at `<clone>-pins/<sha12>`, recorded in the project's `agent-office.project.json`, `PROJECT.md` and the office's data. It moves only with **Update toolkit**. See [Toolkit versions](../administration/toolkit-versions.md). |
| **Toolkit skill** | A reusable, client-free instruction file in the toolkit's `skills/`, read from the project's pin. The Playbook lists the ones a role works from. |
| **Track record** | A subagent's runs, verdicts and grade. |
| **Worker** | A Claude Code session at a desk. |
| **Worktree** | A worker's own checkout and branch of the repository. |

See also [Architectural concepts](../architecture/_index.md) and [Reusable skills and knowledge](../architecture/reusable-skills-and-knowledge.md).
