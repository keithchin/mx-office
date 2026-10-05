---
title: Benching and handoffs
description: Benching a Lead to save resources - the handoff note and lessons it writes first, idle benching (off by default), breaks in the 2D view, and hiring it again.
weight: 5
---

**Benching** clears a team member's Claude Code session to save resources, after it has written down what it knows.

## How a member is benched

1. Click **🪑 Bench** on its card in the [Org chart](../using-the-office/org-chart.md) (admin; only when it's idle or asleep).
2. The office prompts it (waking it if asleep) to append a **handoff note** to its team journal `docs/team/<team>.md`, under `## <date time> — Handoff`, with: *What I know*, *Decisions*, *Open threads*, *Next steps*.
3. The note ends with `AWAITING-PM: <question>` or `AWAITING-PM: none`.
4. It adds its **lessons** to `.ai-context/skills/mxcli-field-lessons/SKILL.md` (or `project-lessons` when there's no field-lessons file).
5. When that turn is over (or after 3 minutes if it never got busy), the office keeps the note, stops the worker and clears its session.

If the note's `AWAITING-PM` line asks something and there's no open escalation for it, the office raises one for the Lead.

## Idle benching is off by default

Leads are benched **only when you say so**. To bench idle Leads automatically, set **Bench a Lead after N idle minutes** in [Settings](../using-the-office/settings.md) (0 means only by hand).

Even then, a member is never benched while it's busy, asleep, or **waiting on an open escalation of its own**. "Idle" means its status is idle or done *and* nobody has its terminal open. Watching the Project Coordinator's console counts as having it open.

## Benched Leads take a break

In the [2D view](../using-the-office/2d-view.md) and the home page's 2D Overview, a benched Lead walks between the lounge TV, a smoke on the balcony and coffee in the kitchen. Hover for what it's doing; click to go to the Org chart.

## Hiring it again

Click **🤝 Hire again** (on the Org chart, or on the Command Center for the Coordinator). The member starts a **fresh session**, primed with its Playbook and its latest handoff note. It never resumes the old session.

> [!TIP]
> Benching is not firing. Use it for a Lead whose part is done for now, so it stops costing tokens, and so its next session starts clean from a good handoff note.
