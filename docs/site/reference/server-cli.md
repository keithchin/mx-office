---
title: Server CLI
description: The agent-office command - its subcommands and every option, such as --port, --password and --home.
weight: 6
---

The office server is `node bin/agent-office.js` (or `agent-office` when installed). `agent-office --help` prints all of this.

## Usage

```text
agent-office [options]
agent-office [dir] [options]
agent-office setup [--projects <dir>] [--project <owner/repo>]...
agent-office prune [dir] [--dry-run] [--force]
agent-office accounts [list|invite|revoke|role|password] ...
agent-office tunnel [office@address | url]
```

Given a `[dir]`, the office keeps its data in `<dir>/.agent-office` and that project starts as a floor. The launcher runs it on the mx-spike folder this way.

## Commands

| Command | Does |
|---|---|
| `setup` | Pick the projects folder and clone projects as floors |
| `prune` | Remove leftover worker worktrees and their `office/*` branches (keeps anything with unsaved work unless `--force`) |
| `accounts` | Invite, list and revoke people's accounts; switch the shared password off or on |
| `tunnel` | On your own computer, for an office elsewhere: open each worker's web server on the same port here |

## Options

| Option | Meaning |
|---|---|
| `--home <dir>` | Data folder when no `[dir]` is given (default `~/agent-office`) |
| `--projects <dir>` | Where new floors are cloned |
| `-p, --port <n>` | Port (default 4600) |
| `-H, --host <addr>` | Address to bind (default `127.0.0.1`: only this machine) |
| `--password <pw>` | The office password |
| `--claim-token <t>` | Show a generated password once at `/claim?t=<t>` |
| `--reset-password` | Forget the generated password and exit |
| `--no-open` | Don't open the browser |
| `--agent <cmd>`, `--agent-args <str>` | Default agent command and extra arguments (a command named after no provider runs Claude Code workers too) |
| `--test-mode` | Refuse to start any real agent CLI; only the fake `--agent` runs (also `AGENT_OFFICE_TEST_MODE=1`, and on by itself under a `scratch` or `test-offices` folder) |
| `--dsh-profile <n>` | DeepSeek Harness profile |
| `--tls-cert <file>`, `--tls-key <file>` | Serve HTTPS with your certificate |
| `--self-signed` | Serve HTTPS with a generated certificate |
| `--trust-proxy` | Trust `X-Forwarded-*` headers behind a proxy |
| `--turn <url>` | A TURN server for voice (repeatable) |
| `--budget <usd>`, `--budget-pause` | Office-wide daily budget, and stop hiring when it's spent |
| `--max-workers <n>` | Most workers at once |
| `--webhook <url>` | Slack or Discord webhook |
| `--city <name>`, `--weather <kind>`, `--real-time-sky` | The 3D office's sky |
| `-h, --help` | Help |

## Examples

```bash
# The real office (what the launcher does, roughly)
node bin/agent-office.js C:/Users/<you>/agent-spike/mx-spike

# A test office: its own port, password and data
AGENT_OFFICE_HOME=C:/Users/<you>/agent-spike/test-home/try node bin/agent-office.js --port 4710 --password test-only-123 --no-open
```
