---
title: Trust and authority
description: Credentials and permission boundaries, human approvals, agent identity and attribution, the limits of process and filesystem isolation, and which controls the office enforces versus asks agents to follow versus leaves to GitHub.
weight: 40
---

> [!NOTE]
> Describes release 66 (commit `39d0083a`), assessed 2026-10-20.
> **Verification scope:** sign-in, admin checks, credential handling, agent environment and the Firm's isolation were read in code. The review gate's flags are covered by tests that were run (`review-gate`, 20 tests). Statements that a control is **absent** (nothing blocks a merge, no OS-level sandbox, no pre-merge check) come from code reading and search; a green test can't show an absence. Whether a Project Manager's review comment posted from the shared office account counts as a review is an inference from the code, not tested.

## The short version

- The office is a **local, single-user-account** system. Every agent runs as the same operating-system user as the office, with no sandbox between agents, projects or clients.
- **Organisational grouping and prompts are not access isolation.** Clients, teams, roles and Playbooks decide what agents are *told*, not what they *can* read or do.
- **Nothing in the office blocks a merge.** The review rule, the 10-minute wait and "merges need the Project Manager's approval" are instructions to agents. The review gate looks *after* a merge, and it checks the *shape of a review comment*, not that the merged revision was reviewed.
- Real blocking belongs to GitHub (branch protection, required reviews), which the office neither sets nor checks.

## Credentials and permission boundaries

| Topic | How it works today | Code |
|---|---|---|
| Signing in | A shared office password, or accounts (`admin` or `member`). **A session on the shared password without an account is admin.** Sessions are an HMAC cookie (HttpOnly, SameSite=Lax, 14 days) | `src/server/office/people.ts`, `src/server/auth.ts` |
| Admin checks | Per route, not central. Most write routes are admin-only; the roster's `tell`, `nudge` and `standup` actions are open to any signed-in member | `src/server/http/routes/*.ts` (for example `roster.ts`, `ADMIN_ONLY`) |
| Hiding in the page | Admin-only navigation items and settings sections are hidden from members, but a deep link still mounts them; the server still refuses the action. **The client is not a boundary** | `src/client/ui/portal/nav-logic.ts`, `src/client/ui/settings/page.ts` |
| Credentials store | `credentials.json` in the data folder, encrypted with Windows DPAPI for the current user (base64 with file mode 0600 elsewhere). It protects against other users of the machine, **not against code running as the same user**, which includes every agent | `src/server/connections/vault.ts` |
| Credentials given to agents | One shared agents GitHub token (`GH_TOKEN`/`GITHUB_TOKEN`), the Mendix token, the Claude sign-in (an API key is never passed without its base URL) | `src/server/connections/env.ts`, `src/server/claude-auth/` |
| Test offices | GitHub token variables dropped, an empty `GH_CONFIG_DIR`, credential helpers cleared | `src/server/testcreds.ts` |
| Network | The office's HTTP server listens on 127.0.0.1 by default; the hook server always does. Phone access goes through a tunnel, and forwarded headers are trusted only from loopback | `src/server/config.ts`, `src/server/hooks/server.ts`, `src/server/phone-access/` |

See [Security and tokens](../administration/security-and-tokens.md) for the how-to.

## Human approvals

Approvals are records and cards; what they hold back is mostly agent behaviour, by instruction.

| Approval | What actually happens |
|---|---|
| ✋ Stage gates (`CONFIRMED` decisions) | The toolkit's `gate-check.sh` reads the decision rows; the office shows the gate and offers the sign-off. Agents are instructed not to pass a gate without it |
| Decision cards (escalations) | Your answer is stored and handed to the agent (see [Execution lifecycle](execution-lifecycle.md)). The agent decides what to do with it |
| Merge approval at autonomy 1 to 3 | An item on the Approvals list and a Playbook instruction. **Not enforced**: an agent with the shared token can still merge, and some prompts (*Fix up and merge*) tell agents to merge |
| Permission card's **Allow this command** | Writes one exact `permissions.allow` rule (no wildcards) into the role's `.claude/settings.local.json`; audited; asks for a fresh sign-in over phone access (`src/server/decisions/permission.ts`). This is a real grant, enforced by Claude Code |
| Skills and their gates (ask / propose / tell / FYI) | Enforced by the office only for `office-workers subagent …` operations; the rest are Playbook instructions (see [Skills and gates](../automation/skills.md)) |
| Acceptance | An admin act with the password asked again, bound to a revision (see [Progress and acceptance](../using-the-office/progress-and-acceptance.md)) |

## Agent identity and attribution

