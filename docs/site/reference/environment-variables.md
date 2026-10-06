---
title: Environment variables
description: Every environment variable the office reads - server, teams and Jeff, the new-project wizard, the live app and PR screenshots - and the ones it sets for workers.
weight: 5
---

Set these before starting the office (the launcher sets the main ones). Values that are secrets are given as **file paths** where possible.

## Server

| Variable | Meaning |
|---|---|
| `AGENT_OFFICE_HOME` | Where the office keeps its data when no folder is given (default `~/agent-office`) |
| `AGENT_OFFICE_PROJECTS` | Where new floors are cloned |
| `PORT` | Port (default 4600) |
| `AGENT_OFFICE_PASSWORD` | The office password |
| `AGENT_OFFICE_CLAIM_TOKEN` | Show a generated password once at `/claim` |
| `AGENT_OFFICE_NO_OPEN` | Don't open the browser on start |
| `AGENT_OFFICE_AGENT`, `AGENT_OFFICE_AGENT_ARGS` | The default agent command (`claude`) and extra arguments |
| `AGENT_OFFICE_BUDGET`, `AGENT_OFFICE_BUDGET_PAUSE` | Office-wide daily budget for Claude Code spend, and stop hiring when it's spent |
| `AGENT_OFFICE_MAX_WORKERS` | Most workers at once, across floors |
| `AGENT_OFFICE_WEBHOOK` | Slack or Discord webhook when a worker needs input or finishes |
| `AGENT_OFFICE_TURN` | TURN servers for voice |
| `AGENT_OFFICE_CITY`, `AGENT_OFFICE_WEATHER`, `AGENT_OFFICE_SKY_CLOCK` | The 3D office's sky and weather |

## Teams and Jeff

| Variable | Meaning |
|---|---|
| `AGENT_OFFICE_TEAMS_DRY_RUN=1` | No GitHub issues from approved proposals, on every floor |
| `AGENT_OFFICE_JEV_KEY_FILE` | Path of Jeff's Jev key file (the launcher points it at `~/.agent-office-jev-key`) |
| `TYPESAFE_API_KEY` | The Jev key itself, instead of a file |
| `AGENT_OFFICE_TOOLKIT_DIR` | The mxcli-project-toolkit clone (default `~/agent-spike/mxcli-project-toolkit`) |
| `AGENT_OFFICE_RANKING_LLM=off` | No LLM-written highlights in the rankings |

## New-project wizard

| Variable | Default |
|---|---|
| `AGENT_OFFICE_ADMIN_GH_TOKEN_FILE` | `~/.agent-office-admin-gh-token` |
| `AGENT_OFFICE_PROJECT_ORG` | `AI-Taskforce-Labs` |
| `AGENT_OFFICE_MXCLI` | `~/agent-spike/bin/mxcli.exe` |
| `AGENT_OFFICE_MENDIX_DIR` | `C:\Program Files\Mendix` |
| `AGENT_OFFICE_BASH` | Git Bash |
| `AGENT_OFFICE_JQ_DIR` | WinGet's jq |
| `AGENT_OFFICE_PYTHON` | The newest Python |
| `AGENT_OFFICE_WIZARD_OFFLINE` | Unset. When set, uses local bare repositories and writes issues as files, and hires and queues nobody (for tests) |

## Live app

These can also go in `<office data>/live-app.json`; the environment wins.

| Variable | Default |
|---|---|
| `AGENT_OFFICE_LIVE_MXCLI` | `mxcli` (the launcher sets `agent-spike\bin\mxcli.exe`) |
| `AGENT_OFFICE_LIVE_PORTS` | `8110-8199` |
| `AGENT_OFFICE_LIVE_DB_HOST` | `127.0.0.1:5432` |
| `AGENT_OFFICE_LIVE_DB_USER`, `AGENT_OFFICE_LIVE_DB_PASSWORD` | `postgres` / `postgres` |
| `AGENT_OFFICE_LIVE_POLL_SECONDS` | `60` (0 turns the auto-update off) |
| `AGENT_OFFICE_LIVE_READY_SECONDS` | `480` |
| `AGENT_OFFICE_LIVE_PG_BIN` | The newest `C:\Program Files\PostgreSQL\<v>\bin` |

## PR screenshots

| Variable | Default |
|---|---|
| `AGENT_OFFICE_PR_CHECKS_WORKFLOW` | `pr-checks.yml` |
| `AGENT_OFFICE_PR_SHOTS_ARTIFACTS` | `screenshots,test-results` |

## Set by the launcher (from files)

| Variable | From |
|---|---|
| `GH_TOKEN`, `GITHUB_TOKEN` | `~/.agent-office-gh-token` |
| `AGENT_OFFICE_PASSWORD` | `~/.agent-office-password` |
| `AGENT_OFFICE_JEV_KEY_FILE` | the path `~/.agent-office-jev-key` |

## Set by the office for each worker

`AGENT_OFFICE_HOOK_URL`, `AGENT_OFFICE_WORKER_ID` and `AGENT_OFFICE_HOOK_TOKEN`, so `office-workers` can reach the office. All other `AGENT_OFFICE_*` variables and `TYPESAFE_API_KEY` are removed from workers' environment.
