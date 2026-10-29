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

## Run it before you say done

The Playbooks of the roles that build or check the model (the Lead Developer, the Lead Tester, a Solo lead, and whoever covers Development) have **Run it before you say done**: after building or changing a page or flow, commit, start the app at the candidate through the office (`office-app start --commit HEAD`), run the journeys that cover the change (`office-app journey J-12`) or, when none does, a smoke click-through of the changed pages (`office-app smoke --page /p/…`), and report the result with its commit (*journeys J-12, J-13 passed at @abc1234*). A check the agent ran itself (a measurement, its own script, screenshots) is recorded at the commit with `office-app check`, so the receipt and the merge dialog show it, labelled as reported by the agent. When the office can't sign in or a check can't run, the agent says so in its report and the office raises it to you too: it never just goes idle. *Not measured* is no longer acceptable when an instance can be started. Microflow tests go through `office-app test`; never `mxcli run --local` or `mxcli test --local` in a worktree, never a database superuser. Test accounts come from **instance constants**: the seed stays off in the model (no known password, demo users off), `.agent-office/instance-constants.json` says what instances run with (`Core.SeedDemoData=true`, and the seed password constant, whose value the office generates per instance), and the Playbook says never to add demo users, a demo admin or a known password to the model. See [office-app](../reference/office-workers-cli.md#office-app).

## Every ask is an escalation

The Playbooks and the office's prompts make sure nothing an agent needs from you sits where you don't look:

- **The toolkit's "ask in chat" is overridden for the office.** Where a toolkit skill says to ask the user, an Mx Office agent files the question with `office-workers escalate`, one escalation per batch, never only in its chat, a journal, a handoff or a standup page. The same rule is in the pinned toolkit's block in the project's instructions.
- **Hands-on asks** (merge a PR, sign in, paste a key, install a tool, allow something at the terminal, restart a preview) are `escalate --trigger needs-human`, never a `task` proposal.
- **Whoever covers Management** ends any reply to you that asks for something by filing an escalation, lists only escalated items under **Blocked on you**, runs the blocker sweep over every place an ask hides (the build plan's pending decisions and `blocked…` rows, PROJECT.md's open questions, the BRDs' RAISED and UNRAISED `openQuestions`, `analysis/sme-questions.md`, every Lead's latest `AWAITING-PM` line, `.claude/.gate-advisories`, the open pull requests), raises asks that need a person's hands without waiting a day, and opens a docs-only pull request with its journal and standup pages at least daily, after the standup, so they reach main.
- **Work carries its task id.** Every task the office gives an agent ends with a `Task: tsk_…` line. The journal etiquette asks every Lead to put it as a trailer on each commit for that task and as its own line in the pull request's description, as it names `MCR-<n>` for a model change request, to cite *Decided per ESC-&lt;id&gt; rev &lt;n&gt;* in a commit that acts on an answer, and to pass the `Task:` line on when it hands the task to someone else. That is how the office links the work to the task and to your decisions; work without it reads as not linked, never as done. See [Task ids and linked work](escalations.md#task-ids-and-linked-work).
- **A decision you answered is recorded as given, with its citation.** The journal etiquette asks every Lead to record your answer to an escalation on a line of its own in its journal entry, or PROJECT.md's Decisions row, that reads `Decided per ESC-<id> rev <n>: <the answer, exactly as given>` with nothing after the answer, rationale and commentary on the next line (the id and revision come from the answer's marker line), and to commit it. The office compares the record with your answer: see [Recorded as given](escalations.md#recorded-as-given).
- **The outlets stay, with the escalation as well:** the one-line "what I'll do next" of a fresh hire, the `AWAITING-PM:` line of a bench or pause handoff, the standup summary's "what needs the Project Manager" and the journal's `### Proposals` all ask for an escalation too when you must act.

The office files what slips through anyway: see [Escalations the office files for an agent](escalations.md#escalations-the-office-files-for-an-agent).
