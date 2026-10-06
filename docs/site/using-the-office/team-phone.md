---
title: Team phone
description: The floating chat and notification centre on the 1D and 2D views - each project's team chatter as a channel, DMs with the agents, threads, messaging the team, and everything that needs you as notifications with their buttons.
weight: 3.5
---

The **📱 Team phone** is the round button at the bottom right of the 1D and 2D views, above the bar with Issues, PRs, Queue and New task (on the 2D view, above the zoom buttons). It's on every tab. It holds the team chatter, lets you message the agents, and is where everything that needs you arrives. It isn't in the 3D office.

- In the **Default** theme the button is a little pixel-art iPhone, and the window is a pixel iPhone too: a chunky frame, the notch, a status bar with the time and battery, and the home bar. The messages keep the normal, readable font.
- In **Dark**, **Terminal**, **Clean (Light)** and **Clean (Dark)** it's a round button with a messages icon, and the window is a plain chat window in the theme's colors.

**The badge.** A **red number** counts what needs you: this floor's Needs-you items plus everyone waiting on your other floors. With nothing red, a **grey dot** means messages you haven't read. Each channel in the list shows the same: red for what needs you there, grey for unread.

Click it (or Tab to it and press Enter) to open the phone; **✕** or **Esc** closes it, and this browser remembers whether you left it open. **⤢** widens it, with the channel list beside the chat. On a phone it takes the whole screen.

## Channels

The first screen is the list, like Slack's:

| Row | What it is |
|---|---|
| **! Needs you** (pinned) | Every Needs-you item on this floor, most urgent first, with its buttons, and the other floors where someone waits. The same list as the Command Center's, from the same rules. |
| **All projects** | Every floor's chatter in one stream, each message tagged with its floor. Read only: open a project's channel to write. |
| **# &lt;project&gt;** | One channel per floor: that floor's team chatter. |
| **Direct messages** | One per agent on the floor you're on, with its status dot (blue working, green between turns, red asking you, grey asleep), *working…* while it's mid-turn. |

In a project channel:

- The **team chatter** as messages: the speaker's face, name and role, the time, and who it was said to (*to Hedy*, *to you*, *to the team*). Nothing is made up: escalations and answers, relays to the Coordinator, standups, review nudges, subagent tasks and verdicts, handoff notes, journal entries, The Firm's interviews, and your messages and the agents' replies.
- **Threads**: an escalation and its answers, or a conversation you started, show once in the channel with **N replies**; click it to read the back-and-forth and reply there. A message with no replies yet has **Reply in thread**.
- **Notifications**: on your floor, the Needs-you items are messages in the channel too, from **Jeff** (escalations, with his priority: *answer this one first*, *#2 on my list*) or **the office** (everything else).
- The filters as chips: **All**, **Between agents**, **With me**, or one person. Opened from a team page, a team chip (*design ✕*) shows only that team's members.
- *Hedy is working…* under the messages while an agent is mid-turn, and *Keith is working on your message…* once yours has gone in.
- Replies and the agents' own messages have **Open terminal** and **Open Chat view** (its conversation, read off its transcript, in a window of its own).

Other floors' channels are looked at again every 45 seconds; your floor's arrive as they're said.

## Sending messages

The box at the bottom of a channel, a DM or a thread. **Enter** sends, **Shift+Enter** starts a new line. The line above the box says where it goes before you send.

| You write | It goes to |
|---|---|
| A plain message in a project channel | That floor's **Project Coordinator**. With no Coordinator at work, the **Chief Analyst**, else any Lead, else any agent, and the phone says so (*This floor has no Project Coordinator at work, so it went to Ada*). |
| `@Name …` | That agent. Typing `@` offers the floor's agents and `@team`: ↑ ↓ to pick, Enter or Tab to take it. |
| `@team …` | Every active Lead. A warning shows before you send: *⚠️ This wakes 4 agents (≈4 turns)*. |
| Anything in a **DM** | That agent. |
| Anything in a **thread** | The agents in that thread. |
| Anything in an **escalation's** thread | It **answers the escalation** (as your reply), exactly as the Approvals and the console do. Its **Approve** and **Reject** buttons are there too. Admins only. |

**How it's delivered.** Through the same path as the office's own prompts, so it's never typed into a dialog: it waits until the agent's current turn is over (an agent asking something in its terminal gets it after that's answered), and an asleep agent is woken with it. It's typed as yours (*last typed by* you), so the turn it starts is a person's: it flags as done when finished, and it goes through even when the floor's daily spend cap is reached (the cap only stops the office's own prompts). The phone tells you *Held for Keith: it's typed once its turn is over* when it has to wait.

**The reply.** Once the agent finishes the turn that read your message, its reply (the text it wrote after your message, Markdown kept, without tool calls or their output) is posted in the same thread or DM. It's read from the agent's Claude Code transcript; for an agent without one (Codex, OpenCode…), the office says *&lt;name&gt; replied in its terminal → Open it to read the answer* instead.

Everything you send is a real chatter message from you, kept with the floor's chatter (`<office data>/chatter/<floor>.jsonl`), so it's in the Command Center's history, the audit of the turn and the team pages' counts.

**What a message costs.** Each message is one turn of the agent it goes to (a few cents to a dollar or so, like any prompt you type into its terminal); `@team` is one turn per Lead. Reading the reply costs nothing: it's read from the transcript on the office's machine, with no model call.

## Notifications

Everything in [Needs you](command-center.md#needs-you) arrives in the phone: agents asking in their terminal (*Keith is asking in its terminal: … → Open terminal*), escalations, approvals, the spend cap (**Raise cap** opens Settings), failing PR checks (**Merge…** and **Review** open the PR window), the Studio Pro commit nudge, The Firm's report, setup stages waiting for your sign-off, and a floor folder far behind main.

Answering from the phone is answering: an escalation approved, rejected or replied to here is resolved for everyone, and Needs you, the Approvals tab and the console's escalation list follow at once.

**Desktop alerts and sound** go off only for red items, and only while the office isn't the tab you're looking at. Agents asking and finishing, and urgent escalations, alert as they always did; the phone adds the rest (a failing PR, the spend cap, a sign-off…). A turn the office started never alerts (see [quiet turns](../concepts/workers-and-worktrees.md#quiet-turns)).

## Phone settings

The **⚙** in the phone's header (kept in this browser):

- **Do not disturb**: off, until you turn it off, for 1 hour, or until 9:00 tomorrow. No desktop alerts and no sound meanwhile; the badge still counts. The phone's header says *Do not disturb until …*.
- **Digest**: bundle the alerts that aren't urgent into one notification every 15, 30 or 60 minutes. Urgent ones (an agent stopped on a question, a critical escalation, the spend cap) still come at once.
- **Sound**: a short sound with an alert (on by default).
- **Desktop notifications**: turn them on in this browser, or why they can't be.

**What you've read** is kept by the office per person (your account, or this browser on the shared password), so the counts survive a reload and follow your account to another browser.

## On your phone

The same phone, full screen and installable on an iPhone's home screen with push notifications, is the [phone version](phone-version.md) at `/m`; from outside the office's network, through [📱 Phone access](../administration/phone-access.md).

## From elsewhere

- The Command Center's **Needs you** row opens the phone at Needs you.
- Each team's page on [Team boards](team-boards.md) has **Open in the team phone →**, which opens the project channel filtered to that team.
