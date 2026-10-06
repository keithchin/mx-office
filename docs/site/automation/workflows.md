---
title: Workflows
description: The office's workflow engine - steps and edges, a checkpoint after every step, carrying on after a restart, retries on flaky steps, cached results, loop guards and budgets, and pause, resume and cancel.
weight: 4
---

Some of the office's jobs are a list of steps that has to get to the end, even when something goes wrong halfway: GitHub is busy, the network drops, the office restarts. The office runs those as **workflows**. The first one is the [new-project wizard](../get-started/first-project.md)'s setup.

## Steps and edges

A workflow is a set of named **steps** joined by **edges**. After a step, the run follows its edge to the next step. Most edges are fixed ("after clone, write the env file"). Some are **gates**: they look at what the run knows so far and pick where to go, so a review can send the work back to be done again.

Each run has its own **state**: what it knows so far (the plan, the floor, the issue it opened). Each step reads it and adds to it.

## Saved after every step

After every step the run is saved to a file in the office's data folder (`flows/<workflow>/<run>.json`, see [Where things live](../administration/data-locations.md)). The file holds where the run is, its state, how many tries the current step has had, and a history of every step it took.

So when the office restarts in the middle of a run, nothing is lost:

- A run that was in the middle of a step comes back **interrupted**, at that step.
- Carrying it on runs that step again. That is safe because each step first checks whether its work is **already done**, and skips itself if it is. The same check makes a Retry after a failure safe.

## Retries

A step can say it may be **tried again** when it fails. It waits a little before each new try, and longer each time (3 seconds, then 6, up to a limit), with a little randomness so steps that failed together don't all try again at the same moment.

Only errors that tend to go away by themselves are retried: a dropped connection, a host that couldn't be found, GitHub's rate limit or a 502. A command that said no, or that ran out of time, is not: the next try would end the same way. When the tries run out, the run stops as **failed** at that step, with the reason. Retry gives the step a fresh set of tries.

## Cached results

A slow step whose answer only depends on its inputs (a health check of a Mendix version, say) can **reuse** its last answer for the same inputs for a while, instead of running again. The cached answers sit next to the runs, in `flows/_cache/`.

## Loop guards and budgets

A gate that keeps sending work back could go round forever. Every run has guards:

- **A step limit**: at most 100 steps (by default) each time it's started or carried on.
- **Loop limits**: a loop can go round at most so many times (a review loop, say, three).
- **Budgets**: a run can be given a cost or time budget, which its steps report against.

When a guard trips, the run stops with **needs attention** and says why (*Went from review to draft 3 times, the limit*). Carrying it on gives it another round.

## Pause, resume, cancel and questions

A run can be **paused** (it stops after the step it's on), **resumed** from where it stopped, or **cancelled** (the step it's on is told to stop, and what it was doing is thrown away).

A step can also stop the run to **ask a question**. The run waits, saved, until the answer comes, and then that step carries on with it. Nothing asks questions yet.

## Statuses

| Status | Means |
|---|---|
| **pending** | Made, not started |
| **running** | A step is running |
| **waiting** | A step asked a question and waits for the answer |
| **paused** | Someone paused it |
| **needs attention** | A loop limit, the step limit or a budget stopped it |
| **interrupted** | The office stopped while a step was running |
| **failed** | A step failed and had no tries left |
| **done** / **cancelled** | Over |

## Where you see them

- The wizard's setup page shows its run's steps and log, as before.
- The [Audit log](../using-the-office/audit-log.md) has each run's start, finish, failure, pause and cancel, by **Workflows** (`flow.start`, `flow.finish`, `flow.fail`, `flow.pause`, `flow.wait`, `flow.cancel`).
- `GET /api/flows` lists the runs, newest first, with their status and step (`?floor=` for one floor's, `?workflow=` for one workflow's). It never includes a run's state.
