---
title: Test Mode page
description: See whether the office is in test mode, run the performance and journey suites against a throwaway test office, and read the results, the per-view timings and the history.
weight: 5
---

The **Test Mode page** is where an admin checks that the office stays smooth and safe. It shows whether this office is in [test mode](test-offices.md#running-a-test-office-safely), lists the test suites with their last results, starts a run, and keeps a history of past runs.

## Opening it

It is for admins only. Open it in one of these ways:

- **☰ → 🧪 Test mode**, on the 1D view, the 2D view or the home page.
- **🧪 Tests** on the home page's top bar.
- **⚙️ Settings › 🧪 Testing** ([section=testing](/lite?tab=settings&section=testing)), then **Open the Test Mode page**.
- The address `/lite?tab=tests`. Add `&run=<id>` to open one run.

The page is part of the flat views. The 3D office doesn't have it.

## What it shows

- **Test mode**: whether this office is in test mode, and why (for example, *started with --test-mode*, or *the office's folder is under scratch/test-offices*). In test mode no real agent CLI starts, only the fake agent given with `--agent`.
- **Suites**: each suite with its last run time, result (Pass, Fail or Error), duration and a **▶ Run** button.

  | Suite | What it checks |
  |---|---|
  | Unit tests | The office's own test suite (`npm test`) |
  | Page responsiveness | Every main view on a big fixture (about 10 times a real project) with live fake workers: no main-thread task over 200 ms, usable within 3 s, and heap growth under the limit over a minute of live events |
  | End-to-end journey | A project from the wizard to a deliverable with fake agents: hiring, an escalation answered from the Team phone, pause and resume, the budget, a restart, and clean incidents |
  | Command Center check | The 1D Command Center stays responsive on a busy floor (the release 15 freeze) |

- **Running**: the run going, with a progress bar, its live log and **■ Stop**.
- **Run details**: for a page responsiveness run, two charts (the longest task per view, and the time to usable, each against its budget line) and a table per view: time to usable, longest task, long tasks, heap before and after, heap growth and the result. A view that failed lists what failed, its longest tasks with the top stack frames, any page errors, and a screenshot you can open full size. A journey run lists its steps.
- **History**: the last 50 runs. Click one to see its details.

## Starting a run

Click **▶ Run** next to a suite. One run goes at a time.

Each run starts a **throwaway test office of its own**, in test mode with a fake agent, under `scratch\test-offices\perf-guard\runs\<run id>` (the nearest `scratch\test-offices` above the office's checkout). Set `AGENT_OFFICE_TEST_OFFICES` to put them somewhere else. When there's no `scratch\test-offices`, they go under the system's temp folder, in `test-offices\agent-office-runs`. A run never uses this office, its data or its floors, and it spends nothing. The run gets none of this office's own `AGENT_OFFICE_*` settings, so it can't pick up its home folder, port or agent.

The page refuses to start a run, and says why, when:

- the test offices' folder isn't a test office's folder (under `scratch\test-offices` or a `test-office…` folder);
- the folder overlaps this office's data folder or one of its floors;
- the office's checkout has no `scripts\perf\run.mjs`;
- a run is already going.

Through [Phone access](phone-access.md), starting or stopping a run and opening an incident need your password again, as other risky actions do. Every start and stop is in the [Audit log](../using-the-office/audit-log.md).

## Opening an incident from a failure

Each failed view or step has **🚨 Open incident**. It opens a sev3 [incident](../using-the-office/incidents.md) that names the view, what failed, the top stack frames and a link back to the run. Each failure gets one incident.

## Where the results are kept

In the office's data folder, under `testlab\`:

- `index.json` lists the runs, newest first (at most 50; older runs' folders are deleted).
- `runs\<id>\` holds each run's `result.json`, `summary.md`, `log.txt` (at most 2 MB) and screenshots.

A run that was going when the office stopped shows as *Interrupted* the next time it starts.
