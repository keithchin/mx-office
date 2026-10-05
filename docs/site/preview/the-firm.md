---
title: The Firm
description: Coming soon - independent Reviewer Agents on Fable 5.1 that audit each project team from outside and deliver a structured audit report to the Project Manager.
weight: 2
badge: Preview
aliases: [/docs/firm]
---

> [!WARNING]
> **Coming soon, in preview.** The Firm is being built on its own branch and is **not in the office yet**. This page says what it will do. It will be completed, with screenshots and exact labels, when the feature lands.

## What it is

**🏛️ The Firm** is an independent audit firm inside the office: **Reviewer Agents** that sit *outside* the project teams and check their work, the way an external auditor would. It reports to you, the Project Manager, not to the team.

```text
            You: the PROJECT MANAGER
             ▲                     ▲
   audit report                    │ escalations, approvals
             │                     │
  🏛️ THE FIRM (outside the project)   🧭 Project Coordinator + 4 Leads
  Engagement Partner + Reviewers ──interviews──▶ (the project team)
  read-only checkouts, budget cap
```

## How it will work

- It has its own page, at **/firm**.
- The Reviewer Agents run on **Fable 5.1**.
- Each project team gets an **Engagement Partner** and **reviewers** attached to it.
- Reviewers **interview the Leads**: they ask with `office-workers firm ask`, and the Leads answer with `office-workers firm answer`.
- They work in **isolated, read-only checkouts** of the project, so they can't change what they audit.
- A **budget cap** limits what an audit can spend.

## The audit report

Each audit ends in a structured report:

- **App statistics**: the size and shape of the app and its delivery.
- **Findings**.
- **Pros and cons**.
- **Root cause analysis** of what went wrong.
- A **re-forecast timeline**.
- **Expectations vs reality**.
- **Worker performance**, including *is someone slacking?*

## How it fits with the rest

- The Firm reads the [Audit Log](audit-log.md), the team journals, the board, the [rankings](../using-the-office/workers.md) and the code.
- Its findings come to you, alongside the team's own [escalations](../teams-and-agents/escalations.md).

<!-- To complete when the feature lands:
     - the /firm page: its sections and screenshots (docs/site/images/firm-*.png)
     - starting an audit, its scope and budget cap, and the settings that control it (Settings reference)
     - the exact `office-workers firm ask|answer` usage (add to the office-workers CLI and MCP tools pages)
     - where reports and read-only checkouts are kept (Data locations), and the API routes (API endpoints)
     - the report's exact sections, with a sample
     - then take the `badge: Preview` and this warning off, and move the page out of preview/ (keep an alias) -->
