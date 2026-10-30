---
title: Subagents
description: Each Lead's subagents - their track record and grade, when one underperforms, and warning, benching, swapping the model and reinstating, each through the Lead's gate.
weight: 3
---

A Lead's team members are **Claude Code subagents**, running inside the Lead's session. The office keeps a **track record** for each one.

## Names

Each subagent (one per Lead and subagent type) gets a person's first name the first time the office sees it, like the Leads have: *Nia · Tester (Hedy's subagent)*. The name is kept in the project's roster file and never changes by itself; no two on a project share one, Leads included. A roster from before names gets them the next time the office starts, the same names every time. The name shows on the Workers tab, in the 2D view and the home page's Overview, in the Team chatter and the Team phone, in the activity and approvals, and on the Budget tab. Each Lead's Playbook names its subagents (*Nia, your Tester*), so the Lead calls them by name; it still dispatches each by its type, so `.claude/agents/<type>.md` and `office-workers subagent … <type>` are unchanged. The Project Manager can give one another name with **✏️ Rename** on its detail or the Org chart (recorded in the audit log as `subagent.rename`).

## The track record

- **Runs** come from Claude Code's hooks (subagent start and stop) and the Agent tool's results, and from the Lead's transcript for a run no hook said had ended (a background run's notification). The last 50 are kept per subagent.
- Each run is **pending** (unreviewed), **accept**, **rework** or **failed**. The verdict comes from the Lead's review: `office-workers subagent review <name> --verdict accept|rework`, which lands on its newest unreviewed run. Unreviewed runs count as runs but not toward the grade; cards say how many there are.
- The **grade** is over the last 5 reviewed runs on its current model (at least 3 needed): accepts divided by reviewed runs, with half credit when the PR's CI failed. **A** ≥ 90, **B** ≥ 80, **C** ≥ 70, **D** ≥ 60, else **F**.
- It is **underperforming** (📉) below 70, or with 2 or more reworks or failures in that window. Its Lead is told once, when idle.

See them on the [Org chart](../using-the-office/org-chart.md), the [Team boards](../using-the-office/team-boards.md), as workers of their own on the [Workers tab](../using-the-office/workers.md#subagents) and in the [2D view](../using-the-office/2d-view.md), or with `office-workers subagent list`.

## At work now

The office also follows each run live, from the moment the Lead's Agent call goes out until it ends:

- **From the hooks**: the Agent tool's PreToolUse (the subagent, its task, its model) and PostToolUse (its answer, or, for a background run, its launch with Claude Code's agent id), and SubagentStart / SubagentStop. Several runs of the same subagent at once are each their own.
- **From the Lead's transcript**, read every 10 seconds, for what no hook says: a background run finishing (its `<task-notification>`), or anything that happened while the office was down. The same run from both is counted once.
- A project keeps its **last 50 runs** in its roster file, each linked to the run record its Lead reviews, so a card shows the verdict. A run with no word of it for 6 hours is marked lost.

**Under each member, wherever the team is listed.** The Overview's Team card and the Org chart show each member's subagents at work under it: name and type (*Elsa · Business Analyst*), its task, how long it has been at it (to the minute) and a working animation. A member whose own turn is over while its subagent works reads **Working (via subagent)**, never idle. A finished run says *done · 4 min* for a minute, then folds into a line like *2 subagent runs today* (on the Overview it opens the Workers tab's subagents); clicking a run opens its subagent's detail. The Project Coordinator's own subagents show here too, at work only: they keep no track record. The home page's *working* counts and the office's fact block for the Coordinator (*Katherine (you) — 1 subagent working: Elsa (business analyst)*) count a member at work through its subagents. All of it comes from the roster the page already has, with nothing polled; the Overview redraws a run's minutes only while its card is on screen.

**Active while its status lags.** A member whose status says idle (or asleep) while the office saw it at work in the last minute and a half (its terminal printed, one of its hooks fired: a tool call, its own or a subagent's) or in the last five minutes (it ran `git commit`) reads **Active (terminal output)**, **Active (tool calls)** or **Active (just committed)** on the Overview's Team card and the Org chart, with *Committed 40 s ago; its status lags the work* under it, and the home page's *working* counts count it. The office hears only the changes (active to quiet and back), so the roster follows within seconds without a message per line of output. Kept in memory: after a restart nobody is active until it does something.

**Background work: Monitors and background commands.** An agent can also end its turn with a Monitor (a watch with a timeout, *expires in 15m*) or a Bash command running in the background (asked for, or moved there when it outran its timeout); Claude Code wakes it when that work reports. The office hears each one start from the agent's PostToolUse hook and reads its end off the transcript's `<task-notification>` (completed, failed, killed, stopped, or *Monitor expired*), on the same transcript reads the subagent runs use: nothing new is polled. While anything of it runs, a member whose turn is over reads **Waiting on background work** (rather than *Working (via subagent)*), with each item first in the list under it: *monitor · 12 min left* or *background command · started 3 min ago*, and *as of 00:27*, the last time the office had word of it. The fact block says *Sophie (you) — waiting on background work: monitor, background command, 1 subagent (Maya)*, the home page counts the member as working (not as waiting on you), and the idle bench leaves it alone, since benching would end the session the work runs in. The office never claims more than it knows: a Monitor two minutes past its stated expiry with no notice, or a command with no word for two hours, reads *background work (status unknown since 14:05)* for half an hour and no longer counts as work going on. A new session (a fresh start or a resume, a new transcript) or the agent going to sleep clears the list. It is kept in memory; after an office restart the first transcript read brings it back.

## Actions

| Action | Does |
|---|---|
| **⚠️ Warn** | Adds a dated warning to its definition `.claude/agents/<name>.md`. |
| **🪑 Bench** | Moves the definition to `.claude/agents.benched/` and blocks the Lead from calling it. It comes back after the **cool-down** (24 hours by default; 0 = only by hand). |
| **🔁 Swap model** | Changes its model: haiku, sonnet, opus, or back to the Lead's. |
| **✅ Reinstate** | Undoes a bench. Warnings stay. |

**Who can do them:**

- **A Lead**, with `office-workers subagent warn|bench|swap-model|reinstate`, each through its gate for that skill (ask, propose, tell or FYI, by autonomy level). See [Skills and gates](skills.md).
- **You**, from the Org chart's buttons, with no gate.
- **The office**, which reinstates a benched subagent when its cool-down ends (checked every minute).

A Lead whose subagent was changed by someone else is told between turns.

> [!TIP]
> A subagent graded D or F on Haiku often does fine on Sonnet. Try **🔁 Swap model** before benching it.
