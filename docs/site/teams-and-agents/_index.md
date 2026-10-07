---
title: Teams & Agents
description: Who the agents on a floor are, how much they decide on their own, and how they come back to you.
weight: 40
---

Every floor has a project team. You, the human, are the **Project Manager**. On an **Enterprise** team, the agents are a **Project Coordinator** and four **Leads**, each Lead with its own Claude Code **subagents**. A smaller project can be **Solo** (one Solo Lead covers every team) or **Startup** (a Chief Analyst and a Lead Developer): see [Team shapes and coverage](team-shapes.md).

```text
                         You: the PROJECT MANAGER (human)
                    approve · answer escalations · set autonomy
                                      │
            ⚖️ Jeff · Router ── 🧭 Project Coordinator (agent)
            (staff, not an agent)   keeps the plan · runs the standup · relays to you
        ┌──────────────────┬──────────────┴───────┬──────────────────┐
  🎨 Lead Designer   🛠️ Lead Developer      🧪 Lead Tester      📈 Chief Analyst
   UI/UX Designers      Developers              Testers         Business & Data Analysts
   (subagents)          (subagents)             (subagents)            (subagents)
```
