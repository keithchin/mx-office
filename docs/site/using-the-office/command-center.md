---
title: Command Center
description: The default tab of a project - the Needs you strip, the project setup panel, the project summary, and the Project Coordinator console with escalations.
weight: 3
aliases: [/docs/command-center]
---

The **🎛️ Command Center** is the first tab of every project and the place to keep open. From top to bottom: **Needs you**, the **Project setup** panel (toolkit projects being set up), and the **project summary** with the **Project Coordinator console** in its middle.

![The Command Center](../images/command-center.png)

## 🚨 Needs you

Everything waiting for a human on this floor, most urgent first. It folds after five items (**Show N more ▾**). When it's empty it says *✅ Nothing needs you right now.*

| Icon | Item | Button |
|---|---|---|
| 🙋 | *&lt;name&gt; is asking: …* (a question or a permission prompt) | **Answer**: opens its terminal |
| ✅ | *&lt;name&gt; finished: &lt;summary&gt;, not looked at yet* | **Review**: opens its terminal |
| 🚩 | An escalation, tagged CRITICAL, URGENT, IMPORTANT or INFO | **Answer** (admin) or **View**: jumps to the card |
| 🔀 💸 🧰 📝 | An approval: a merge, a cost cap, a subagent action, a proposal | **Review**: opens Approvals |
| 💸 | *Hiring is paused* (the daily cap is spent) | **Settings** |
| ❌ | *PR #n has failing checks* | **Open PR #n** |
| ✋ | *Stage X waits for your sign-off* | **Sign off**: scrolls to the setup panel |
| 🌐 | *The live app failed* | **Live app** |
| 🌿 | A worktree was deleted outside the office | **Fix** |
| 🙋 | *N waiting on &lt;other floor&gt;* | **Go** |

**Finished, not looked at yet.** An agent that ended its turn and that nobody has opened since counts as waiting on you. Its worker card says *👀 Finished, not looked at yet: … open it to see*. Opening its terminal clears it.

**Answer → lands on the escalation in one step.** The list scrolls to the card, the card pulses, and its reply box gets the focus.

## 🧰 Project setup

Shown for toolkit projects until the build plan is confirmed.

- Chips for the entry mode (🧭) and the size tier (📏).
- Buttons **🧭 Entry mode**, **📝 Intake** and **👥 Team** reopen the wizard at that page. **🔄 Re-check gates** runs the toolkit's gate check again.
- The stages **P** Kickoff, **0** Triage & scope, **1** Analysis, **2** Requirements, **3** Architecture & design, **4** Build plan, each ✅ PASS, ⏳ PENDING, ⚠️ FAIL, ↷ WAIVED or ✋ MANUAL.
- *Next: …* and **❓ N open questions**.

See [The toolkit](../integrations/toolkit.md).

## The project summary

- **📍 Name**, the repo, and a **🌐 Live app** chip (it opens the Live app tab).
- The goal, and **🧭 phase** with stage dots and how many decisions are recorded.
- **What's happening**: a short story of the floor, written by Claude Haiku (*AI*) or put together by the office (*auto*).
- **Risks**: agents waiting on a human (and for how long), blocked or failing things.
- Progress bars for **issues**, **pull requests** and the **queue**, and **💰 $x today · $y all told on this floor**.
- **Agents (N)**, and **Recent activity** on the right.

## The Project Coordinator console

In the middle of the summary:

- The Coordinator's name, model, cost and state: *Not hired*, *Starting*, *Working*, *Needs you*, *Idle*, *Asleep*, *Writing handoff* or *Benched*. **⏰ Wake** and **⤢ Open** (its full terminal).
- Its **live terminal**, read-only. Watching it keeps the Coordinator from being benched for idling.
- **Ask the Project Coordinator…**: Enter sends, Shift+Enter adds a line, ↑/↓ recall what you sent. It confirms *Sent ✓*, or *Queued while busy ⏳* when the Coordinator is mid-turn.
- Quick chips: **📊 Status update**, **🚧 What's blocking?**, **🗺️ Plan next steps**, **📋 Run standup**.
- No Coordinator yet? **🤝 Hire Project Coordinator** (admin). Benched? Its latest handoff note and **🤝 Hire again**.

## 🚩 Escalations to you

Above the ask box: **Escalations to you (N open)**, with *N need you now* when any are urgent or critical.

![An escalation card](../images/escalations.png)

Each card shows:

- **who raised it**: the agent's 2D character, big, with its name and role title, and what it needs in a speech bubble beside it;
- the urgency tag (or FYI), the title, the trigger and how long ago;
- **Details** (expandable), the **options** (⭐ marks the recommended one; clicking one fills in *Go with: …*) and **Recommends: …**.

As admin you answer with a reply box and **💬 Reply**, **✅ Approve** or **❌ Reject** (reply and reject need text). An FYI gets **✓ Noted**. Answered cards fold into **Answered (N)**.

See [Escalations](../teams-and-agents/escalations.md).
