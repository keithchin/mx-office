---
title: Budget
description: What a project has spent, by stage, role, agent, model, day and issue; the budget chips in the top bar; the local currency; and how the office meters its own background calls.
weight: 16
---

The **💰 Budget** tab shows what a project has spent in US dollars, and in a local currency too. The office is billed per API call, so these are real dollars.

![The Budget tab](../images/budget.png)

## The top bar

Two chips sit in the top bar of the 1D and 2D views:

- **Next to the project's branch**: the project's spend, as `$42 today · $252 / $600 · 42 %`. With no budget set it reads `$42 today · $252 spent`. Hover for the same numbers in the local currency, and the rate's date.
- **At the far right**: the whole office, as `Office $110 today`. This covers every project plus the office's own calls. If the office has a daily budget (`--budget`), it shows that too: `Office $110 / $150 today`.

The project chip is **green** inside the budget, **amber** within 10 % of it and **red** over it. It goes by the forecast at completion when there is one, and by spend so far when there isn't. Click either chip to open the Budget tab. The 2D view's chips open the 1D view's tab. In the Clean themes the chips use line icons, not emoji.

## The headline

**Spent**, **Budget**, **Remaining**, **Forecast at completion**, **Today** and **Days active**, each with the local-currency amount underneath. Under the tiles you'll see:

- calls that are **not metered**: providers the office can't price, like Codex or OpenCode. They're counted but not costed.
- the exchange rate in use.
- **Price list checked on** a date: when the office's Claude prices were last checked against Anthropic's pricing page.
- **Priced at Opus rates**, when a worker or a background call ran on a model the price list doesn't have (a model newer than the list, say): its cost is priced at Opus rates until the list is updated, so treat it as an estimate. The same line shows in Needs you as an info row (worth knowing, not waiting on you). Each model is named once, from when the office first saw it since it started.

## Where the money went

Each table has a bar per row, the amount and its share of the whole:

- **By stage**: the toolkit stage that was active when the money was spent (P to 7). The stage is read the way the setup panel reads it: from the project's default branch on origin (the project's folder when there's no remote), checked again at most once a minute. Spend outside a pipeline, or from before the office kept a ledger, shows as *No stage*.
- **By role**: the team's roles. Each Lead's subagents get a row of their own, and the office's background calls are under *Office background*.
- **By agent**: every worker. A Lead's subagents are nested under it, by name (*Nia*, *Business Analyst · hired by Barbara*). The Lead's own row covers both its own session and its subagents.
- **By model**: Opus, Sonnet, Haiku and so on.
- **By day**: columns for the last 30 days. Hover a column for its amount, or open **Table view** to see every value.
- **Top issues and pull requests**: spend is credited to the issue the worker was on. That's the issue on its queue task, or the one named in its prompt. If there's no issue, it goes to the worker's pull request.

### Estimated history

When the office starts a project's ledger, it fills in what had already been spent. That comes from two places: the workers at their desks (their session's usage so far) and the analysis runs log (`analysis/runs.jsonl`, which also covers workers who have gone home). Each worker's total is spread evenly over the days it was around. These amounts show as the **lighter part of each bar**, labelled *Estimated from history*, because the real days aren't known. Anything spent after that is booked as it happens.

## How spend is counted

- **Workers**: each worker's tokens come from its Claude Code transcript, subagents included, priced from the office's price list. Each API request is counted once, however many transcript lines Claude Code wrote for it and whether it appears in the session's transcript, a subagent's, or both. The office's Ledger (the office total) and the project ledger book the same change, at the same moment, so the two never disagree. The project ledger also splits each change by agent (the worker, or a subagent type) and by model. When a session ends, Claude Code writes its own tally, which also covers calls that never reach the transcript (titles, summaries). The office reads it run by run (a resumed session in a new process starts its tally again) and books each run at the larger of Claude Code's figure and its own estimate, so a worker's spend never goes down and no ledger day is negative.
- **The office's background calls** are booked on the project they served, and added to the office total. These are Jeff's Haiku fallback, the analyzer, task naming, the project summary and the Firm's reviewers. A call that served no project (the office's own) goes on the office view. Jeff's calls to Jev aren't priced, so they show as not metered. Gate-check makes no model calls.
- **Providers other than Claude** count their calls but no cost.

