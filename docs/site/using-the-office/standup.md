---
title: Standup
description: The daily standup at 09:00 Singapore time on weekdays - how it's collected, the standup page, and approving its proposals.
weight: 11
---

The **📋 Standup** tab shows the team's daily standup and the **proposals** in it.

![A standup](../images/standup.png)

## When it runs

- By default on **weekdays at 09:00, Asia/Singapore time**, and only if there was activity on the floor since the last one. Change it in [Settings](settings.md).
- On demand: **▶️ Run standup** on this tab, or the **📋 Run standup** chip on the Command Center.
- If the office was down at standup time for more than 12 hours, that standup is skipped.

The tab shows *Next: &lt;when&gt;*, or that the daily standup is off.

## How it's put together

1. Leads that are awake and not waiting on someone are asked live for **done**, **next**, **blockers** and **proposals**, in their journal. The others are summarised from their journal.
2. The Chief Analyst also gets the analysis numbers and writes the weekly insight memo `docs/insights/YYYY-Www.md` if it's missing.
3. After up to 20 minutes the office writes `docs/standups/<date>.md` and hands it to the Project Coordinator to summarise and commit.

## Proposals

Each proposal under *Proposals* becomes a card: **✅ Approve**, **❌ Reject** or **✏️ Change**.

- **Approve** opens a GitHub issue labelled `team:<team>` (unless dry run is on).
- If your autonomy level already allows that kind of decision, the proposal is approved automatically.
- Your decisions go back to the Coordinator a minute after your last one, and each to the Lead that proposed it, as one short note between its turns (an asleep Lead gets its notes once it's back at its desk). Both wait through a restart: they're kept in the roster file until they're delivered.

Pending proposals also show on [Approvals](approvals.md).
