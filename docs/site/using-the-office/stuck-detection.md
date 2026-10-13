---
title: Stuck detection
description: How the office tells you, through Needs you, when work is stuck - a pull request nobody moves, a decision waiting on you, a test failing for days, or agents busy with nothing landing - and how to act on it.
weight: 3.4
---

**Stuck detection** tells you when work has stopped moving and only a person can get it going again. It's the net under the team's own escalations: on a real project a fix PR sat open for four days with no review, a decision about integration owners parked four build-plan rows on stubs, and nobody escalated either, because the team kept working around them. The office now spots that from what it already has and puts it in [Needs you](command-center.md#needs-you), once, until it clears.

It needs no AI and makes no extra GitHub calls: it reads the board's existing pull-request poll, the project's files at main (read off the event loop, through git, only when main moves), Testing's records and the budget ledger. **The office never writes to GitHub:** every action is a message to the team lead, or a snooze or a dismissal of the item.

## What it looks for

| Item | Raised when | Default |
|---|---|---|
| ⏳ **Stale pull request** | An open, ready (not draft) PR with no new commits, comments or reviews (GitHub's *updated* time) for the threshold. What it blocks comes from every mention of `#<n>` in `architecture/build-plan.md` (or `build-plan.json`), `PROJECT.md` and the test reports under `reports/testing/`. | 24 h |
| ❓ **Decision waiting on you** | A row of the build plan's pending-decisions table (*ID · Question · Raised · Blocks (rows) · Build proceeds on*) that blocks rows still not built, or a `PROJECT.md` open question that is yours or the client's, open for the threshold. Rows marked DECIDED, CONFIRMED or ANSWERED, rows that block nothing, and questions the PM deferred don't count. The age comes from the *Raised* cell, or the `PROJECT.md` row it names. | 24 h |
| 🔴 **Failing for days** | A journey, test or required check failing with the same failure for the threshold (Testing's records on main), or the build plan saying so (*J-08 fails on #51*) while that PR is open. When the cause is a stale PR, it goes on **the PR's card** (*J-08 has failed for 4 days: waits on PR #51*) instead of a card of its own. | 48 h |
| 🔁 **Going in circles** | Agents working (at least 4 hours of agent time), but no merged PR, no change to `PROJECT.md`'s *Current stage* and no build-plan row changing state, for the threshold. The card gives the hours worked, the spend since the last progress (budget ledger) and what that last progress was. | 48 h |

An item is **raised once** under a stable id (`pr-51`, `decision-OW-1`, `failing-J-08`, `circles`), **updated in place** when what it says changes (a new row waiting on the PR, say), and **resolved by itself** when the condition clears: the PR merged or closed, the decision recorded, the journey passing, progress made. Restarting the office raises nothing again. If an agent has already escalated the same thing (an open escalation naming the PR, the decision or the test), the item stays out of Needs you so it isn't there twice.

Every raise, update, resolve and action is in the [Audit log](audit-log.md) as `stuck.raised`, `stuck.updated`, `stuck.resolved`, `stuck.snoozed`, `stuck.dismissed`, `stuck.ask-lead`, `stuck.answer`, `stuck.accept` or `stuck.blockers` (the *Escalations & approvals* group).

## In Needs you

Each item is one row with a **Stuck** tag: *PR #51 has had no activity for 4 days. It blocks J-08 and 'Team_Travel' (build plan).* or *Decision waiting on you: OW-1 integration owners for SSO and SMTP. Blocks build-plan rows 59–62 (J-09). Build continues on stubs.* A stale PR or a decision counts as blocking (red); failing-for-days and going-in-circles are worth a look. They're actionable items, so they count in the Command Center's tab, the Overview's *N waiting on you* and the team phone's Needs you.

Its button (**Ask Ada**, **Answer**, **Ask for blockers** or **Review**) opens the item's card: what's stuck and since when, what it blocks, the evidence (`file:line` at main, or the PR's link), what waiting costs, the next safe step, and its buttons:

| Item | Buttons |
|---|---|
| Stale PR, failing for days | **Ask &lt;lead&gt; to rebase and merge, or close it** (or **to fix it**), **Snooze 1 day**, **Dismiss** |
| Decision | **Answer** (a text box), **Accept the current workaround for now** (when the build plan says what the build proceeds on), **Snooze 1 day**, **Dismiss** |
| Going in circles | **Ask &lt;lead&gt; for a blockers summary**, **Snooze 1 day**, **Dismiss** |

- **Ask, Answer, Accept** send a message to whoever covers Management (the Project Coordinator, or the Lead on a Solo or Startup team) through the team's own tell, as yours. If the lead is working, the card asks **OK to interrupt?**: **After their current turn** (the default: the office holds it until the turn ends) or **Interrupt now**.
- **Answer** asks the lead to record your answer in `PROJECT.md`'s Decisions as CONFIRMED by you, mark the decision decided in the build plan and unblock its rows. The item resolves once that's at main.
- **Accept the current workaround for now** sends *PM accepts &lt;workaround&gt; for this slice; record as CONFIRMED* and keeps the item quiet for 7 days.
- **Snooze 1 day** hides it for 24 hours. **Dismiss** hides it until it clears and comes back; neither resolves anything.

Only admins act on items; everyone sees them. On the [phone version](phone-version.md) the items show with the others and open on a computer.

## Notifications

Stuck items follow the same rules as the other red Needs-you items: a [phone push](phone-version.md) once per item (Do not disturb and the digest apply), and a [Teams card](../integrations/teams-notifications.md) when Teams notifications are on.

## The standup

The standup page gets a **Blocked on you** section above *Needs the Project Manager*: the stuck items standing on the project, and the Leads' blockers that name a decision, an owner, an access or you. The team's Playbooks also say so: whoever covers Management runs a **blocker sweep** at every standup and at least once a day, and escalates anything only you or the client can resolve that has blocked work for more than a day, with options and a recommendation; every Lead says in its handoff when it works around a blocker, and tells the lead ([Playbooks](../teams-and-agents/playbooks-and-journals.md)).

## Settings

**⚙️ Settings › 🧭 Stuck detection** (office-wide; admins change it, everyone sees it):

| Setting | Default |
|---|---|
| Stuck detection on or off | On |
| A pull request with no activity | 24 h |
| A decision waiting on you | 24 h |
| A test failing the same way | 48 h |
| Agents working with no progress | 48 h |

Each change is in the audit log as `settings.change` (`stuck.on`, `stuck.prHours` …). With it off, nothing is raised and nothing shows. The settings are kept in the office's `office-settings.json` (`stuckDetection`), the items per project in `<office data>/stuck/<project>.json`. The office looks at each project every 5 minutes, and at once after a settings change.

## Blocked build-plan rows, and the toolkit's question states

- **Open questions** in PROJECT.md count as open when their Status is in the toolkit's own words too: `RAISED` (put to you, awaiting your reply) and `UNRAISED` (never put to you), as `bin/open-questions.sh` uses them.
- **Build-plan rows whose State starts with `blocked`** (any `blocked…` prefix in `architecture/build-plan.md`) for longer than the decision threshold become a 🧱 item, one per blocker: *Build-plan rows 59–61 have been blocked for 3 days on: …*. When the row names a decision that's resolved, it says so: *Rows 59–61 say blocked on OW-1, which is resolved: update the build plan or name the real blocker*. Rows a pending decision already parks are that decision's item, and a row blocked on an open PR is the stale-PR item's. Its button asks the team lead.