| Layer | What identifies an agent | Limitation |
|---|---|---|
| **To the office** | A per-agent bearer token on every hook call | Stored **in plaintext** in `<project>/.agent-office/workers.json`, next to the worktrees, so one agent can read another's token and post as it (`src/server/workers/persist.ts`) |
| **In git** | Author `<Name> (Mx Office <role>)` at `<profile>@agents.mx-office.local`; the office is the committer | Set through environment variables, so an agent can change it (`src/server/workers/git-identity.ts`) |
| **On GitHub** | Nothing per agent: **all agents share one `gh` account** | GitHub shows the same opener, author and merger for every agent. The Playbook asks each PR body to start with an *Opened by* line, the only record of who opened it |
| **In the review gate** | A reviewer *name* in the `Review:` comment | Any project agent's name counts, or any other GitHub account. Since agents share one account, "another account" in practice means a person |

These are documented limitations, not bugs to work around in prompts.

## Filesystem and process isolation

- **None between agents, projects or clients.** Each agent is an OS process of the office's own user. It can read other projects' folders, the office data folder (including `workers.json` tokens) and any company brain on the machine.
- Tool permissions are **Claude Code's own** permission layer and the project's settings. The office adds `--permission-mode acceptEdits` only for models where Claude Code's auto mode isn't offered (Haiku), and nothing when the agent's arguments set a mode (`src/server/providers/claude.ts`, `src/shared/providers.ts`).
- Two office hooks narrow behaviour for Claude agents: worktrees only under the project's `.agent-office/worktrees`, and mxcli writes held while Studio Pro has the project open. They are guard rails, not a sandbox.
- `jail.json` is the 2D view's "sent home" list. It confines nothing.
- **The one isolated agent is the Firm's reviewer** (`src/server/firm/isolation.ts`): a pinned clone with no remote and no token, and `gh pr merge` denied in its Claude settings.

## Which controls are enforced, and by whom

| Control | Enforced by the office | Hook the office installs | Instruction to agents only | External enforcement |
|---|---|---|---|---|
| Loopback bind (HTTP default; hook server always) | ✔ | | | |
| Task record on disk before a task id is typed | ✔ | | | |
| No typing into an agent's prompt; hold for turn end; refuse when paused or over the spend cap | ✔ (bypassed by the idle-lead console prompt) | | | |
| Durable answer and hand-off, no blind replay | ✔ (your answers and tells; agent-to-agent tells are not durable) | | | |
| Agent-to-agent tell limit (5 per pair in 10 min) | ✔ (in memory; resets on restart) | | | |
| Worktree location | | ✔ (Claude only) | | |
| Studio Pro write hold | | ✔ (Claude only) | | |
| Independent review before merge; 10-minute wait | Flagged **after** the merge only | | ✔ | |
| Merge is the Project Manager's approval (autonomy 1–3) / a human action | An approvals item only | | ✔ (contradicted by *Fix up and merge* prompts) | |
| Blocking merges; required reviews | | | | GitHub branch protection (**not set or checked by the office**) |
| No direct or force push to main | Detected after the fact (`src/server/review-gate/pushes.ts`) | | ✔ | Branch protection |
| Lint-baseline resets and waivers need your decision | Detected by text match (`Decided per ESC-…`; the id isn't checked) | | ✔ | |
| Firm reviewer cannot merge | ✔ (Claude deny list) | | | |
| Claude tool permissions | | | | Claude Code's permission layer |
| Token scopes | | | | GitHub |

## What the review gate checks

From `src/shared/review-gate.ts` and `src/server/review-gate/judge.ts`, a merged PR counts as reviewed when a comment posted at or before the merge:

- starts with `Review:` and names a reviewer;
- has at least one `Checks:` item shaped like a result and at least one `Files read:` item;
- names a reviewer who is a project agent (or comes from another GitHub account) and isn't the opener.

It never compares the reviewed commit with the merged commit, never looks at commits pushed after the review, ignores the `Verdict:` line and GitHub's own review decision, and doesn't check the reviewer's role. Once a task is marked *unreviewed* the mark is never cleared. The 10-minute rule is a timing heuristic, not evidence of quality.

So the gate shows **that a review-shaped comment existed before the merge**. It does not show **an independent review of the revision that was merged**. On a Solo team the Playbook makes you the reviewer, and a comment you post from the shared office account under your own name is probably not counted (inference, untested). See [Review gate](../using-the-office/review-gate.md) and, for **PROPOSED** changes (revision-bound reviews, a Project Manager review record, a pre-merge signal), [Proposed simplifications](proposals.md).

## See also

- [Security and tokens](../administration/security-and-tokens.md)
- [Reusable skills and knowledge](reusable-skills-and-knowledge.md): why a client's company brain isn't private to its projects.
- [Design decisions](design-decisions.md): the incidents that led to test offices without tokens and to agent git identities.
