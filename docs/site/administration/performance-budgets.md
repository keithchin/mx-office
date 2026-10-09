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
| Project switch | 1.5 s | From picking another project (the floor picker in the 1D and 2D views, or a card on Home) until its view is usable and drawn. |
| Server stall | 250 ms | No block of the office server's event loop while the journey makes a project (wizard, clone, hiring), nor while six workers are busy for minutes in the busy office. A test office records every block over 100 ms (`GET /api/perf/stalls`). |

The numbers are named constants, `PERF_BUDGETS` in `src/shared/testlab.ts` (and `scripts/perf/budgets.mjs`, which a test keeps the same), so they can be tuned in one place.

The views: the Command Center (Chat and Terminal), the Board, the team's org chart, standup and approvals, Team boards with Deliverables, Workers, Budget, the Audit log and Incidents, Settings, Home (Projects, Overview, Budget), the 2D view, the Team phone open (and its floor channel), and the phone page (`/m`). Project switches are timed on the 1D Board, the 1D Command Center, the 2D view and Home → a project, with the office's own part (from asking for the floor to getting it), the fetches that follow and any `performance.mark` timings the page sets.

## The big test office

`scripts/perf/fixture.ts` writes a whole office from a seed, with nothing real in it: a roster filled to every limit the office keeps (300 proposals, 200 escalations, 200 held messages, 2,000 subagent runs), 30,000 lines of chatter, 20,000 audit lines, 2,500 budget rows, 400 analysis runs, 100 incidents, 30 workers (six of them live) with their transcripts, and 200 queued tasks. A test loads every part through the office's own loaders, so the fixture always matches what the office really reads.

The live workers run the fake agent (`scripts/perf/fakebin/fake-agent.mjs`): it never calls a model, and sends tool events and transcript lines the way Claude Code does.

## Running it

From the [Test Mode page](test-mode-page.md), or from a terminal with the same entry points:

```sh
npm test                  # every unit test file, with time limits (Windows too)
npm run test:perf:quick   # builds, then the main views (5 s soak), the journey and a minute of the busy office: a few minutes
npm run test:perf         # builds, then every view (60 s soak), the switch stress, the journey and 3 minutes of the busy office
```

Before committing a change to the pages or the server, run `npm test` and `npm run test:perf:quick`. The test offices go under the nearest `scratch\test-offices\perf-guard\runs` (or `AGENT_OFFICE_TEST_OFFICES`), the results under its `results` folder.

One suite by hand:

```sh
npm run build
node scripts/perf/run.mjs --suite pages --root <scratch>\test-offices\perf-guard\runs --out <dir> --id <id> [--soak 60] [--only board,cc-chat] [--quick]
```

It makes the test office under `--root` (which must be under `scratch\test-offices` or a `test-office…` folder), starts it in test mode with the fake agent, runs the views one after another, writes `result.json`, `summary.md` and a screenshot per view, then stops the office and removes it.

A view that fails on time alone (a long task, time to usable, a switch) is opened once more and fails only if it fails again, since the office's own laptop is often busy with Studio Pro and more. A view that fails on a long task is then opened again under the CPU profiler, and the result names the functions that took the time. Build with `PERF_SOURCEMAP=1` (hidden source maps, never in a normal build) to get source files and lines instead of bundle positions.

## What it found, and the numbers now

The first run on the big office (2026-10-07) failed 10 of 18 views: the Workers view hung the page, the Team phone hung when opened, the Board's memory kept growing, and the Command Center, the Team pages, the Budget, the Audit log, Home's Overview and the 2D view each had tasks of 300 to 700 ms. The causes, all fixed:

- Views redrew everything for every worker update (dozens a second with six live workers): now drawn at most a few times a second, and only when something they show changed.
- The tab badges, the title, the phone's badge and Needs you rewrote the page about 270 times a second, each write restyling all 1,400 elements: now written only when they change.
- Long lists drew every row (hundreds of gone-home workers, a thousand chat messages): now the first or newest rows, with Show more, and rows off screen skip layout and paint.
- The board read its scroll positions from the layout before each redraw; the 2D sprites were read back from the GPU; the phone opened a sound device in the middle of a paint.
- On the server, each Audit log page re-hashed the whole log, and the ranking was worked out for every look.
- Switching projects fetched the same roster four times and ran git six times for the setup panel three times over, and now and then left the new floor's budget unloaded (the loading overlay waiting 15 s).

The run after the fixes (scale 10, six live workers, 60 s soak per view):

