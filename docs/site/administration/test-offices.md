---
title: Test offices
description: Try a change on a throwaway office - its own port, password, data folder and cloned floors - without ever touching the real office or its agents.
weight: 4
---

Before a change goes to the real office, it's tried on a **test office**: a second server with its own port, password, data and floors.

## The rules

> [!CAUTION]
> **Never point a test office at a real floor folder** (such as `agent-spike\mx-spike` or `agent-office\AI-Taskforce-Labs\travel-approval`). Each floor keeps its own `workers.json`, so an office opened on it **restores and resumes the real agents**, which then run in the real worktrees. Never touch the real office on port 4600 or its data.

- Use ports in the **47xx** range (or 48xx).
- Use a throwaway password, such as `test-only-123`.
- Use a data home under `agent-spike\test-home\<name>`, with its **own** `floors.json`.
- Floors are **throwaway clones** (or new empty git repositories) under that test home.
- Keep the test floors' `workers.json` empty unless you want real `claude` processes.
- When done, stop the test office and check that no `node`, `claude` or browser processes it started are left.

## Running a test office safely

On 2026-10-06 three test offices started **real** Claude Code sessions instead of their fake agent (see [Incidents](../using-the-office/incidents.md#the-incidents-of-2026-10-06)): the office used to honour a fake `--agent` for Claude workers only when its file was named `claude`. Two things now stop that:

- **A fake of any name works.** `--agent C:pathake-agent.cmd` (or `AGENT_OFFICE_AGENT`) runs Claude Code workers too, whatever the file is called, as long as its name isn't another provider's (`codex`, `opencode`…).
- **Test mode** refuses to start any real agent CLI (`claude`, `codex`, `opencode`, `grok`…). It's on with `--test-mode` or `AGENT_OFFICE_TEST_MODE=1`, and **by itself** when the office's folder or a floor's is under a folder named `scratch` or `test-offices`. Only these may start then:
  - the command given with `--agent` / `AGENT_OFFICE_AGENT`;
  - an executable that itself lives under a `scratch` or `test-offices` folder, or whose name says `fake`, `mock` or `stub` (so a fake `claude.cmd` first on `PATH` from a scratch folder still works).

  Anything else fails to start with *Test mode: refused to start the real claude…* on the worker's card and terminal, and opens a near-miss [incident](../using-the-office/incidents.md). The top bar shows a **TEST MODE** badge. `AGENT_OFFICE_ALLOW_REAL_AGENTS=1` lets real agents through anyway (each one is a sev2 incident).

So: start every test office with `--test-mode` and a fake `--agent`, keep it under `scratch	est-offices<name>`, and prefer seeding data (a `workers.json`, the audit log, incidents) to hiring.

```bash
AGENT_OFFICE_HOME="C:/Users/<you>/agent-spike/scratch/test-offices/try" node bin/agent-office.js --port 4710 --password test-only-123 --no-open --test-mode --agent "C:/Users/<you>/agent-spike/scratch/fake-agent.cmd"
```

## Start one

From the branch's worktree, after `npm run build`:

```bash
AGENT_OFFICE_HOME="C:/Users/<you>/agent-spike/test-home/try" \
node bin/agent-office.js --port 4710 --password test-only-123 --no-open
```

Then open `http://127.0.0.1:4710` and add a throwaway floor.

## Screenshots in a test office

Playwright with the bundled Chromium works (headless Edge is blocked on the laptop). For realistic screenshots without real agents, inject sample data into the page rather than hiring.
