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

## Bounded

The office counts the revision rounds from the verdicts, so the loop can't go on forever: reworks in a row count, and an accept ends the task and starts the count again. One rework past the level's allowance (2 rounds at levels 1 and 2, 3 at levels 3 and 4) is *revisions-exhausted*:

- the office raises **one** `revisions-exhausted` escalation for the Lead, with the task, the last review note and the subagent's track record (an FYI at levels 3 and 4, where that trigger doesn't alert you);
- the Lead's `subagent review` answer says it's out of rounds and not to send the work back again;
- the review nudge stops for that subagent.

When you answer the escalation (or the Lead accepts the work), the count starts again.

The verdicts feed the subagent's **track record** and the Lead's own **review turnaround** and **review quality** on the Workers tab. See [Subagents](../automation/subagents.md) and [Workers and rankings](../using-the-office/workers.md).

## The nudge

If a Lead's turn ends right after one of its subagents came back, the office prompts it **once** to review that result per its Playbook and continue or escalate. Nobody sits idle with an unreviewed result.

- It waits 15 seconds after the turn ends, and leaves at least 3 minutes between nudges.
- It skips the Project Coordinator, a Lead that is asleep, busy, waiting on you, or answering a standup.
- It stops after 3 nudges in a row when the Lead records no review verdict and nobody else prompts it, with one Activity line (*Stopped nudging …*). A verdict, or anyone else's prompt, lets it go on.
- It isn't sent while the floor's daily cost cap is reached.
- Turn it off in [Settings](../using-the-office/settings.md) (**Review loop**). It's on by default.
