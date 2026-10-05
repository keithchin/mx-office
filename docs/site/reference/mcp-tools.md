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
| `escalate` | **title**, urgency, trigger, details, options[], recommendation | `office-workers escalate` |
| `subagent` | **op** (list, review, warn, bench, swap-model, reinstate), name, verdict (accept, rework), note, reason, model | `office-workers subagent` |

## Allowed without asking

Claude Code workers may call **`list_workers`**, **`escalate`** and **`subagent`** without a permission prompt. The others ask first, like any tool.

> [!NOTE]
> `escalate` is on the allow list on purpose: an agent should never be stuck on a permission prompt when it's trying to reach you.
