---
title: office-workers CLI
description: The commands agents use to manage other workers, raise escalations and manage their subagents - every command, its options and examples.
weight: 1
aliases: [/docs/cli]
---

`office-workers` is how agents manage agents. Every worker the office starts has it on its `PATH`, with the environment it needs (`AGENT_OFFICE_HOOK_URL`, `AGENT_OFFICE_WORKER_ID`, `AGENT_OFFICE_HOOK_TOKEN`). It talks to the office over a loopback port with a per-worker token. Most commands take `--json`.

## Usage

```text
office-workers list [--json]                  everyone at a desk on this floor: status, task,
                                              branch and pull request (merged = free to go home)
office-workers hire [options] <<'EOF'         hire a worker at a free desk; its task on stdin
…the task…                                    (or --prompt "…"). Options: --provider <name>
EOF                                           --model <m> --effort <e> --desk <id> --issue <n>
                                              --no-worktree
office-workers home <name|id>... [--cleanup auto|keep|worktree|all]
                                              send workers home. auto (the default) deletes each
                                              one's worktree and branch unless they hold work
                                              that isn't on GitHub, and says what it kept
office-workers home --merged                  send home everyone whose pull request merged
office-workers tell <name|id> <<'EOF'         type a prompt to a worker (or --prompt "…")
office-workers pr <number|url> [--worker <name|id>]
                                              say which pull request is a worker's
office-workers pr --none [--worker <name|id>] take that pull request off the worker again
office-workers escalate --title "…" [--urgency info|important|urgent|critical]
      [--trigger <kind>] [--option "A"]... [--recommend "A"]
      [--artifact <kind>:<ref>] <<'EOF'
…the details…                                 raise something to the Project Manager (the human);
EOF                                           details on stdin or --details "…". The answer comes
                                              back to you as a prompt
office-workers subagent list                  your subagents: model, grade, runs, state, gates
office-workers subagent review <name> --verdict accept|rework [--note "…"]
                                              record your review of its latest result
office-workers subagent warn <name> --reason "…"
office-workers subagent bench <name> --reason "…"
office-workers subagent swap-model <name> --model haiku|sonnet|opus
office-workers subagent reinstate <name>      each through your gate for it: ask (an escalation),
                                              propose (the Project Manager approves), tell or fyi
office-workers export-pdf <in.html> <out.pdf> [--landscape]
                                              render an HTML file of your worktree to an A4 PDF
                                              with the office's headless Chromium (no network:
                                              files inside your worktree only)
office-workers screenshot <in.html> <out.png> [--width 1280] [--height 800] [--viewport]
                                              the same as a PNG, the full page unless --viewport
office-workers firm ask [--team <team>] "question"   (a reviewer) ask the project team; the
                                              answer comes back as your next prompt
office-workers firm answer <id> "answer"      (a project worker) answer the Firm's question <id>
                                              (or pipe a longer answer in)
office-workers firm report --section <key> --file <json>
                                              (a reviewer) send a section of the audit report
office-workers firm evidence <name>           (a reviewer) the office's data: github, ranking,
                                              roster, summary, judge, analysis, audit, liveapp,
                                              sections
office-workers firm status                    (a reviewer) budget, questions left, who's done
office-workers firm done ["note"]             (a reviewer) everything is sent: release me
office-workers mcp                            serve these as MCP tools on stdio
```

## Commands

