---
title: Interruptions and back to work
description: How the office's own messages never replace an agent's task, never cut into a turn under way, nudge an agent that stopped with its task open, and ask you before your own actions interrupt busy agents.
weight: 8
---

An agent in the middle of a task should finish it, and an agent that stops with its task open should be told to carry on. The office keeps four rules for that.

## The office's messages never replace the task

The office knows what each team member was **last given to do**: the task it was hired with, a prompt you typed to it (a short reply like *yes, go ahead* or a question doesn't count), or what the Coordinator told it with `office-workers tell`. The 👥 Team tab and the [Command Center](../using-the-office/command-center.md) show it.

Every message the office writes to an agent (a standup, an autonomy or skills notice, the answer to an escalation, the decision on a proposal, a relay to the Coordinator) **ends with the resume line**:

> When you've done this, carry on with: work on GitHub issue #1 (Discovery).

An agent with no task is told *you have no task yet: tell the Coordinator what you will do next, or escalate if you are blocked*. Several messages typed together get one line, at the end.

How a task ends is worked out from GitHub's own lists, and only real delivery counts as delivered:

- **Delivered**: the issue it names was closed as *completed*, or its pull request was **merged** and verified on its merge commit (below).
- **Merged**: a pull request that carries the task was merged after the task was given. It is finished, and then judged on the merge commit against the project's [verification policy](../using-the-office/testing.md#verification-policy-and-waivers):
  - **Done (verified)**: every required check passed, or was waived, on the merge commit. Only this counts as delivered.
  - **Merged, not verified**: a required check failed, is missing or was skipped there. The office asks you once in Needs you: re-run checks, waive (with a reason), or send it back for rework.
  - **Passed on PR head, integrated revision not checked**: the pull request's head passed, and the merge commit has no results yet. Not counted as delivered.
- **Cancelled**: the issue was closed as *not planned* (or as a duplicate). It's finished, but not delivered.
- **Closed without merging**: its pull request was closed and not merged. That's never success. If the same agent opened a newer pull request from its branch for the same issue, the old one is just **replaced** and the work carries on. Otherwise the office asks you in [Needs you](../using-the-office/command-center.md#needs-you): *PR #9 was closed without merging: rework, cancel, or replaced?* Only for pull requests closed after the office first started with task outcomes (release 39, a moment it records once): an older closed pull request raises nothing and leaves the task as it was.
- **Associated (unconfirmed)**: a pull request from the same agent or branch merged after the task was given, but neither its description nor any of its commits has the task's `Task: tsk_…` line. The office shows it on the member's card and never counts it: the task stays open, and its resume line tells the agent to add the line. A pull request that merged **before** the task was given is never that task's, whatever it says.
- **Pending verification**: the agent ended a turn saying `task done`, but no pull request merged and no issue closed. The office takes it as a claim and notes it in the project's recent activity. It moves on once the pull request merges (then judged as above) or the issue closes.

A task waiting on your decision or pending verification gets no back-to-work nudges, the same as a finished one: it waits for you. Its resume line tells the agent not to carry on with that task until you answer. A merged task is finished whatever its verification, so it gets no nudges either: "Merged, not verified" waits for your answer in Needs you. Tasks finished before these changes keep the record they had. The one exception is a task recorded as finished by a pull request that can't be its own: one merged before the task was given, or (once the office has read its commits) one that doesn't carry the task's id. The next time the office reads that task it is open again, with a note on the member's card such as *earlier shown as done by PR #3 — that PR predates the task*. The task file itself is never rewritten.

## The office never cuts into a turn under way

Messages the office starts by itself wait until the agent's turn is over, and are typed then (they're kept in the roster file, so a restart doesn't lose them):

- the **scheduled standup** asks only the Leads between turns and reads the busy ones from their journals;
- **autonomy and skills notices**, **relays** and **notes** (a decision on a proposal) go in when the turn ends;
- a team hired **after today's standup time** gets no catch-up standup that day: its first is the next scheduled one.

This holding applies to the **office's own** messages only (`Delivery.send` in `src/server/roster/deliver.ts` holds messages whose origin is the office). Other messages go in differently:

- **Your answer to an escalation** is typed at once, even into an agent that is mid-turn: it isn't held for the turn's end, and the [ask-before-interrupting check](#you-choose-before-your-actions-interrupt-busy-agents) doesn't apply to it. Claude Code queues what is typed into a busy session and hands it to the agent when it can, so in practice the agent reads it at the end of its current step or turn. The decision card's *gets it after their current turn* describes that, not when the office types it. The office holds the answer back only while a dialog may be up in the agent's terminal (a permission prompt, a question, or while it's starting), or while it writes its handoff; an asleep agent is woken with it. See [Escalations › Answering](escalations.md#answering).
- **Your decision on a proposal** goes in at once too (within ten seconds, so a few approved in a row arrive as one message; an asleep Lead is woken for it).
- **Change answer** and **Send correction** are held and typed when the agent's turn ends.
- **An agent's `office-workers tell`** goes in at once, unless you chose *After their current turn* for that Lead in a quick question's check within the last half hour (below).

## Back to work

When a team member's turn ends with its task still open, the office waits half a minute and then sends it one short prompt:

> You stopped with work on GitHub issue #1 (Discovery) open: carry on, or escalate if you're blocked.

It's sent once per stop, and at most **twice per task an hour**. Never when:

- the member has an escalation open (the next move is yours), or its task is finished, waiting on your decision or pending verification;
- it's working, asking you something in its terminal, asleep, benched or answering a standup;
- someone has its terminal open, or messages are waiting to be typed to it (they carry the resume line);
- the project is paused (⏸ Pause project, a safe restart, the budget) or the daily spend cap is reached;
- Studio Pro has the project open (Studio mode holds the agents' writes);
- the autonomy level is 1 (*Directive*: you drive every step).

Turn it off in ⚙️ Settings › 👥 Team › **Review loop** (*Back to work*). It's on by default.

## The next build-plan rows, handed over

On the real build the Lead Developer stopped after every batch of build-plan rows and waited for a nudge. Now, 20 seconds after a Lead's turn ends, the office looks: when its batch is done (it has no open task, or every build-plan row its task names, *rows 12–15*, has build evidence on main or a branch, including its own branch's *Row N: …* commits) and `architecture/build-plan.md` has next rows for its role, the office hands them over itself, as its new task:

> Your last batch is done. Next in architecture/build-plan.md for you: rows 16–18 (Phase 3 — Approvals): …

- **Which rows**: the plan's next rows not done and not *blocked*, in plan order, at most **4** and all from one phase. A row's role is its *Owner* (or *Role*, *Lead*, *Team*) column when the plan has one, else its Kind: BUILD, RUN and HARNESS rows are the Lead Developer's (or whoever covers Development), PROVE rows the Lead Tester's, BRIEF rows the Chief Analyst's.
- **Never past a checkpoint**: a row whose Kind is CHECKPOINT, GATE, SIGN-OFF, REVIEW, DEMO or MILESTONE, or whose step says checkpoint, sign-off, Project Manager review, demo or acceptance, stops the hand-off before it, whoever's row it is; the activity feed says *No rows handed to Blake: row 16 is a checkpoint*. A row whose *Depends on* names rows not done ends the batch too.
- **Never when** back to work wouldn't nudge: the autonomy level is 1, *Back to work* is off, the project is paused (⏸ Pause project, a safe restart, the budget's auto-pause, the daily spend cap), Studio Pro has the project open, the Lead asks you something, has an escalation open, is answering a standup, has someone at its terminal, messages waiting for it, or subagents or background work still running.
- **Recorded**: the activity feed (*➡️ Handed Blake the build plan's next rows 16–18*), the audit log (`roster.handoff`, with the rows) and `<office data>/handoff/<project>.json`. The same rows are never handed twice (if the last hand-off didn't land them, the Lead shows idle with an open task in Needs you), and at most four hand-offs an hour per Lead. The Project Coordinator is never handed rows.

**💤 Idle with an open task** in [Needs you](../using-the-office/command-center.md#needs-you): a member idle for 10 minutes with a task open and nothing escalated, with a **Nudge** button that sends the same prompt, as yours.

## You choose before your actions interrupt busy agents

**📋 Run standup** (on the Command Center and the Standup tab) and the console's quick questions (**📊 Status update**, **🚧 What's blocking?**, **🗺️ Plan next steps**) reach agents that may be mid-turn. If anyone they'd reach is busy, a small window lists the team first: who is **ready**, who is **working** (on what, for how long) and who is **asking you** something. For each busy one pick:

- **Interrupt now**: typed straight away;
- **After their current turn** (the default): held and typed when that turn ends;
- **Skip: use their journal** (standup only): read from their journal, not asked.

**Same for all** sets every row. ✕ or Esc cancels. For a quick question, what you pick for the Leads also applies to the Coordinator's relays of it (`office-workers tell`) for the next half hour. Nobody busy: no window, it just goes.

What you **type yourself** in the team-lead panel goes to whoever leads the team. While it's mid-turn a note above the box says so (*working 4 min*), with **Send now** and **After their turn** (Enter picks the second):

- **After their turn** goes through the office's delivery rules as your message: it's kept on disk before it's typed, held while the lead is mid-turn, and typed when the turn ends.
- **Send now**, and anything you type while the lead is idle, is typed straight into its terminal as a console prompt. It does **not** go through those delivery rules: nothing checks for a dialog in the lead's terminal, and nothing holds it. A working lead's Claude Code queues it.

This check covers **📋 Run standup**, the quick questions and what you type to the lead. It doesn't cover your answers to escalations (above), which are typed at once.

See also: [Needs you](../using-the-office/needs-you.md) and, for how the office's messages travel, [Execution lifecycle](../architecture/execution-lifecycle.md).
