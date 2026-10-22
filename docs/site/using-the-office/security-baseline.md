---
title: Security baseline
description: The app's security as the office reads it from main, the project's security policy, and the required Mendix check (mx check) - what the office refuses at a sign-off or acceptance until they are met, what it only flags, and what it can't see.
weight: 3.44
---

New Mendix apps start with app security **Off**, and nothing used to ask for more. A model can also pass `mxcli check` (which checks an MDL script) and still fail Mendix's own checker: on one probe `mx check` reported six CE2729 errors for a model `mxcli check` had passed. The **security baseline** makes both explicit:

- the office **reads** the app's security from the model on main, at the commit, and shows it on **App Insights › 🔐 Security**;
- each project has a **security policy** (by default: Production security before the build starts);
- the office runs Mendix's own **`mx check`** at a commit and keeps the result with that commit;
- it **refuses** your sign-off of Stage 4 or later, and ✅ Accept of a delivery, while the baseline isn't met at that commit, and says what's missing.

It never says an app is *secure*. It says what the model has set and what `mx check` found, at which commit.

## What the office reads

At main's head, straight from the commit's model in git (the same unit reader as the [Model tab](model.md): no checkout, no mxcli, a fraction of a second, done once per commit and kept per revision):

| Shown | From |
| --- | --- |
| Security level (Off, Prototype / demo, Production) | the project security's level |
| Strict mode | on or off |
| Demo users | on or off, and how many are defined (never their names or passwords) |
| Anonymous access | on or off, and the guest role |
| Password minimum length | the password policy |
| User roles | how many |
| Entities without access rules | persistable entities outside System with no access rule, with a few names |

Not read: pages' and microflows' allowed roles (mxcli's lint rule MPR007 covers pages in navigation), XPath constraints' content, and anything about the running app. When the model can't be read this way, the card says *Not read yet* with why, and **Run mx check** reads the security with `mxcli show project security` in its copy of the app instead.

## The policy

| Option | Default | What it means |
| --- | --- | --- |
| Level | **Production before the build** | Production security by the end of Stage 3 (Architecture & Design), before any build row. *Prototype only* is for spikes: at least Prototype security, and you must give a reason |
| Strict mode | **Recommended** | Off is flagged, not refused. *Required* refuses it. Strict mode disables the `mx.data.*` client APIs, which some Marketplace and pluggable widgets use: vet each widget under strict mode when it's added |
| Demo users | allowed while building | Always flagged for a release, never refused |
| Enforced | **On** | Off makes the policy advisory: the card and Needs you still say what's missing, but nothing is refused. You must give a reason |

An admin changes the policy on the Security page (**Change the policy**). The change is audited (`security.policy`) and the team's Playbooks are written again with it. The policy and every read and check are kept in `<data>/security/<project>.json`; deleting the file puts the project back on the default with nothing read.

## mx check

**Run mx check on main** (admins) runs Mendix's checker at main's head, through `mxcli docker check` (which updates pluggable widget definitions first, so stale ones don't read as errors). It runs:

- in the office's own copy of the app at that commit (`<data>/testing/work/<project>/instance-mxcheck`, updated in place from the project's git objects), never the project's folder or an agent's worktree;
- with the `mx` beside the mxbuild the live app would use: `MXBUILD_PATH` in the project's `.claude/toolkit.env`, else the office's (unless it is another Mendix version than the project's, when the installed Studio Pro of the project's version is used), else that Studio Pro;
- off the office's main thread, one at a time across the office, for at most 20 minutes;
- in [test mode](../administration/test-offices.md), only with a plainly fake mxcli.

The result is kept with its commit: **0 errors**, **N errors** (with the error codes and the first lines), or **Didn't finish** with why (no Studio Pro of that version, a Linux mxbuild, a timeout). A result that didn't finish never counts as a pass. A result of an older commit is shown as such (*not main's head*): a new commit on main needs a new check. Each run is audited (`security.mxcheck`).

## Where the office refuses

| Step | Needs, at the commit in question |
| --- | --- |
| Signing off **Stage 4** (Build Plan), so the build starts | the policy's security level |
| Signing off **Stage 5** (Build), **6** or **7** | the level, strict mode when required, every persistable entity with an access rule (at Production), and a clean **mx check** (0 errors) |
| **✅ Accept** of a delivery ([Progress and acceptance](progress-and-acceptance.md#accepting-a-delivery)) | the same as Stage 5, at the delivery commit |

A sign-off is judged at main's head; an acceptance at the delivery commit it records. When it isn't met, the sign-off dialog or the acceptance says why (*Signing off Stage 5 needs the project's security baseline met at 4f2c9e1. Missing: App security is Off at 4f2c9e1; the policy needs Production; No mx check at 4f2c9e1 yet*). When the only thing missing is an mx check, the office starts one at that commit, so you can try again once it has finished. Stages P to 3 are never held back by it, and a commit with no Mendix app has nothing to check.

## In Needs you

Once the build has started (the project is at Stage 5 or later), a 🔐 **Security baseline** card says what's missing on main: the level, strict mode when required, entities without access rules, or a failing mx check at main. **Ask &lt;lead&gt; to fix** tells whoever covers Management exactly those lines, through the team's durable tell; **Hide** hides it until the list changes. A missing mx check alone doesn't raise a card (it is run when needed).

## What the agents are told

The Playbooks of the roles that write or check the model (the Lead Developer, the Lead Tester, the Solo Lead and whoever covers Development) have a *Security baseline* section with the policy: set Production security in the one script that owns project security, write entity access rules with the entities, vet widgets under strict mode, switch demo users off before a release, and run `mxcli docker check` (not only `mxcli check`) before saying a build is done. They are told the office checks it at the sign-offs and acceptance.

## New projects

When ✨ New project makes a brand-new app, the *Create the Mendix app* step then sets its security to Production with strict mode on (`alter app security (SecurityLevel: PRODUCTION, StrictMode: TRUE);`) with the office's mxcli and reads it back; the step's line says what the model now holds (*app security now Production, strict mode on, demo users on (for building)*). On a Blank 11.12.4 app `mx check` reports 0 errors either way. Demo users stay on for building. Without mxcli, or if mxcli refuses, the step says so and the setup carries on; the Playbook's section and the gate still ask for it. An existing app (a change request) is never touched.

## What it doesn't do

- It doesn't block merges or pushes: agents can still merge a change that lowers security; the next sign-off or acceptance is refused, and Needs you says so. See [Trust and authority](../architecture/trust-and-authority.md).
- It doesn't test the running app (role-based negative tests, crafted requests): that is journeys' and tests' work ([Testing](testing.md)).
- It reads the model as committed on main, not a branch or a working copy.

## See also

- [Progress and acceptance](progress-and-acceptance.md)
- [Review gate](review-gate.md) and [Claims check](claims-check.md)
- [Trust and authority](../architecture/trust-and-authority.md)
- [Security and tokens](../administration/security-and-tokens.md)
