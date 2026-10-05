---
title: The review loop
description: How a Lead reviews every subagent result, records a verdict, and continues, revises or escalates - and how the office nudges a Lead that stops too early.
weight: 4
---

When a subagent finishes, its **Lead reviews the result** before anything else happens.

## What the Lead does

1. Runs the cheap checks (for MDL: `mxcli check`; for tests: run them).
2. Records its verdict: `office-workers subagent review <name> --verdict accept|rework --note "…"`, and writes a *Review* entry in the team journal.
3. Then one of:
   - **continue**: accept and move on;
   - **revise**: send it back with what to fix (up to the revision rounds of the autonomy level);
   - **escalate**: raise it to you when the level says so, for example after failing review twice at level 2.

The verdicts feed the subagent's **track record** and the Lead's own **review turnaround** and **review quality** on the Workers tab. See [Subagents](../automation/subagents.md) and [Workers and rankings](../using-the-office/workers.md).

## The nudge

If a Lead's turn ends right after one of its subagents came back, the office prompts it **once** to review that result per its Playbook and continue or escalate. Nobody sits idle with an unreviewed result.

- It waits 15 seconds after the turn ends, and leaves at least 3 minutes between nudges.
- It skips the Project Coordinator, a Lead that is asleep, busy, waiting on you, or answering a standup.
- Turn it off in [Settings](../using-the-office/settings.md) (**Review loop**). It's on by default.
