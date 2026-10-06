---
title: Jeff · Router
description: Jeff, the office's quick judge - powered by Jev with a Claude Haiku fallback; Off, Shadow and On modes; priority sorting of escalations; his key file; and what data leaves the laptop.
weight: 1
aliases: [/docs/jeff]
---

**Jeff · Router** is staff, not an agent. He is the office's quick judge, powered by **Jev**: TypeSafe AI's fast "System One" model, which answers typed questions about a piece of text. He sits beside the Project Coordinator on the org chart, and in his own glass room in the 2D view.

## What he judges

| Judgement | Question | The office's own rule | When **On**, Jeff… |
|---|---|---|---|
| 🙋 **Waiting on you** | An agent just ended its turn. Is it waiting on the Project Manager? | It is *needs input*, or has an open escalation | raises the escalation the agent forgot (important, *blocked*), when he's sure (≥ 0.7), the rule says no and its message really asks you something (see [When he escalates](#when-he-escalates)) |
| 🏷️ **Issue triage** | A new issue appeared. Which team is it for? | Its `team:` label | labels an unlabelled issue when he's sure (≥ 0.75) |
| 🧑‍⚖️ **Priority** | An escalation is open. How soon should the Project Manager resolve it? | Urgency, then age | puts the escalation lists in his order, with a chip (see below). Advisory only |

## Modes

Set each judgement in [Settings](../using-the-office/settings.md) → **Jeff · Router**:

- **Off**: never asked.
- **Shadow** (the default for Waiting on you and Triage): asked, and his verdict is logged next to the office's own rule. He never acts.
- **On**: he acts as above. **Priority** is Off or On only, and On by default: it only orders lists, so there is nothing to watch in shadow first.

Watch the **Jeff · Router** section of the [Analysis](../using-the-office/model-analysis.md) tab. It shows how often he agrees with the rule and the recent disagreements. When he agrees with *you*, switch that judgement to On.

## When he escalates

With **Waiting on you** On, **When to escalate** (Settings → Jeff · Router) says what it takes for him to raise an escalation the office's rule missed:

- **Only a real ask** (the default, `agree`): he says it's waiting *and* the end of its last message (its last three paragraphs) asks you something: a question put to you, a request or approval (*should I…*, *can you…*, *waiting on you*, *until you decide*, *needs your approval*, *for you to merge*), or an `AWAITING-PM:` line. A progress report (*Still running: …*, *I also told Keith…*), a condition (*If you meant something else, tell me*) or the future (*Merging it will need your approval when I open its PR*) isn't one. When he says it's waiting but there's no real ask, nothing is raised: the row is logged as a disagreement, marked *held: no real ask* on the Analysis tab.
- **His say-so** (`model`): his verdict alone is enough, as he worked before. Progress reports get escalated too.

Either way he never raises what the agent already raised: an escalation of its own about the same (the same title, or nearly) that is open, or was answered in the last 6 hours, is *held: raised already*. When the rule already says it's waiting (it's *needs input*, or has an open escalation), there is nothing for him to raise.

> [!NOTE]
> Agents raising the same thing are merged too: an agent's `office-workers escalate` whose title matches an open escalation on the floor (nearly word for word) adds a **+1 from** *name* with its details to that one instead of opening a second, and the agent hears your answer as well. See [Escalations](../teams-and-agents/escalations.md).

## The same ask in other words

When an agent's new escalation matches no open one by title, and **Waiting on you** isn't Off (Shadow counts), Jeff is asked whether it asks you for the same thing as one of the floor's open ones: the same decision, the same action, the same missing secret or access, however it's worded. He reads the new title and the start of its details, and the newest 8 open escalations' titles and details, redacted like everything he reads. Only a pick he's at least **85%** sure of joins it as a +1; *none*, a lower confidence, no answer within 10 seconds or any failure raises it as its own. He's asked at most 30 times an hour per floor, and the Haiku fallback's own hourly cap applies too.

This is what would have turned mx-spike's nine escalations about two CI secrets (*Set repo secret …*, *One command to set the e2e secret …*, *Secret 404 …*) into what they were: two asks.

## Priority: which escalation first

With **Priority** on (the default, Settings → Jeff · Router → **Priority**: Off or On), Jeff rates every open escalation that isn't FYI, once, and again at most once an hour or when its text changes. He picks a level, from *Can wait days* to *Blocking work right now, or a critical risk*, and says how true two things are: *agents are stopped until you answer* (blocking) and *delaying it risks security, data loss, budget overrun or a client milestone* (risk). The office turns that into a score:

```text
score = 100 × (0.45 × level + 0.35 × blocking + 0.20 × risk)  +  20 × blocking × min(1, hours open / 24)
```

So an old blocker climbs past a fresh one of the same weight, while an old nice-to-have doesn't climb at all.

- **Escalations to you** on the [Command Center](../using-the-office/command-center.md), the [Approvals](../using-the-office/approvals.md) tab and **Needs you** list the open escalations in his order, under the note *Sorted by Jeff · Router — resolve from the top*.
- Beside each card is a chip: **🧑‍⚖️ #1 · resolve first**, then **#2**, **#3**… Hover it for *Jeff (Jev) ranks this #1: blocking 92%, risk 40%* and his level.
- A **critical** or **urgent** escalation he hasn't rated yet (just raised, or he's down) stays above his list; other unrated ones go below it.
- Off, or nothing rated yet: the lists keep their usual order (urgency, then age).

It only orders the lists: nothing is answered, raised or hidden for you.

## Jev and the Haiku fallback

- With a key, Jeff asks Jev (`api.typesafe.ai`), with a 3-second timeout. He shows as **Jeff (Jev)**.
- Without a key, while Jev is failing (2 failures in a row skip it for 5 minutes), or when Jev doesn't answer, he runs on **Claude Haiku** through the `claude` CLI, up to 40 calls an hour. He shows as **Jeff (on Haiku)**.
- If neither answers, the office keeps its own rule.

## His key

The launcher passes only the **path** of the key file: `AGENT_OFFICE_JEV_KEY_FILE` pointing at `~/.agent-office-jev-key`. The office reads the file's first line (re-reading it at most every 30 seconds). You can set `TYPESAFE_API_KEY` instead.

> [!IMPORTANT]
> Workers never get the key: both variables are removed from every worker's environment. Never print or paste the key file.

## What data leaves the laptop

With a key, an agent's last message and new issues' text go to TypeSafe. Before they leave:

- tokens and secrets are **redacted** (GitHub tokens, `sk-…` keys, Slack tokens, AWS keys, `Bearer …`, private keys, and the value of `token=`, `password=` and similar);
- the text is **clipped to 4000 characters** (the end of an agent's last words, the start of an issue).

Without a key, the same text goes to Claude Haiku instead.

## Where his verdicts are kept

`<office data>/judge/<floor>.jsonl`, one line per verdict: when, which judgement, the subject, Jev or Haiku, the model, how long it took, Jeff's verdict, the rule's, whether they agree, whether he acted, and the first 300 characters of the text. The file is trimmed past 5000 lines.
