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

## Start one

From the branch's worktree, after `npm run build`:

```bash
AGENT_OFFICE_HOME="C:/Users/<you>/agent-spike/test-home/try" \
node bin/agent-office.js --port 4710 --password test-only-123 --no-open
```

Then open `http://127.0.0.1:4710` and add a throwaway floor.

## Screenshots in a test office

Playwright with the bundled Chromium works (headless Edge is blocked on the laptop). For realistic screenshots without real agents, inject sample data into the page rather than hiring.
