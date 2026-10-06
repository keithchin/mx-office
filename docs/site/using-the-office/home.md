---
title: Home
description: The /home page - every project as a card, the office's statistics, a 2D overview of every floor, and the audit log of the whole office.
weight: 2
---

`/home` is where the office opens. It has four tabs. The last one you used is remembered, and a link can open one with `?tab=projects`, `?tab=stats`, `?tab=overview` or `?tab=audit`.

The top bar has **🏠**, a **back link** to the floor you were last on (in the view you last used), **📑 The Firm** (opens [/firm](the-firm.md)), **📚 Docs**, **🎨** and **☰**.

## 🏢 Projects

![Projects on the home page](../images/home-projects.png)

One card per floor:

- its number, name and a *last visited* tag;
- `repo · ⎇ branch`, or a progress bar while it clones;
- **🙋 N waiting · 👷 N working · 💻 N workers · 🧑 N here**;
- the one-line project summary (for example *Stage 3 · 2 agents working · 🙋 1 needs you*);
- **🗂️ Board** (the 1D view) and **🗺️ Office** (the 2D view). The view you used last is the highlighted one.

Above the cards:

- **✨ New project** opens the wizard. See [Create your first project](../get-started/first-project.md).
- **➕ Add project** adds an existing repository.

## 📊 Statistics

![Statistics](../images/home-stats.png)

- **Tiles**: spent today, spent all-time, agents working, waiting on a human, asleep, open issues, open PRs, PRs merged in 7 days, queued tasks.
- **Projects side by side**: a sortable table with stage, issues open and closed, PRs open and merged, queue, agents, team, spend and last activity.
- **🏆 Model ranking**: the top 8 models across all projects by score, with runs, average cost and PRs merged and opened. See [Analysis](model-analysis.md).

## 🗺️ 2D Overview

![Every floor at once](../images/home-overview.png)

Every floor drawn in pixel art on one canvas, each under a banner with its name and numbers. It refreshes every 10 seconds.

- Hover a worker, or a benched Lead on a break, for details.
- Click a banner (or double-click a floor) to open it in the 2D view.
- Zoom with the wheel or pinch, drag to pan, **+ − 0** and the arrows work too.

## 🧾 Audit log

The office's [audit log](audit-log.md) across **Every floor**, with a floor column and a floor picker (or **Office-wide** for sign-ins, settings and floors added and removed). Same filters, histogram, chain badge and, for admins, CSV / JSONL export as a project's tab.

## 💰 Budget

Every project's spend in one place. For each project you get:

- a status chip: *Within budget*, *Close to budget*, *Over budget* or *Paused*.
- what it has spent against its budget, as a meter.
- its forecast at completion and today's spend.
- a 14-day sparkline; hover it for the numbers.

Click a project's name to open its [Budget tab](budget.md). Under the table:

- **the office's own calls**, by source: Jeff, the analyzer, task naming, the project summary and the Firm.
- **the Firm's audits**, with what each spent against its budget.

The tiles across the top give today's spend for the whole office, the all-time total, the background-call overhead and the audits.
