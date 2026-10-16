---
title: Escalations
description: How agents raise things to the Project Manager, what an escalation contains, how urgent ones alert you, and how your answer gets back to the agent.
weight: 3
---

An **escalation** is a structured question from an agent to you, with an urgency, options and a recommendation. It's how the team comes to the Project Manager.

![An escalation card](../images/escalations.png)

## Where escalations come from

- **An agent** runs `office-workers escalate` (or the MCP tool `escalate`). See [office-workers CLI](../reference/office-workers-cli.md).
- **A handoff note** ends with `AWAITING-PM: <question>` and there's no open escalation for it. The office raises one for the Lead.
- **Jeff · Router**, when *Waiting on you* is **On**: an agent ended its turn waiting on you but didn't say so. See [Jeff · Router](../automation/jeff-router.md).
- **An *ask* gate**: a Lead wants to do something its skill says it must ask about first. See [Skills and gates](../automation/skills.md).
- **A review loop out of rounds**: a Lead sent the same subagent's work back more times in a row than its autonomy level allows (2 rounds at levels 1 and 2, 3 at levels 3 and 4). The office raises one `revisions-exhausted` escalation for the Lead and stops nudging it about that subagent. See [The review loop](review-loop.md#bounded).

## The same ask, raised again

An agent's escalation that asks for what's already open on the project isn't opened a second time: it joins the open one as a **+1 from** *name*, its details are added, and that agent hears your answer too.

- **The same title, or nearly** (three quarters of the words shared): joined straight away.
- **The same ask in other words** (*Set repo secret X*, *One command to set the e2e secret*, *Secret 404: set it in the web page instead*): when no title matches, [Jeff](../automation/jeff-router.md#the-same-ask-in-other-words) is asked whether it's the same ask as one of the open ones, and it's joined only when he's at least 85% sure. While his **Waiting on you** judgement is Off he isn't asked; when he doesn't answer within 10 seconds, or fails, it's raised as its own.

The Activity line says *Jeff judged it the same ask* when he joined it, and so does the Audit log.

## What's in one

| Field | Notes |
|---|---|
| **Urgency** | `info`, `important` (default), `urgent` or `critical` |
| **Trigger** | Optional: plan, scope, design, architecture, revisions-exhausted, blocked, milestone, repeated-failure, budget-risk, security, data-loss, client-milestone, budget-overrun, blocked-no-path |
| **Title** | Required, up to 160 characters |
| **Details** | Up to 6000 characters |
| **Options** | Up to 6 |
| **Recommendation** | Up to 400 characters |

The office stamps who raised it (name, role, team) and the autonomy level at the time, and works out whether it's an **FYI** for that level. See [Autonomy levels](autonomy.md#fyi-escalations).

## How you're told

- Every open, non-FYI escalation is in **🚨 Needs you** (in Portal, the Overview's Needs you card shows it in full: the question, the options with the recommendation marked, why, and **Send answer** / **Reply in my words** / **Ask &lt;lead&gt;**) and **✅ Approvals**.
- An **urgent** or **critical** one also makes a toast and a desktop notification.
- Jeff rates each open one and, with his **Priority** on (the default), the lists show them in his order with a **🧑‍⚖️ #1 · resolve first** chip. See [Jeff · Router](../automation/jeff-router.md#priority-which-escalation-first).
- The Project Coordinator is told about the team's escalations (batched a minute after the last one), so it can summarise them for you. The relay says it needs no reply. While the Coordinator is benched or asking someone, or the project's daily cost cap is reached, they wait for it, kept in the roster file so a restart doesn't lose them. An asleep Coordinator is woken with all its relays in one message, at most once a minute. A project with no Coordinator at all skips them (they're on the Command Center and the next standup page anyway).

## Answering

On the card, as admin:

- **💬 Reply**: send an answer or a question back.
- **✅ Approve**: go ahead (pick an option first to fill in *Go with: …*).
- **❌ Reject**: no, with a reason.
- **✓ Noted**: for an FYI.

The answer goes to the agent as a prompt: *REPLIED*, *APPROVED*, *REJECTED* or *NOTED*.

- If it's **asking something in its terminal** (a permission prompt or a question, or it's still starting up), the answer isn't typed there, where Enter would pick one of the dialog's options and the answer would be lost. It waits, and goes in once that turn is over, with any other answers it's owed, in one message. The Activity says *… has a question open in its terminal: the answer goes in once that's answered*, and the answer counts as not delivered until then.
- If it's **asleep**, it's woken with your answer.
- If it was **benched**, its role gets the answer: in its current session, or by re-hiring it with your answer in its first message (when hiring is open).

