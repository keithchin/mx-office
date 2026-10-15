---
title: Agents
description: Agent profiles - an office-wide name and factual history for each team member - and Hire from your agents, which reuses a profile on another project in a fresh session, moving it there when it's working elsewhere.
weight: 2.3
aliases: [/docs/using-the-office/profiles, /docs/agents, /docs/profiles]
---

Every member of a project's team has an **agent profile**: an office-wide identity with an id that never changes (`prf_…`), a display name you can edit, the roles it has held, and the projects it has worked on with their dates. A profile lets you bring an agent you know back on another project with **Hire from your agents**.

> **A profile is a name and a factual history.** Each project starts a **fresh session** with that project's Playbook. Nothing from earlier projects comes with it: no session, handoff note, journal, transcript or your notes. A familiar name doesn't mean better work, and the office doesn't claim it does: there are no skill levels, no scores and no "training".

## Home › 👥 Agents

Home's **👥 Agents** tab (`/home?tab=agents`) lists every profile with where it is now (*Working on Travel approval (Lead Developer)*, *Benched on …*, *Moving to …*, *Not on a project*), its roles and how many projects it has worked on. Open one for its page (`/home?tab=agents&profile=prf_…`, also the **👤 Profile** button on its card on a project's Team tab):

- **Profile**: its id, since when it exists (*given to an existing team member* for one made when profiles came in), its roles.
- **Projects**: each project, the role, how it started (*hired*, *hired from your agents*, *moved here*, *on the team before profiles*) and its dates, with how it ended (*moved to another project*, *seat given to another agent*, *project removed*).
- **Track record**: tasks completed, pull requests merged first time, verification passed at the delivered revision, spend per task, each **not measured yet**. Figures need each piece of work attributed to the agent when it happens; until the office records that, it shows nothing rather than a guess. Results also depend on the model, the configuration and the project.
- **Your notes** (admins only): your own notes about the agent. They are kept in a separate file, shown only to admins, and **never given to an agent**.
- **✏️ Rename** (admins): names are unique across the office. The id stays; the seat it holds and its live session take the new name.

## Names

New team members still get a name from the office's pool of 30. A profile is made at a seat's first hire, with the seat's name; if another agent in the office already has that name, the seat is renamed to a free one first (and the project says so). Renaming on the Team tab or on the profile page refuses a name another agent has.

Team members from before profiles each got a profile of their own when the office first started with this feature, **never merged by name**: three projects that each had an "Ada" have three Adas. Lists tell them apart by the end of the id: *Ada · #7QX2*.

## Hire from your agents

On a project's Team tab, a seat with no session (not hired, or benched) has **👥 From your agents** beside 🤝 Hire (admins). It lists the office's agents: those that have held this role first, then those from other projects, the free ones before the busy, each with its roles, projects and dates, where it is now and *Track record: not measured yet*. Pick one, add a task if you like, and **Hire**.

- **Not on a project**: hired straight away, in a fresh session.
- **Benched on another project**: the office asks you to confirm, because its seat there is released: that project's next hire for the role is someone new. Its handoff note stays with that project.
- **Working on another project**: the office won't hire it twice. It explains a **Move** and asks you to confirm:
  1. On the other project it is asked to write a handoff note and lessons, then benched, as any bench. **The note stays with that project.**
  2. Once it's benched, it is hired here in a fresh session with this project's Playbook. Nothing from the other project comes along.
  3. The other project's seat is then open: its next hire there is someone new.

  If it's in the middle of something there (or waiting on your answer), the bench is refused and nothing changes. There is no way to have the same agent on two projects at once.

What a reused agent is told: its first message is the usual one for the seat (this project's Playbook, journal and, if the seat had one, *this project's* last handoff note), plus at most one line: *Your profile in this office has worked on 2 other projects before. Nothing from them comes with you (no session, handoff, journal or notes): work from this project's Playbook, journal and handoff.* No project or client names, and never your notes.

## When a move is interrupted

Every Hire from your agents is written down before each step (the bench asked, then the hire), so it survives a restart:

- While it is moving, its card says *Moving to …*, and neither seat can be hired by anyone else (the Team tab, the wizard, the phone, The Firm or a scheduled resume all refuse with why).
- If the hire here fails (the project is paused, no desk is free), this seat gets its old name back, the agent stays benched on the other project, and its profile page says what happened, with **Retry** and **Cancel move**. Cancel leaves it benched where it was; you can hire it back there.
- After a restart, the office looks at both seats: a hire that happened is finished, one that didn't is put back as failed (Retry or Cancel), and a bench that was lost is reported. It never starts a second session for the same agent.

Both projects' [Audit logs](audit-log.md) record each step: `profile.move-started`, `profile.move-done`, `profile.move-failed`, `profile.move-cancelled`, and `profile.reuse` for a hire with no move. Renames and notes are `profile.rename` and `profile.notes` (the notes' length, never their text); the first start's migration is `profile.migrate`.

## Benching, removing a project, restarting

- **Benching** keeps the agent on its seat (*Benched on …*); hiring the seat again brings the same agent back.
- **Removing a project** keeps its agents' profiles: the assignment ends as *project removed*, with the project's name, the role and the dates, nothing more.
- **Restarting the office** keeps every id: profiles are never worked out from names.

## Rollback

Profiles live in `<data>/profiles.json` (profiles, which seat each is on, and the moves) and `<data>/profile-notes.json` (your notes). The projects' own team files are never changed by profiles. To roll back, stop the office and delete both files: the office behaves as before, except that on the next start (with this version) existing team members get profiles again, with a fresh history.

## Who can do what

Everyone signed in can see the Agents tab. Only an admin can hire from your agents, confirm a move, retry or cancel one, rename an agent or see and write notes; the office checks this itself. Not in this version: lending an agent to two projects at once, reusing a whole team, and measured track records.
