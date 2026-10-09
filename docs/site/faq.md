---
title: FAQ
description: Answers to the questions people actually ask - signing in, tokens, agents that stop, benched Leads, other floors, models, costs, restarts, the views, the live app, CI emails, Jeff, rankings and skills.
weight: 95
aliases: [/docs/questions]
---

## Getting in

### What's the office password, and where is it?

It's in `~/.agent-office-password` on the laptop. The launcher reads that file and gives it to the office. Ask whoever looks after the office if you don't have it. Never paste it in a chat or an issue.

### Who is the admin?

Anyone signed in with the shared office password is an admin: the **Project Manager**. Only admins can hire and bench, answer escalations and approvals, change settings, create projects and start the live app. See [Security & tokens](administration/security-and-tokens.md).

### I signed in but the page looks old. Why?

The browser kept the old version. Press **Ctrl+F5**.

### Why are the docs behind the sign-in?

They name token files, folders and ports. They use the same sign-in as the rest of the office.

## Tokens and GitHub

### Where do the GitHub tokens go?

In two files in your home folder, never in a repo:

- `~/.agent-office-gh-token`: the **agents' token** (fine-grained, owner AI-Taskforce-Labs, all repositories, Contents, Issues and Pull requests read and write);
- `~/.agent-office-admin-gh-token`: the **admin token**, only for the wizard creating repositories.

See [GitHub](integrations/github.md).

### Do I need to change the token for a new project?

No. The agents' token covers **all repositories** of AI-Taskforce-Labs, so a new repository is covered at once.

### Can the agents see the admin token or the Jev key?

No. The admin token is only passed to the one `gh repo create` the wizard runs. The Jev key variables are removed from every worker's environment.

### Why do I get GitHub emails about failed runs?

Either a project's **pr-checks** failed on a pull request, or the office's own fork failed its tests on `main`. The fork's workflow tests but never publishes. See [CI pipeline](integrations/ci-pipeline.md).

## Agents

### Why did my agent stop?

The usual reasons:

