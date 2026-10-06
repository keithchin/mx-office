---
title: Command Center
description: The default tab of a project - The Firm strip, the Needs you row, the project setup panel, and the project summary with the Project Coordinator console and its escalations, fitted to a laptop screen.
weight: 3
aliases: [/docs/command-center]
---

The **🎛️ Command Center** is the first tab of every project and the place to keep open. From top to bottom: **The Firm** strip, **Needs you** (one row), the **Project setup** panel (toolkit projects being set up; one line once its gates are fine), and the **project summary** with the **Project Coordinator console** in its middle and **Recent activity** beside it. The team chatter is in the [📱 Team phone](team-phone.md) now.

**It fits the screen.** On a desktop window (at least 1024 × 560 px) the Command Center is a fixed-height layout: the page doesn't scroll, and neither does any column. Needs you and the folded setup line share one row, and the summary's three columns (the project, the console, recent activity) take exactly the height that's left above the bottom bar. Each card scrolls inside its own frame when it has to, with a thin scrollbar in the theme's colors: **What's happening** and **Agents** keep their height while there's room and give it up in proportion when there isn't, **Progress** keeps its rows, each risk is one line (hover for all of it), and Recent activity's list scrolls in its box. In the console, its chat or terminal fills the middle and is the only thing there that scrolls; the escalation cards sit behind a one-line bar (*🚩 2 escalations to you · 1 needs you now* **Show ▾**) and, shown, take the screen's place until **Back to the chat ▴** (this browser remembers which; **Answer** in Needs you shows them). Each section of the summary (**What's happening**, **Progress**, **Agents**, **Recent activity**) folds with a click on its heading, and a folded one gives its room to the others. On a short window (under 820 px) the setup panel starts folded even with a failing gate (its line says so in red); opened, its own frame scrolls. A phone or a narrow window stacks everything and the page scrolls as usual.

![The Command Center](../images/command-center.png)

## 📑 The Firm strip

A slim strip at the top: **📑 Call an audit** and **The Firm →** when no audit is running (calling one is for admins); *The Firm is auditing this project: N reviewers · $spent of $cap · phase* with **View →** while one runs (amber at 80 % of the budget); **📑 Audit report ready from The Firm → Read** when it's delivered. See [The Firm](the-firm.md).

## 🚨 Needs you

