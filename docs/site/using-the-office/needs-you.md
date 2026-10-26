---
title: Needs you
description: What Needs you is made of - one list built in one place, its card kinds and levels - the one count every surface on a project's page shows (and how a member's differs), what the notification channels post instead, how answers are kept and typed, and what no count includes.
weight: 3.1
---

**Needs you** is everything on a project that waits on a person: an agent asking in its terminal, an escalation, a ✋ sign-off, a failing pull request, the budget, a stuck item, and the rest. This page explains how that list is built, where it appears and what each place counts. The cards themselves, their buttons and what each one does, are described on the [Command Center](command-center.md#needs-you) page.

## One list, built in one place

Every Needs-you item comes from one function, `collectDecisions` in `src/shared/needsyou.ts`. The browser, the server and the tests all import it. It builds two things from the same input:

- **decision cards** (`src/shared/decisions/`), the full cards the Portal Overview draws;
- their **compact rows** (`NeedItem`): one line, an icon, a button. The classic strip, the phone, Teams, the tray and push use these.

The cards are a projection, not a store of their own. Each one is rebuilt from what the office already keeps: escalations, the Questions page, stuck detection, surfaced asks, proposals and approvals, ✋ sign-offs, PR checks, the budget, the live app. The only thing Needs you keeps itself is your **Separate** choices.

Each row has a **level**:

| Level | Meaning | Counted as waiting on you? |
|---|---|---|
| `block` | Something is stopped until you act (an urgent or critical escalation, an agent asking, the spend cap, a budget pause) | Yes |
| `warn` | Worth a look (an important escalation, a failing PR, an idle agent with a task) | Yes |
| `info` | Shown, not waiting on you (an FYI, *Not on main*, *Review gate*, a sign-off waiting for the lead to record it) | No |

Each card has a **kind**, which decides its buttons (see [Decision cards](command-center.md#decision-cards)):

| Kind | Tag on the card | Buttons |
|---|---|---|
| `decision` | *Decision* | The options, **Reply in my words**, **Ask &lt;lead&gt;** |
| `hands-on` | *Action for you* | **I've done it**, **Can't now**, **Ask &lt;lead&gt;**, and a field for a note sent with either (optional) |
| `fyi` | *FYI* | **Noted** (approves nothing) |
| `status` | *Status* | Its own button (open the PR, the setup panel…) |

**Action cards take words.** An *Action for you* card has a one-line field, *A note for &lt;agent&gt; (optional: sent with the button you press)*: what you type goes with **I've done it** or **Can't now** (say why you can't, or what to do instead), and the field clears once it went. Empty is fine: the buttons work as before. A [Marketplace request](marketplace.md)'s **Decline** takes its note the same way.

A **Marketplace request** (an agent asked for a Mendix Marketplace widget or module) is a *Decision* with its own buttons: **Download and add**, **Use a package file…** and **Decline**. See [Add from Marketplace](marketplace.md).

## Where it shows, and what each place counts

### The one count on a project's page

On a project's page every surface says **one number**, worked out once by the Needs-you strip and handed to the others, so they agree at the same moment: the top bar's **bell** and the **team phone**'s badge, the navigation's **Overview** item, the **Overview › Needs you** card (and the classic strip's Command Center tab), the lead panel's **N waiting on you** banner (in Project Management and docked in the Developer view), and the **phone version**'s Needs you tab (which works it out with the same rule). The rule is `needsCount` in `src/shared/needs-count.ts`:

- **For you**: a decision or an action on this project (not an FYI or `info` row, not another project's row) that **you** can act on. The Project Manager (an admin) can act on all of them. A **member** can act only on an agent asking, an agent's finished turn and a lost worktree; the rest (escalations, approvals, the budget, settings, sign-offs…) need an admin on the server.
- **Waiting on the Project Manager**: for a member, the decisions and actions only an admin can act on. They are never counted as the member's: the Overview card and the lead panel say *N waiting on the Project Manager* instead.
- **In other projects**: agents asking or finished elsewhere. Said apart (*2 agents waiting in another project*, in the bell's and the phone's label, and as a dot on the phone when nothing waits here) and never added to this project's number.

Where scopes differ the words say so, for example *3 for you in this project · 2 waiting on the Project Manager · 4 agents waiting in 2 other projects*.

Two places count a **part** of it, labelled as such: **Approvals** counts its own items (*1 to approve · part of what needs you*; a member sees *waiting on the Project Manager* and no badge), and a closed navigation group never adds up its tabs' counts: the group holding the Overview shows the Overview's number, the others a dot (or **!** when something broke).

### The notification channels

The places below are not the page's count: they **post or list what is urgent enough to buzz**, for every project, and say what they post.

| Where | What it counts | Code |
|---|---|---|
| **Home › Needs you, across everything**, a project's count on Home, the **desktop tray** and its taskbar badge, **Teams** cards | "Red" items only (see below), for every project, minus a ✋ sign-off already given and waiting for the lead to record it | `redItems`, `src/server/notify-teams/gather.ts`, with `isRedNeed`, `src/shared/notify-teams.ts` |
| **Web push** to a phone | The same red items, but it **keeps** the `info` setup rows (a sign-off waiting to be recorded, the stage-paperwork note) and **drops** an agent asking from a turn the office started itself | `pushItemsOf`, `src/server/webpush/notifier.ts` |
| **Phone › 📊 Status**, per project | Open escalations that aren't FYI, and nothing else | `src/server/mobile/status.ts` |

**What "red" means.** `isRedNeed` posts these kinds:

- an agent asking;
- an escalation that isn't a plain FYI (an FYI that asks something counts);
- the spend cap reached;
- a PR with failing checks;
- Studio Pro changes nobody committed;
- every stuck item;
- client questions, one per batch (a question you answered that isn't recorded yet counts too, as an info row);
- a toolkit stage sign-off (not the "folder behind main" row);
- a Firm report ready (not its budget warning);
- the budget paused or at 100 %;
- the agents' Claude credentials refused;
- the live app crashing by itself, or a milestone becoming ready (or no longer ready) in it.

Everything else is never red, so it never reaches Home, the tray, Teams or push: incidents (sev1 included), approvals and proposals, the duplicates clean-up card, finished turns nobody looked at, idle agents, lost worktrees, design-system and company-brain cards, gate advisories, assumptions without consent, *Not on main*, *Ready for your review*, the review gate's cards, the claims check, the [security baseline](security-baseline.md#in-needs-you) card, a failed live-app build, budget forecasts and thresholds, and FYIs.

**The Claude credentials alert** is counted on every project in the browser, but the server posts it with the first project only, so one alert is one post.

**Another project's agents.** The *N waiting on &lt;project&gt;* row and the *agents waiting in other projects* words count only agents stopped in their terminal or finished and not looked at. Escalations on those projects aren't in that number: open the project to see its own count.

## Not counted anywhere

Two kinds of item are drawn **only by the Portal Overview's Needs you card** (`src/client/ui/portal/needs-card.ts`). No count includes them, and the strip, Home, the tray, Teams, push and the phone don't show them:

- **Answers whose outcome is unknown**: the office typed your answer but couldn't confirm the agent received it (or it stopped mid-send). The card offers **Send again**, **It went through** and **Abandon**. See [Answers whose outcome is unknown](command-center.md#answers-whose-outcome-is-unknown).
- **Follow-through items**: an answered decision that isn't yet *recorded as given* and merged into main. See [Following through](command-center.md#following-through).

In a classic theme, neither shows in Needs you. To settle an unconfirmed answer, open the project's Overview in a Portal theme. An answered client question also shows its record state on its own card on the [Questions](questions.md) page.

## One card per decision

Sources fold into one card only when they share an **explicit id**: a BRD question key, a register decision id (`OW-1`), a PR number, a stage, a journey or test id. Similar wording never merges anything. Two more explicit links fold cards. A **stage gate** that names the questions it asks you to confirm (*Stage 2 gate: … Q-01..Q-11*) takes those questions' cards under it, the gate leading: one card and one count instead of twelve. And the items the office reads from an agent's turn-ending reply share **the reply they came from** with the agent's own escalation raised in that turn (within 15 minutes), so one blocker is one card, not five. **Separate** splits a source off, and that choice is kept. **Likely duplicates** among an agent's `AWAITING-PM` asks or proposals are offered on one clean-up card, and the office closes them only after you confirm. The rules are in [Decision cards](command-center.md#decision-cards).

## Your answers are kept, then typed

When you answer a card (or in Approvals, from the phone, a question's **Send**, a stuck item's answer), the office does this in order:

1. **It stores your answer first.** It appends a new answer revision, in full, to `<office data>/answers/<project>.jsonl`. If that write fails, nothing is sent.
2. **It hands the answer off separately.** It writes a dispatch record (who it's for, which session, the exact text) before typing anything.
3. **Typed is not received.** The answer counts as received only once the agent's own session shows the typed message with its marker line. Until then the card says *Typed, not received yet*.
4. **It is never replayed automatically.** If the office can't confirm the answer arrived (nothing seen within about 30 seconds, or a restart mid-send), the attempt becomes *outcome unknown* and waits for you: **Send again**, **It went through** (your word, shown as yours) or **Abandon**.

What the office guarantees is durable intent, reconciliation from the session transcript, and no automatic replay. It does **not** promise that an answer arrives exactly once, and the store and the dispatch are not one transaction. Details are in [Escalations › Answering](../teams-and-agents/escalations.md#answering).

**When the answer is typed.** A decision card says *&lt;agent&gt; gets it after their current turn*. In fact, your answer to an escalation is **typed straight away** into an agent that is working, and Claude Code queues it and hands it over when it can. The office holds that answer back only while a dialog may be up in the agent's terminal (a permission prompt or a question, or while it is starting) or while it writes its handoff; then it goes in once that turn is over. An asleep agent is woken with it. **Change answer** and **Send correction** are different: they are held and typed when the agent's turn ends. See [Interruptions](../teams-and-agents/interruptions.md#the-office-never-cuts-into-a-turn-under-way).

**A stale answer.** The Overview's cards send the revision you saw. If someone answered the decision since you opened it, the answer is refused (*This decision changed since you opened it*) and nothing is written or typed.

**One card, several escalations.** Answering a card on the Overview answers every escalation folded into it, as one group: each gets its own dispatch.

### Answering from the phone

The phone's **Reply**, **Approve** and **Reject** (`src/server/mobile/actions.ts`) go through the same durable path: the answer is stored, then dispatched, and is never replayed automatically. Two things differ:

- **No revision check.** The phone doesn't send the revision you saw. An escalation someone already answered is still refused (*Already answered by …*), but the answer isn't checked against the exact version of the escalation you were looking at.
- **One escalation only.** It answers the escalation you tapped, not the other escalations folded into the same card on the Overview. Answering the card on the Overview answers all of them at once.

Approving a risky escalation (merge order, security, data loss, budget overrun) from the phone asks for your password again unless you signed in within the last 10 minutes.

## Known gaps

- **The notification channels count a subset** (what's urgent enough to post), so Home or the tray can say 0 while a project's page says 3. On a project's page the surfaces agree.
- **Other projects are counted only by their waiting agents**, not by their full Needs you: the office doesn't send every page every project's list.
- **An unconfirmed answer is invisible** away from the Portal Overview: not on the tray, Teams, push or the phone.
- **Some urgent items are never pushed or posted**: a sev1 incident or an approval stays on the project's own Needs you.
- **Some `info` rows are red**: an answered-but-unrecorded client question, and "live app ready".

Proposals to make unconfirmed answers and follow-through visible everywhere are in [Proposals](../architecture/proposals.md). They are **proposals**, not current behaviour.

## See also

- [Command Center](command-center.md): the cards, their buttons and the classic strip
- [Escalations](../teams-and-agents/escalations.md) and [Interruptions and back to work](../teams-and-agents/interruptions.md)
- [Home](home.md), [Desktop app](../administration/desktop-app.md), [Teams notifications](../integrations/teams-notifications.md), [Phone version](phone-version.md)
- Architecture: [State and sources of truth](../architecture/state-and-truth.md), [Execution lifecycle](../architecture/execution-lifecycle.md), [Proposals](../architecture/proposals.md)
