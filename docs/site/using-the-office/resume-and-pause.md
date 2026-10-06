---
title: Resume and pause
description: ▶ Resume project wakes the agents that have work waiting, a few at a time, each with a short brief; ⏸ Pause project lets every agent finish its turn, write a handoff note and sleep, and holds the office's own prompts. Plus Resume all / Pause all on Home, and 🔁 Restart safely.
weight: 3.5
---

Since release 6 a restart wakes only the agents that were cut off mid-turn. Everyone else stays asleep until something prompts them. **▶ Resume project** is the safe way to bring a project's team back. **⏸ Pause project** is the clean way to stop it, for example before a restart, a release or a migration.

Both buttons are in the heading of the **🎛️ Command Center**, next to the project's name, and at the top of the team pages (Org chart, Standup, Approvals, Settings). **/home** has **▶ Resume all projects** and **⏸ Pause all projects**. Only admins (the Project Manager) see the buttons. Everyone sees the floor's state, for example *⏸ Paused by Keith at 14:05 · 2 waiting on you*, and while a run is going, a progress chip such as *▶ Resuming 2/3* that opens the run.

## ▶ Resume project

### The preview

Nothing is woken until you say so. Resume first opens a preview listing every agent on the floor that's asleep, plus every benched team member. For each one it shows whether it has **work waiting**, and why:

| Reason | Where it comes from |
|---|---|
| *N escalation answers owed to it* | You answered its escalations while it slept, and it hasn't been told yet |
| *N prompts held for it* | Prompts the office's one delivery path is holding (typed once its turn is over) |
| *N notes queued for it* | The office's outbox: relays for the Project Coordinator, the Project Manager's decisions for a Lead |
| *Cut off mid-turn* | A restart or a crash stopped it mid-turn, and it hasn't carried on yet |
| *Failing checks on PR #n* | Its open pull request is red on the floor's PR list |
| *Open issue #n assigned* | For a Lead, an open issue with its team's label that someone is assigned to. For a worker, an open issue its task names |
| *Standup … page not handed over* | For the Project Coordinator, a compiled standup page it was asleep for |

An agent with nothing to do stays asleep. Agents that are already awake are listed and left as they are.

You can pick who to wake:

- **Those with work** wakes the agents that have work waiting. This is the default.
- **All asleep** wakes everyone on the list.
- **Pick agents** lets you choose an action for each agent: **▶ Wake**, **🔁 Re-hire from handoff**, **🏠 Send home** or **💤 Leave asleep**.

The last line of the preview estimates the cost, for example *Wakes 3 agents ≈ 3 turns · 2 at a time, 45 s apart*.

### Safety checks

The preview also runs safety checks:

| Check | What happens |
|---|---|
| The floor's daily **spend cap** is reached | **Blocks.** Nothing can be woken until the cap lifts (raise it in the team settings). |
| **Studio mode** (Studio Pro has the project open) | A warning: agents wake, but their mxcli writes stay paused until Studio Pro closes. |
| The agent's **worktree is gone** | A team member is re-hired fresh, primed with its handoff note. Any other worker is left asleep: rebuild its worktree from its card. |
| Its **branch is already merged** into `origin/<default>` | **🏠 Send home** is offered instead of waking it. |
| It's **N commits behind** `origin/<default>`, or has **uncommitted changes** | A note in the preview. Its brief tells it to rebase first and re-run the checks, or to look at the changes before anything else. |
| Its **session can't be carried on** (Claude no longer has the conversation) | A team member is re-hired with its handoff note, through the roster's own hire. Any other worker starts a fresh session. |

### Order and pacing

The **Project Coordinator** wakes first, because it routes everyone else's news. The **Leads** follow, the most blocking first: the most answers owed from you, then open PRs that others are waiting on, then the highest [Jeff priority](../automation/jeff-router.md#priority-which-escalation-first) among their escalations. **Everyone else** wakes last.

At most **2** agents start at a time, **45 seconds** apart. A wake only counts as started once its session is live (its SessionStart hook). If a session doesn't come up within 5 minutes, that wake fails and its slot frees up. You can change both numbers in the team settings, under **▶ Resume project**: 1 to 6 at once, and 5 to 600 seconds apart.

### The resume brief

A woken agent doesn't get the generic "carry on" prompt. It gets a short brief, sent as your turn (a person-originated message, so its turn flags when done as usual):

- what happened while it slept: merges on `origin/<default>` since its last turn, escalations that involve it (answered or raised), and a few lines of Team chatter about it. This part is cut to about 1,500 characters
- its open escalations, with *don't raise these again*
- the state of its branch (*N commits behind main: rebase first and re-run the checks*, or uncommitted changes)
- the answers and notes it's owed, in the same message, and marked as told
- at autonomy 1 or 2, *post a 2-line plan before acting*

### The run

Resume runs as a [workflow](../automation/workflows.md) on the office's engine (`project-resume`), with one step per agent. It's checkpointed after every step, so a run cut off by a restart carries on where it was when the office comes back, and nobody is woken twice. The preview window turns into the run's progress, with **⏸ Hold** (stop after the current step, then **▶ Carry on**) and **✕ Cancel run**. The audit log gets `resume.started`, `agent.woken` (once each session is live), `agent.skipped` (a wake that couldn't happen, and why), `agent.sent-home` and `resume.finished`.

Starting a resume lifts the floor's pause.

## ⏸ Pause project

1. The floor is paused straight away. The office stops sending its own prompts to this floor's agents: no nudges, standups, relays, review nudges or Firm interviews. Messages a person sends still go through, and wake only the agent they're sent to.
2. Each agent then winds down:
   - one **mid-turn** finishes its turn. It's never interrupted.
   - one **asking something in its terminal** (a question or a permission prompt) is left alone, and nothing is typed into it. It's listed as *waiting on you in its terminal*.
   - one **between turns** is asked for a short handoff note (what it was doing, the next step, open questions). A team member writes it in its team journal. Once that turn is over, the agent goes to sleep with its session kept, so ▶ Resume project carries it on. A team member's handoff note is also kept for a fresh hire, in case its session is lost later.
3. The Command Center and the team pages show *⏸ Paused by &lt;name&gt; at &lt;time&gt; · N waiting on you*. The office's prompts stay held until someone resumes the project.

Pause also runs as a workflow (`project-pause`), checkpointed and audited: `pause.started`, `agent.slept`, `agent.skipped` (an agent left waiting on you, or one that couldn't be put to sleep), and `pause.finished`.

The pause is kept in `<office data>/project-run.json`, so it survives a restart. That's the point: pause the projects, restart, release or migrate, then resume.

## 🔁 Restart safely

For a release or a restart, use **⚙️ Settings › Workers › 🔁 Restart safely** (admins), or `POST /api/office/restart` from a script. It pauses every project, waits until no agent is mid-turn, and restarts the office. When the office is back, it resumes the projects it paused. See [Releasing and restarting safely](../administration/running-the-office.md#releasing-and-restarting-safely).

## Limitations

- Meeting-room nudges and the task queue don't go through the roster's delivery path, so a pause doesn't hold them.
- The "while you slept" part only covers what the office can see: merges on the default branch, the floor's escalations and its Team chatter.
- A worker that isn't on the team and whose worktree is gone isn't woken. Rebuild it from its card first.
