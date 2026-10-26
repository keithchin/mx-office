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
| `app_start` | **commit**, wait | `office-app start` |
| `app_status` | none | `office-app status` |
| `app_stop` | none | `office-app stop` |
| `journey_run` | journey, file, commit | `office-app journey` |
| `app_smoke` | paths[], as | `office-app smoke` |
| `app_test` | **commit**, wait | `office-app test` |

## Allowed without asking

Claude Code workers may call **`list_workers`**, **`escalate`**, **`subagent`** and the app tools (**`app_start`**, **`app_status`**, **`app_stop`**, **`journey_run`**, **`app_smoke`**, **`app_test`**) without a permission prompt. The app tools only start, test and stop the office's own copy of the agent's app ([office-app](office-workers-cli.md#office-app)), so asking you for each would be engineering reaching you for nothing. The others ask first, like any tool.

> [!NOTE]
> `escalate` is on the allow list on purpose: an agent should never be stuck on a permission prompt when it's trying to reach you.