Your answer is kept before it's sent: the office appends it, in full, to the project's answer history (`<office data>/answers/<project>.jsonl`), writes down the attempt to type it, and only then types it, ending with a marker line such as *[office answer dsp_… · ESC-3f9c2a1b7e rev 1]*. The escalation is resolved only once the attempt settled. An answer that waits for the agent's turn (a dialog up) keeps the same attempt, and its prompt is on disk at once. If the office stops mid-way, it checks the agent's session when it starts again and never types the answer again by itself; an attempt it can't confirm shows in Needs you with **Send again**, **It went through** and **Abandon** (see [Answers whose outcome is unknown](../using-the-office/command-center.md#answers-whose-outcome-is-unknown)). What the office guarantees is **durable intent plus reconciliation, and no automatic replay of an ambiguous attempt**. It does not promise that an answer is delivered exactly once. An answer to an escalation someone answered meanwhile is refused (*This decision changed since you opened it*), with nothing sent.

### Recorded as given

Your answer asks the agent to record the decision with a citation, on a line of its own in its team journal entry (`docs/team/*.md`) or in PROJECT.md's Decisions row, and gives it the exact line to write:

```
Decided per ESC-3f9c2a1b7e rev 1: Use SSO
```

The citation, a colon, then the answer exactly as given and nothing else on that line. Rationale, conditions and commentary go on the next line (in a Decisions table, in another cell). The id and the revision are the ones in the answer's marker line, and the [Playbooks](playbooks-and-journals.md) say the same.

The office looks for the citation in the project folder, every agent's worktree and the branch heads, on the same look that finds `AWAITING-PM` lines (every few minutes, and soon after a turn ends: no polling of its own, local git only, never GitHub). Finding the citation only **locates** the record: it never shows that the record agrees with you. The office then compares the record's **answer**, the text after the citation's colon to the end of that line (in a table row, to the end of its cell), with your answer:

