---
title: Proposed simplifications
description: PROPOSED, not built - a simpler navigation, one Inbox with one count, revision-bound review safeguards, structured agent reports, readiness separated from walkthroughs, a routine design card, clearer team setup and consistent terminology, with a phased plan.
weight: 70
badge: Proposed
---

> [!IMPORTANT]
> **Everything on this page is PROPOSED.** None of it is built in release 66. The current behaviour each proposal would change is described on the other pages of this section and linked from each item.

> [!NOTE]
> Proposals made against release 66 (commit `39d0083a`, the same `src/` as release 65), assessed 2026-10-20.
> **Verification scope:** the *today* part of each proposal was confirmed in code and, for navigation, Needs you, the review gate and readiness, by tests that were run. The proposals themselves are untested designs; their effect on performance and on users is unknown until built.

> [!NOTE]
> **Built since, in its minimal form: the artifact beside the decision.** A decision card whose question is pinned on the toolkit's process map links to it (`See where this fits → Process map: (process) · step (n)`, opening the map at that process), in today's Needs-you cards; no App Workspace. See [Documents › The process map](../using-the-office/deliverables.md#the-process-map).

Each proposal says what it does to the work: **removes** it, **hides** it, **automates** it, or **transfers** it to you (or makes an existing transfer visible).

## Navigation

**Today:** about 22 destinations in six groups in a project's Portal navigation, five office pages, about 20 items in ☰ and 17 Settings sections. *Agents*, *Budget*, *Testing*, *Team* and *Studio* each have three or four homes, and four registered tabs have no tab-row button in the classic themes (`src/client/ui/portal/nav-logic.ts`, `src/client/tabs/`). See [Top bar and menu](../using-the-office/top-bar-and-menu.md).

**Proposed:** a default navigation of **Overview · Work · Inbox · App · Agents · More**, with **Settings** at the bottom.

| Group | Holds today's |
|---|---|
| Overview | Command Center (with a Needs-you summary and *Open Inbox →*), the Budget card |
| Work | Board, Team boards, Documents, Git (branches, PRs); Issues, Pull requests and Task queue in its header |
| Inbox | Every Needs-you item as one page (see below), with Approvals and Questions as filters |
| App | Live app (running app and readiness), Model, Testing (verification evidence), Walkthroughs, Design gallery, View app and Studio Pro actions |
| Agents | Team (org chart), Standup, All agents |
| More (collapsed, never removed) | Analysis, Budget page, Audit log, Test mode |

Every existing `?tab=` id and alias keeps working, and links from Teams cards, push, the tray and these docs still resolve. Settings shows a short *Common* list first (You, Notifications, Budget, Team, Connections). An optional *Show optional tools* switch could hide specialist tools (2D props, The Firm, team phone, design systems, walkthroughs, ranking, Test mode) while keeping them reachable by link, ☰ and search.

**Effect:** **hides** specialist tools; **removes** nothing. Client-only: no server change. Affects [Top bar and menu](../using-the-office/top-bar-and-menu.md), [URL parameters](../reference/url-parameters.md), [A tour](../get-started/tour.md).

## One Inbox and one count

**Today:** one aggregator (`collectDecisions` in `src/shared/needsyou.ts`) feeds five different count rules: the project strip, the tray / Home / Teams *red items*, web push, the phone badge and the phone's Status tab. Some items that need a person (an answer whose delivery is unknown, a record that differs from your decision) appear only on the Overview's card and are counted nowhere; severity-1 incidents never reach the tray or Teams, while some informational items do. See [Needs you](../using-the-office/needs-you.md).

**Proposed:**

- One category function and one count definition in `src/shared/`, used by every surface. Four categories: **Decision required**, **Needs intervention** (both counted as actionable), **Office resolving** and **Informational** (shown, not counted).
- Outcome-unknown hand-offs and follow-through mismatches join the list as *Needs intervention*.
- *Office resolving* items get an age and a threshold; past it they move to *Needs intervention* with the reason, instead of waiting silently.
- Each row carries its provenance: *agent says*, *office checked* or *you decided*.
- The phone's answer passes the expected revision and the folded group, as the desktop does.
- Every specialised control stays on its card (options, Allow / Keep blocked, Send again / It went through / Abandon, Snooze, the sign-off dialog). **No new authority**: every action keeps its route and admin check.

**Effect:** **automates** consistency; counts will change (tray and Home rise, the strip falls slightly), which the release notes must explain. Affects [Home](../using-the-office/home.md), [Teams notifications](../integrations/teams-notifications.md), [Desktop app](../administration/desktop-app.md), [Phone version](../using-the-office/phone-version.md).

## Review safeguards

**Today (built after release 69, the [merge gate](../using-the-office/review-gate.md#the-merge-gate)):** proposals 1 to 3 are built. Reviews are bound to the head they reviewed and their verdict, a later valid review clears *unreviewed*, you record a review from the PR window (with your password), the PR window's Merge refuses a head without an independent approval (an admin can override, audited), and the office posts `mx-office/review` and reads (never writes) the base branch's protection. Proposals 4 and 5 are still open. See [Trust and authority](trust-and-authority.md).

**Proposed:**

1. **Bind a review to a revision and a verdict.** The `Review:` comment carries `Head: <sha>` and `Verdict: approve|changes`; a review of a different head than the one merged, or not an approval, doesn't count; a later valid review clears *unreviewed*. Only for PRs opened after the change.
2. **Count a Project Manager review.** A *Mark reviewed at &lt;sha&gt;* action (admin, audited) that the gate counts as independent. **Transfers** review to you explicitly, matching the Playbook.
3. **A pre-merge signal.** Show the gate's would-be verdict on open PRs, and a confirmation with the reason before the PR window's Merge. Optionally read (never write) the default branch's protection and say *main is not protected*. The office still never claims to block.
4. **An explicit review policy per project** (*another Lead*, *Project Manager*, *none recorded*), defaulted from the team shape and read by both the Playbook and the gate.
5. **One merge rule in prompts**, removing the contradiction between "merging is a human action" and *Fix up and merge*.

**Effect:** **automates** checking; agents must include the commit; more honest flags at first.

## Structured agent reports

**Today:** about seventeen places infer state from agents' prose (task or not, "task done", `Review:` layout, `AWAITING-PM:`, build-log words, `Decided per ESC-…`, report-file fields). See [Design decisions](design-decisions.md).

**Proposed:** small typed calls on the existing `office-workers` channel (hook server, bearer token): `report_done`, `report_review`, `report_applied`, `report_test_run`, `record_decision`. Each **references existing ids** (task, PR, commit, escalation) and **appends an event** to an existing store; it never becomes a second truth. The office keeps deriving outcomes from git, GitHub and test results; a report is evidence labelled *agent says* until validation upgrades it to *office checked*. Because hook tokens are readable by any agent, a report's content is validated, never its caller trusted. The prose readers stay as a fallback for older toolkit pins and other providers.

Also proposed here: route the idle-lead console prompt through the same delivery checks as everything else, and give every work request from the lead panel a task id.

**Effect:** **automates** validation; **removes** heuristics over time; a few more tokens per report. Affects [Execution lifecycle](execution-lifecycle.md), [Claims check](../using-the-office/claims-check.md).

## Readiness and walkthroughs

**Today:** readiness and walkthroughs are separate modules and tabs, coupled through automatic recording and a link on a ready milestone. A milestone with no journeys could read Ready in release 66 (fixed since: it now reads *built, no journey evidence yet*). Recording is one switch (*auto record*, on by default); failed automatic recordings count as done; recording failures and app failures share one *error* status. See [Live app](../using-the-office/live-app.md) and [Walkthroughs](../using-the-office/walkthroughs.md).

**Proposed:**

- Done after release 66: a milestone with no tied journeys reads *built, no journey evidence yet*, never Ready.
- One revision strip on the Live app: *Running abc1234 · main def5678 · tests for abc1234: 3 journeys (2 pass) · recordings for abc1234: 2*.
- A recording policy (*on demand*, *milestones*, *every eligible build*) migrated from today's switch, kept in the same file but written durably.
- Failure kinds (app step, app boot, sign-in, session cap, harness, cancelled, office stopped); only real results count as done; harness and boot failures retried once.
- Live app liveness: probe on every poll, mark *unresponsive*, persist the last running commit, offer *Start* after a restart.
- Journey results stamped with the tested commit (needs a toolkit change).

**Effect:** **removes** false Ready; fewer automatic recordings by default would **transfer** pressing Record to you.

## Design configuration

**Today:** authoring is already a specialist flow on the client page. In a project, the Design gallery can only propose the client's default; *Adopt* applies, commits and pushes in one step without a confirmation; compatibility labels are fixed text; the binding committed to the repository is never loaded as the binding (a fresh office or a clone loses it). See [Design systems](../using-the-office/design-systems.md).

**Proposed:** a routine card under App: the current system and version with its digest, a picker of approved versions, **Preview** (applied in the recording workspace, with screenshots), **Change** with a confirmation, and the PR link with *merge to bind*. The committed binding becomes authoritative on read, so a fresh office or a clone keeps it.

**Effect:** **automates** the preview; **removes** a hidden state split; the merge stays a person's or agent's step.

## Team setup

**Today:** the wizard's team card shows shape, level, agent count and budget, but not who reviews, who coordinates or how often you'll be asked. On Solo the Playbook makes you the reviewer of every PR; Solo's description names a model the Fast level doesn't use. See [Team shapes](../teams-and-agents/team-shapes.md) and [Create your first project](../get-started/first-project.md).

**Proposed:** a consequence-first summary of four facts: **Outcome** (stages and estimate), **Spend** (budget and auto-pause), **Your approvals** (autonomy in words), **Independent review** (*PRs reviewed by another Lead* or *you review every PR*). Shape names stay as labels; roles, models and pacing stay behind *Change*.

**Effect:** **makes an existing transfer visible**; may steer people to Startup.

## Required autonomy step (App Workspace C1): done

**Built** on `feat/autonomy-step`, so no longer proposed: the New project flow asks *How much should the agent team do without asking you?* with nothing preselected, a preview generated from the gate tables (each approval tagged *stops automatically*, *only you can* or *team is told to wait*), an optional office policy that limits or fixes the level (fixed: acknowledged), server-side validation with older callers recorded as the default, the choice recorded and shown on Settings › Team, the budget level separated from autonomy for such projects, and a confirmation for later changes. See [Autonomy levels](../teams-and-agents/autonomy.md) and [Create your first project](../get-started/first-project.md#autonomy-how-much-the-team-does-without-asking-you).

## Terminology

**Today:** "skill" means a permitted action in the Team tab, reusable instructions elsewhere, and a Claude Code skill file for Playbooks; "gate" means both a skill's approval rule and a toolkit stage check. See [Reusable skills and knowledge](reusable-skills-and-knowledge.md).

**Proposed** (UI and docs only; code identifiers, the `skill` API action and audit names stay):

| Use | Term |
|---|---|
| Reusable instructions | **skill**, qualified when ambiguous: *toolkit skill*, *company skill*, *mxcli skill* |
| A project lesson not yet reviewed | **lesson** |
| A lesson drafted into a brain's inbox | **candidate** |
| What a member may do | **permission**, in a **🔐 Permissions** window |
| Ask / Propose / Tell / FYI | **approval rule** |
| A toolkit stage check | **gate** (unchanged) |
| The Craft list | a **Knowledge** list: "toolkit skills this Playbook points to" |

The knowledge promotion lifecycle is proposed on [Reusable skills and knowledge](reusable-skills-and-knowledge.md#proposed-a-promotion-lifecycle).

## What each proposal does to the work

| Proposal | Removes | Hides | Automates | Transfers to you |
|---|---|---|---|---|
| Navigation regroup | | specialist tools | | |
| One count, one Inbox | duplicate count rules | | consistency | |
| Provenance labels | ambiguity | | | |
| Office-resolving expiry | | | | stale items, explicitly |
| Consequence-first team summary | | | | makes the existing transfer visible |
| Review policy per project | an implicit rule | | | |
| Recording policy | some recordings | | less, by default | pressing Record |
| Recording failure kinds | "never redone" | | one retry | |
| Revision strip | false Ready | | | |
| Routine design card | | authoring | preview | |
| Design binding read-back | a state split | | ✔ | |
| Structured reports | heuristics, over time | | validation | a small token cost to agents |
| One delivery path | | | safety | |
| Revision-bound review | | | ✔ | agents include the commit |
| Project Manager review record | | | | explicit review |
| Pre-merge signal | | | | the decision at merge time |
| Optional-tools switch | | ✔ | | |

## Phased plan (summary)

| Phase | Contents | Notes |
|---|---|---|
| 0. Honesty fixes | Ready requires journeys; CI conclusions mapped correctly; GitHub read failures shown as such; card copy for answers to busy agents; Solo copy; docs catch-up | Small, independent |
| 1. One Inbox model | Category and count functions; every surface uses them; outcome-unknown and follow-through join; phone answers pass the revision; expiry; provenance | Counts change: release-note them |
| 2. Navigation | Inbox page; regrouped navigation; classic themes reach every tab; 2D view links; Settings *Common*; optional-tools switch | Client-only |
| 3. Review safeguards | Revision and verdict; Project Manager review record; pre-merge signal; read-only branch-protection status; review policy; one merge rule | Grandfather old PRs |
| 4. Readiness, walkthroughs, live app | Revision strip; recording policy; failure kinds and one retry; liveness; commit-stamped journey results | The last needs the toolkit |
| 5. Coordination and state | One delivery path; structured reports; a task for every work request; durable small stores; hook tokens out of `workers.json` | |
| 6. Team setup and design | Consequence-first team summary; design binding read-back; routine design card; toolkit remotes and upstreaming the fork's fixes | |

Every increment follows the repository's rules: a reviewed PR, `npm run typecheck`, `npm test`, `npm run build`, the performance quick check for page or server changes, screenshots for visual changes, and docs updated in the same PR. When an increment ships, move its description from this page into the current-state pages.
