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

> [!NOTE]
> **Since release 69: the security baseline and the mx check gate** (`src/server/security-gate/`). The rows that mention it were read in code and covered by tests that were run (`security-gate`, `security-dom`, `wizard-app`, `signoff`). The reading of a real model's security and a real `mx check` were also run once against a Blank 11.12.4 app outside the tests.

## The short version

- The office is a **local, single-user-account** system. Every agent runs as the same operating-system user as the office, with no sandbox between agents, projects or clients.
- **Organisational grouping and prompts are not access isolation.** Clients, teams, roles and Playbooks decide what agents are *told*, not what they *can* read or do.
- **The office blocks only its own Merge button.** The PR window's Merge refuses a pull request whose current head has no independent approval (the [merge gate](../using-the-office/review-gate.md#the-merge-gate)); an admin can override it, audited. An agent's own `gh pr merge`, or a merge on GitHub, goes around the office.
- **Blocking every merge belongs to GitHub, and only a human review holds.** The office posts its verdict as the `mx-office/review` commit status, **with the agents' token**, so any agent can post a passing status too: a required status alone is *Weak*. What holds is a human review required on GitHub (approvals or CODEOWNERS), once a person has checked its bypass paths. The office reads the protection and shows a verdict per project, **Enforced**, **Weak** or **None** ([Branch protection](../integrations/branch-protection.md)); it never writes branch protection.
- The 10-minute wait and "merges need the Project Manager's approval" (autonomy 1 to 3) are still instructions to agents.
- **The office also refuses an unmet security baseline at a sign-off or acceptance.** Your sign-off of Stage 4 or later and ✅ Accept are refused while the app's security (read from the model at that commit) or a clean `mx check` at that commit is missing, unless the project's policy is advisory. It refuses *your* step, not an agent's merge.

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
| Where a change may come from | Every signed-in request that changes something (any method but GET, HEAD and OPTIONS) must come from the office's own page, its `Origin` header naming the office's address, or carry the session's request token in the `X-Mx-Office-Csrf` header (`GET /api/csrf` gives a tool the token for its session). Anything else gets a 403 before any route runs. Until now a JSON request with no `Origin` at all counted as the office's page. Not covered: the public routes (sign-in), and the agents' own calls (the hook server's `/office/*` endpoints with their bearer token, the MCP server, the `office-*` tools), which aren't signed-in routes. The desktop app sends the office's address as its `Origin`. **Protection against mistakes and drive-by requests** (another site's page, a script pointed at the wrong office, a pasted `curl` with a session cookie), **not a boundary against an agent**: an agent runs as the same OS user, can read the browser's cookies or the office's data folder and send a matching `Origin` itself (see [What holds against an agent](#what-holds-against-an-agent)) | `src/server/http/origin.ts`, `src/server/http/router.ts` |

See [Security and tokens](../administration/security-and-tokens.md) for the how-to.

## Human approvals

Approvals are records and cards; what they hold back is mostly agent behaviour, by instruction.

| Approval | What actually happens |
|---|---|
| ✋ Stage gates (`CONFIRMED` decisions) | The toolkit's `gate-check.sh` reads the decision rows; the office shows the gate and offers the sign-off. Agents are instructed not to pass a gate without it. **The office refuses its own sign-off of Stage 4 or later while the [security baseline](../using-the-office/security-baseline.md) isn't met at main's head** (`src/server/security-gate/`, through the sign-off's guard in `src/server/signoff/`); a lead can still record a CONFIRMED row by hand |
| Decision cards (escalations) | Your answer is stored and handed to the agent (see [Execution lifecycle](execution-lifecycle.md)). The agent decides what to do with it |
| Merge approval at autonomy 1 to 3 | An item on the Approvals list and a Playbook instruction. **Not enforced**: an agent with the shared token can still merge, and some prompts (*Fix up and merge*) tell agents to merge |
| Permission card's **Allow this command** | Writes one exact `permissions.allow` rule (no wildcards) into the role's `.claude/settings.local.json`; audited; asks for a fresh sign-in over phone access (`src/server/decisions/permission.ts`). This is a real grant, enforced by Claude Code |
| Skills and their gates (ask / propose / tell / FYI) | Enforced by the office only for `office-workers subagent …` operations; the rest are Playbook instructions (see [Skills and gates](../automation/skills.md)) |
| Acceptance | An admin act with the password asked again, bound to a revision (see [Progress and acceptance](../using-the-office/progress-and-acceptance.md)). **Refused while the security baseline isn't met at the delivery commit**, including a clean `mx check` there |

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
| A signed-in change comes from the office's page (matching `Origin`) or carries the session's request token | ✔ (against mistakes and other sites; an agent of the same user can send either) | | | |
| Task record on disk before a task id is typed | ✔ | | | |
| No typing into an agent's prompt; hold for turn end; refuse when paused or over the spend cap | ✔ (bypassed by the idle-lead console prompt) | | | |
| Durable answer and hand-off, no blind replay | ✔ (your answers and tells; agent-to-agent tells are not durable) | | | |
| Agent-to-agent tell limit (5 per pair in 10 min) | ✔ (in memory; resets on restart) | | | |
| Worktree location | | ✔ (Claude only) | | |
| Studio Pro write hold | | ✔ (Claude only) | | |
| Independent review of the current head before merge | ✔ for the office's own Merge button (an admin can override, audited); flagged after the merge otherwise | | ✔ | A human review required in branch protection (set up and its bypass paths checked by a person). Requiring `mx-office/review` alone is *Weak*: the agents' token can post it |
| A new commit invalidates a review; changes requested blocks | ✔ (merge gate, status, Needs you) | | ✔ | *Dismiss stale approvals* with a required human review; `mx-office/review` shows the verdict but can be posted by an agent |
| How much GitHub enforces the review (Enforced / Weak / None) | Read and shown per project (PR window, 🔐 Security tab), one Needs-you note while not *Enforced* (`src/server/merge-gate/gh.ts`, `protection-ask.ts`) | | | GitHub branch protection |
| 10-minute wait | Flagged **after** the merge only | | ✔ | |
| Merge is the Project Manager's approval (autonomy 1–3) / a human action | An approvals item only | | ✔ (contradicted by *Fix up and merge* prompts) | |
| Blocking every merge (an agent's `gh`, GitHub's own button) | Reads whether the base branch requires `mx-office/review` and says so (never writes it) | | | GitHub branch protection |
| No direct or force push to main | Detected after the fact (`src/server/review-gate/pushes.ts`), against a baseline kept on disk across restarts, with the push watch's bounded fetch (`src/server/push-watch/`). A project's very first look shows its earlier commits as unchecked until reconciled (`review-gate/baseline.ts`). Against mistakes only: an agent could edit the file | | ✔ | Branch protection |
| Lint-baseline resets and waivers need your decision | Detected by text match (`Decided per ESC-…`; the id isn't checked) | | ✔ | |
| Firm reviewer cannot merge | ✔ (Claude deny list) | | | |
| Security baseline (level per policy, strict mode when required, entity access rules, a clean `mx check` at the commit) before the office's sign-off of Stage 4+ and ✅ Accept | ✔ (refused unless the policy is advisory; the office's own sign-off and acceptance only) | | ✔ (Playbook: set it by Stage 3, run `mx check`) | |
| Production security set on a new app | ✔ (the wizard sets it and reads it back; a later script can lower it) | | ✔ | |
| Security kept at the baseline between sign-offs; demo users off for a release | Flagged (Needs you once the build has started; demo users flagged only) | | ✔ | |
| Claude tool permissions | | | | Claude Code's permission layer |
| Token scopes | | | | GitHub |

