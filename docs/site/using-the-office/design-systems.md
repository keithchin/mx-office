---
title: Design systems
description: Give a client a reusable design system (Atlas defaults or Branded Atlas), publish immutable versions, adopt one exact version per project, apply it with mxcli theme, pick patterns per page or issue in the Design gallery, and give agents one Design line per task.
weight: 2.3
aliases: [/docs/design-systems]
---

A **design system** is a client's reusable look and set of interaction patterns for its Mendix apps. You set it up once on the client, publish a version, and new projects of that client can adopt that exact version. The office applies the theme for you with `mxcli theme`, and agents get a short pointer to it with each task instead of inventing the design again.

Design systems are optional. A client without one, a project without a client, or a project that chose **Keep the app's design** works exactly as before.

> **Branded Atlas covers colours, type, density and shape.** Logo, brand font files, page layouts and the toolkit's extra components (the StyleGallery's KPI tiles, chips, stepper and so on) are separate work: they are not tokens. The office says so wherever Branded Atlas is offered. No token or cost saving is claimed: the office records what each task used so it can be measured.

## A client's design system

On a client's page (**Clients** › the client), the **Design system** part offers three choices:

- **None** (the default): today's behaviour.
- **Atlas defaults**: Atlas as it ships, no theme change, plus the administration patterns.
- **Branded Atlas**: a short form. Name, the primary colour, four status colours (success, warning, danger, info), background, cards and text, a font family with a fallback for when it isn't installed, density (compact, comfortable or spacious rows) and corners (square, soft or round).

From those few inputs the office derives **all 40** of mxcli's `--mxt-*` theme tokens, light and dark: hover and ink colours, surfaces, the navigation rail, status tints, radius, row and control heights. All 40 are always set, so nothing falls back to the starting theme's colours. Beside the form you see a small preview drawn with the derived tokens (an approximation, not the app) and a **contrast check** of the pairs that carry text (WCAG 2.2 AA, 4.5:1).

**Save draft** keeps the form. **Publish v1** freezes it as an immutable version in the office's data folder (`<data>/design-systems/packages/<id>/v1/`): the token file, a short summary, the five pattern files and a manifest with the version's **digest** (a sha256 over its files), a compatibility label and the **mxcli version** it was published with. The label always says Studio Pro 11.12.4 and Atlas 3: it is fixed in the office, not worked out from the package, and nothing checks a project's Studio Pro version against it. Only the mxcli version is real, and a project applying the package with a different mxcli gets a **warning** on its binding, not a refusal. A published version never changes. **Edit as new draft** starts the next version from it.

A published version is **Draft** until an admin presses **Approve**; approving a newer version marks the older approved one **Superseded**. **Make default** recommends an approved version to the client's new projects. Changing the default never changes a project that already adopted a version: each project keeps the exact version it took until someone decides otherwise. Every step is in the audit log (`design.draft`, `design.publish`, `design.approve`, `design.default`).

Packages live in the office's data folder, not in the company brain. Deleting `<data>/design-systems/` takes the office back to today's behaviour; you can also delete the `design` entry in a project's `agent-office.project.json`, though the office doesn't load bindings from it (see below).

## Adopting it in a new project