Everything waiting for a human on this floor, as **one row of counts** (*🚩 2 escalations · 🙋 1 asking · ❌ 1 failing PR*, red for what blocks something) and **Open in the team phone →**. Any count opens the phone's pinned **Needs you** section, which has the full list, most urgent first (escalations in Jeff's order when his [priority sort](../automation/jeff-router.md#priority-which-escalation-first) is on), with each item's button. When nothing is waiting it says *✅ Nothing needs you right now.* (A view without the phone shows the list here, folded after five items.)

The items, and their buttons in the list:

| Icon | Item | Button |
|---|---|---|
| 🙋 | *&lt;name&gt; is asking: …* (a question or a permission prompt) | **Answer**: opens its terminal |
| ✅ | *&lt;name&gt; finished: &lt;summary&gt;, not looked at yet* (not for a [quiet turn](../concepts/workers-and-worktrees.md#quiet-turns): one the office started, or a team member's at autonomy 3 and up) | **Review**: opens its terminal |
| 🚩 | An escalation, tagged CRITICAL, URGENT, IMPORTANT or INFO | **Answer** (admin) or **View**: jumps to the card |
| 🔀 💸 🧰 📝 | An approval: a merge, a cost cap, a subagent action, a proposal | **Review**: opens Approvals |
| 💸 | *Spend cap reached: office prompts paused; agents finish their current turn* (the daily cap is spent) | **Settings** |
| ❌ | *PR #n has failing checks* | **Open PR #n** |
| ✋ | *Stage X waits for your sign-off* | **Sign off**: scrolls to the setup panel |
| 🌿 | *This floor's folder is on &lt;branch&gt;, N commits behind main* (only past 10 commits; last of this floor's items) | **Setup** |
| 🌐 | *The live app failed* | **Live app** |
| 🌿 | A worktree was deleted outside the office | **Fix** |
| 🙋 | *N waiting on &lt;other floor&gt;* | **Go** |
| 📑 | *Audit report ready from The Firm* (and The Firm's budget warnings) | **Read** |

**Finished, not looked at yet.** An agent that ended its turn and that nobody has opened since counts as waiting on you. Its worker card says *👀 Finished, not looked at yet: … open it to see*. Opening its terminal clears it.

**Answer → lands on the escalation in one step.** The list scrolls to the card, the card pulses, and its reply box gets the focus.

## 🧰 Project setup

Shown for toolkit projects until the build plan is confirmed. **Once its gates are fine** (no stage failing or waiting for a sign-off, the folder not behind main) it **folds to one line**: *🧰 Project setup · 3 passed · 3 pending · next: stage 3* with **Show ▾**. **Hide ▴** folds it whatever the gates say; this browser remembers your choice.

- Chips for the entry mode (🧭) and the size tier (📏).
- Buttons **🧭 Entry mode**, **📝 Intake** and **👥 Team** reopen the wizard at that page.
- **The stages are read from the project's default branch on GitHub** (`origin/main`, from `origin/HEAD`, else `main` or `master`), not from whatever branch the floor's folder is on: `PROJECT.md`, `intake.md`, `triage.md` and the gate dashboard `index.html`, after a quiet `git fetch` at most every 90 seconds. A committed `index.html` is often stale, so whenever `origin/main` moves (a pull request merged) the office runs the toolkit's `gate-check.sh` on it in a temporary detached worktree, with the floor's `toolkit.env`, and deletes the worktree afterwards: at most once every three minutes per floor, one at a time, five minutes at most. The floor's folder is never written to.
- When the folder isn't on the default branch, or is behind it, the panel says so: *This folder is on run4/discovery-p-4, 23 commits behind main; the stages below are read from main.* More than 10 commits behind also puts a 🌿 item in Needs you.
- **🔄 Re-check gates** (admins only) runs that gate-check now. A project with no remote is read from the floor's folder as before, and Re-check runs `gate-check.sh` there (it rewrites `index.html` and the *Current stage* line in `PROJECT.md`, left uncommitted). It doesn't change answers or decisions, start agents or push anything. **ℹ️ What does Re-check gates do?** under the panel says the same.
- The stages **P** Kickoff, **0** Triage & scope, **1** Analysis, **2** Requirements, **3** Architecture & design, **4** Build plan, each ✅ PASS, ⏳ PENDING, ⚠️ FAIL, ↷ WAIVED or ✋ MANUAL.
- *Next: …* and **❓ N open questions**.
- **📦 Deliverables**: per stage, how many expected deliverables are on main (and how many only on a branch or drafts), and **Open deliverables →** for every team's list. See [Deliverables](deliverables.md).

See [The toolkit](../integrations/toolkit.md).

## The project summary

- **📍 Name**, the repo, a **🌐 Live app** chip (it opens the Live app tab) and, for a Mendix project, **Open in Studio Pro** (see below).
- **▶ Resume project** and **⏸ Pause project** (admins), the floor's pause when it has one (*⏸ Paused by Keith at 14:05 · 2 waiting on you*), and a progress chip while a resume or a pause is running. See [Resume and pause](resume-and-pause.md).
- The goal, and **🧭 phase** with stage dots and how many decisions are recorded.
- **What's happening**: a short story of the floor, written by Claude Haiku (*AI*) or put together by the office (*auto*).
- **Risks**: agents waiting on a human (and for how long), blocked or failing things.
- Progress bars for **issues**, **pull requests** and the **queue**, and **💰 $x today · $y all told on this floor**.
- **Agents (N)**, and **Recent activity** on the right: the newest 8, with **More (N) ▾** for the rest.

## Open in Studio Pro

For a floor with a Mendix project, **Open in Studio Pro** in the summary's heading (and ☰ → 🧱 **Open in Studio Pro**, on every view) opens the floor's `.mpr` in Studio Pro **on the office's computer**. It's the project in the floor's own checkout (at its top or one folder down), not the live app's clone.

- **Admins only.** Everyone else sees it greyed out. It's hidden on a floor without a `.mpr`.
- **A confirm first.** Studio Pro locks the project while it's open, and the agents write it with `mxcli exec` (one writer per app: the Lead Developer). The confirm says the office pauses their mxcli writes automatically while Studio Pro is open (see [Studio mode](#studio-mode)), and lists the agents on the floor in the middle of a turn. Let them finish their turn before you change anything in Studio Pro.
- It goes through Mendix's **Version Selector**, which starts the Studio Pro version the project was saved in (*Opening in Studio Pro 11.6.4…*). Without the Version Selector, the `studiopro.exe` of that version under `C:\Program Files\Mendix` (never another version: it would offer to convert the project).
- Opening it is written in the [Audit log](audit-log.md) (`studio.open`, under *Workers*), said in Team chatter, and toasted to everyone on the floor.
- It can't open when the office isn't on Windows, runs without a desktop (over SSH, in CI, headless), or Studio Pro isn't installed: the button is greyed out and says why.

### Studio mode

The office looks for itself whether Studio Pro has the floor's project open, however it was opened (the button, the Version Selector, Studio Pro's own start page), every 4 seconds, for floors with a `.mpr` only. While it's open, the floor is in **Studio mode**:

- Beside the button, a chip says **Studio Pro open · mxcli paused** (with **· MCP** when Studio Pro's MCP server answers), and the button turns into a greyed-out **Studio Pro is open**. Hover either for since when, and the process.
- **The agents' model writes are held.** Every Claude worker on the floor has a PreToolUse hook for Bash (`bin/studio-guard.js`) that denies `mxcli exec`, `fix`, `layout`, `rename`, `widget sync`, `theme switcher install`, an `mxcli -c` with a statement that writes, the mxcli REPL, the toolkit's `bin/exec.sh` and `bin/restore-mpr.sh`, its `wf-*.py` patches and `mx update-widgets`/`convert`, from the floor's checkout or any worktree. The agent is told why (*Studio Pro has &lt;app&gt; open… Don't write to the model with mxcli*) and to work on reviews, tests or docs, or escalate, meanwhile. Reads (`mxcli check`, `lint`, `report`, `show`, `describe`, `diff`, `--dry-run`) and `bin/verify-model.sh` still run. Each held write is in the Audit log (`studio.denied`, under the agent's name).
- **Through Studio Pro instead.** On Mendix 11.10 and up, Studio Pro serves MCP at `http://localhost:7782/mcp` (`AGENT_OFFICE_STUDIO_MCP_PORT` or `AGENT_OFFICE_STUDIO_MCP_URL` to change it). When it answers, the agents are told to route their writes through it with `mxcli --mcp http://localhost:7782/mcp …`, which the hook lets through: Studio Pro makes the change itself.
- It's said once in Team chatter (*Studio Pro is open on &lt;app&gt; — mxcli writes paused*, and *Studio Pro closed — mxcli writes allowed again*), toasted, and written in the Audit log (`studio.opened`, `studio.closed`).
- **When Studio Pro closes**, writes are allowed again. If the checkout then has model changes nobody committed (the `.mpr` or `mprcontents/`), **Needs you** says *Commit your Studio Pro changes so the agents build on them* until they're committed.
- **Stale lock.** Studio Pro writes `<app>.mpr.lock` (with its process id) and leaves it behind when it closes. A lock whose Studio Pro isn't running is written in the Audit log (`studio.stale-lock`) and mentioned in the open confirm, but gets no chip on the Command Center (most Mendix floors have one) and writes aren't paused for it.

How it knows: a `studiopro.exe` whose command line names the `.mpr` (or its folder), or the lock's process id being a running `studiopro.exe`. Windows only: elsewhere there's no Studio Pro to see. What changed is kept in the floor's `.agent-office/studio-mode.json`, so a restart picks up where it was (a Studio Pro that closed while the office was down is a `studio.closed` on the first look). While Studio mode is on, the office keeps `.agent-office/studio-open.json` in the floor's checkout: that's what the hook reads. Workers started before this version get the hook when they're next started or resumed, and agents other than Claude Code aren't held.

## 💬 Team chatter

The team chatter moved into the [📱 Team phone](team-phone.md) (bottom right), where each project is a channel, escalations and conversations are threads, and you can message the agents. Nothing was dropped: the same messages, filters (**All**, **Between agents**, **With me**, one person) and history, kept in `<office data>/chatter/<floor>.jsonl` (the newest 1000 per floor).

## The Project Coordinator console

In the middle of the summary:

- The Coordinator's name, model, cost and state: *Not hired*, *Starting*, *Working*, *Needs you*, *Idle*, *Asleep*, *Writing handoff* or *Benched*. **Chat | Terminal**, **⏰ Wake** and **⤢ Open** (its full terminal).
- Its screen, in one of two views (**Chat** unless you changed it). Watching it keeps the Coordinator from being benched for idling.
  - **Chat**: the conversation as messages. Your prompts on the right; its replies on the left with its icon and color, in Markdown (bold, lists, links, `code`, code blocks that scroll inside their box); each tool call as one quiet line with ✓, ✗ (and why it failed) or … while it runs (*Ran git log --oneline -5*, *Read plan.md*), runs of edits, reads or searches folded into one (*Edited 3 files*, click to open). A question it asks you (AskUserQuestion), or a permission it wants, is a highlighted card with **Open terminal to answer**: you answer in its terminal, never from the chat. Three dots and what it's doing show while it works. The newest 200 rows are shown, with **Show earlier** above them.
  - **Terminal**: its live terminal, read-only, as it is.
- Chat reads the Coordinator's Claude Code session transcript, which the office tails on its own machine and sends only to the browsers showing it. What a tool printed or read (a file's contents, a command's output) never leaves the office: only a line of why a tool failed. A Coordinator on another agent (Codex, OpenCode…), or one whose transcript isn't known yet, shows its terminal's text in Chat instead, under *Chat view needs Claude Code transcripts; showing terminal text*.
- Which view it opens in is yours alone, kept in this browser: the toggle (← → on the keyboard), or **Command Center terminal** in ⚙️ Settings › 🧍 You (`/lite?tab=settings&section=you`) or the 3D office's ⚙️ Settings › You.
- **Ask the Project Coordinator…**: Enter sends, Shift+Enter adds a line, ↑/↓ recall what you sent. It confirms *Sent ✓*, or *Queued while busy ⏳* when the Coordinator is mid-turn.
- Quick chips: **📊 Status update**, **🚧 What's blocking?**, **🗺️ Plan next steps**, **📋 Run standup**.
- No Coordinator yet? **🤝 Hire Project Coordinator** (admin). Benched? Its latest handoff note and **🤝 Hire again**.

## 🚩 Escalations to you

Above the ask box: **Escalations to you (N open)**, with *N need you now* when any are urgent or critical.

![An escalation card](../images/escalations.png)

When Jeff's **Priority** is on (the default) and he has rated them, the open cards are in his order under *Sorted by Jeff · Router — resolve from the top*, each with a chip beside it: **🧑‍⚖️ #1 · resolve first**, **#2**, **#3**… (hover for why). A critical or urgent one he hasn't rated yet stays on top. See [Jeff · Router](../automation/jeff-router.md#priority-which-escalation-first).

Each card shows:

- **who raised it**: the agent's 2D character, big, with its name and role title, and what it needs in a speech bubble beside it;
- the urgency tag (or FYI), the title, the trigger and how long ago;
- **Details** (expandable), the **options** (⭐ marks the recommended one; clicking one fills in *Go with: …*) and **Recommends: …**.

As admin you answer with a reply box and **💬 Reply**, **✅ Approve** or **❌ Reject** (reply and reject need text). An FYI gets **✓ Noted**. Answered cards fold into **Answered (N)**.

See [Escalations](../teams-and-agents/escalations.md).