- **The exact-answer rule.** The answer must be exactly your chosen option, or your words (also without *Go with:* and without an option's letter), or, for an approval or a rejection with no words, *APPROVED* or *REJECTED*. The comparison ignores only: runs of spaces and line breaks, curly quotes and Unicode dashes or minus signs (read as `'`, `"` and `-`), letter case, one pair of quotes or backticks around the whole answer, and one full stop at its end. Nothing else is ignored: *-5* is not *5*, *Do not merge now* is not *Merge now*, *If CI passes, merge now* is not *Merge now*, and *"Merge now" was rejected* is not *Merge now*. There is no list of negative words and no AI judging the wording: anything that isn't exactly the answer is for you to review. The rest of the paragraph or row is kept and shown, never read as the answer.
- **Recorded as given:** the answer is exact, at the current revision.
- **Needs review: not worded exactly as given:** the record mentions your answer but doesn't state it exactly (a negation, a condition, a quotation, added words or commentary on the answer line, or an older line written before this rule). The card shows your answer, the record and the answer read from its line.
- **Recorded differently:** the citation is right, the answer is something else. The record is kept as written, and the card shows both texts.
- **Recorded for rev 1:** the record cites an older revision of your answer than the current one.
- **Not recorded yet:** no citation found.

Where the record is, is kept as separate fields: the file's `path`, the `commitSha` of the commit that holds it (none for a working copy), the file's `blobId` in that commit (`git rev-parse <commit>:<path>`, never the commit itself), and `where`: **in a working copy, not committed**, **committed on** a branch, or **merged into main**. Merged means the commit is reachable from `origin/<default branch>`, by local git only.

Only **recorded as given, at the current revision, merged into main** takes the answer off the follow-through list by itself, and only that counts where something else waits on the decision (see [stuck detection](../using-the-office/stuck-detection.md)). *Needs review* and *Recorded differently* never clear anything by themselves; **Accept as recorded** (your choice, a new revision) makes the record's words your decision. See [Following through](../using-the-office/command-center.md#following-through) for the cards and their buttons.

### Changing an answer

An answered escalation has **Change answer** on its card in the Team tab's approvals and on its follow-through item in Needs you (admins only; the server checks). It opens a small window (✕ top right; ✕ or Esc puts you back where you were) with:

- **Current answer (rev n)**: its words, who gave it and when, how it was sent, and its follow-through state.
- **New answer**: the same choices as the first time: the escalation's options, your reply, and Reply, Approve or Reject (Noted for an FYI). Or tick **No implementation work required**: the answer stands as it is, and a new revision of that kind records your choice, with what you type as the reason. The agent is told to record it and start no work for it. The same box is on the escalation's card in the Team tab when you first answer it.
- **Work that used rev n**: what the office knows used the answer. A **Recorded link** is a field that names the escalation: its `refs` (the BRD question, the decision id, the PR, the stage, the stuck item, the journey), a member's task waiting on it, or a task's verification raised as it. **Inferred** is text the office read: a model change request whose words name *ESC-&lt;id&gt;*, or the linked BRD question's free-text *blocks*. Below them are the **task links** (see [Task ids and linked work](#task-ids-and-linked-work)), each with how it was found and how far its evidence goes. When there is nothing it says *No links found* (the office located nothing, which is not the same as no work being needed), never that nothing was affected.
- **Send change.**

Sending appends revision n+1 to the answer history, marked as replacing rev n, and hands it to the agent that raised it through the same durable path as an answer (after its current turn). The message says plainly: *This replaces my answer rev 1 to ESC-3f9c2a1b7e: Go with: Use magic links. Record it as `Decided per ESC-3f9c2a1b7e rev 2`*, and asks the agent to check what it did on the strength of rev 1. If someone changed or answered it since you opened the window, it's refused (*This decision changed since you opened it*) with nothing written or sent, and the window shows the answer as it is now.

Follow-through then tracks rev n+1. A record that still cites rev 1 reads **Recorded for rev 1** until the agent records the new answer; rev 1's own finding stays in the history. An escalation answered before answer revisions were kept, or closed as a duplicate, can't be changed here. If the office can't confirm the change was typed, nothing moves: the change is kept on disk before it's typed, and the card in Needs you asks you to settle it, after a restart too (**It went through** moves the escalation to the new revision, **Abandon** leaves it on the old one). Send correction works the same way.

**History (3 revisions)** under the same card opens every revision from the answer history (never the shorter copy on the escalation): its number, kind, full text, who and when, how it was sent (*You said it went through* stays a person's confirmation), and what follow-through found for it. It's read once, when you open it.

Your answer goes through even when the project's daily cost cap is reached: the cap holds the office's own prompts, not yours. See [Models and costs](models-and-costs.md#the-daily-cost-cap).

> [!NOTE]
> A Lead waiting on an open escalation of its own is never benched for idling. It is waiting on you, not idle.

## Task ids and linked work

Every new piece of work the office hands an agent gets a **task id**, `tsk_<ulid>`: a hire's task, a prompt that gives a team member a task, a Coordinator's `office-workers tell`, a model change request, a stuck item's or a decision card's ask to the lead, a queue task (its old queue id kept beside it) and a proposal's GitHub issue. The task text the agent reads ends with a `Task: tsk_…` line, the desk-opened pull request's *Task* section ends with it, and the Playbooks ask agents to put it as a trailer on their commits and as a line in their pull requests, as they name `MCR-<n>` for a model change request. Handing the task to another agent, or restarting its worker, keeps the task id; each attempt (a hire, or the task handed to a worker's session) gets its own execution id, `exe_<ulid>`. Both go on the audit log's events and on the budget ledger's rows when the office knows them. Tasks from before task ids stay a **legacy task (no id)**: no id is ever made up for them. There is no task list page yet.

When you answer, each dispatch records the task its recipient is on. **Work that used rev n** (in Change answer) and the follow-through item list each link with its **strength**:

- **candidate**: the recipient's task when your answer went. Only a candidate, never proof.
- **associated**: a commit, pull request or issue names *ESC-&lt;id&gt; rev &lt;n&gt;* or the task id (local git and the pull requests the office already fetched; nothing new is polled).
- **inferred**: a build-plan row whose text names it, labelled as inferred.

And with its **evidence**, always for that revision:

- **acknowledged**: the office saw your answer typed, and a later turn of the agent in that same session cites *ESC-&lt;id&gt; rev &lt;n&gt;* (in its words or its escalation reply). A turn that merely follows isn't enough.
- **associated change**: a commit after your answer, on the task's branch, citing the revision. It says the work changed, never that your answer was implemented.
- **checks passed on the associated change**: checks that passed on the task's pull request at a revision containing that commit. A later passing check that doesn't contain it proves nothing.
- **Implemented as decided**: only your acceptance, when the acceptance record names the decision revision.

For example: *Task tsk_… "Visitor checkout" (Linus): candidate · acknowledged · associated change PR #98 · checks passed on the associated change @e77a0d3*. *No links found* (nothing located) and *No implementation work required* (your stated choice, kept as an answer revision) are never shown one for the other.

## Asks that need a person: `needs-human` and `question`

Two triggers are never filed as FYI, at any autonomy level: **`needs-human`**, a hands-on action only a person can do (merge a pull request, sign in such as `mxcli auth login`, paste a key, install a tool, allow something at the terminal, restart a preview), and **`question`**, a question only the Project Manager can answer. They toast, relay to the Coordinator and post to Teams like a blocking escalation. The Playbooks tell every Lead to raise hands-on asks with `office-workers escalate --trigger needs-human`, never as a `task` proposal; a standup proposal whose words are such an action becomes the **human-action** kind, which waits for the Project Manager at every level (a plain task is still the team's at level 4).

## FYI escalations are shown, not hidden

An escalation below the level's threshold is still filed as FYI (no toast, no Teams post), but Needs you lists it as a low **FYI** card with **Noted**, not counted in *N waiting on you*, so an ask filed quietly is still seen. An FYI that has options or asks a question is shown, and counted, as a decision, with a *filed as FYI* note.

## Answers, outcomes and ids

Besides Reply, Approve and Reject, a [decision card](../using-the-office/command-center.md#decision-cards) answers with **Noted** (an FYI) or **I've done it** (a hands-on action: the agent is told *&lt;you&gt; says it's done: please re-check*, never *APPROVED*). Each is kept as an outcome beside a verdict an older office knows (noted: *dismiss*; done: *reply "Done"*). A duplicate you close from Needs you's clean-up card is kept as *superseded* (verdict *dismiss*) with the id of the escalation it repeats, and nothing is sent to the agent. An escalation also keeps the explicit ids it is about (`refs`: a BRD question key, a decision id such as `OW-1`, a PR number, a stage, a stuck item, a journey such as `J-08`), read from its title when it names exactly one of a kind; Needs you groups it with the other sources of the same decision only on those. Escalations from before this have no stored ids: Needs you reads them from the title with the same rule when it builds the cards (nothing is written back), and the card says *id read from the title*.

## Escalations the office files for an agent

- **From the chat.** Whoever covers Management (the Coordinator, or the lead on a Solo or Startup team) has Jeff's waiting judgement On by default (**The lead's chat** in Team settings, which can be set back to Shadow). When its last message really asks you something and it filed no escalation in that turn, the office files one for it, titled *From the chat: …*, as `question` or `needs-human`; the same ask isn't filed again within a day, and another open escalation doesn't hold it back.
- **From an `AWAITING-PM` line.** Each item of the newest `AWAITING-PM:` line of a team journal becomes an escalation of its own. Items are split only on clear list separators (`;`, ` · `, a numbered *(1) … (2) …* list, or a bulleted list under an empty `AWAITING-PM:` line), never on a comma or a semicolon inside brackets; a short clause that only points back (*Ada has it*) stays with its item, a closing note such as *(#98 is escalation …, separate.)* or *, both already in open escalations* is commentary, and *merge #98 and run the LF conversion (issue #91)* is two asks. The item is read wherever the newest entry is: the project folder, an agent's worktree, its branch head (local git only). It happens on bench, on pause and in the office's five-minute look, once per entry. When the line is gone from the newest entry, the escalation is **not** closed: its card in Needs you says so, with **Resolved** and **Still needed: ask &lt;agent&gt;** (a missing line isn't an answer, and a journal the office couldn't read says nothing either way). An escalation the agent raised itself in the same words isn't doubled.
- **Reworded items continue.** When the same role writes an item again in other words in a newer entry (*GenAI key*, then *GenAI Text Generation resource + key*), the escalation already open for it (its line gone or not) is updated in place, with the new words and its line back, instead of a second one being filed (`escalation.continued` in the [Audit log](../using-the-office/audit-log.md)). The same item means: the same explicit ids when both name ids (`#98`, `OW-1`, `J-08`; different ids are different decisions), or otherwise the same words once brackets, punctuation and small words are set aside, overlapping highly (Jaccard 0.8 or more) or every word of the shorter (two at least) in the longer, unless the shorter is only one side of an *and* or a *+* (*preview restart* is not *preview restart + Withdraw rebuild*). Never across roles, never across sources (an escalation the agent raised itself isn't continued), and never two escalations you separated on a card.
- **From an approved `human-action` proposal.** Approving one makes its issue (once, even if two people approve it at the same moment) and files a hands-on escalation for the proposer, open in Needs you until you press **I've done it**.
