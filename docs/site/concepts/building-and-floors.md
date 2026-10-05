---
title: The building and its floors
description: One office, many projects - what a floor is, what it owns, and how to move between floors.
weight: 1
---

## The building

The **building** (or *office*) is one Agent Office server. On the Taskforce laptop it runs at `http://127.0.0.1:4600` behind one password. Everything in it, every project and every agent, is one building.

Two things belong to the building rather than to a floor: **🏛️ The Firm** at `/firm`, whose Reviewer Agents audit a floor from outside its team (see [The Firm](../using-the-office/the-firm.md)), and the office-wide side of the **🧾 Audit log** (sign-ins, settings, floors added and removed).

## A floor is a project

Each **floor** is one GitHub repository, cloned on this machine. For us, that is one Mendix app in the **AI-Taskforce-Labs** organization, such as `mx-spike` (the SEA AI Hub) or `travel-approval`.

Each floor has its own:

- **board** (GitHub issues and pull requests) and task **queue**;
- **workers** and **team** (Project Coordinator and Leads);
- **settings**: autonomy level, standup schedule, cost caps, Jeff;
- **live app**, run from its `main` branch;
- **Jeff · Router log** and analysis runs.

Floors don't share workers. To run two apps in parallel, use two floors. The rule *one writer per Mendix app* holds per floor.

## Moving between floors

- **🏠 Home → 🏢 Projects**: every floor as a card, with how many agents wait on you.
- The **floor** picker in the top bar of the 1D and 2D views. A floor with people waiting shows `· 🙋 N`.
- When an agent on another floor starts waiting, you get a toast and a ding, and a **🙋 N waiting on &lt;floor&gt; →** button. It lands on that floor's Command Center.
- In the 3D office, the elevator on the north wall.

## Adding and removing floors

- **✨ New project** creates a new repository and floor. See [Create your first project](../get-started/first-project.md).
- **➕ Add project** adds an existing repository.
- The office keeps the list of floors in `floors.json` in its data folder. See [Data locations](../administration/data-locations.md).

> [!WARNING]
> Each floor keeps its own `workers.json` in `<floor folder>/.agent-office/`. An office that points at a floor folder restores and resumes that floor's agents. Never point a test office at a real floor folder. See [Test offices](../administration/test-offices.md).
