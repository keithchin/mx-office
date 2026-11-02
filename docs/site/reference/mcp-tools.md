---
title: MCP tools
description: The office-workers commands as MCP tools for agents - names, parameters, and which ones agents may call without asking.
weight: 2
---

`office-workers mcp` serves the same commands as **MCP tools**, on a server named `agent-office`. In Claude Code they appear as `mcp__agent-office__<tool>`. The office wires it into each worker (Claude Code through `--mcp-config`, Codex and OpenCode through their own settings).

| Tool | Parameters (required in **bold**) | Same as |
|---|---|---|
| `list_workers` | none | `office-workers list` |
| `hire_worker` | **prompt**, provider, model, effort, worktree, desk, issue | `office-workers hire` |
| `send_home` | workers[], merged, cleanup (auto, keep, worktree, all) | `office-workers home` |
| `tell_worker` | **worker**, **prompt** | `office-workers tell` |
| `link_pr` | pr, worker, unlink | `office-workers pr` |
| `escalate` | **title**, urgency, trigger, details, options[], recommendation, artifact | `office-workers escalate` |
| `subagent` | **op** (list, review, warn, bench, swap-model, reinstate), name, verdict (accept, rework), note, reason, model | `office-workers subagent` |
| `marketplace_add` | **id**, **kind** (widget, module), version, name, why | `office-workers marketplace add` (`office-marketplace add`) |
| `propose_phases` | **reason**, **phases** (name, goal, rows, journeys, estimate {min, max}, foundation, useCases, days, checkpoint, publish), summary, cutover | `office-workers phases propose` (JSON with `phases`): the phases at the Build Plan gate, for the PM on the Roadmap ([Phased delivery](../using-the-office/phased-delivery.md)) |
| `propose_phase_change` | **reason**, **ops** (rename, move-rows, reorder, split, merge, toggle, overlap, estimate, journeys, add), summary | `office-workers phases propose` (JSON with `ops`): a change to the approved phases |
| `phases_status` | none | `office-workers phases status` |
| `app_start` | **commit**, wait, constants (`{"Module.Name": value}`, this run only) | `office-app start --const` |
| `app_status` | none (its answer has the instance's generated test password, when the project names a seed password constant) | `office-app status` |
| `app_stop` | none | `office-app stop` |
| `journey_run` | journey, file, commit | `office-app journey` |
| `app_smoke` | paths[], as | `office-app smoke` |
| `app_check` | **name**, **result**, detail, shots[], commit | `office-app check` |
| `app_test` | **commit**, wait, files, tags | `office-app test` (`--files`, `--tag`) |

## Allowed without asking

Claude Code workers may call **`list_workers`**, **`escalate`**, **`subagent`** and the app tools (**`app_start`**, **`app_status`**, **`app_stop`**, **`journey_run`**, **`app_smoke`**, **`app_check`**, **`app_test`**) without a permission prompt. The app tools only start, test and stop the office's own copy of the agent's app ([office-app](office-workers-cli.md#office-app)), so asking you for each would be engineering reaching you for nothing. The others ask first, like any tool.

> [!NOTE]
> `escalate` is on the allow list on purpose: an agent should never be stuck on a permission prompt when it's trying to reach you.
