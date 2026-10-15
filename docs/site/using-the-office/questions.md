---
title: Questions
description: The open questions the analysts raised for the client in the BRDs, collected by the office from main and every agent's working copy, answered in one place and sent back to the analyst to record.
weight: 3.45
---

**Questions** (*Project Management › Questions*) shows every open question an analyst agent raised for the client in the project's BRDs, and lets you answer them in one place. Before it, an analyst could write two dozen structured questions into BRD files and the office never showed them: you only heard of them by asking the Project Coordinator.

The office reads the questions the toolkit's way and never changes a BRD itself: your answers go back to the analyst in one message, and the analyst records them.

## Where the questions come from

An analyst raises questions in a BRD's `openQuestions` (each with an `id`, the `question`, its `kind`, `status`, `evidence`, `proposedPosition`, what it `blocks`, its `owner` and a `sourceRef`), and in `analysis/sme-questions.md`. Its status uses the toolkit's controlled vocabulary (`bin/open-questions.sh`):

| Status | Means | Waits on you? |
|---|---|---|
| UNRAISED | Never put to you (also an ASSUMED with no `consentBy`/`consentAt`, which the toolkit counts as never raised) | Yes |
| RAISED | Put to you, awaiting your reply | Yes |
| UNRECOGNISED | A status the toolkit couldn't read | Yes |
| ANSWERED | You decided (an answer is recorded) | No |
| ASSUMED | The analyst took a position and you consented (`consentBy`, `consentAt`) | No |
| MOOT | It stopped mattering (the reason is recorded) | No |

The office collects them from the project's folder (main) and from every agent's worktree (`.agent-office/worktrees/*`), because the questions are often only in an analyst's working copy, not yet committed. It runs the project's pinned toolkit's `bin/open-questions.sh <folder> --json` (with Git Bash, as it runs gate-check) for each verdict, and reads the BRDs for the rest. Questions are merged by BRD and id: an agent's copy wins over main's when it differs, and each card says where it was read (*Tim's working copy, not committed* or *main*).

If the toolkit script is missing or fails, the office reads the BRDs' `openQuestions` with the script's rules and the page says *Toolkit script unavailable: read from the BRD files*. A failure never reads as "no questions".

The office collects at most every 5 minutes on its own, shortly after an agent's turn ends, and when you press **⟳ Refresh**. It runs off the main thread, reuses the script's last answer for a folder whose files haven't changed, and makes no GitHub call.

## The page

