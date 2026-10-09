---
title: A tour of the office
description: What is on the home page, the top bar and each tab of a project, and which view to use for what.
weight: 4
---

This page shows where everything is. Each screen has its own page under [Using the Office](../using-the-office/_index.md).

## The pages

| Address | What it is |
|---|---|
| `/home` | Every project as a card, office-wide **📊 Statistics**, a **🗺️ 2D Overview** of all floors, and the **🧾 Audit log** of the whole office. See [Home](../using-the-office/home.md). |
| `/lite?floor=<id>` | The **1D view** of one project, with a tab for everything. The default and most useful view. |
| `/pixel?floor=<id>` | The **2D Office view**: the floor from above in pixel art, opened from the 1D view's **Go to Office**. See [2D Office view](../using-the-office/2d-view.md). |
| `/firm` | **🏛️ The Firm**: independent Reviewer Agents that audit a project and report to you. See [The Firm](../using-the-office/the-firm.md). |
| `/docs` | These docs. |

## The top bar

On the 1D view: the launcher, **Mx Office**, the project, the search, **Go to Office**, the bell, help, dark mode, **🎨** (color theme) and your avatar (the **☰** menu). The 2D Office view has the same bar with **OFFICE · &lt;project&gt;** and **Return to Project**. See [Top bar & menu](../using-the-office/top-bar-and-menu.md).

## The tabs of a project (1D view)

| Tab | Use it to… |
|---|---|
| 🎛️ **Command Center** | See what needs you, the project summary and recent activity, and talk to the Project Coordinator. The team chatter is in the 📱 Team phone at the bottom right. The default tab. |
| 🗂 **Board** | Move work along the Kanban, from issue to merged PR. |
| 🧩 **Team boards** | One board per team, with its Lead, journal and team panels. |
| 🤖 **Workers** | See every agent, ranked A–F. |
| 📊 **Analysis** | Compare models, and see Jeff · Router's judgements. |
| 🌐 **Live app** | Run the app built from `main` and click through it (admin). |
| 🌳 **Git** | The branch map: every branch and PR as a railway line. |
| 📐 **Model** | The Mendix app as Studio Pro shows it (App Explorer, domain models, microflows) on main or any branch, and what a branch changed. See [Model tab](../using-the-office/model.md). |
| 🏢 **Org chart** | Hire, wake, bench, rename and change the model of the team; skills and subagents. |
| 📋 **Standup** | The daily standup and its proposals. |
| ✅ **Approvals** | Everything waiting for the Project Manager. |
| ⚙️ **Settings** | Autonomy, benching, review loop, standup time, cost caps, Jeff. |
| 🧾 **Audit log** | Who did what, when: hires, prompts, escalations, approvals, GitHub, settings and sign-ins. See [Audit log](../using-the-office/audit-log.md). |

> [!TIP]
> The address says where you are: `/lite?floor=travel-approval&tab=standup`, or `&tab=teams&team=testing`. Bookmark or share it. See [URL parameters](../reference/url-parameters.md).

## Which view when?

- **1D** for daily work. It shows the most, on any screen, phone included.
- **2D** to see who is busy at a glance, with a team-room feel. **N** jumps to the next agent that needs you.
- **3D** and **Retro** for fun and demos. They need a good GPU.

![The 2D view](../images/office-2d.png)
