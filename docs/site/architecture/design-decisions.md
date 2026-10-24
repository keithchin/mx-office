---
title: Design decisions
description: Why the main mechanisms of Mx Office exist, the observed failures that led to them, the trade-offs they make, their current limitations, and the questions still open.
weight: 60
---

> [!NOTE]
> Describes release 74 (`c4c6a14` on `main`). **Last checked against release 74 on 2026-10-24** for the current limitations below; the mechanisms table was written against release 66 (`39d0083a`, 2026-10-20), and the decisions of releases 67 to 74 (merge gate, security gate, business status, hot reload, the Developer view) are on their own pages, not yet in that table.
> **Verification scope:** the *history* column comes from the published [Release notes](../release-notes.md) and is kept apart from current guarantees. The *mechanism* column was confirmed in code; the restart, dispatch, store-safety and desktop teardown mechanisms are also covered by tests that were run. Limitations are from code reading.

History explains why something exists; it isn't a promise about what the code does now. For what the office guarantees today, see [State and sources of truth](state-and-truth.md) and [Trust and authority](trust-and-authority.md).

## Mechanisms and the failures behind them

| Observed failure (release) | Decision | Mechanism today | Trade-off |
|---|---|---|---|
| A test office's *Cancel and undo* used an inherited GitHub token and deleted a real repository (release 38) | Test offices never get GitHub credentials | `src/server/testcreds.ts` drops token variables and credential helpers; the delete check looks at the actual executable | A test office can't exercise real GitHub paths; fakes stand in |
| *Cancel and undo* could delete repositories the office had only adopted (release 40) | A destructive external action needs recorded ownership | Setup operation records written before the command (critical write), reconciled after (`src/server/wizard/operations.ts`, `reconcile.ts`) | Ambiguous outcomes stop the wizard and wait instead of guessing |
| Answers were lost, or sent twice, across restarts (release 48) | Durable intent plus reconciliation, never a blind replay | Answer revisions (fsync'd append) and hand-off records (critical write), reconciled from the transcript (`src/server/answers/`, `dispatch/`) | Some answers end as *outcome unknown* and need a person |
| An answer was reported sent while it still sat in the agent's input box (release 56) | Typed is not received | The transcript marker, one extra Enter at most, then *outcome unknown* (`src/server/dispatch/typed-watch.ts`) | Depends on the provider writing a transcript the office can read |
| A virus-scanner lock or a crash emptied the project list, the team or the hand-off history (release 56) | Only a missing file means empty; quarantine the rest | `src/server/durable/read.ts` moves a corrupt file aside and recovers from the backup; a locked file blocks writes and raises an incident | A locked file stops work on that store until it clears |
| Held messages were lost on restart (releases 16–17) | Persist holds with an idempotency id | `src/server/roster/held.ts` | Held messages expire after 24 hours |
| A safe restart froze the office for 2.6 s while it started agents (release 20) | Move terminal creation out of the office's event loop | The Windows PTY host process (`src/server/ptys.ts`), tied to the office | On Windows agent terminals end with the office; they are resumed by session id, not kept |
| Every commit carried the person's identity, and PRs merged without review (release 56) | Agent git identity, and a review detector after the merge | `src/server/workers/git-identity.ts`, `src/server/review-gate/` | The identity is set by environment (agents can change it); the gate detects, it doesn't block |
| The same decision was filed several times from journals and chats (releases 49, 56) | A same-item rule and folding by explicit ids | `src/shared/decisions/same-item.ts`, `group.ts` | Two asks without a shared id can still both appear |
| Agents claimed applies and passes that git didn't back (release 61) | A deterministic claims check | `src/server/claims/` compares claims with git, without running anything | It checks the claim has git evidence, not that the work is right |
| Walkthrough batches failed on cold bundles, taken ports, session caps and journey order (releases 62–65) | A warm recording workspace, one retry, one session per account, a start-state planner | `src/server/app-instance/`, `src/server/walkthroughs/` | Failed automatic recordings aren't retried later |
| A gateway API key was passed without its base URL (releases 58–59) | The key and the base URL are one set | `src/server/claude-auth/` | — |
| Desktop Quit left a windowless process that the next start handed over to (release 66) | An ordered, capped teardown | `desktop/src/core/teardown.ts` | Steps that take longer than 3 s are abandoned; the process exits after 5 s regardless |

## Recurring trade-offs

- **Detect rather than block.** The review gate, the claims check, stuck detection and the pushes check all look after the fact and raise a card. Blocking would need either branch protection on GitHub (outside the office) or a guard in every agent's tool use (only for Claude, and bypassable by an agent with the shared token). The office chose to stay honest about what happened instead of claiming to prevent it.
- **Derive rather than store.** Task outcomes, readiness and stage progress are recomputed from git, GitHub and files. That keeps them from drifting from their sources, at the cost of depending on how those sources are written (commit subjects, report fields, journal lines).
- **Instructions plus evidence.** Most process rules live in Playbooks and toolkit skills. The office can't make an agent follow them; it can show what the evidence says.
- **Prose inference.** About seventeen places read agents' prose: whether a prompt is a task, whether an agent said it finished, a `Review:` comment's layout, `AWAITING-PM:` lines, build-log words, `Decided per ESC-…` lines. Each needed fixes over releases 49–61. Structured reports are proposed, not built ([Proposed simplifications](proposals.md#structured-agent-reports)).
- **One machine, one user.** Running everything as one OS user keeps setup simple and Studio Pro usable, and gives up isolation between agents, projects and clients.

## Current limitations

1. **The office blocks only its own Merge button.** Reviews are now bound to the reviewed revision and their verdict, and the PR window's Merge refuses a head without an independent approval ([merge gate](../using-the-office/review-gate.md#the-merge-gate)). An agent's own `gh pr merge` still goes around it unless the repository's branch protection requires the office's `mx-office/review` status, which a person sets up on GitHub. Reviewer identity is the office's record (the agent a comment names, the person signed in), not a GitHub account: all agents share one.
2. **No process or filesystem isolation** between agents, projects or clients; hook tokens are readable by any agent.
3. **The live app doesn't come back by itself after an office restart** (only the last served commit is kept, shown as *last ran*; **Keep warm** starts it with the office), a hung runtime keeps reading *running* (it isn't probed again once up), and a failed update has no fallback to the previous build: the runtime reuses one folder and one database, with no database backup.
4. **Readiness** could read Ready with no journey evidence (fixed after release 66: such a milestone now reads *built, no journey evidence yet*), reads plan and journeys at main rather than the running commit, and relies on report files declaring their own revision. The toolkit's journey runner writes no commit.
5. **Needs-you counts differ by surface.** Since release 67 the tray, Home, Teams and phone pushes share one count (`src/shared/needs-actionable.ts`), and an answer whose delivery is unknown is in it; other surfaces (the project strip, the phone badge and Status tab) still count by their own rules, and follow-through items are only on the Overview's card (see [Needs you](../using-the-office/needs-you.md)).
6. **Decision answers to a working agent are typed at once** (Claude Code queues them); the ready-or-busy question covers standups, quick questions and lead tells only.
7. **Three ways of telling an agent**: your answers and tells are durable hand-offs; agent-to-agent tells go through delivery but aren't durable; the idle-lead console prompt skips delivery's checks.
8. **No CI from the product.** The office reads a project's CI (PR checks, the scorecard comment) but writes no workflow, so a new project has none until someone adds one ([CI pipeline](../integrations/ci-pipeline.md)), and required checks then read as missing. (Fixed in release 67: cancelled, timed-out and similar CI conclusions read as failed, a failed GitHub read is shown as such, and the tell limit survives a restart.)
9. Several small stores replace atomically without fsync; walkthrough settings and manifests use a plain write; acceptance appends aren't fsync'd.
10. Toolkit pins can fall well behind the public upstream, a pin can be reproduced only where the office's toolkit clone has that commit, mxcli isn't pinned at all, and the office's walkthrough planner doesn't read the upstream journey-ordering fields.

## Open questions

- How reliably does `--resume` bring back a Windows agent after the provider's session expired? The fallback starts fresh with only a toast. (Not verified.)
- What should the review gate and the pushes check do on Team Server or other non-GitHub remotes? No code path exists; behaviour is untested.
- Power-loss durability is explicitly not claimed. Is that acceptable for the answer and hand-off stores?
- Does an expired held message settle the hand-off it carried? (Not re-checked in this assessment.)
- Should a Solo team's review burden be stated in the wizard and counted by the gate? (See [Proposed simplifications](proposals.md#review-safeguards).)
- How often does a real project reach Ready, and on what evidence? (Needs real project data.)
