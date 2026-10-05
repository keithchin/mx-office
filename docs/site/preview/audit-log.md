---
title: Audit Log
description: Coming soon - an append-only, hash-chained audit trail per floor and for the whole office, with filters, a histogram and CSV / JSONL export.
weight: 1
badge: Preview
aliases: [/docs/audit]
---

> [!WARNING]
> **Coming soon, in preview.** The Audit Log is being built on its own branch and is **not in the office yet**. This page says what it will do. It will be completed, with screenshots and exact labels, when the feature lands.

## What it is

The **🧾 Audit Log** is a trail of everything that happens in the office: who did what, when, on which floor. It is:

- **append-only**: entries are only ever added, never edited or removed;
- **hash-chained**: each entry carries a hash of the one before it, so any change to past entries shows up as a broken chain;
- kept **per floor**, and for the **whole office**.

## Where you'll find it

- On a project's 1D view: a new tab, **Audit log**.
- On **/home**: an Audit log tab across every floor.

## What you'll be able to do

- **Filter** the entries (for example by floor, who, kind of event and time).
- See a **histogram** of activity over time.
- **Export** what you filtered as **CSV** or **JSONL**.
- Check that the chain is intact.

## Why it matters

The App Factory lets agents act with real autonomy. An audit trail you can't quietly edit lets the Project Manager, the client and [The Firm](the-firm.md) see exactly what happened: hires and benches, escalations and answers, approvals, merges, settings changes.

<!-- To complete when the feature lands:
     - the exact tab names and where they sit (1D tab id for ?tab=, the /home tab id)
     - which events are recorded, and each entry's fields
     - how the hash chain is computed and verified, and what a broken chain looks like
     - the filters, the histogram and the export formats, with screenshots (docs/site/images/audit-*.png)
     - where the log files are kept (Data locations), the API routes (API endpoints), and any settings
     - then take the `badge: Preview` and this warning off, and move the page out of preview/ (keep an alias) -->
