---
title: The building and its projects
description: One office, many projects - what a project is, what it owns, and how to move between projects.
weight: 1
---

## The building

The **building** (or *office*) is one Mx Office server. On the office laptop it runs at `http://127.0.0.1:4600` behind one password. Everything in it, every project and every agent, is one building.

Two things belong to the building rather than to a project: **🏛️ The Firm** at `/firm`, whose Reviewer Agents audit a project from outside its team (see [The Firm](../using-the-office/the-firm.md)), and the office-wide side of the **🧾 Audit log** (sign-ins, settings, projects added and removed).

## What a project is {#a-floor-is-a-project}

Each **project** is one GitHub repository, cloned on this machine. For us, that is one Mendix app in the **AI-Taskforce-Labs** organization, such as `mx-spike` (the SEA AI Hub) or `travel-approval`.

Each project has its own:

- **board** (GitHub issues and pull requests) and task **queue**;
- **workers** and **team** (Project Coordinator and Leads);
- **settings**: autonomy level, standup schedule, cost caps, Jeff;
- **live app**, run from its `main` branch;
- **Jeff · Router log** and analysis runs.

Projects don't share workers. To run two apps in parallel, use two projects. The rule *one writer per Mendix app* holds per project.

## Moving between projects {#moving-between-floors}

- **🏠 Home → 🏢 Projects**: every project as a card, with how many agents wait on you.
- The **project** picker in the top bar of the 1D and 2D views. A project with people waiting shows `· 🙋 N`.
- When an agent on another project starts waiting, you get a toast and a ding, and a **🙋 N waiting on &lt;project&gt; →** button. It lands on that project's Command Center.

## Adding and removing projects {#adding-and-removing-floors}

- **✨ New project** creates a new repository and project. See [Create your first project](../get-started/first-project.md).
- **➕ Add project** adds an existing repository.
- The office keeps the list of projects in `floors.json` in its data folder. See [Data locations](../administration/data-locations.md).

> [!WARNING]
> Each project keeps its own `workers.json` in `<project folder>/.agent-office/`. An office that points at a project folder restores and resumes that project's agents. Never point a test office at a real project folder. See [Test offices](../administration/test-offices.md).