| View | Time to usable | Project switch | Longest task | Heap growth |
| --- | --- | --- | --- | --- |
| Command Center (Chat) | 788 ms | | 165 ms | 12 % |
| Command Center (Terminal) | 630 ms | | 194 ms | 8 % |
| Board | 262 ms | | 166 ms | 8 % |
| Team: org chart / standup / approvals | 340 / 229 / 358 ms | | 82 / 106 / 78 ms | under 5 % |
| Team boards and Deliverables | 270 ms | | 125 ms | 12 % |
| Workers | 256 ms | | 79 ms | 12 % |
| Budget | 438 ms | | 83 ms | 4 % |
| Audit log / Incidents | 190 / 250 ms | | 82 / 111 ms | 5 % |
| Settings | 236 ms | | 115 ms | 9 % |
| Home: Projects / Overview / Budget | 188 / 213 / 163 ms | | 70 / 75 / 0 ms | under 12 % |
| 2D view | 289 ms | | 127 ms | 18 % |
| Team phone (open / floor channel) | 265 / 615 ms | | 94 / 173 ms | under 8 % |
| Phone page (`/m`) | 181 ms | | 0 ms | 5 % |
| Switch: 1D Board / 1D Command Center / 2D view / Home → project | | 1,113 / 535 / 169 / 337 ms | 58 to 115 ms | |
| Switch 10× on the 1D Command Center | | p90 525 ms | 0 ms | |

### The second pass (2026-10-07)

- **The server stalled 3 to 16 s during the wizard**, every journey, right after the clone step. A CPU profile of the office put it on programs started on the event loop: on Windows starting a program (CreateProcess) runs on the thread that asks, and a binary the virus scanner hasn't seen yet (gh, mx, claude) takes seconds there; around them git ran with `execFileSync` for every hire, floor opened and restart-state look. Programs now start from a thread of their own (`server/offloop/exec.ts`), branch, origin and HEAD are read from the checkout's files (`server/gitfiles.ts`), and hiring into a worktree runs git without blocking. Before: a 4.4 to 4.6 s block every run; after: no block over 100 ms (the journey now fails on one over 250 ms), wizard 11.2 → 7.6 s, hiring 9.7 → 4.6 s.
- **The first Budget look and the setup panel's first look** waited 0.8 s and 3.5 to 4.5 s on a fresh big office (the Budget one blocking the server 840 ms): the analyzer rewrote its whole record file for every record it settled, the budget files were written and renamed on the event loop, and the benchmark scored every run again for every worker. Now: written once and in the background, scored once per record, the ranking and each floor's setup view worked out in the background after the office starts and when a floor is added, and both answer stale-while-revalidate. First Budget look 830 → 130 ms; after the warm-up both answer in about 20 ms.
- **⏸ Pause project waited three minutes** on an agent whose handoff turn was shorter than its two-second look. Every turn is counted as it starts now; the pause sees one that came and went between looks.
- **On a scrubbed copy of this office's real data** (`scripts/perf/real-shape.mjs`: two floors, 13 worktrees) every view and project switch was within budget; Settings' first open was borderline once (202 and 221 ms, then 165 ms). Switches took 63 to 91 ms.
- **The Command Center's terminal** draws with xterm's DOM renderer (its first draw 150 to 290 ms). xterm 6 has no canvas renderer any more, and its WebGL addon isn't installed (it isn't small, and a headless browser draws WebGL in software), so it stays as it is; the next thing to try is writing only the visible tail of the scrollback first.

The quick check after this pass (`npm run test:perf:quick`, scale 10, 5 s soak):

| View | Time to usable | Project switch | Longest task |
| --- | --- | --- | --- |
| Command Center (Chat) | 424 ms | | 75 ms |
| Board | 259 ms | | 128 ms |
| Team: org chart | 314 ms | | 108 ms |
| Workers | 313 ms | | 90 ms |
| Budget | 337 ms | | 102 ms |
| Audit log | 244 ms | | 125 ms |
| Home: Projects | 129 ms | | 80 ms |
| 2D view | 199 ms | | 126 ms |
| Team phone (open) | 442 ms | | 129 ms |
| Switch: 1D Board / 1D Command Center | | 202 / 203 ms | 114 / 100 ms |
| Switch 3× on the 1D Command Center | | p90 187 ms | 0 ms |
| Journey | 12/12 steps, longest server block under 100 ms | | |

### The third pass: stalls with workers live (2026-10-08)

The first two passes measured views and the journey, never an office whose workers kept working for hours. Release 18 then stalled for 1.6 to 3.2 s every few minutes on this machine (incident INC-12), while its agents sat idle and nobody touched it. A profiler couldn't be attached to the live office, so the causes were found by reading what runs on its own and timing each piece on the same machine:

