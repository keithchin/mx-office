---
title: Budget
description: What a project has spent, by stage, role, agent, model, day and issue; the budget chips in the top bar; the local currency; and how the office meters its own background calls.
weight: 16
---

The **💰 Budget** tab shows what a project has spent in US dollars, and in a local currency too. The office is billed per API call, so these are real dollars.

![The Budget tab](../images/budget.png)

## The top bar

Two chips sit in the top bar of the 1D and 2D views:

- **Next to the floor's branch**: the project's spend, as `$42 today · $252 / $600 · 42 %`. With no budget set it reads `$42 today · $252 spent`. Hover for the same numbers in the local currency, and the rate's date.
- **At the far right**: the whole office, as `Office $110 today`. This covers every project plus the office's own calls. If the office has a daily budget (`--budget`), it shows that too: `Office $110 / $150 today`.

The project chip is **green** inside the budget, **amber** within 10 % of it and **red** over it. It goes by the forecast at completion when there is one, and by spend so far when there isn't. Click either chip to open the Budget tab. The 2D view's chips open the 1D view's tab. In the Clean themes the chips use line icons, not emoji.

## The headline

**Spent**, **Budget**, **Remaining**, **Forecast at completion**, **Today** and **Days active**, each with the local-currency amount underneath. Under the tiles you'll see:

- calls that are **not metered**: providers the office can't price, like Codex or OpenCode. They're counted but not costed.
- the exchange rate in use.

## Where the money went

Each table has a bar per row, the amount and its share of the whole:

- **By stage**: the toolkit stage that was active when the money was spent (P to 7). The stage comes from the gate readings the setup panel uses. Spend outside a pipeline, or from before the office kept a ledger, shows as *No stage*.
- **By role**: the team's roles. Each Lead's subagents get a row of their own, and the office's background calls are under *Office background*.
- **By agent**: every worker. A Lead's subagents are nested under it (*Business Analyst · hired by Barbara*). The Lead's own row covers both its own session and its subagents.
- **By model**: Opus, Sonnet, Haiku and so on.
- **By day**: columns for the last 30 days. Hover a column for its amount, or open **Table view** to see every value.
- **Top issues and pull requests**: spend is credited to the issue the worker was on. That's the issue on its queue task, or the one named in its prompt. If there's no issue, it goes to the worker's pull request.

### Estimated history

When the office starts a project's ledger, it fills in what had already been spent. That comes from two places: the workers at their desks (their session's usage so far) and the analysis runs log (`analysis/runs.jsonl`, which also covers workers who have gone home). Each worker's total is spread evenly over the days it was around. These amounts show as the **lighter part of each bar**, labelled *Estimated from history*, because the real days aren't known. Anything spent after that is booked as it happens.

## How spend is counted

- **Workers**: each worker's tokens come from its Claude Code transcript, subagents included, priced from the office's price list. The office's Ledger (the office total) and the project ledger book the same change, at the same moment, so the two never disagree. The project ledger also splits each change by agent (the worker, or a subagent type) and by model.
- **The office's background calls** are booked on the floor they served, and added to the office total. These are Jeff's Haiku fallback, the analyzer, task naming, the project summary and the Firm's reviewers. A call that served no floor (the office's own) goes on the office view. Jeff's calls to Jev aren't priced, so they show as not metered. Gate-check makes no model calls.
- **Providers other than Claude** count their calls but no cost.

## Currency

Dollars are always shown. Admins pick a second, local currency (**SGD** by default) and where its rate comes from:

- **Daily** (the default): fetched once a day from the European Central Bank's reference rates, through [frankfurter](https://frankfurter.dev). It's free and needs no key. Each amount says which day the rate is from. If a fetch fails, the last good rate stays in use and the page says the fetch failed.
- **By hand**: type the rate (how much of the local currency one US dollar buys).

## Where it's kept

Each project's ledger is in the office's data folder, at `budget/<floor>.json`. It holds:

- a rollup for every day, kept forever: the total, plus splits by stage, role, model, agent and issue/PR.
- detailed rows (day × agent × model × stage × issue) for the last 30 days.
- the toolkit stage each time it changed.

The office's own settings and its unattributed background calls are in `budget/office.json`. See the [settings reference](../reference/settings-reference.md#office-settings-budget).
