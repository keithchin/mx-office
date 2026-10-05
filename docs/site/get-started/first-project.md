---
title: Create your first project
description: Use the ✨ New project wizard to create a GitHub repo in AI-Taskforce-Labs, add it as a floor, set up the mxcli-project-toolkit and queue the Chief Analyst.
weight: 2
---

The **✨ New project** wizard on **/home** turns a few answers into a ready project: a private GitHub repository, a floor in the office, the toolkit's scaffold, recorded decisions and a Discovery issue for the Chief Analyst.

> [!NOTE]
> Only an admin (the Project Manager) can create a project. The wizard uses a separate **admin token** that can create repositories: `~/.agent-office-admin-gh-token`. The agents never see it. See [Security & tokens](../administration/security-and-tokens.md).

![The new-project wizard](../images/wizard.png)

## Open the wizard

Go to **🏠 Home → 🏢 Projects** and click **✨ New project**. This browser tab keeps your answers while you work, so a reload doesn't lose them.

## Page 1: Project

- Choose **✨ A new project**, or **🛠️ Changes to an existing app** (then pick its repository).
- **Name**: becomes the repository name, in lower case with dashes.
- **Owner organization**: `AI-Taskforce-Labs` by default.
- **Description**, **Private repository** (on by default), and the **Mendix (Studio Pro) version** (11.6.4 is preferred).
- Tick **I created this repository myself** if you made the repo by hand. The wizard then only checks that it exists.

## Page 2: Entry mode

Pick how the project starts. The toolkit adapts its stages to it.

| Entry mode | When |
|---|---|
| 🌱 Greenfield | A new app from an idea. |
| 📄 Requirements-driven | You already have requirements or a BRD. |
| 🛠️ Change an existing app | Changes to an app that exists. |
| 🚚 Migration | Moving an app from another platform. |
| 🔎 Assurance only | Review and test an app; no building. |

Then pick the **size tier**: 🐣 **Small** (at most 1 module, 8 screens and 25 use cases) or 🏗️ **Standard**.

## Page 3: Intake

The toolkit's kickoff questions, as a form. Mark each answer **Answered**, **Assumed** or **Unverified**. The wizard fills in three for you: Q1 (entry mode), Q9 (interview mode: attended or unattended) and Q11 (exec approval: auto or ask).

## Page 4: Client & team

- **Client name(s)** and **Operator(s)**.
- **Roles to staff**: all five are ticked.
- **Discovery**: open a *Discovery* issue for the Chief Analyst (on by default). Tick **Queue it now for an agent** to start it straight away, and pick its model (Opus by default).

## Page 5: Review & create

Check the summary and click **✨ Create project**. A progress list runs each step. Every step can be retried, and a step that is already done is skipped.

1. Create the GitHub repository (`gh repo create`, private, with the admin token).
2. Clone it as a floor.
3. Write `.claude/toolkit.env` (MXBUILD_PATH, mxcli nightly, Python).
4. Run the toolkit's `init-project.sh`.
5. Install the pre-commit hook.
6. Write the intake answers to `intake.md`.
7. Record decisions in `PROJECT.md`: entry mode, size tier, Mendix version and interview mode, each `CONFIRMED` with today's date.
8. Save the client, operator and role settings in `agent-office.project.json` at the project's root. It is committed with the project, so every office that opens it sees the same client and team.
9. Refresh the gate dashboard (`gate-check.sh`).
10. Commit and push.
11. Open the Discovery issue: *"Discovery: kickoff with the client (Stages P → 4)"*.
12. Queue the Chief Analyst (when you ticked it).

If a step fails, fix the cause and click **🔁 Retry from the failed step**. **✏️ Edit answers** goes back to the form. When it's done, click **🗂️ Go to the floor**.

## After the wizard

The new floor's Command Center shows a **🧰 Project setup** panel with the toolkit's stages **P** to **4**. Each one is ✅ PASS, ⏳ PENDING, ⚠️ FAIL, ↷ WAIVED or ✋ MANUAL, and a ✋ stage waits for your sign-off. The panel goes away once Stage 4 (the build plan) is confirmed. See [The toolkit](../integrations/toolkit.md).

![The project setup panel](../images/setup-panel.png)

> [!TIP]
> The Discovery brief tells the Chief Analyst to stop at the ✋ gates 0, 3 and 4, and to record `CONFIRMED` only when the client says so. You confirm by answering its escalations.

## Add an existing repository instead

**➕ Add project** opens *Add a project*. Search your repositories or type `owner/name`. The office clones it with its own `gh` login and opens it as a floor. Admins can choose the folder with **📁 Change folder**.