- **Starting the `claude` binary held the event loop 0.65 s every time.** The office's own background calls to Claude Haiku (the analyzer classifying a run, the project summaries, Jeff's fallback, the ranking's highlights), the task namer and the Firm's reviewers started `claude -p` on the main thread. On Windows the start itself (CreateProcess, with the virus scanner looking at the 256 MB binary) runs on the thread that asks: 650 ms each time, measured on the office's own laptop, and 1.3 to 7.9 s the first time a new binary starts (after a Claude Code update, or mxcli's first run). The live office's ledger shows 32 such calls that day with no agent working. They now start from the process-starter thread (`server/offloop/exec.ts`), as gh and git already did, and so does Studio mode's look for Studio Pro every 4 s.
- **The analyzer read each session's whole transcript, and every subagent's, again for every run it recorded**: at every turn's end, every open PR's quarter-hourly look and the first look after a start. About 6 ms per MB, and a long session with its subagents is tens of MB (155 MB for one here: 0.9 s). It now keeps a reader per session and reads only what was appended, a half-MB slice at a time with the event loop free in between (`analysis/transcript.ts` `readSessionLive`).
- **The scrollback save serialized every busy terminal in one go** every 15 s (80 to 180 ms with a few workers): now one terminal per turn of the event loop, and the 10 s usage scan the same (`server/offloop/apart.ts`).
- **A sleeping computer counted as a stall** (a 155 s "stall" the night before): see below.

The **busy office** (`scripts/perf/busy.mjs`, suite `busy`, part of `npm run test:perf:quick` for a minute and of `npm run test:perf` for three) now holds this: a fresh fixture whose six live workers work like real ones (turns of tool calls with real-sized results, a Stop, a pause, the next prompt) on sessions with 30 MB of history each, open PRs due their look, a background `claude` as big as the real one, and pages asking for the ranking, analysis, budget and roster every 4 s. On release 18 it failed: 18 blocks over 100 ms in 90 s, the longest 309 ms. Now: 2 blocks over 100 ms, the longest 108 ms. On the scrubbed copy of the real office with its workers busy and two pages open: 5 blocks over 100 ms and a 365 ms one at start before, none over 100 ms after.

### The fourth pass: workers' terminals start off the event loop (release 20)

After release 19 the live office still stalled whenever workers started: its own CPU profile put the longest block, 2,582 ms, in node-pty's `WindowsPtyAgent._completePtyConnection`, where the pseudo console starts the agent (CreateProcess of the 256 MB `claude.exe`, with the virus scanner reading it: 0.65 to 2.6 s each time, on the thread that asks). A safe restart that woke six agents stalled the server for 2.6 s twice.

On Windows every worker's terminal now runs in the **terminal host**, a small node process of its own (`agent-office-ptys`, `src/server/ptyhost.ts`) that each floor's office starts once (from the process-starter thread) and talks to over a named pipe. node-pty's native calls (starting a terminal, writing, resizing, killing) happen there; the office's main thread only writes a line to the pipe. The host is tied to the office: it ends every terminal and exits as soon as the office's pipe closes or its process is gone (checked every 2 s as a backstop), and if the host itself dies its terminals end with it (their pseudo consoles close). The office then resumes those workers in a fresh host; a host that dies more than three times in ten minutes isn't started again and terminals run in the office, as before. What stays on the main thread: parsing the host's output lines (the same work the Unix host always had), and the one start of the host per floor. `AGENT_OFFICE_PTY_HOST=off` runs terminals in the office as release 19 did (for troubleshooting). Claude Code's sign-in (☰ → 🔐 Your sign-ins) starts in the host too.

The busy office (`scripts/perf/busy.mjs`) now ends with a **wake burst**: six asleep workers are woken at once, right after a fresh agent binary went in (`scripts/perf/slowstart.mjs`: the tests' shim with 24 MB of random bytes after it, which the scanner reads through on its first start), and the server must stay under 250 ms while they start. With terminals in the office (release 19's way, `AGENT_OFFICE_PTY_HOST=off`) it fails: one block of 3.9 to 4.8 s. With the host: no block over 100 ms. `tests/ptys-host-win.test.ts` checks the host itself: output, multi-line input, resize, exit codes, kill, a failed start, the host dying under the office, the office dying under the host, and three fresh binaries starting with the event loop held under 250 ms.

### The fifth pass: a loaded machine (2026-10-08)

The busy office and the journey passed on a quiet machine but failed on this laptop while the live office ran three Mendix builds (java, mxbuild) with the virus scanner busy: blocks of 0.4 to 2.4 s. The office's own CPU profiles (and `PERF_BUSY_LOAD=<n>`, which runs the busy check with n disk hammers in the test office's folder, `scripts/perf/diskload.mjs`, to reproduce it at will) put every one on synchronous file work or a synchronous system call on the event loop, each harmless on a quiet machine:

| What held the loop | Where | Longest seen | Now |
| --- | --- | --- | --- |
| The ranking's background refresh: every journal, every project's files, every worker graded in one go | `ranking/index.ts` | 1,807 ms | Inputs read with fs/promises, only files whose time or size changed (`ranking/inputs.ts`); grading a slice at a time (`buildRankingSliced`, the same report) |
| The machine monitor's `os.cpus()` (Windows reads each core's details from the registry) | `machine.ts` | 1,105 ms | Read in a worker thread (`offloop/cpu.ts`); the core count read once |
| The Office Ledger's `usage.json`, the roster files, the analyzer's classes, the ranking's history, the scrollback, the flow checkpoints | various | 1,500 ms | Written in the background, a temporary file then a rename, the latest text only (`offloop/save.ts` `BackgroundFile`); what's still due is written at exit |
| A new time-zone formatter at every worker update (the standup clock) | `shared/roster/schedule.ts` | 313 ms | One per zone |
| Looking for each session's transcript one folder at a time, then reading it with readSync | `analysis/transcript.ts` | 303 ms | fs/promises |
| The Leads' transcripts every 10 s, the chatter's and the Team tab's journals | `roster/subagent-live.ts`, `roster/journal-io.ts` | 564 ms | fs/promises; a journal look answers from the last background read |
| Every part of the office looking for `claude` on the PATH (an access call per folder and extension) | `workers/process.ts` | 203 ms | Cached; the warm-up looks the usual commands up in the background |
| The wizard's clone step, its checkpoint and opening the new floor in one go; a hire writing a dozen Playbook files | `flow/engine.ts`, `roster/playbooks.ts` | 1,684 ms | A turn of the loop between steps, before opening the floor, and after each file |
| Every busy terminal's screen read in one flush | `workers/terminal.ts` | 201 ms | At most 20 ms per flush; the rest go in the next |

Two of the blocks were the guard's own: starting the office's CPU profiler and saving its profile each held the loop 0.2 to 1.2 s on the loaded machine, inside the measured minute. The busy check and the journey now start the profile before the stretch they measure, and the journey's server check names what ran in a stall it finds.

What is left is the machine itself. With the builds running, a block now and then still lands on code that does almost nothing (a 1 s garbage collection of a small heap, 300 ms in Node's HTTP header parser, 100 ms in a regular expression): the office's thread wasn't given the CPU. Those are scheduling, not work to move, and the 250 ms budget stays as it is.

Measured on this laptop (32 threads, the live office busy with its builds):

| Run | Machine | Busy office (60 s) | Journey's server check |
| --- | --- | --- | --- |
| Before (release 22) | 3 builds, scanner busy | 13 blocks over 100 ms, longest 966 ms; 1.8 s in another run | one block of 412 to 789 ms |
| With 6 disk hammers, before / after the hook-path fixes | 63 % CPU | 50 blocks, longest 2.4 s / 34 blocks, longest 1.2 s, all on trivial frames | |
| After, quick check | 34 % CPU, 4 java, 3 mxbuild | 0 blocks over 100 ms | longest 203 ms: pass |
| After, quick check | 59 % CPU, 4 java, 2 mxbuild | 0 blocks over 100 ms | 340 ms in opening the new floor (fixed since) |
| After, quick check | 70 % CPU, 4 java, 2 mxbuild | 0 blocks over 100 ms | 5 blocks of 280 to 580 ms in wizard steps: still open |

## Live warnings in the real office

- **A page froze**: every flat view and the home page watch their own long tasks. One over 500 ms is reported (at most once a minute per view, never from a hidden tab) and opens an incident naming the view and the scripts that took the time.
- **The server stalled**: the server reads its event-loop delay every 5 s. A block over 1 s opens an incident. A gap of a minute or more during which the process used almost no CPU (under a fifth of the gap), or the wall clock ran ahead of the monotonic one, is the computer sleeping: it is logged as a notice and opens no incident.
- **The office profiles itself when a stall comes back.** A second stall within 30 minutes of the first starts a CPU profile of the office's own main thread (in-process, through `node:inspector`: nothing to attach, nothing running until then), at most once an hour. It runs until the next stall is caught (or 5 minutes) and goes on the stall's incident timeline: where the `.cpuprofile` was saved, what ran in the longest block and which office functions called it, and the top 10 functions by self time. The last 10 profiles are kept in `.agent-office/perf/profiles`.
- **Record one by hand**: the [Test Mode page](test-mode-page.md)'s *This office's server* part has ⏺ Record 60 s CPU profile (admins only; `POST /api/perf/profile {seconds}`, 5 to 300). It shows the same summary and links the file; `GET /api/perf/profiles` lists them and `GET /api/perf/profiles/<file>` downloads one for Chrome DevTools (Performance › Load profile) or VS Code.

Both are incident rules (**A page froze**, **The server stalled**) that can be switched off in the incident settings like the others.

## The rules every new view follows

- Cap what a list draws: draw the newest or first rows and offer the rest on demand, never thousands of rows at once.
- Batch and debounce updates: many events in a second draw once.
- Never redraw a whole view for one new message: skip the redraw when nothing it shows changed.
- Don't read layout (sizes, positions) in the middle of writing the page.
