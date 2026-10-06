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
      [--trigger <kind>] [--option "A"]... [--recommend "A"] <<'EOF'
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
| `list` | Everyone at a desk on this floor | A merged PR means *free to go home* |
| `hire` | Hire a worker at a free desk | `--provider`, `--model`, `--effort low\|medium\|high\|xhigh\|max`, `--desk`, `--issue`, `--no-worktree`; task on stdin or `--prompt` |
| `home` | Send workers home | `--cleanup auto\|keep\|worktree\|all`; `--merged` for everyone whose PR merged |
| `tell` | Type a prompt to a worker | Prompt on stdin or `--prompt`. Held until its turn is over when it has a question open in its terminal; at most 5 to the same worker in 10 minutes; refused while the floor's cost cap is reached |
| `pr` | Link a pull request to a worker (yours without `--worker`) | `--none` unlinks |
| `escalate` | Raise something to the Project Manager | See below |
| `subagent` | Manage your subagents (Leads only) | See below |
| `firm` | The Firm: reviewers ask and report, the team answers | See [The Firm](#the-firm) |
| `mcp` | Serve these as MCP tools on stdio | See [MCP tools](mcp-tools.md) |

## escalate

| Option | Values |
|---|---|
| `--title` | Required, up to 160 characters |
| `--urgency` | `info`, `important` (default), `urgent`, `critical` |
| `--trigger` | `plan`, `scope`, `design`, `architecture`, `revisions-exhausted`, `blocked`, `milestone`, `repeated-failure`, `budget-risk`, `security`, `data-loss`, `client-milestone`, `budget-overrun`, `blocked-no-path` |
| `--option` | Repeat up to 6 times |
| `--recommend` | Your recommendation |
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

## subagent (Leads only)

| Subcommand | Does |
|---|---|
| `subagent list` | Your subagents: model, grade, runs, state, gates |
| `subagent review <name> --verdict accept\|rework [--note "…"]` | Record your review of its latest result |
| `subagent warn <name> --reason "…"` | Warn it |
| `subagent bench <name> --reason "…"` | Bench it for the cool-down |
| `subagent swap-model <name> --model haiku\|sonnet\|opus` | Change its model |
| `subagent reinstate <name>` | Bring a benched one back |

Warn, bench, swap-model and reinstate go through your gate for them. Anyone who isn't a Lead of this floor's team gets *Only a Lead of this floor's team manages subagents*. See [Subagents](../automation/subagents.md).

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

## office-queue

Board agents (the ones at the issues board, PR board and queue in the 3D office) also have `office-queue`:

```text
office-queue list                                  what's on the queue: id, status, title, worker, PR
office-queue add --title "…" [--issue 12] <<'EOF'  add a task, its prompt on stdin (or --prompt "…")
office-queue remove <id>                           take a waiting task off
```
