---
title: Quick start
description: Start the office, sign in, open a project, hire the team, give the first task and answer the first escalation.
weight: 2
aliases: [/docs/quickstart, /docs/start]
---

This page takes you from a machine where nothing is running to a team of agents working on a Mendix app. You need about 15 minutes.

## Before you begin

The office has to be set up on this machine once: the prerequisites (Node.js, Git, `gh`, Claude Code, Studio Pro, mxcli), the clone and build, and the office's **first-run setup** (the office password, the GitHub and Mendix tokens, the toolkit). [Set up on a new machine](new-machine.md) walks you through it in about 20 minutes. If the office already runs on this machine, carry on here.

> [!IMPORTANT]
> Never paste a token or the password into a chat, an issue or a file in a repo. The office keeps them itself, encrypted, in [🔌 Connections](../administration/connections.md). See [Security & tokens](../administration/security-and-tokens.md).

## Step 1: Start the office

1. Click the **Mx Office** shortcut on the desktop or in the Start menu (`scripts\install-shortcut.ps1` makes it), or run `.\scripts\start-office.ps1` in the office's folder. It opens the office in your browser, and starts it first if it isn't running.
2. A PowerShell window opens with the office in it. Leave it open. **Closing that window stops the office and all its agents.**

More options are on [Running the office](../administration/running-the-office.md).

## Step 2: Sign in

1. The launcher opens the office already signed in. Otherwise, open `http://127.0.0.1:4600` (or the port you started it on). You land on **/home**.
2. Type the office password. Anyone who signs in with it is an **admin**: the Project Manager.

> [!TIP]
> After an update, press **Ctrl+F5** once so the browser loads the new pages.

## Step 3: Open a project, or create one

On **🏠 Home → 🏢 Projects** every project is a card.

- **Open one:** click **🗂️ Board** on its card (the 1D view) or **🗺️ Office** (the 2D view).
- **Start a new Mendix app:** click **✨ New project**. The wizard creates the GitHub repo in the organization picked in the first-run setup (⚙️ Settings › 🔌 Connections › Run setup again changes it), adds it as a floor and sets up the toolkit. See [Create your first project](first-project.md).
- **Add an existing repo:** click **➕ Add project** and pick the repository.

## Step 4: Staff the team

1. In the project, open the **🏢 Org chart** tab.
2. Click **🤝 Hire** on the **🧭 Project Coordinator** card. Pick a model in the dropdown (Sonnet 5.5 is a good default). You can also type a first task.
3. Hire the Leads you need: 🎨 Lead Designer, 🛠️ Lead Developer, 🧪 Lead Tester, 📈 Chief Analyst. Each brings its own subagents.

New toolkit projects start with the **Chief Analyst** on a Discovery issue, so at first you may only need the Coordinator. See [The team model](../teams-and-agents/team-model.md).

![The org chart](../images/org-chart.png)

## Step 5: Give the first task

Work is a **GitHub issue**. Use one of these:

- **Ask the Coordinator.** On **🎛️ Command Center**, type in *Ask the Project Coordinator…* and press Enter. For example: *"Plan the first milestone and open issues for each team."*
- **Start an issue.** On **🗂 Board**, drag a card from **📌 Backlog** to **🤖 In progress** (the hire window opens: pick the model) or to **📋 Queued** (the next free agent takes it). The card's **▶ Start** and **📋 Queue** buttons do the same.
- **A new task.** Click **✨ New task** at the bottom of the 1D view.

## Step 6: Answer what needs you

Keep the **🎛️ Command Center** open. Its **🚨 Needs you** strip lists, most urgent first:

- an agent **asking** a question or for a permission (🙋 → **Answer** opens its terminal);
- an agent that **finished**, which nobody has looked at yet (✅ → **Review**);
- an **escalation** to you (🚩 → **Answer** jumps to the card);
- approvals, failing PR checks, a toolkit gate waiting for your sign-off, a failed live app.

Escalation cards show who raised them, their options and their recommendation. Click **💬 Reply**, **✅ Approve** or **❌ Reject**. The answer goes back to the agent as a prompt. See [Escalations](../teams-and-agents/escalations.md).

## Step 7: See the result

- Pull requests appear in **🔀 In review** on the board. Hover a card to see its CI **scorecard**. See [CI pipeline](../integrations/ci-pipeline.md).
- After a merge, the **🌐 Live app** tab runs the app from `main`. The first time, click **▶ Start** (admin). See [Live app](../using-the-office/live-app.md).

## Next steps

- Decide how often agents should ask you: [Autonomy levels](../teams-and-agents/autonomy.md).
- Learn every screen: [A tour of the office](tour.md).
- Bookmark the [FAQ](../faq.md).
