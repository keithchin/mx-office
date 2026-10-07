---
title: Performance budgets
description: How smooth the office has to stay on a big project - the page budgets the performance guard holds every main view to, the big-data test office it measures on, and the live warnings in the real office.
weight: 6
---

The office has to stay smooth as projects grow. The **performance guard** checks that on a project about ten times the size of mx-spike, and the real office warns when a page or the server stalls.

## The budgets

Every main view is opened in a headless browser on a big test office, with six workers live and sending events the whole time. A view fails when:

| Budget | Limit | What it means |
| --- | --- | --- |
| Longest task | 200 ms | No single piece of work on the page's main thread may run longer. Over this, clicks and typing visibly lag. |
| Time to usable | 3 s | From opening the address until the view has drawn its content and answers. |
| Heap growth | 25 % (and over 4 MB) | How much the page's memory may grow while it stays open on live events for 60 s. Steady growth means something piles up. |

The numbers are named constants, `PERF_BUDGETS` in `src/shared/testlab.ts` (and `scripts/perf/budgets.mjs`, which a test keeps the same), so they can be tuned in one place.

The views: the Command Center (Chat and Terminal), the Board, the team's org chart, standup and approvals, Team boards with Deliverables, Workers, Budget, the Audit log and Incidents, Settings, Home (Projects, Overview, Budget), the 2D view, the Team phone open, and the phone page (`/m`).

## The big test office

`scripts/perf/fixture.ts` writes a whole office from a seed, with nothing real in it: a roster filled to every limit the office keeps (300 proposals, 200 escalations, 200 held messages, 2,000 subagent runs), 30,000 lines of chatter, 20,000 audit lines, 2,500 budget rows, 400 analysis runs, 100 incidents, 30 workers (six of them live) with their transcripts, and 200 queued tasks. A test loads every part through the office's own loaders, so the fixture always matches what the office really reads.

The live workers run the fake agent (`scripts/perf/fakebin/fake-agent.mjs`): it never calls a model, and sends tool events and transcript lines the way Claude Code does.

## Running it

From the [Test Mode page](test-mode-page.md), or from a terminal:

```sh
npm run build
node scripts/perf/run.mjs --suite pages --root <scratch>\test-offices\perf-guard\runs --out <dir> --id <id> [--soak 60] [--only board,cc-chat]
```

It makes the test office under `--root` (which must be under `scratch\test-offices` or a `test-office…` folder), starts it in test mode with the fake agent, runs the views one after another, writes `result.json`, `summary.md` and a screenshot per view, then stops the office and removes it.

A view that fails on a long task is opened again under the CPU profiler, and the result names the functions that took the time. Build with `PERF_SOURCEMAP=1` (hidden source maps, never in a normal build) to get source files and lines instead of bundle positions.

## Live warnings in the real office

- **A page froze**: every flat view and the home page watch their own long tasks. One over 500 ms is reported (at most once a minute per view, never from a hidden tab) and opens an incident naming the view and the scripts that took the time.
- **The server stalled**: the server reads its event-loop delay every 5 s. A block over 1 s opens an incident.

Both are incident rules (**A page froze**, **The server stalled**) that can be switched off in the incident settings like the others.

## The rules every new view follows

- Cap what a list draws: draw the newest or first rows and offer the rest on demand, never thousands of rows at once.
- Batch and debounce updates: many events in a second draw once.
- Never redraw a whole view for one new message: skip the redraw when nothing it shows changed.
- Don't read layout (sizes, positions) in the middle of writing the page.