### The price list

Claude costs are priced per model from the office's price list (`src/server/prices.ts`), with the date it was checked against [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing). Each row matches one model id exactly, whatever a cloud adds around it (`us.anthropic.…-v1:0`, `@…`, a dated snapshot, `[1m]`), and the `fable`, `opus`, `sonnet` and `haiku` aliases are priced as the model Claude Code runs for them. A model with no row is priced at Opus rates ($5 / $25 per million input / output tokens; Fable rates for an unknown Fable or Mythos model), and the Budget tab says which. Haiku 5.5 costs more for a request whose prompt is over 100,000 tokens, and the office prices each request that way.

## Insights

**Insights** covers the last 30 days. It has two parts.

**What drives the spend:**

- a model family the Leads run on that takes 40 % or more of spend (*Opus Leads are 71 % of spend*).
- the Lead Tester's review loop (its own session plus its subagents) when it's 15 % or more of the week.
- the Coordinator's relays, when there are 20 or more turns a day.
- the office's own calls, when they're 5 % or more of spend.

**Ways to spend less.** Each suggestion has a button to the action that already exists:

- **Move a Lead from Opus to Sonnet** when its Opus work is a fifth or more of the week. The saving is half of that, from the price list. Goes to the Org chart.
- **Delegate to its subagents** when a Lead does 80 % or more of its work itself on Opus. Goes to the Org chart.
- **Turn on idle benching**, when it's off. Goes to the team settings.
- **Switch on Jeff's real-ask mode** (Jeff's *waiting* judgement on), when it's off or in shadow. Goes to the team settings.
- **Turn off early drafts**, while the pipeline is before Stage 3 and Design, Development and Testing have spent 10 % or more on drafts. Goes to the team settings.

The model suggestions show the Lead's **token-efficiency score** from the [worker ranking](workers.md) where it has one.

## The expected plan

Every project gets an expected plan, made automatically. It gives an expected cost per toolkit stage (and per build module once there is a build plan) and an expected end date. Expand **Expected plan** on the tab to see it. Admins can change any line's cost or working days; each edited line records who changed it.

The plan is built from:

- **Size tier and entry mode**, from `agent-office.project.json` or the decision register in `PROJECT.md`. If neither says, the plan assumes a standard requirements-driven project.
- **The stages that mode runs**:
  - Greenfield: P (light), 0 (scope only), 5 and 6.
  - Requirements-driven: P and 0 to 6.
  - Changing an existing app: P and 0 to 6, with stages 1 to 4 at 60 %.
  - Migration: everything up to 7, with analysis at 130 %.
  - Assurance only: one line.
- **Build modules**: the folders in `architecture/modules/`, or the module headings in `architecture/build-plan.md`. Until there's a build plan, a small project assumes one module and a standard project four. While nobody has edited the plan, it follows the build plan's modules as they appear.
- **This office's history**: once the analysis runs log has at least 5 runs of the right task types, a line is priced from their median cost. Build uses *domain-model*, *logic*, *ui-pages* and *security* runs (4 runs a module). Test uses *tests* and *bugfix* runs (4 a stage). Stages 1 and 2 use *docs* runs (6 and 5).
- **Otherwise, the default rates** below. They're for a standard project at Balanced. A small project costs half as much for every stage except build.

| Stage | Default cost | Working days |
|---|---|---|
| P · Kickoff | $15 | 1 |
| 0 · Triage & scope | $30 | 1 |
| 1 · Analysis | $90 | 3 |
| 2 · Requirements | $80 | 3 |
| 3 · Architecture & design | $90 | 3 |
| 4 · Build plan | $40 | 1 |
| 5 · Build | $120 per module | 2 per module |
| 6 · Test | $80 | 2 |
| 7 · Cutover | $40 | 1 |

### Team shapes in the plan

The default rates are priced from Enterprise teams: five sessions that each prime on their Playbook, a Coordinator relaying and summarising, standups that wake four Leads, and a handoff between Leads at every stage. A [Solo or Startup team](../teams-and-agents/team-shapes.md) is priced as a share of each stage, and each line says who does it:

