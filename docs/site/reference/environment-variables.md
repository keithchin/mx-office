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
| `AGENT_OFFICE_LAUNCHER_LOOP` | `1`: the launcher restarts the office when it exits with code 75, so [🔁 Restart safely](../administration/running-the-office.md#releasing-and-restarting-safely) restarts it. Otherwise it only pauses, waits and exits |
| `AGENT_OFFICE_AGENT`, `AGENT_OFFICE_AGENT_ARGS` | The default agent command (`claude`) and extra arguments. A command named after no provider (a fake, a wrapper) also runs Claude Code workers, whatever its file name |
| `AGENT_OFFICE_TEST_MODE` | `1`: test mode, no real agent CLI starts (see [Test offices](../administration/test-offices.md#running-a-test-office-safely)) |
| `AGENT_OFFICE_ALLOW_REAL_AGENTS` | `1`: let real agent CLIs start in test mode anyway (each one opens an incident) |
| `AGENT_OFFICE_SEED_INCIDENTS` | `0`: skip the one-off import of the 2026-10-06 incidents; `1`: apply it to any office without incidents |
| `AGENT_OFFICE_BUDGET`, `AGENT_OFFICE_BUDGET_PAUSE` | Office-wide daily budget for Claude Code spend, and stop hiring when it's spent |
| `AGENT_OFFICE_MAX_WORKERS` | Most workers at once, across floors |
| `AGENT_OFFICE_WEBHOOK` | Slack or Discord webhook when a worker needs input or finishes |
| `AGENT_OFFICE_TURN` | TURN servers for voice |
| `AGENT_OFFICE_CITY`, `AGENT_OFFICE_WEATHER`, `AGENT_OFFICE_SKY_CLOCK` | The office's sky and weather (⚙️ Settings › Advanced › Outside) |

## Teams and Jeff

| Variable | Meaning |
|---|---|
| `AGENT_OFFICE_TEAMS_DRY_RUN=1` | No GitHub issues from approved proposals, on every floor |
| `AGENT_OFFICE_JEV_KEY_FILE` | Path of Jeff's Jev key file (the launcher points it at `~/.agent-office-jev-key`) |
| `TYPESAFE_API_KEY` | The Jev key itself, instead of a file |
| `AGENT_OFFICE_TOOLKIT_DIR` | The mxcli-project-toolkit clone (default `~/agent-spike/mxcli-project-toolkit`); the toolkit folder picked in [Connections](../administration/connections.md#folders) beats it |
| `MENDIX_TOKEN`, `MX_PAT` | The Mendix token, when Connections has none (then `~/Mendix/.env`). Taken out of workers' environment unless switched on for their project |
| `AGENT_OFFICE_SECRETS_HOME` | Where the office looks for its dot-files (`~/.agent-office-gh-token` and the rest) instead of the home folder: a test office points it somewhere harmless |
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

## Studio mode

| Variable | Default |
|---|---|
| `AGENT_OFFICE_STUDIO_MCP_PORT` | `7782`: where Studio Pro (11.10 and up) serves MCP on localhost |
| `AGENT_OFFICE_STUDIO_MCP_URL` | `http://localhost:7782/mcp`; wins over the port |

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

What's saved in [Connections](../administration/connections.md) beats all three; with everything there, the launcher needs none of the files.

## Set by the office for each worker

`AGENT_OFFICE_HOOK_URL`, `AGENT_OFFICE_WORKER_ID` and `AGENT_OFFICE_HOOK_TOKEN`, so `office-workers` can reach the office. All other `AGENT_OFFICE_*` variables and `TYPESAFE_API_KEY` are removed from workers' environment.

From [Connections](../administration/connections.md): `GH_TOKEN` and `GITHUB_TOKEN` (the agents' token, first of Connections, the variable, the file); `MENDIX_TOKEN` and `MX_PAT` only on a project where *Give agents the Mendix token* is ticked (removed otherwise); and `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` when a commit identity is set there (a worker's own wins).