In ✨ **New project** › Advanced, once you pick a client that has an approved design system, a **Design system** line shows its recommendation: *Acme Design System v1 — recommended for this client*, with **Use this version**, **Choose another** (the client's other approved versions) and **Keep the app's design**. A new app starts on the recommendation; nothing is shown for a client without one.

With **Use this version**, right after the Mendix app is created the setup:

1. checks the app's starting point: plain Atlas (what `mx create-project` makes), an mxcli theme (what `mxcli new` makes: *signal*), or styling of its own;
2. runs `mxcli theme create <theme> --from tokens.css --force` and `mxcli theme apply <theme>` with the office's mxcli, off the office's event loop. The theme's name ends in the package digest's first eight characters (`acme-design-system-3f2a91c0`), so the fenced blocks mxcli writes in `theme/web/*.scss` name the exact package;
3. checks the result itself, because mxcli's own word isn't enough: any `skipped` block is a failure (mxcli can refuse a block and still exit 0), the fenced blocks must be in `custom-variables.scss` and `main.scss`, and the `.mpr` and `themesource/` (Atlas core) must be exactly as they were.

The binding (package, version, digest, preset, who approved it, exceptions, the starting point and mxcli's fence digests) is recorded in the office's data folder (`<data>/design-systems/projects.json`) and also written as `design` in the project's `agent-office.project.json`; the setup's commit takes the theme files.

> [!NOTE]
> **The office's own record is the one that counts.** The committed `design` entry is written for agents and other readers, but the office doesn't load a binding from it (it only looks at its digest to recognise a squash-merged adoption, below): what a project is bound to, what agents are told and what the Design gallery shows all come from the office's data folder. Editing or deleting the committed entry changes nothing in the office, and an office that clones the project doesn't pick the binding up from it. An existing app that adopts **Atlas defaults** gets no committed entry at all (nothing in the project changes); a new project on Atlas defaults does. The step is restart-safe: its record is written before mxcli runs, a Retry after it finished doesn't run mxcli again, and a restart halfway runs mxcli's idempotent apply, which reports `unchanged`. If the apply fails or the app has styling of its own, the project is still created and the design system waits for you as a ✋ card instead.

## Existing apps: always a ✋ decision

An existing app (✨ New project › Change an existing app, or any project from its Design gallery) is never changed automatically. The office scans its styling first:

- Atlas variables set outside the theme's blocks (for example `--brand-primary` in `custom-variables.scss`): these **would stop applying**, because Atlas imports the theme last;
- custom rules in `custom-variables.scss` or `main.scss` (they stay, outside the theme's blocks);
- theme modules of its own in `themesource/` (they stay as they are).

Then Needs you shows one card: **Adopt Acme Design System v1 in this project?** with what would be overridden, and two buttons. **Keep existing design** is the default and changes nothing. **Adopt** is one click with no further confirmation: in one action it applies the package in a temporary worktree on a branch of its own (`agent-office/design-<theme>`), commits it there and pushes that branch when the project has a remote (never to the default branch, never forced), so the change is reviewed and merged like any other. Only `theme/web`, `theme/mxcli-themes` and `agent-office.project.json` change.

Adopting goes step by step, and the office says which step it reached: **applied**, **committed** (locally), **pushed**, **merged**. Until the branch is merged into the default branch the version is only a **candidate**: the project keeps the design it had (or none), the Design gallery and the card say *candidate on the branch …, not merged*, and agents are told the same, never that the theme is applied. Once the candidate commit is on `origin/<default>` (or, with no remote, the local `main`; a squash merge counts when its `agent-office.project.json` records the package), the project is bound to it and the card goes. Each step is recorded before it runs, and after a restart the office checks git to see how far it really got.

If a step fails (a pre-commit hook refuses the commit, the push is rejected…), nothing is bound and the card stays as *Adoption failed at …* with **Retry** and **Discard**. A failed push says *committed locally, not pushed*: the commit is kept, and Retry pushes it. Retry carries on from the failed step on the same branch: commits already on it (review edits, someone's own work) are kept, never rewritten; a branch whose commits are all in the project already starts again from the current commit. Discard (or Keep existing design) leaves the binding as it was; the branch is deleted only when it holds nothing but the office's own commit and was never pushed. Only one adoption per project is open at a time.

## The Design gallery

**Project Management › Design gallery** (`/lite?tab=design`) shows:

- what the project adopted (version, digest, starting point), a ✋ proposal waiting, an adoption under way (a candidate on its branch, not merged yet, or failed at a step, with **Retry** and **Discard**), or the client's **default** version when the project isn't on it (**Propose adoption**, or **Propose v&lt;n&gt;** for a project bound to an older one). Only the client's default can be proposed here: the gallery has no way to pick another approved version (the New project wizard's **Choose another** does);
- the five **administration patterns**: list with search and results, details, validated form, approval and status, and empty, loading and error states. Each has a stable id and version (`forms.validated@1`), when to use it, its required states (click a state to see how it shows in Atlas), its constraints and a Mendix reference in stock Atlas classes, checked with `mxcli check -p` on Studio Pro 11.12.4;
- **Use for**: record that a pattern is used for an issue (`7`) or a page (`Visitor_NewEdit`), optionally *on behalf of the client*. This is a record only: no model is asked and the app doesn't change. A task on that issue then gets that pattern;
- **Runtime screenshots**: **Capture now** takes light and dark screenshots of the project's live app at 1440 px, only when it's already running (a capture never starts it). Screenshots stay when the app stops, labelled as history.

The tab is loaded the first time you open it and asks the office only when it's shown.

## What agents get

When a project has a binding, each new task's text gets one line under its `Task: tsk_…` line, at most 300 characters:

```
Design: Acme Design System@v1 #3f2a91c (Branded Atlas, administration). Patterns: forms.validated. Read C:/…/design-systems/guidance/<project>/<hash>.md first; use the bound package and patterns, propose an exception instead of new variants.
```

The guidance file is small and made the same way every time from the package digest and the task's patterns: the rules (use the bound package; the theme is already applied, so skip the toolkit's design-artifacts token-to-Atlas mapping; escalate an exception rather than invent a variant; at most **two** automated design-correction attempts per unresolved issue, then escalate), and the selected patterns in full. Everything else is in the package folder, by path. The two-attempt limit is an **instruction to the agents** (in the guidance file and the Playbooks): the office doesn't count or enforce it.

The office writes every guidance file a task can be given ahead of time (when the project is bound, when a pattern is chosen, and at start), and a task gets the path only once its file is written. If it couldn't be written, the task's line says the guidance couldn't be prepared, with no path, and the file is tried again for the next task. A version that is only a candidate on its branch gets a line saying so (*only a candidate, on the branch …, not merged*), with no guidance. What each task was given is recorded in `<data>/context-manifests/<project>.design.jsonl` as **supplied**, **unavailable** (with why) or **candidate**; that records what was supplied, never that the agent read it. The Lead Designer's, Lead Developer's and Solo Lead's Playbooks say the same in one line.

## What's measured

Each row of a project's Budget ledger now also records, where the office knows it: the task's **kind** (design, design correction or other, from its role or subagent and its words at dispatch), the **design pointer** (`<id>@v<n>#<digest>` or none), and the four token categories (input, output, cache read, cache write) with the model and whether they're **observed**, **estimated** (shared out between a session and its subagents by cost) or **missing** (never booked as 0).

## Not in this version

Storybook, Figma, importing an existing Mendix company design module, kiosk and mobile presets, logo, fonts and layouts, and automatic upgrades of bound projects. An independent project (no client) can own a design system on the server, but the page for it is not built yet.

## See also

- [Reusable skills and knowledge](../architecture/reusable-skills-and-knowledge.md): design systems next to toolkit skills and company brains.
- [State and truth](../architecture/state-and-truth.md): which record the office trusts when two disagree.
