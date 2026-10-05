---
title: Teams & Agents
description: Who the agents on a floor are, how much they decide on their own, and how they come back to you.
weight: 40
---

Every floor has a project team. You, the human, are the **Project Manager**. The agents are a **Project Coordinator** and four **Leads**, each Lead with its own Claude Code **subagents**.

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
