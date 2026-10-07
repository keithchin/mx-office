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

- **A fake of any name works.** `--agent C:\path\fake-agent.cmd` (or `AGENT_OFFICE_AGENT`) runs Claude Code workers too, whatever the file is called, as long as its name isn't another provider's (`codex`, `opencode`…).
- **Test mode** refuses to start any real agent CLI: `claude`, `codex`, `opencode`, `grok`, `muse`, `cursor-agent`, `dsh`, `pi` and a few more (`gemini`, `aider`…). It's on with `--test-mode` or `AGENT_OFFICE_TEST_MODE=1`, and **by itself** when the office's folder or a floor's is under `scratch\test-offices` or a folder whose name starts with `test-office` (`test-office-budget`, `test-offices`). A plain `scratch` folder doesn't turn it on any more. Only one thing may start then:
  - the fake given with `--agent` / `AGENT_OFFICE_AGENT`, for the workers it runs, and only when it isn't itself a real agent CLI: `--agent codex` (or `--agent C:\Users\<you>\AppData\Roaming\npm\claude.cmd`) is refused like any other. A fake may still be called `claude.cmd` when it lives in a test office's folder.

  Anything else (another provider's CLI for a worker someone picked it for, or the real `claude` on `PATH` when the office wasn't started with `--agent`) fails to start with *Test mode: refused to start the real claude…* on the worker's card and terminal, and opens a near-miss [incident](../using-the-office/incidents.md). The top bar shows a **TEST MODE** badge. `AGENT_OFFICE_ALLOW_REAL_AGENTS=1` lets real agents through anyway (each one is a sev2 incident).

The [Test Mode page](test-mode-page.md) (☰ → 🧪 Test mode, admins) shows whether the office you are on is in test mode, and runs the performance and journey suites against a throwaway test office of their own.

So: start every test office with `--test-mode` and a fake `--agent`, keep it under `scratch\test-offices\<name>`, and prefer seeding data (a `workers.json`, the audit log, incidents) to hiring.

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
