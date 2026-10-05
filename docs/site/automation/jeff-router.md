---
title: Jeff · Router
description: Jeff, the office's quick judge - powered by Jev with a Claude Haiku fallback; Off, Shadow and On modes; his key file; and what data leaves the laptop.
weight: 1
aliases: [/docs/jeff]
---

**Jeff · Router** is staff, not an agent. He is the office's quick judge, powered by **Jev**: TypeSafe AI's fast "System One" model, which answers typed questions about a piece of text. He sits beside the Project Coordinator on the org chart, and in his own glass room in the 2D view.

## What he judges

| Judgement | Question | The office's own rule | When **On**, Jeff… |
|---|---|---|---|
| 🙋 **Waiting on you** | An agent just ended its turn. Is it waiting on the Project Manager? | It is *needs input*, or has an open escalation | raises the escalation the agent forgot (important, *blocked*), when he's sure (≥ 0.7) and the rule says no |
| 🏷️ **Issue triage** | A new issue appeared. Which team is it for? | Its `team:` label | labels an unlabelled issue when he's sure (≥ 0.75) |

## Modes

Set each judgement in [Settings](../using-the-office/settings.md) → **Jeff · Router**:

- **Off**: never asked.
- **Shadow** (the default): asked, and his verdict is logged next to the office's own rule. He never acts.
- **On**: he acts as above.

Watch the **Jeff · Router** section of the [Analysis](../using-the-office/model-analysis.md) tab. It shows how often he agrees with the rule and the recent disagreements. When he agrees with *you*, switch that judgement to On.

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