- **It finished its turn.** It shows as ✅ *finished, not looked at yet* in Needs you. Open it. (A turn the office started itself, or a team member's at autonomy 3 and up, finishes [quietly](concepts/workers-and-worktrees.md#quiet-turns): no Needs you item, just its card.)
- **It's asking you something.** 🙋 in Needs you. Answer in its terminal.
- **It's waiting on a setup prompt** (*trust this folder*). Open its terminal and accept once. The office marks the floors it manages trusted by itself, so a new project's agents shouldn't ask (see [Agents and GitHub](troubleshooting/agents-and-github.md#an-agent-waits-on-a-setup-prompt-trust--login)).
- **The office restarted.** On Windows that stops all agents. The ones cut off mid-turn resume when the office comes back; the rest stay asleep (💤) until prompted, or until you press **R** at their desk.
- **It was benched.** Hire it again from the Org chart.

See [Agents and GitHub](troubleshooting/agents-and-github.md).

### Why is my Lead benched?

Someone clicked **🪑 Bench**, or idle benching is turned on for the floor. Idle benching is **off by default** (0 minutes = only by hand). A benched Lead wrote a handoff note first. Click **🤝 Hire again** and it starts fresh from that note. See [Benching and handoffs](teams-and-agents/benching-and-handoffs.md).

### What is a benched Lead doing on the balcony?

Taking a break. In the 2D view benched Leads rotate between the TV, a smoke on the balcony and coffee. Click one to go to the Org chart.

### An agent says it's waiting on another floor. What does that mean?

The **🙋 N waiting on &lt;floor&gt; →** button means agents on another project need you. Click it to land on that floor's Command Center.

### How do I talk to an agent?

Click its card (anywhere: the board, Workers, the Org chart, the 2D view) to open its terminal and type. To talk to the team as a whole, use *Ask the Project Coordinator…* on the Command Center.

### What's the difference between the Project Manager and the Project Coordinator?

The **Project Manager** is you, the human. The **Project Coordinator** is an agent that keeps the plan, coordinates the Leads and runs the standup. See [The team model](teams-and-agents/team-model.md).

### How often will the agents interrupt me?

That's the **autonomy level**, per floor, in Settings. **2 Guided** is the default. Critical things (security, data loss, client milestones, budget overruns, blocked with no way forward) always reach you. See [Autonomy levels](teams-and-agents/autonomy.md).

### Can two agents edit the Mendix app at once?

No. Only the **Lead Developer** applies changes to the model; the others draft and check MDL. For parallel work, use another floor.

## Models and costs

### Which model should I pick?

**Sonnet 5.5** gave the best value in our runs, **Opus 5.5** the highest quality, and **Haiku 4.5** struggled with Mendix work. Check the [Analysis](using-the-office/model-analysis.md) tab for your own numbers. See [Models and costs](teams-and-agents/models-and-costs.md).

### Where do I see what it costs?

On every worker card (💵), the board's summary line, the Command Center (*$x today · $y all told*), and **Home → 📊 Statistics**.

### Can I cap spending?

Yes. In **⚙️ Settings › 👥 Team** (`/lite?tab=settings&section=team`), set a **daily cost cap** for each autonomy level. When the floor's day is spent, hiring pauses there until midnight (Singapore time).

## Running the office

### Is it safe to restart the office?

It's safe for your data, but on Windows **restarting stops every running agent**, even mid-task. The ones that were mid-turn resume from their saved sessions and carry on; the rest stay asleep until they're needed. Avoid restarting while agents are in the middle of something. See [Running the office](administration/running-the-office.md#restarting).

### How do I start it after a reboot?

Click the **Agent Office** icon on the desktop or taskbar, or ask Claude Code *"Run Agent Office"*. Keep the PowerShell window open.

### Can I try a change without risking the real office?

Yes: a [test office](administration/test-offices.md) on another port with its own data and throwaway floor clones. Never point it at a real floor folder.

## Views and the browser

### Where did the 3D office go?

The 3D and Retro views are removed. Every project opens on its **1D view**; **Go to Office** there shows the floor from above (the **2D Office view**), and **Return to Project** comes back. Old `/?view=3d` links open the 1D view. See [The two views](concepts/views.md).

### How do I switch to dark mode?

Click **🎨** in the top bar: Default → Dark → Terminal. It's remembered in this browser.

### Can I share a link to a tab?

Yes. The address says where you are, for example `/lite?floor=travel-approval&tab=standup`. See [URL parameters](reference/url-parameters.md).

## The live app

### Why isn't the live app running?

Live apps don't start by themselves. Open **🌐 Live app** and click **▶ Start** (admin only).

### It says "A required privilege is not held by the client".

Windows symlink rights. Create the junction mxcli names with `cmd /c mklink /J <link> <target>`, or turn on Developer Mode. See [Live app problems](troubleshooting/live-app.md).

### Does it update after a merge?

Yes, within about a minute of `main` moving.

## Jeff, rankings and skills

### Who is Jeff?

**Jeff · Router**, the office's quick judge, not an agent. He decides whether an agent that ended its turn is waiting on you, and which team a new issue is for. See [Jeff · Router](automation/jeff-router.md).

### Is Jeff acting on his own?

Only if you switch a judgement to **On**. By default both are **Shadow**: he judges and logs, and never acts.

### What data does Jeff send out?

With a Jev key, an agent's last message and new issues' text go to TypeSafe, with tokens redacted and clipped to 4000 characters. Without a key, the same goes to Claude Haiku.

### How are workers graded?

A to F from model benchmark (25%), delivery (30%), autonomy (25%) and token efficiency (20%). Team roles also have specialist duties worth 30%. See [Workers and rankings](using-the-office/workers.md).

### What are skills and gates?

Each team member's skills say what it may do (Manage up, Manage down, Craft), and the gate says how: **ask** you, **propose** for approval, **tell** the Coordinator, or **FYI**. Defaults follow the autonomy level; you can override them per member. See [Skills and gates](automation/skills.md).

### A subagent keeps getting its work sent back. What now?

Its grade drops and it's flagged 📉. Its Lead (or you) can warn it, swap its model, or bench it for the cool-down. See [Subagents](automation/subagents.md).

### Which escalation should I answer first?

The one with Jeff's **🧑‍⚖️ #1 · resolve first** chip. With **Priority** on (the default), Jeff rates each open escalation on how soon it matters, whether agents are stopped on it and how risky a delay is, and the lists (Escalations to you, Approvals, Needs you) are in his order. Older blockers climb. See [Jeff · Router](automation/jeff-router.md#priority-which-escalation-first).

## Oversight: chatter, the audit log and The Firm

### What is The Firm?

Independent **Reviewer Agents** at `/firm` that audit a project from outside its team: an Engagement Partner plus a reviewer per team, in an isolated clone, interviewing the Leads, ending in one report to you. See [The Firm](using-the-office/the-firm.md).

### What does an audit cost?

What you allow: the wizard shows an **estimate**, and the **budget cap** is enforced (warning at 80 %, wrap-up at 100 %, a partial report if it runs out). Reviewers default to Fable 5.1, $10 / $50 per million input / output tokens. Start with Quick depth, two reviewers and a $10 cap.

### Can a reviewer change the project or push?

No. It works in a local clone with no remote and no credentials, without the team's instructions, and deny rules block pushes and GitHub writes. See [Isolation](using-the-office/the-firm.md#isolation-no-shared-context-no-bias).

### Who can see what happened, and when?

Everyone signed in, on the **🧾 Audit log** tab of a project or /home. Admins can export it as CSV or JSONL. See [Audit log](using-the-office/audit-log.md).

### Does the audit log keep my prompts?

Only their length, unless an admin ticks **Log prompt text** (then the first 80 characters). Token values are never logged.

### What does "Chain broken" mean?

A line of the audit log was edited, removed or moved after it was written. Each line carries the hash of the one before it, so the badge shows where the chain stops matching.

### How do I see what the agents say to each other?

In the **📱 Team phone** at the bottom right of the 1D and 2D views: each project's channel has its team chatter (escalations, relays, standups, nudges, subagent tasks and reviews, handoffs, PR hand-overs, journal lines and The Firm's interviews). Filter by **Between agents**, **With me** or one person. See [Team phone](using-the-office/team-phone.md).

### Can I message an agent without opening its terminal?

Yes, from the **📱 Team phone**: a plain message in a project channel goes to the Project Coordinator, `@Name` to one agent, `@team` to every Lead, and a DM to that agent. It's typed in once the agent's current turn is over, and its reply comes back in the same thread. See [Sending messages](using-the-office/team-phone.md#sending-messages).

### Can the office look plainer, without emoji?

Yes: click **🎨** and pick **Clean (Light)** or **Clean (Dark)**. They look like VS Code's classic themes, hide every emoji and show line icons on buttons that only had one. See [Color themes](using-the-office/top-bar-and-menu.md#color-themes).
