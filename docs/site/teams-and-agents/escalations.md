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

- If it's **asleep**, it's woken with your answer.
- If it was **benched**, its role gets the answer: in its current session, or by re-hiring it with your answer in its first message (when hiring is open).

> [!NOTE]
> A Lead waiting on an open escalation of its own is never benched for idling. It is waiting on you, not idle.
