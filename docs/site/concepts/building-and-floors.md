---
title: The building and its projects
description: One office, many projects - what a project is, what it owns, and how to move between projects.
weight: 1
---

## The building

The **building** (or *office*) is one Mx Office server. On the office laptop it runs at `http://127.0.0.1:4600` behind one password. Everything in it, every project and every agent, is one building.

Two things belong to the building rather than to a project: **🏛️ The Firm** at `/firm`, whose Reviewer Agents audit a project from outside its team (see [The Firm](../using-the-office/the-firm.md)), and the office-wide side of the **🧾 Audit log** (sign-ins, settings, projects added and removed).

## What a project is {#a-floor-is-a-project}

Each **project** is one Mendix app in one git repository, cloned on this machine: for example `acme-visitor-registration` for Acme Logistics' visitor app.

- **Usually the repository is on GitHub.** The office reads its issues and pull requests with `gh`, and agents open pull requests there.
- **A local-only project** (✨ New project › Advanced › *Keep this project off GitHub*) has its `origin` in a bare repository on this machine instead. The office refuses every GitHub call for it, and the Lead merges into `main` locally. See [Local only](../get-started/first-project.md#local-only-not-on-github).
- **On Mendix Team Server** (✨ New project › Advanced › *Where the code lives*, or ⚙️ Settings › ☁️ Team Server › Connect for a local-only project): the office creates the app in the Mendix Portal and pushes the project's main to its Team Server repository after every merge. Without the GitHub mirror it's local only too (no pull requests); with it, GitHub carries the pull requests. See [On Mendix Team Server](../get-started/first-project.md#on-mendix-team-server).

Each project has its own:

- **board** (GitHub issues and pull requests; none for a local-only project) and task **queue**;
- **workers** and **team** (Project Coordinator and Leads, or a smaller [team shape](../teams-and-agents/team-shapes.md));
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

## See also

- [Architectural concepts](../architecture/_index.md) and [Components](../architecture/components.md): what runs where, and which store owns what.
- [State and truth](../architecture/state-and-truth.md).
