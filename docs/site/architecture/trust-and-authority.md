---
title: Trust and authority
description: Credentials and permission boundaries, human approvals, agent identity and attribution, the limits of process and filesystem isolation, and which controls the office enforces versus asks agents to follow versus leaves to GitHub.
weight: 40
---

> [!NOTE]
> Describes release 66 (commit `39d0083a`), assessed 2026-10-20.
> **Verification scope:** sign-in, admin checks, credential handling, agent environment and the Firm's isolation were read in code. The review gate's flags are covered by tests that were run (`review-gate`, 20 tests). Statements that a control is **absent** (no OS-level sandbox, nothing stopping an agent's own `gh pr merge` on an unprotected branch) come from code reading and search; a green test can't show an absence.
>
> **Updated after release 69 for the merge gate:** reviews bound to a revision and a verdict, the Project Manager's review recorded in the office, the PR window's Merge refusing a head without an independent approval, the `mx-office/review` status and the read-only branch-protection check, covered by the `merge-gate` tests (a fake gh only).

## The short version

- The office is a **local, single-user-account** system. Every agent runs as the same operating-system user as the office, with no sandbox between agents, projects or clients.
- **Organisational grouping and prompts are not access isolation.** Clients, teams, roles and Playbooks decide what agents are *told*, not what they *can* read or do.
- **The office blocks only its own Merge button.** The PR window's Merge refuses a pull request whose current head has no independent approval (the [merge gate](../using-the-office/review-gate.md#the-merge-gate)); an admin can override it, audited. An agent's own `gh pr merge`, or a merge on GitHub, goes around the office.
- **Blocking every merge belongs to GitHub.** The office posts its verdict as the `mx-office/review` commit status and shows whether the base branch requires it. A person makes it a required status check in branch protection ([Branch protection](../integrations/branch-protection.md)); the office never writes branch protection. Without that, the gate is advisory outside the office.
- The 10-minute wait and "merges need the Project Manager's approval" (autonomy 1 to 3) are still instructions to agents.

## Credentials and permission boundaries

| Topic | How it works today | Code |
|---|---|---|
| Signing in | A shared office password, or accounts (`admin` or `member`). **A session on the shared password without an account is admin.** Sessions are an HMAC cookie (HttpOnly, SameSite=Lax, 14 days) | `src/server/office/people.ts`, `src/server/auth.ts` |
| Admin checks | Per route, not central. Most write routes are admin-only; the roster's `tell`, `nudge` and `standup` actions are open to any signed-in member | `src/server/http/routes/*.ts` (for example `roster.ts`, `ADMIN_ONLY`) |
| Hiding in the page | Admin-only navigation items and settings sections are hidden from members, but a deep link still mounts them; the server still refuses the action. **The client is not a boundary** | `src/client/ui/portal/nav-logic.ts`, `src/client/ui/settings/page.ts` |
| Credentials store | `credentials.json` in the data folder, encrypted with Windows DPAPI for the current user; on macOS (preview) each value an item in the user's login Keychain, the file naming it (`keychain.ts`); base64 with file mode 0600 on Linux. It protects against other users of the machine, **not against code running as the same user**, which includes every agent | `src/server/connections/vault.ts` |
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
| **In the review and merge gates** | A reviewer *name* in the `Review:` comment; a person's office sign-in for a review recorded in the PR window | Any project agent's name counts (except the PR's authors), or any other GitHub account. Since agents share one account, an agent could post a review in another agent's name: the office records whom the comment names, not who wrote it. A review recorded in the office is tied to the person's sign-in, with their password typed again |

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
| Independent review of the current head before merge | ✔ for the office's own Merge button (an admin can override, audited); flagged after the merge otherwise | | ✔ | Branch protection requiring `mx-office/review` (set up by a person) |
| A new commit invalidates a review; changes requested blocks | ✔ (merge gate, status, Needs you) | | ✔ | Branch protection requiring `mx-office/review` |
| 10-minute wait | Flagged **after** the merge only | | ✔ | |
| Merge is the Project Manager's approval (autonomy 1–3) / a human action | An approvals item only | | ✔ (contradicted by *Fix up and merge* prompts) | |
| Blocking every merge (an agent's `gh`, GitHub's own button) | Reads whether the base branch requires `mx-office/review` and says so (never writes it) | | | GitHub branch protection |
| No direct or force push to main | Detected after the fact (`src/server/review-gate/pushes.ts`) | | ✔ | Branch protection |
| Lint-baseline resets and waivers need your decision | Detected by text match (`Decided per ESC-…`; the id isn't checked) | | ✔ | |
| Firm reviewer cannot merge | ✔ (Claude deny list) | | | |
| Claude tool permissions | | | | Claude Code's permission layer |
| Token scopes | | | | GitHub |

## What the review and merge gates check

From `src/shared/merge-gate.ts`, `src/server/merge-gate/` and `src/server/review-gate/judge.ts`, a review counts when:

- it approves **exactly the head commit** it is checked against (the `Head:` line of a `Review:` comment, else the branch's head when it was posted; the commit of a GitHub review; the head a person saw when recording it in the office). Any later commit makes it stale;
- its **verdict** is an approval, and no independent reviewer's last word on that head asks for changes (`Review:` comments from 22 October 2026 on need a `Verdict:` line);
- its reviewer is **not an author** of the pull request's commits (the opener, and every agent or person named as a commit author);
- for a `Review:` comment: it names a project agent or comes from another GitHub account, and lists checks with results and files read.

It still doesn't check that the listed checks really ran, or the reviewer's role. The 10-minute rule is a timing heuristic, not evidence of quality. A task marked *unreviewed* is cleared once a counting review of the merged revision exists; the clearing is recorded.

So the gate shows **an approval of the revision that was (or will be) merged, by someone other than its authors, as far as the office's records tell**. On a Solo team you are the reviewer, and your review recorded in the PR window counts. See [Review gate](../using-the-office/review-gate.md#the-merge-gate) and [Branch protection](../integrations/branch-protection.md).

## See also

- [Security and tokens](../administration/security-and-tokens.md)
- [Reusable skills and knowledge](reusable-skills-and-knowledge.md): why a client's company brain isn't private to its projects.
- [Design decisions](design-decisions.md): the incidents that led to test offices without tokens and to agent git identities.