| Stage | Solo | Startup |
|---|---|---|
| P, 0 | 70 % | 80 % |
| 1 to 4 (analysis, requirements, design, build plan) | 50 % | 80 % |
| 5 · Build | 60 % | 85 % |
| 6 · Test | 50 % | 70 % |
| 7 · Cutover | 70 % | 85 % |
| Working days | × 1.4 | × 1.15 |

Why these shares: single-agent focused runs in this office's analysis data cost $0.31–2.66 each, while mx-spike's full team came to about $350. A small greenfield app is some 40–60 such runs of work, so one agent doing it costs roughly $60–100 at Lean. Solo · Lean comes to $60 for a small greenfield project. The analysis and design stages shed the most (no handoffs, no Coordinator, one context instead of three). The build sheds least: the MDL still has to be written and checked by the same one writer. A Startup keeps two sessions and one handoff (analyst to developer at Stage 4), so it sits in between. The project's shape is read from `teamShape` in `agent-office.project.json`, which the wizard writes; without it, the project is Enterprise.

Each line's cost is spread evenly over its working days, Monday to Friday, which gives the expected cumulative curve. **Make again** rebuilds the plan from the project, and edited lines are replaced too. If a [Firm audit](the-firm.md) of the project gave a cost re-forecast or milestone dates, **Apply the Firm's re-forecast** scales the plan's lines to its total and takes its last milestone as the end date.

## Plan against actual, and the forecast

**Plan against actual** shows the expected cumulative spend (orange) against the actual (blue). The budget is drawn as a line, and the forecast at completion as the end point. Hover anywhere on the chart for that day's plan, actual and difference, or open **Table view** for every value. Each stage's plan and spend are in the **Stages against plan** table (below). A stage counts as **done** once the project has moved past it.

The **forecast at completion** works like this:

> forecast = actual + remaining plan × (actual ÷ planned, for the completed stages)

- **Remaining plan** is what's left of the current stage plus every stage ahead.
- **The factor** (actual ÷ planned) is kept between 0.5 and 2, so one odd stage can't swing the forecast. With no stage finished yet, it's 1.
- **The forecast** never drops below what has already been spent.

The forecast appears in the headline and sets the colour of the top bar's chip.

## Stages against plan