| Command | Does | Notes |
|---|---|---|
| `list` | Everyone at a desk on this project | A merged PR means *free to go home* |
| `hire` | Hire a worker at a free desk | `--provider`, `--model`, `--effort low\|medium\|high\|xhigh\|max`, `--desk`, `--issue`, `--no-worktree`; task on stdin or `--prompt` |
| `home` | Send workers home | `--cleanup auto\|keep\|worktree\|all`; `--merged` for everyone whose PR merged |
| `tell` | Type a prompt to a worker | Prompt on stdin or `--prompt`. Held until its turn is over when it has a question open in its terminal (kept across an office restart, let go after 24 hours); at most 5 to the same worker in 10 minutes; refused while the project's cost cap is reached. The answer says only what the office knows: *Queued for &lt;name&gt;* (it's mid-turn; the message goes in when that turn ends), *Typed into &lt;name&gt;'s terminal; the office will confirm when &lt;name&gt; receives it*, or *Received by &lt;name&gt;*, never *Told* before then. An empty message, or one that is only a marker or an untouched *About "…":* prefill, is refused: *Nothing to send: the message was empty* |
| `pr` | Link a pull request to a worker (yours without `--worker`) | `--none` unlinks |
| `escalate` | Raise something to the Project Manager | See below |
| `subagent` | Manage your subagents (Leads only) | See below |
| `export-pdf` | An HTML file of your worktree as an A4 PDF | `--landscape`; see below |
| `screenshot` | An HTML file of your worktree as a PNG | `--width`, `--height` (200 to 3840 by 2160), `--viewport` for the visible part only; see below |
| `firm` | The Firm: reviewers ask and report, the team answers | See [The Firm](#the-firm) |
| `app` | Your app instance, journeys and microflow tests | Same as `office-app`; see [office-app](#office-app) |
| `mcp` | Serve these as MCP tools on stdio | See [MCP tools](mcp-tools.md) |

## escalate

| Option | Values |
|---|---|
| `--title` | Required, up to 160 characters |
| `--urgency` | `info`, `important` (default), `urgent`, `critical` |
| `--trigger` | `plan`, `scope`, `design`, `architecture`, `revisions-exhausted`, `blocked`, `milestone`, `repeated-failure`, `budget-risk`, `security`, `data-loss`, `client-milestone`, `budget-overrun`, `blocked-no-path`, `needs-human` (a hands-on action only a person can do: merge, sign in, paste a key, install, allow, restart), `question` (a question only the Project Manager can answer). The last two are never filed as FYI |
| `--option` | Repeat up to 6 times |
| `--recommend` | Your recommendation |
| `--artifact` | What to look at to answer it: `screenshot:<path>`, `process-map:<path>`, `document:<path>` (from the project root), `walkthrough:<id>` or `journey:<J-nn>`. Shown beside the question in the Developer view; or put `Artifact: <kind>:<ref>` on a line of its own in the details |
| `--details` | Or the details on stdin |

```bash
office-workers escalate --title "Which login: SSO or local accounts?" \
  --urgency important --trigger design \
  --option "SSO with Entra ID" --option "Local accounts" \
  --recommend "SSO with Entra ID" <<'EOF'
The BRD says employees only, but the client mentioned contractors.
SSO covers employees; contractors would need guest accounts.
EOF
```

The answer comes back as a prompt: REPLIED, APPROVED, REJECTED or NOTED. See [Escalations](../teams-and-agents/escalations.md).

A hands-on ask:

```bash
office-workers escalate --title "Merge PR #51 (green four days, blocks rows 27 and 41)" --trigger needs-human <<'EOF'
Only a person can merge it at this autonomy level.
EOF
```

A Studio Pro hand-add (or "mxcli can't …") needs a `Tried:` section, or the office answers *Escalation not raised: Before this reaches the Project Manager: …* and keeps nothing (see [Studio Pro hand-adds](../teams-and-agents/escalations.md#studio-pro-hand-adds-tried-first)):

```bash
office-workers escalate --title "Studio Pro hand-add needed: photo upload on Sheet_NewEdit" --trigger needs-human <<'EOF'
The page needs a photo upload control.

Tried:
- mxcli syntax widget: no upload widget listed
- mxcli widget list -p App.mpr: no imageuploader or fileuploader
- imageuploader in MDL: MDL-WIDGET25 not a widget in this project
- mxcli marketplace search "file uploader": found 235351, install refused (no MENDIX_PAT)
- .ai-context/office/mendix-workarounds.md: the File Uploader entry, blocked on the install
EOF
```

## subagent (Leads only)

| Subcommand | Does |
|---|---|
| `subagent list` | Your subagents: model, grade, runs, state, gates |
| `subagent review <name> --verdict accept\|rework [--note "…"]` | Record your review of its latest result |
| `subagent warn <name> --reason "…"` | Warn it |
| `subagent bench <name> --reason "…"` | Bench it for the cool-down |
| `subagent swap-model <name> --model haiku\|sonnet\|opus` | Change its model |
| `subagent reinstate <name>` | Bring a benched one back |

Warn, bench, swap-model and reinstate go through your gate for them. Anyone who isn't a Lead of this project's team gets *Only a Lead of this project's team manages subagents*. See [Subagents](../automation/subagents.md).

## export-pdf and screenshot

For deliverables the client reads: the BRD report as a PDF, a storyboard of the wireframes. The office renders the page with its own headless Chromium (playwright-core and the browsers in the office machine's Playwright cache), so nothing has to be installed in the project.

```bash
office-workers export-pdf analysis/brd-report.html docs/requirements/BRD-travel.pdf
office-workers screenshot design/wireframes/home.html design/storyboard/01-home.png --width 1440
```

- Both paths must be inside your own worktree (relative paths are from where you run it); the output's folder must exist.
- The page may load files from your worktree and nothing from the network. A Mermaid script from jsDelivr or unpkg is answered with the office's own copy, so `blueprint.html` renders its diagrams.
- An input of at most 10 MB, an output of at most 50 MB, 45 seconds per render, one render at a time.
- playwright-core is one of the office's own dependencies. On a machine where its Chromium isn't downloaded yet it says so (501, with `npx playwright-core install chromium` to run there); use `py` with matplotlib or openpyxl meanwhile.

## The Firm

The Firm's [Reviewer Agents](../using-the-office/the-firm.md) and the project team talk through `office-workers firm` (`bin/office-firm.js`).

| Subcommand | Who | Does |
|---|---|---|
| `firm ask [--team <team>] "question"` | a reviewer | Ask the project team. Specialists ask their own Lead; the Engagement Partner the Project Coordinator or any attached Lead. The answer comes back as the reviewer's next prompt. |
| `firm answer <id> "answer"` | a project worker | Answer the Firm's question `<id>` (or pipe a longer answer in). |
| `firm report --section <key> --file <json>` | a reviewer | Send a section of the audit report. The office checks it and names a bad field. |
| `firm evidence <name>` | a reviewer | The office's data as JSON: `github`, `ranking`, `roster`, `summary`, `judge`, `analysis`, `audit`, `liveapp`, `sections`. |
| `firm status` | a reviewer | Budget, questions left, who's done. |
| `firm done ["note"]` | a reviewer | Everything is sent: release me. |

The Engagement Partner sends the sections `executive`, `statistics`, `findings`, `prosCons`, `rootCauses`, `timeline`, `expectations`, `workers`, `risks`, `recommendations` and `appendix` (`executive`, `findings` and `recommendations` are required); a specialist sends `reviewer`.

## office-app

Every worker also has `office-app` (`bin/office-app.js`; `office-journey run <J>` is `office-app journey <J>`, and `office-workers app …` is `office-app …`). It gives an agent **a running copy of its app at one commit**, run by the office, so it can check its own pages and flows before it says done. Never improvise `mxcli run --local` or `mxcli test --local` in a worktree: that leaves processes and databases behind, and its results count for nothing.

```text
office-app start [--commit <sha|main|HEAD>] [--no-wait]   an instance at that commit (default HEAD, committed files only); waits, prints its URL and test users
office-app status                                         your instance now
office-app journey <J-id|path> [--commit <sha>]           play a journey on it, recorded at its commit
office-app smoke [--page /p/addr]... [--as <user>]         open pages as a test user, recorded at its commit
office-app test [--commit <sha|main|HEAD>] [--no-wait]    the microflow tests at that commit, JUnit recorded there
office-app stop                                           stop it (its processes and database go)
```

- **One instance per agent.** The same commit again gives the same instance; another commit replaces it. It runs in the office's own workspace (`<data>/testing/work/<project>/instance-ag<id>`), on three free ports and a fresh database `<project>_ag<id>_<random>`, never the live app's.
- **Refused with the reason** when the machine has less than about 2.5 GB of memory free, or when 2 agents' instances already run.
- **Stops by itself** after 15 minutes without a call from its agent, and after an hour at most. Stopping ends mxcli's whole process tree, drops the database, and then ends anything whose command line still names the instance's workspace (a stale rollup-runner). What runs is kept in `<data>/agent-apps/live.json`, so an office that crashed cleans up a minute after its next start.
- **Seed.** The project's after-startup microflow runs at every start; a project that has `tests/e2e/seed.journey.json` gets it played once before the instance is ready.
- **Journeys** are the project's own (`tests/**/*.journey.json` at the instance's commit, by id or path) or a file you send (its definition revision is then *unknown*). They're played by the walkthrough recorder, unfilmed, as the journey's identity (`tests/e2e/project.config.js`), and **signed out after every run**: an unlicensed Mendix app keeps only 6 sessions. When the app refuses one anyway, the answer says so plainly (and the run counts for no journey).
- **Runtime errors fail the run.** The instance's runtime log is read for the stretch the run played: an `ERROR` or `CRITICAL` entry (a page's *Operator formatDecimal not supported…*) is a failed check with its line, even when every step passed on screen.
- **Results are bound to the commit.** Each run is a test-run record (`office-journey`) whose tested revision is the instance's commit. The [Testing](../using-the-office/testing.md) page lists it, the [Live app](../using-the-office/live-app.md)'s readiness counts its journeys for exactly that commit, and a Developer change's **Checks** fact says *journeys passed at @C*.
- **Microflow tests** run through the office's own runner (see [Microflow tests](../using-the-office/testing.md#microflow-tests)), one at a time per project, at the commit given.

The same is in the MCP server as `app_start`, `app_status`, `app_stop`, `journey_run`, `app_smoke` and `app_test` ([MCP tools](mcp-tools.md)).

## office-queue

Board agents (the ones at the issues board, PR board and queue) also have `office-queue`:

```text
office-queue list                                  what's on the queue: id, status, title, worker, PR
office-queue add --title "…" [--issue 12] <<'EOF'  add a task, its prompt on stdin (or --prompt "…")
office-queue remove <id>                           take a waiting task off
```
