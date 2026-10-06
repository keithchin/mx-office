---
title: Escalations
description: How agents raise things to the Project Manager, what an escalation contains, how urgent ones alert you, and how your answer gets back to the agent.
weight: 3
---

An **escalation** is a structured question from an agent to you, with an urgency, options and a recommendation. It's how the team comes to the Project Manager.

![An escalation card](../images/escalations.png)

## Where escalations come from

- **An agent** runs `office-workers escalate` (or the MCP tool `escalate`). See [office-workers CLI](../reference/office-workers-cli.md).
- **A handoff note** ends with `AWAITING-PM: <question>` and there's no open escalation for it. The office raises one for the Lead.
- **Jeff · Router**, when *Waiting on you* is **On**: an agent ended its turn waiting on you but didn't say so. See [Jeff · Router](../automation/jeff-router.md).
- **An *ask* gate**: a Lead wants to do something its skill says it must ask about first. See [Skills and gates](../automation/skills.md).
- **A review loop out of rounds**: a Lead sent the same subagent's work back more times in a row than its autonomy level allows (2 rounds at levels 1 and 2, 3 at levels 3 and 4). The office raises one `revisions-exhausted` escalation for the Lead and stops nudging it about that subagent. See [The review loop](review-loop.md#bounded).

## The same ask, raised again

An agent's escalation that asks for what's already open on the floor isn't opened a second time: it joins the open one as a **+1 from** *name*, its details are added, and that agent hears your answer too.

- **The same title, or nearly** (three quarters of the words shared): joined straight away.
- **The same ask in other words** (*Set repo secret X*, *One command to set the e2e secret*, *Secret 404: set it in the web page instead*): when no title matches, [Jeff](../automation/jeff-router.md#the-same-ask-in-other-words) is asked whether it's the same ask as one of the open ones, and it's joined only when he's at least 85% sure. While his **Waiting on you** judgement is Off he isn't asked; when he doesn't answer within 10 seconds, or fails, it's raised as its own.

The Activity line says *Jeff judged it the same ask* when he joined it, and so does the Audit log.

## What's in one

| Field | Notes |
|---|---|
| **Urgency** | `info`, `important` (default), `urgent` or `critical` |
| **Trigger** | Optional: plan, scope, design, architecture, revisions-exhausted, blocked, milestone, repeated-failure, budget-risk, security, data-loss, client-milestone, budget-overrun, blocked-no-path |
| **Title** | Required, up to 160 characters |
| **Details** | Up to 6000 characters |
| **Options** | Up to 6 |
| **Recommendation** | Up to 400 characters |

The office stamps who raised it (name, role, team) and the autonomy level at the time, and works out whether it's an **FYI** for that level. See [Autonomy levels](autonomy.md#fyi-escalations).

## How you're told

- Every open, non-FYI escalation is in **🚨 Needs you**, **🚩 Escalations to you** on the Command Center, and **✅ Approvals**.
- An **urgent** or **critical** one also makes a toast and a desktop notification.
- Jeff rates each open one and, with his **Priority** on (the default), the lists show them in his order with a **🧑‍⚖️ #1 · resolve first** chip. See [Jeff · Router](../automation/jeff-router.md#priority-which-escalation-first).
- The Project Coordinator is told about the team's escalations (batched a minute after the last one), so it can summarise them for you.

## Answering

On the card, as admin:

- **💬 Reply**: send an answer or a question back.
- **✅ Approve**: go ahead (pick an option first to fill in *Go with: …*).
- **❌ Reject**: no, with a reason.
- **✓ Noted**: for an FYI.

The answer goes to the agent as a prompt: *REPLIED*, *APPROVED*, *REJECTED* or *NOTED*.

- If it's **asking something in its terminal** (a permission prompt or a question, or it's still starting up), the answer isn't typed there, where Enter would pick one of the dialog's options and the answer would be lost. It waits, and goes in once that turn is over, with any other answers it's owed, in one message. The Activity says *… has a question open in its terminal: the answer goes in once that's answered*, and the answer counts as not delivered until then.
- If it's **asleep**, it's woken with your answer.
- If it was **benched**, its role gets the answer: in its current session, or by re-hiring it with your answer in its first message (when hiring is open).

Your answer goes through even when the floor's daily cost cap is reached: the cap holds the office's own prompts, not yours. See [Models and costs](models-and-costs.md#the-daily-cost-cap).

> [!NOTE]
> A Lead waiting on an open escalation of its own is never benched for idling. It is waiting on you, not idle.