The header counts them: *Questions · 9 of 24 answered · 6 block work* (answered by you or settled in the BRD; *block work* means the question's `blocks` names something). Filter by **Needs the client** (kind `user-only`), **You can decide** (`choice`, and the gaps and conflicts the analyst offers a position on), **Blocks work** and **Answered**, or search. The questions are grouped by BRD, under the BRD's title.

Each card has the id, the question, what it blocks, who can answer it, the proposed position when there is one, the evidence (folded) and where it was read, with its status:

| Status | Means |
|---|---|
| *Waiting on you* | Open in the BRD, no answer from you yet |
| *Your answer: ready to send* | You answered; it waits in the bar below |
| *Your answer: sent to Tim, not recorded yet* | Sent; the BRD doesn't say so yet |
| *Recorded (ANSWERED by Keith, 13 Oct)* | The toolkit reads it ANSWERED, ASSUMED or MOOT |
| *Asked the client* | Marked for the export to the client |
| ⚠ *Assumed by agent without your consent* | The analyst wrote ASSUMED without your consent; the toolkit counts it as never raised |

Its buttons:

- **Accept proposal** (only when there's a proposed position): records it as ASSUMED with your consent (`consentBy` is your name, `consentAt` the time).
- **Answer**: your answer in words (and one of the options, when the BRD lists them). Recorded as ANSWERED.
- **Ask the client**: marks it for the export. It no longer waits on you.
- **Not relevant**: with the reason (required). Recorded as MOOT with it.
- **Take back**: an answer not sent yet.

## Sending your answers

Answers wait in a bar at the bottom: *7 answers ready · Send to Tim*. **Send to Tim** shows the message first: one message with every answer (its id, BRD, the status to set, the answer, and `consentBy`/`consentAt` for an accepted proposal), asking the analyst to record them in the BRD files with the toolkit's vocabulary and re-run `bin/open-questions.sh`. It goes to the agent whose working copy the questions are in, or, for questions on main, to whoever covers Analysis.

If the analyst is working, it asks **OK to interrupt?**: **After their current turn** (the default: the office holds it until the turn ends) or **Interrupt now**, the same choice as the console's. The analyst goes back to its task afterwards.

Each answer you give is kept in the project's answer history before the book changes, and **Send** is written down before it's typed, with a marker line at the end of the message. If the office stops while sending and can't confirm afterwards that the message reached the analyst, the answers stay **ready to send** and Needs you asks you to settle it (**Send again**, **It went through**, **Abandon**). What the office guarantees is **durable intent plus reconciliation, and no automatic replay of an ambiguous attempt**. It does not promise that an answer is delivered exactly once. An answer changed by someone else since you opened the page is refused, with nothing written.

### Recorded as given

At **Send** the office keeps what the message asked the analyst to record for each answer: the status, and the `answer`, or the `decision` with `consentBy` and `consentAt`. On every collection it compares the BRD's fields with that. The toolkit's ANSWERED, ASSUMED or MOOT alone never counts: the words must match (case, quotes, punctuation and spacing aside; consent times to the minute).

Each sent answer's card says how its record stands, and where:

- **Recorded as given**, then **In a working copy, not committed**, **Committed on office/tim-1** or **Merged into main**. The location keeps the file's path, the commit and the file's blob in that commit as separate fields.
- **Recorded differently**: the BRD says something else. The card shows *You decided: … · Recorded: …* with the location, and **Accept as recorded** (the BRD's words become a new revision of your answer; nothing is sent) or **Send correction** (a new revision, sent to the analyst as a new message that replaces the last one).
- **Recorded for rev 1**: the record matches an earlier revision of your answer.
- **Not recorded yet.**

An answer shows as **recorded** only when it's recorded as given at its current revision and merged into main. Until then it stays a follow-through card in Needs you (not counted as waiting on you), unless you dismiss it.

Answers sent before Recorded as given came in have no stored expectation. They are **legacy**: recorded once a later collection reads ANSWERED, ASSUMED or MOOT, as before, and the card says *legacy: by the toolkit's state*.

## Export for the client, and their answers back

**Export for the client** makes a file with the questions marked *Ask the client*, or those and every open `user-only` question: the id, the BRD, the question, its context in plain words, what it blocks, and an empty **Answer** column. It's a **CSV** (Excel opens it) or a **printable page**.

**Import answers** takes the filled-in CSV back, or pasted lines like `OQ-05: Yes, all ten draft decisions are confirmed.` Each answer goes on the question with the same id as *Answered (from the client file, imported by Keith)*, ready to send.

## Needs you and notifications

Each question waiting on you is a [decision card](command-center.md#decision-cards) of its own in Needs you, grouped with the other sources of the same question: its stuck item, and `PROJECT.md`'s register row with the same id (OQ-07 in the register is F002's OQ-07 when only one BRD has that id). Its **Answer** opens this page at that question. Once you've answered, the card shows *Sent* until the toolkit reads it recorded, and if the register still lists the question as open it says so: the message **Send** types asks the analyst to mark the register row answered too, so both close. Each card counts in the Overview's and the team-lead panel's *N waiting on you*.

It's a red item, so it follows the usual rules for [phone pushes](phone-version.md) (Do not disturb and the digest apply) and [Teams cards](../integrations/teams-notifications.md): **one notification when new questions appear**, not one per question.

A `user-only` question that blocks work and has waited on you longer than the decision threshold (24 h by default) also becomes a [stuck item](stuck-detection.md) (*Client question waiting on you: …*), raised once and resolved by itself when you answer it. It shows inside the question's card, not as a second item. Its age is from the `raisedAtGate` date when the BRD has one, else from when the office first saw it or the file's time.

## The Playbooks

The analyst's [Playbook](../teams-and-agents/playbooks-and-journals.md) (the Chief Analyst's, or whoever covers Analysis) says: raise questions for the PM as a batch in the BRD `openQuestions` with the toolkit's vocabulary (status RAISED), because the office shows them here; don't announce them only in chat; record the PM's answers when the office sends them, then re-run `bin/open-questions.sh`.

## Audit and data

New questions, your answers, each send, imports and recorded answers are in the [Audit log](audit-log.md) as `questions.new`, `questions.answer`, `questions.sent`, `questions.imported` and `questions.recorded` (the *Escalations & approvals* group). Only admins answer, send and import; everyone sees the page. What the office keeps per project (the last collection and your answers) is in `<office data>/questions/<project>.json`.
