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

A task is **finished** when the office can tell: the issue it names was closed, its pull request is no longer open, or the agent ended a turn saying `task done`.

## The office never cuts into a turn under way

Messages the office starts by itself wait until the agent's turn is over, and are typed then (they're kept in the roster file, so a restart doesn't lose them):

- the **scheduled standup** asks only the Leads between turns and reads the busy ones from their journals;
- **autonomy and skills notices**, **relays** and **notes** (a decision on a proposal) go in when the turn ends;
- a team hired **after today's standup time** gets no catch-up standup that day: its first is the next scheduled one.

A decision an agent was **waiting on** goes in at once: your answer to its escalation, or your decision on its proposal (within ten seconds, so a few approved in a row arrive as one message; an asleep Lead is woken for it).

## Back to work

When a team member's turn ends with its task still open, the office waits half a minute and then sends it one short prompt:

> You stopped with work on GitHub issue #1 (Discovery) open: carry on, or escalate if you're blocked.

It's sent once per stop, and at most **twice per task an hour**. Never when:

- the member has an escalation open (the next move is yours), or its task is finished;
- it's working, asking you something in its terminal, asleep, benched or answering a standup;
- someone has its terminal open, or messages are waiting to be typed to it (they carry the resume line);
- the project is paused (⏸ Pause project, a safe restart, the budget) or the daily spend cap is reached;
- Studio Pro has the project open (Studio mode holds the agents' writes);
- the autonomy level is 1 (*Directive*: you drive every step).

Turn it off in ⚙️ Settings › 👥 Team › **Review loop** (*Back to work*). It's on by default.

**💤 Idle with an open task** in [Needs you](../using-the-office/command-center.md#needs-you): a member idle for 10 minutes with a task open and nothing escalated, with a **Nudge** button that sends the same prompt, as yours.

## You choose before your actions interrupt busy agents

**📋 Run standup** (on the Command Center and the Standup tab) and the console's quick questions (**📊 Status update**, **🚧 What's blocking?**, **🗺️ Plan next steps**) reach agents that may be mid-turn. If anyone they'd reach is busy, a small window lists the team first: who is **ready**, who is **working** (on what, for how long) and who is **asking you** something. For each busy one pick:

- **Interrupt now**: typed straight away;
- **After their current turn** (the default): held and typed when that turn ends;
- **Skip: use their journal** (standup only): read from their journal, not asked.

**Same for all** sets every row. ✕ or Esc cancels. For a quick question, what you pick for the Leads also applies to the Coordinator's relays of it (`office-workers tell`) for the next half hour. Nobody busy: no window, it just goes.

What you **type yourself** in the console goes straight to the Coordinator. While it's mid-turn a note above the box says so (*working 4 min*), with **Send after their turn** to hold it instead.