The **Stages against plan** card has a row for each stage, showing its plan line (the office's estimate unless a person set it), what has been spent on it, and **×** (spent ÷ plan). Missing data is labelled as missing, never shown as $0:

- a stage with spend but no plan line reads *not in the plan*, and its × is *—*.
- spend booked to no stage (before the stage was known, or outside the pipeline) is not put in any row. A note gives the amount.
- a project without the toolkit's pipeline gets a note that its spend can't be split by stage, and no stage warnings are raised.
- spend is booked to the stage the project was in at the time, read from its gate files. Work done before a gate was recorded counts towards the earlier stage.

**Stage overspend warnings.** When a stage's spend passes its plan line, the office raises a warning once at each of **1×, 2×, 5× and 10×**, for example: *Stage 5 Build has spent $61.70 against its plan of $6.86 (9×). At this rate the project budget ($500) runs out around 20 Oct (estimate), before the plan's end (5 Nov).* A jump past several levels at once raises only the highest. Each warning goes to the audit log (`budget.stage`) and appears as a toast. It also shows on **🚨 Needs you** with **Raise the budget…** (the Settings below, with the total focused) and **Dismiss for this stage**. On the card itself, **Review the plan** is there too. A dismissed warning stays off Needs you until that stage reaches its next level. If someone raises the stage's plan line so the stage is back within it, the warning goes, and passing the new line counts as news.

**The run-out estimate** is what's left of the budget divided by the average spend a day over the last 7 calendar days (fewer if the ledger is younger), counting weekends, because agents spend then too. It's always labelled as an estimate.

**Pace warning.** If the run-out estimate falls before the plan's end, or before the project's **milestone** when that comes earlier (Settings), Needs you says so at most once a day, with **Review the plan** and **Dismiss for today** (audit log `budget.pace`). The pace warning isn't shown alongside a stage warning, which already gives the run-out date. It also isn't raised once spend has reached the alert threshold, because the threshold alert below already covers that. Neither warning changes the budget's alerts or its auto-pause, and both leave Needs you while the budget has the project paused.

## Alerts

The budget raises an alert:

- at the **alert threshold** (80 % unless the project or the office sets another).
- at **100 %**.
- when the **forecast** goes over the budget.

Each alert is raised once per budget. Raising the budget clears all of them, so crossing a level of the new budget is news again. Each alert:

- goes to the [audit log](audit-log.md) (`budget.alert`) and appears as a toast.
- shows on **🚨 Needs you** on the Command Center (kind `budget`), which also feeds the [Teams cards](../integrations/teams-notifications.md) and the Team phone.
- at 100 %, also sends a desktop notification.

The **Alerts** card on the Budget tab lists the alerts standing. An admin can **Mark as seen** the forecast and threshold alerts, there or with the button beside **Budget** in Needs you. A seen alert leaves Needs you, its count, the phone and Teams, and stays on the Budget tab, dimmed, with *Seen by &lt;name&gt;, &lt;date&gt;* (in the audit log as `budget.alert.seen`). A seen **forecast** alert comes back, with its new numbers, when the forecast at completion grows by more than 10 % over what it was when it was seen. A seen **threshold** alert stays seen until the budget changes. The **100 %** alert and the budget's pause can't be marked as seen: they need a budget decision (raise it, or resume).

## Auto-pause at 100 %

When spend reaches the budget and **Pause the project at 100 %** is on (the default), the office pauses the project with [⏸ Pause project](resume-and-pause.md), recorded as the budget's doing:

- agents finish the turn they're on, write a handoff note and go to sleep.
- nobody new is hired, and the office sends no prompts of its own (nudges, standups, relays, wakes).
- **people's messages still go through**.
- the project's pause line reads *⏸ Paused: budget reached*, and the pause survives a restart.

Needs you then says *Budget reached: project paused*, with **Raise budget** and **Resume** buttons. **Resume** opens the ▶ Resume project preview (who has work waiting, and what's safe). Raising the budget above what's spent resumes the project the default way (*Those with work*). Either way the project won't pause again for the same budget. If a person resumes it from ▶ Resume project instead, the budget sees that too.

## Settings

On the tab (admins; every change is in the audit log):

- **This project**: the total budget (USD), the alert threshold, auto-pause and an optional **milestone** date for the pace warning to use.
- **Budget level**: **Change level** shows the [new-project wizard's](../get-started/first-project.md#5-team--budget) cards again, priced for this project. Applying a level sets the budget and the team's models and settings.
- **The office**: the default alert threshold, and the local currency.

### Budget levels

A level sets the Leads' model, their subagents' models (Haiku only where the role allows it), early drafts and how many subagents a Lead runs at once, and, only on a project from before the New project flow's autonomy step, autonomy by stage (Lean and Fast turn it on). On a project whose autonomy was chosen in that step the level never changes autonomy: its cards leave the autonomy line out, Manual has no *Autonomy by stage* box, and its autonomy stays as chosen ([Autonomy levels](../teams-and-agents/autonomy.md)). The Leads' Playbooks say "Run at most N subagents at once" (Lean 1, Balanced 2, Fast 4). The changes apply from each Lead's next hire or Playbook rewrite. A running session keeps the model it started on, and a Lead only hears about a subagent change between turns, so nobody is interrupted mid-turn.

## Currency

Dollars are always shown. Admins pick a second, local currency (**SGD** by default) and where its rate comes from:

- **Daily** (the default): fetched once a day from the European Central Bank's reference rates, through [frankfurter](https://frankfurter.dev). It's free and needs no key. Each amount says which day the rate is from. If a fetch fails, the last good rate stays in use and the page says the fetch failed.
- **By hand**: type the rate (how much of the local currency one US dollar buys).

## Where it's kept

Each project's ledger is in the office's data folder, at `budget/<project>.json`. It holds:

- a rollup for every day, kept forever: the total, plus splits by stage, role, model, agent and issue/PR.
- detailed rows (day × agent × model × stage × issue) for the last 30 days.
- the toolkit stage each time it changed.

The office's own settings and its unattributed background calls are in `budget/office.json`. See the [settings reference](../reference/settings-reference.md#office-settings-budget).