## What holds against an agent

Two kinds of control are easy to mix up. **Protection against mistakes** (the merge gate on the office's own Merge button, the review status, the direct-push check, the `Origin` / request-token rule for signed-in changes, Playbook rules) catches an agent or a person that gets it wrong while trying to do it right. A **security boundary** holds against an agent that tries to get around it on purpose. Almost everything in the office is the first kind; nothing in the office is the second, because of the table below. Where the docs or the pages say *Enforced*, they mean GitHub enforces it against the agents' token, not that the office does.

Agents run as the same operating-system user as the office. So, today, an agent can do anything the office's user can, whatever the office's own pages allow. The `review-enforcement` tests probe this with fake values (`tests/review-enforcement.test.ts`), run as an agent's environment would:

| An agent can | Because |
|---|---|
| Post a passing `mx-office/review` | It is given the agents' GitHub token (`connections/env.ts`), the one the office's own gh posts the status with (`connections/resolve.ts` puts it in the office's environment) |
| Merge with `gh pr merge`, push to main | Same token; only GitHub branch protection stops it |
| Read the Connections store | `credentials.json` is DPAPI-encrypted for the Windows user (the macOS Keychain: the login user), which every process of that user can decrypt |
| Sign in to the office as an admin | `config.json` in the data folder holds the session secret and the password's hash; a session signed with it is accepted, and counts as a fresh sign-in (the review and override routes take it) |
| Change the office's settings and records | They are files in the data folder |

So **only GitHub enforces anything against an agent**, and only what the agents' token can't do: a required human review whose bypass paths a person has checked. Separate identities on the same machine (a GitHub App, a second account's token) would give the office's posts their own name, but an agent could read their keys from the same store, or use them through the office's endpoints. A real boundary needs the office (and its secrets) to run as **a different operating-system user, or on another machine**, from the agents: then the agents' files and processes can't reach the office's secrets, and the office's endpoints can require credentials agents don't have. That is not built.

## What the review and merge gates check

From `src/shared/merge-gate.ts`, `src/server/merge-gate/` and `src/server/review-gate/judge.ts`, a review counts when:

- it approves **exactly the head commit** it is checked against (the `Head:` line of a `Review:` comment, else the branch's head when it was posted; the commit of a GitHub review; the head a person saw when recording it in the office). Any later commit makes it stale;
- its **verdict** is an approval, and no independent reviewer's last word on that head asks for changes (`Review:` comments from 22 October 2026 on need a `Verdict:` line);
- its reviewer is **not an author** of the pull request's commits (the opener, and every agent or person named as a commit author);
- for a `Review:` comment: it names a project agent or comes from another GitHub account, and lists checks with results and files read.

It still doesn't check that the listed checks really ran, or the reviewer's role. The 10-minute rule is a timing heuristic, not evidence of quality. A task marked *unreviewed* is cleared once a counting review of the merged revision exists; the clearing is recorded.

So the gate shows **an approval of the revision that was (or will be) merged, by someone other than its authors, as far as the office's records tell**. On a Solo team you are the reviewer, and your review recorded in the PR window counts. See [Review gate](../using-the-office/review-gate.md#the-merge-gate) and [Branch protection](../integrations/branch-protection.md).

## Data-impact approval

Confirming that the work looks right is not the same as accepting that data may be lost, so the office has one authority for the second: the **data-impact approval** permission (`server/data-impact/`, rules in `shared/data-impact.ts`).

**Implemented (not yet in a release):**

- **Where it applies:** the live preview only (`server/liveapp/`). Before the live app applies a commit (an update after a merge, a restart, or a start over the database an earlier build used), `liveapp/app.ts` asks the guard with the revision the database last ran (the served commit, or the last served one) and the new commit.
- **Detection:** a diff of the domain model and enumeration units at both revisions, read from git by `model/units.ts`, with no mxcli and no database. It finds removed, renamed and no-longer-stored persistent entities, attributes and associations, attribute type changes, reference storage changes, changed delete behaviour, removed or renamed enumeration values in use, and generalization changes. Each finding names the unit and the element, with one risk line. It is kept per revision pair; nothing is decoded when none of those units changed.
- **Fail closed:** a model or changed unit that can't be read is *data impact unknown*, which holds like a finding.
- **The hold:** a held commit is not hot reloaded, restarted onto or built by a start; the running build keeps serving. The hold is a fact of its own (`HeldFact`: environment, baseline, target, reason), exposed by `GET /api/data-impact` and on the live app's state as failure kind `held`. It never folds into merged, implemented, verified or accepted.
- **Who:** office admins by default, plus accounts the office policy names (`<data>/data-impact/policy.json`, admins only, audited). Owning or running a project grants nothing. The check is on the server (`http/routes/data-impact.ts`); the page only hides the button.
- **The approval** needs the approver, a recovery step (a `pg_dump` of the live preview's database taken by the office and checked with `pg_restore --list`, with its path, size and sha256, or the approver's explicit "no data to keep") and a reason. It is bound to the environment, the starting baseline, the target and the recovery evidence; a change to any of them (a new commit, a different baseline, a dump file changed or gone) voids it, and the change is assessed again. A hold the office finds **stale** (the change it guarded is over, or the live preview already runs a revision with it) can instead be released with a reason, by someone with the same permission; the office checks it is stale when it records the release (the request's word is never enough), and the release is an approval with recovery step *none needed, a stale hold released (why)*, audited like any other.
- **Evidence:** every hold, dump, approval, void and release is a hash-chained audit event with all four bound values.
- **Developer change candidates** (`feat/lifecycle-b`): `server/dev-changes/` calls `checkCandidate` (env `candidate:DC-n`) on the active change's newest candidate, and a held merge doesn't settle as implemented or free the slot until approved ([Revisions and Developer changes](revisions-and-changes.md#four-facts-kept-apart)). Approving it takes the same permission, bound to that environment.
- **External commits on main** (`feat/lifecycle-b`): the push check (`review-gate/pushes.ts`, from the persisted baseline) calls `checkExternal` (env `external:<branch>`) for commits that skipped a PR; a finding is its own Needs-you card and holds nothing else.

**Planned, not built:**

- **mxcli's own warnings** are carried in the assessment (`warnings`) but the office doesn't capture the output of the agents' mxcli runs, so the list is empty.
- **Restore**: the office takes and checks dumps but doesn't restore them; a restore loses records made after the dump and needs its own authorization.
- **Policy by change class:** every finding kind holds; the policy can't yet exempt a class.

**Limits, stated plainly:** detection is model-diff based (migration microflows, Java actions and the runtime's schema sync aren't analysed). The guard protects against accidental errors by people and agents. It is **not** a security boundary against an adversarial agent: agents run as the same operating-system user as the office, so one set on it could edit the office's data folder or drive its API (see [Filesystem and process isolation](#filesystem-and-process-isolation)).

## See also

- [Security and tokens](../administration/security-and-tokens.md)
- [Reusable skills and knowledge](reusable-skills-and-knowledge.md): why a client's company brain isn't private to its projects.
- [Design decisions](design-decisions.md): the incidents that led to test offices without tokens and to agent git identities.
