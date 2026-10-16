# Release notes

What changed in Mx Office, newest first. A release is what went
live with an office restart; **Unreleased** is merged into `staging/integration` and waits for the
next one. Each entry says what you'll notice, then anything to know. Commit hashes are on `main`.

## Unreleased

### Fixed

- **Naming a new client.** Wherever a project picks its client, a new one can now be named on the spot: **＋ New client** in a project's ⚙️ Settings › Client (which read *There are no clients yet* with its button greyed out until a client existed) and in the Add to client dialog, and **＋ New client…** at the end of the New project wizard's *Advanced › Client* list (the field wasn't there at all before the first client). The New client dialog also sends a name once: a double Enter used to be able to make two clients of the same name.

### Added

- **Start from a team.** The New project wizard's Team & budget card has **Start from a team**: pick a project already in the office (shown with its client, shape, members and level) and the new project copies its team shape, its roles, each role's model and its budget level, never the budget amount (the new project's own estimate prices the level). The card lists what was copied and what wasn't: permission settings (the new project's own defaults, shown for review), connections and tokens, the amount, and anything from that project's work (transcripts, handoffs, journals, documents, brief, lessons). Everything stays editable. **Also bring the same agents** picks that project's agent profiles for the new seats: an agent on no project is hired with the team, and one on another project needs a Move, listed and confirmed before setup starts, then done by the team step through Hire from your agents (restart-safe, never two sessions). The source is recorded in the audit log (`wizard.team-from`) and the project's `agent-office.project.json`.
- **Agents and Hire from your agents.** Every team member now has an agent profile: an id that never changes, a name you can edit (names are unique across the office) and the projects it worked on, with dates. Home has a **👥 Agents** tab with each agent's page: its projects, a track record that says *not measured yet*, and your notes (admins only, never given to an agent). On a project's Team tab, a free seat has **👥 From your agents**: pick an agent and it starts here in a fresh session with this project's Playbook; nothing from its earlier projects comes along. One that is working on another project is never hired twice: the office explains a **Move** (it writes its handoff note there, which stays there, and is benched; then it is hired here) and asks you to confirm. A move survives a restart, and if the hire here fails the agent stays benched where it was, with **Retry** and **Cancel move** on its page. Existing team members get a profile each the first time the office starts, never merged by name. The docs have it under Using the Office › Agents.
- **Clients page.** Clients is a page of its own at `/clients`, next to Projects (the launcher, the phone drawer, Home's bar): a card per client in the Projects page's grid (its projects and its company brain's state) with **＋ New client**, and a client's page with its projects drawn as the Projects page's cards. Home's Clients tab is gone; old links to it open the page.
- **Rename a client.** **Rename** on a client's page (or ⋯ › Rename… on its card): only the name changes, its projects, brain and links stay. A taken or empty name is refused in the dialog. Admins only; in the audit log as `portfolio.rename` with the old and new name.

## 2026-10-15 · release 50 (`0d92abc`)

### Added

- **Task ids.** Every new piece of work the office hands an agent now has a task id (`tsk_…`): a hire's task, a task you or the Coordinator give a team member, a model change request, a stuck item's or a decision card's ask to the lead, a queue task and a proposal's issue. The agent reads it as a *Task: tsk_…* line at the end of the task, the pull request the desk opens carries it, and the Playbooks ask agents to put it on their commits and pull requests. Handing the task to someone else, or restarting its worker, keeps the id; each attempt gets its own execution id. Both go on audit events and on budget rows where the office knows them, ready for tokens per task later.
- **Work linked to your answers.** *Work that used rev n* in Change answer, and each follow-through item, now list the task links of that revision, each with how it was found (*candidate*: the agent's task when you answered; *associated*: a commit or pull request names *ESC-… rev n* or the task id; *inferred*: a build-plan row) and how far the evidence goes (*acknowledged*, *associated change*, *checks passed on the associated change*, and *Implemented as decided* only from your acceptance). For example: *Task tsk_… "Visitor checkout" (Linus): candidate · acknowledged · associated change PR #98 · checks passed on the associated change @e77a0d3*.
- **No implementation work required.** A box in Change answer, and on an escalation's card in the Team tab, records that choice as a revision of its own, with your reason. The answer itself stands.
- **Change answer.** An answered escalation (its card in the Team tab's approvals, its follow-through item in Needs you) and a question whose answer was sent or recorded (the Questions page) now have **Change answer**. A small window shows your current answer with who, when and how its record stands, the new answer in the same shape as the first, and the work that used the old answer, each marked *Recorded link* or *Inferred* (or *No linked work found. Task links arrive with task ids (1B-4)*). **Send change** keeps the new answer as the next revision, sends it once, saying which revision it replaces and the citation to use now, and follow-through moves to the new revision: a record of the old one reads *Recorded for rev 1*. If the answer changed since you opened the window, nothing is written or sent. Admins only.
- **Answer history.** *History (n revisions)* on the same cards lists every revision of the answer with its full text, who and when, how it was sent (your *It went through* stays a person's confirmation) and what its record came to. It is read once, when you open it, from the project's answer history, so nothing is lost when the card's short copy rolls over.
- **Clients (optional).** Home has a **🗂️ Clients** tab: group a client's (the company's) projects and connect that client's curated **company brain** (the toolkit's folder of accepted conventions). Clients organise knowledge; they **aren't access control**: agents can still read any folder by path, and the office says so wherever clients are shown.
  - **Connect a brain** checks the folder (README.md and ROUTING.md; a git repository gives snapshots, a plain folder is shown as *not versioned*), wires each project with the toolkit's `wire-company-brain.sh` after init, in Windows-form paths, and checks the result itself: one block per instruction file, naming a ROUTING.md that exists. Incomplete wiring is an error and a Needs-you card (**Wire again**).
  - **Add to client** (on the client page, or the project's **⚙️ Settings › 🗂️ Client**) shows what the project already has wired first; a project can belong to one client, and moving it between clients isn't available. ✨ New project can give a new project a client (*Advanced › Client*).
  - Each hire on a client's project gets **one line** in its first message (at most 300 characters): *Company brain Acme @a1b2c3d: before answering terminology or convention questions, read C:/…/ROUTING.md. Don't search other company folders.*, or *Company brain unavailable this session* when the brain can't be read. Never the brain's content.
  - A **context manifest** per hire records what the session was offered (the brain's snapshot, the routed files with their hashes, what was left out and why), not what it read.
  - When the brain changes under a live session, the project gets one Needs-you card, *Company brain changed: 1 corrected, 1 withdrawn since Ada's session was prepared*, with **Rehire for a fresh session** or **Dismiss**. Nothing restarts by itself.
- Projects without a client are unchanged: the same setup, Playbooks and first message, byte for byte. With no `portfolios.json` the office behaves exactly as before (see *Clients › Rollback* in the docs).
- **Add a source folder (Migrate an app, Change an existing app).** New project's **+** menu takes the full path of a local folder of the app's code. Before anything is copied it says what will be: *212 files, 9 MB; skipped: node_modules, 2 secrets-like files*. Dependency and build folders (`node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, `.turbo`, `__pycache__`), files over 5 MB and secrets-like files (`.env*`, `*.pem`, `*.key`, `*.pfx`) are never copied; system folders, your home folder, the office's own folders and the projects home are refused, and so is anything over 200 MB or 20,000 files. The draft keeps the folder. The Chief Analyst sees only its file index (paths and sizes), never the code. At setup it is copied into the project's git-ignored `sources/legacy/<name>/` and marked confidential in the brief and the Discovery brief. It never leaves the machine. Admins only.
- **Keep this project off GitHub.** Under Advanced, a new project can be local only, for a client that won't allow a private GitHub repository (unticked by default; a project with a source folder is otherwise always a private repository, and the copied source is git-ignored): no GitHub repository (a bare repository on this machine is its `origin`), no push to GitHub, and the Discovery brief is `docs/discovery-brief.md` handed to the team instead of an issue. The project's `CLAUDE.md` and every hire are told not to push to GitHub, and the Overview says *Local only: not on GitHub*. GitHub issues, pull requests, PR checks, merges and PR-based task outcomes are unavailable for it and say so (*Local only: not on GitHub, so issues, pull requests and PR checks are unavailable for this project*) instead of failing. See *Create your first project › Local only*.
- **A migration's Discovery runs the toolkit's migration track.** Stage 0 source sufficiency over the absolute legacy source path and assess-migration, the slice picked at CAC-1 when you asked for one, then Stage 1 Path A extraction from the legacy source, with gates 0, 3 and 4 and the stop before Stage 5 as before. Other modes' Discovery is unchanged.
- **A cap for migrations.** For Migrate an app, Team & budget shows the planner's estimate with *Migrations have run over this estimate; set a cap* and a cap field filled in with the level's budget; auto-pause at 100% is on.

### To know

- **Tasks from before task ids stay without one** and read *legacy task (no id)*: the office never makes an id up for them. *No links found* means the office located nothing, which is not the same as *No implementation work required*. Linking reads local git and the pull requests the office already fetched; it adds no polling. There is no task list page yet.
- **A changed answer or a correction moves on only once it's known to have been sent, even across a restart.** If the office can't confirm it was typed, the decision stays at the old revision until you settle it on its card in Needs you, after a restart too: **It went through** moves it to the new revision, **Abandon** leaves it where it was (the new revision stays in the history). A correction that couldn't be sent at all now says so and leaves the decision as it was.

### Changed

- **Agents get the Mendix token on every project, also as `MENDIX_PAT`.** mxcli reads `MENDIX_PAT` for Marketplace installs, and the office only handed the token out as `MENDIX_TOKEN` / `MX_PAT`, so agents kept asking you to run `mxcli auth login` even with the token switched on. ⚙️ Settings › 🔌 Connections › Mendix is now on for every project; untick a project to keep the token from its agents. Test offices still never get it.

## 2026-10-15 · release 49 (`4cea6e8`)

### Added

- **Recorded as given.** After you answer, the office checks the agent's record of your decision and compares the words with what you decided, instead of trusting a status. It shows where the record is: in a working copy, committed on a branch, or merged into main.
  - **Escalations:** your answer asks the agent to record the decision on one line that starts *Decided per ESC-3f9c2a1b7e rev 1:* in its team journal or PROJECT.md's Decisions, and the Playbooks say the same. The office finds the citation in the project folder, the worktrees and the branch heads on the look it already makes, and compares the line and the rest of its paragraph (or its table row) with your option or words.
  - **Questions:** at **Send** the office keeps what the message asked the analyst to record, and compares the BRD's answer, decision and consent with it on every collection. ANSWERED, ASSUMED or MOOT alone is no longer "recorded".
  - **Each answered card** keeps a line until it's recorded as given and merged: *Decided (rev 1) · Sent (Typed) · Recorded as given · Committed on office/dev*. These are status cards after the rest of Needs you, never counted as waiting on you, and **Dismiss** stops one.
- **Recorded differently.** When the record says something else, the card shows *You decided: … · Recorded: …* with where it is, and two buttons. **Accept as recorded** makes the recorded words a new revision of your decision, with nothing sent. **Send correction** sends a new revision to the agent with the citation to use now. A record that cites an older revision shows as *Recorded for rev 1*.
- **Likely duplicates card.** Asks filed more than once before this fix show as one card in Needs you: *Likely duplicates: 9 asks repeat 5 others*, a line per group (*GenAI key ×3 → keep the newest*), with **Close duplicates** and **Review one by one**. Nothing closes until you confirm; each duplicate is closed as superseded by the one kept, recorded in the Audit log, and nothing is sent to the agents.

### Changed

- **Only a faithful record settles a decision by itself.** For decisions with an answer revision, a question is marked recorded, and a stuck decision that the register says is CONFIRMED is settled, only when your answer is recorded as given at its current revision and merged into main. *Recorded differently* never settles anything. Decisions answered before this release are *legacy* and keep the old rule.
- Everywhere you read it, a floor is now called a project (the pages, Needs you, Teams and phone messages, the CLI's words and the docs). Nothing about your data or links changes.

### Fixed

- **The same ask no longer piles up in Needs you.** When an agent rewrites an item of its `AWAITING-PM` line in other words (*GenAI key*, then *GenAI Text Generation resource + key*), the escalation it already has is updated instead of a new one being filed. Only for the same role and the same `AWAITING-PM` source, and only when it's clearly the same item: the same ids (`#98`, `OW-1`), or the same words once brackets and small words are set aside. Never across roles, never two you separated.
- **`AWAITING-PM` lines are split into whole items.** Only list separators split a line (`;`, ` · `, numbered or bulleted lists), never a comma or a semicolon inside brackets, so there are no more items like *Ada has it* or *shared GitHub account)*. *merge #98 and run the LF conversion (issue #91)* is two items.
- **A proposal waiting on you isn't added twice** (the same role's, same kind, same words), and every proposal shows when it was made (older ones show their standup's time instead of a blank date).

### To know

- Merged means the commit is reachable from `origin/<default branch>`, by local git only: no fetch, no GitHub call. The record's path, commit and blob are kept apart. What the office found of each escalation is in `<office data>/followthrough/<project>.json`.
- The comparison is strict on purpose. Your option, or your words without *Go with:*, must appear in the record as complete words; case, quotes, punctuation and spacing may differ.
- Every action is an admin's (`POST /api/followthrough/action`), refused when the decision changed since you opened it, and audited as `followthrough.*`.
- A line that goes from an agent's newest entry still never closes its escalation by itself: the card asks you, as before.
- Going back to release 48: escalations closed as duplicates show as dismissed (the outcome *superseded* is new), and proposals closed as duplicates as rejected.

## 2026-10-15 · release 48 (`2f43166`)

### Added

- **Your answers are kept before they're sent, and never sent twice by a restart.** Every answer (a card, Approvals, the phone, a question's **Send**, a stuck item's answer, a model change request, a question to the lead, a proposal's approval) is written to disk in full before anything is typed, then the attempt to type it (who, which session, the exact text), and only after it went in does the escalation, question or proposal change. Typed answers end with a marker line, *[office answer dsp_… · ESC-3f9c2a1b7e rev 1]*. The office guarantees durable intent plus reconciliation, and no automatic replay of an ambiguous attempt; it does not promise exactly-once delivery.
  - **After a restart** the office checks each unfinished attempt in the agent's own session, from where it was when the answer went out: only the typed message carrying the marker counts, never the marker quoted in a reply, a tool's output or another session.
  - **Couldn't confirm your answer was typed to Linus**: when it can't tell, Needs you says so, with **Open Linus's terminal**, **Send again** (a new attempt), **It went through** (recorded as your confirmation, never shown as the office's) and **Abandon**.
  - **Proposal issues are made at most once by the office.** The proposal is marked approved before GitHub is asked, and the issue body ends with *office-proposal: &lt;id&gt; rev &lt;n&gt;*. When the outcome is unclear, the card offers **Check GitHub** (only a match settles it: GitHub's search lags), **Create it** and **It exists: link #…**.
  - **A stale answer is refused.** An answer to a decision someone else answered since you opened it gets *This decision changed since you opened it*, and nothing is written or typed; two answers at once, one wins.
  - **Held answers survive a restart.** An answer waiting for the agent's turn is on disk at once and goes in once, after the turn, with the same attempt.
- **The rollback guard.** `node bin/agent-office.js dispatch status` lists the unsettled answer attempts and exits 1 while there is one; 🔁 Restart safely refuses to restart onto a build older than them while any is unsettled. The procedure is in the docs: *Running the office › Rolling back to an older build*.

### To know

- The answer history is `<office data>/answers/<floor>.jsonl` (full text, hash-chained, fsync'd); the attempts are `<office data>/dispatch/<floor>.json`. Each answer costs a few small fsync'd writes; nothing new polls.
- Answers and tells typed to agents now end with the marker line. Owed answers (a dialog was up) are marked in flight before they go in.
- Going back to release 47: run `dispatch status` and settle what it lists first. Release 47 then sees escalations open or delivered, never owed for an attempt that may have gone in, and a proposal with an unclear issue as approved without one.

## 2026-10-15 · release 47 (`3055d0e`)

### Added

- **One-click setup.** First-run setup's Prerequisites step has a **🔧 Fix** on each missing row and **⚡ Set up everything**, which runs every fix the check asks for in order and stops at the first that fails, saying why. Nothing runs until the admin says yes: a window first lists every command and where each program comes from, and the office refuses a run without the confirm it handed out. Progress streams live.
  - **Installs:** winget on Windows for Git (with Git Bash), the GitHub CLI, Node.js LTS and jq, then the office reads PATH again from Windows so the new program counts without a restart. Without winget it shows the download links; on macOS and Linux the `brew` and `apt` lines. Claude Code comes from its official installer (npm when that can't run), mxcli is the newest release's binary in the office's `tools` folder, and the toolkit is cloned.
  - **GitHub in one click:** `gh auth login --web` runs without a terminal and its one-time code is shown big with **📋 Copy** and a button to GitHub's page; then `gh auth setup-git`. The agents' GitHub token can be saved from the same sign-in, straight from `gh auth token` into 🔌 Connections, never shown, logged or audited by value. A gh that needs a terminal gets a window of its own.
  - **Claude Code sign-in:** **Sign in with your Claude account** opens a terminal running `claude` (the office never sees the credentials) and waits for it; **Use an API key** saves an Anthropic API key in 🔌 Connections (a new card), given to workers as `ANTHROPIC_API_KEY` and never echoed.
  - Admins only, audited, and a test office never runs any of it (`AGENT_OFFICE_FAKE_SETUP=1` runs scripted fakes there instead).
- **Get Mx Office in one line.** The README's new **Get Mx Office** section: `irm …/scripts/get-mx-office.ps1 | iex` checks for Git and Node.js (offering winget), clones the office (or pulls it when it's there), runs `npm ci` and `npm run build`, and starts it on First-run setup.
- **Clear decisions in Needs you.** On the Overview, every item is a decision card: what is asked and by whom, the options and the recommendation, the evidence, what it blocks, and what happens after you answer. The header counts *3 decisions · 2 actions for you · 4 FYIs*; only decisions and actions count as waiting on you.
  - **Three kinds, three sets of buttons:** a decision has its options, **Reply in my words** and **Ask &lt;lead&gt;**; a hands-on action has **I've done it**, **Can't now: tell &lt;agent&gt;** and **Ask**; an FYI has **Noted** (*Noting doesn't approve anything*). An FYI with options or a question shows as a decision, with a *filed as FYI* note.
  - **I've done it** tells the agent *&lt;you&gt; says it's done: please re-check*, never APPROVED, then runs a harmless status check where one exists (`gh auth status`; `mxcli auth status` only when the office's mxcli has it), labelled as a check, not proof.
  - **One card per decision:** sources fold only on an explicit id: a BRD question key, the same id in `PROJECT.md`'s register, a register decision id (OW-1), a PR number (#98, across escalations, `AWAITING-PM` lines, chat asks, proposals and stuck items), a stage, a journey id (J-08). PR #98's seven items are one card with seven sources. Similar wording never merges; **Separate** splits a card (kept, audited).
  - **Approving a human-action proposal** makes one issue (two approvals at once used to make two) and puts a hands-on card in Needs you, open until **I've done it**.
  - Every surface (the strip, the Overview, the lead panel, the team phone, the phone version, Teams) builds from the same input, so the phone version and Teams now show surfaced asks, the budget and incidents too. Every new action is admin-only, checked by the office.

### Changed

- **A missing source is not an answer.** When an `AWAITING-PM` line goes from an agent's newest entry, its escalation stays open and its card asks **Resolved** or **Still needed: ask &lt;agent&gt;** (it used to close by itself). When a read fails (a git error, an unreadable file), stuck items and surfaced asks stay as they were, marked *couldn't re-read at 14:02*, instead of resolving.
- **Stuck detection doesn't re-raise answered decisions:** a register row CONFIRMED, or CONFIRMED *for now* (accepted, parked on a workaround), isn't waiting on you (OW-1 came back from its own evidence). An escalation about the same PR or decision no longer hides a stuck item: it shows inside the escalation's card. Dismissed items show as **Hidden (N)**: hidden, not resolved.
- **One answer path per question:** each client question waiting on you is a card of its own, grouped with its stuck item and its register row; **Answer** opens the Questions page at that question, never a message to the lead. The answer message asks the analyst to mark the register row answered too. Phone pushes and Teams still post one notification per batch.
- **Rollback-safe answers:** Noted and I've done it are kept beside a verdict release 46 knows (dismiss; reply "Done").

## 2026-10-14 · release 46 (`363fe1e`)

### New

- **Change this, in the Model tab.** Pick an entity, attribute, association, enumeration or value, microflow, nanoflow, page, snippet or constant (or tick several attributes or values), press **✎ Change this** in the details or right-click it, and say what should change (quick chips per kind: *Rename*, *Add value*, *Make required*…). It goes to whoever covers Development, or Design for a page's look (any hired member can be picked), **after their current turn** unless you say **Now**, as a task naming the element(s), the branch and commit they were read at and your words, with the instructions to change it with mxcli on a branch, run `mx check`, open a PR naming the elements, and escalate first if it needs a decision. The element shows *Change requested · Ada · #123* until its PR merges, with **View change** opening the PR's branch with *Changes in this branch* on. Recorded as `model.change-requested`. The office still never writes the model itself.

### Changed

- **A New project draft keeps the app's repository.** For **Change an existing app** and **Assurance only**, the repository is saved with the draft, so **Continue** on a resumed draft brings it back on the start page and under **Advanced** (it used to come back empty). A repository field marked as a problem clears as soon as it names a repository.
- **The Chief Analyst is told which app a change is for, and says it hasn't read it.** In change and assurance mode the planning calls get the repository's name, and its GitHub description when the office's repository list already has it, as context only: the planner still has no access to the repository. The start card no longer says the team reads it first: *the brief is drafted from your description; the team reads the app after setup.*
- **Discovery finds the attached documents.** `sources/` is git-ignored, so an agent's worktree doesn't have it: the Discovery issue and the analyst's Playbook now give the project folder's full `sources/` path, and say to inventory it first with the toolkit's `bin/source-sufficiency.sh init . --sources` (so the gates' source ledger stops failing with *files under sources/ and no inventory*). The documents aren't copied into worktrees.
- **The setup log keeps its start and its end.** It keeps the first 300 lines and the last 2,700, with *… N lines left out …* between them, instead of only the last 1,500, so a long toolkit run no longer pushes out how the setup began.

### Fixed

- **The office tells the truth about its version.** On 13 Oct, release 43 was built while the release 42 office kept running, and nothing said so: the pages loaded the new build at once, so *Mark as seen* failed with *Unknown action* and a Resolve failed silently against the old server, while a dropped connection (the laptop waking from sleep) put up *Mx Office is restarting… reconnecting* and looked like a restart. When Restart safely was pressed at last, the laptop went to sleep two minutes later and the restart sat frozen for 34 minutes. Now:
  - **What runs:** ⚙️ Settings › Workers › Restart safely starts with *Running release 45 (aaf30a5), started 08:32*, and `GET /api/health` says the same without a sign-in (`sha`, `release`, `builtAt`, `startedAt`). `npm run build` writes them to `dist/public/build-info.json`, which the office reads as it starts.
  - **A newer build:** admins see *A newer build is ready (release 46). Restart safely to use it.* on every page when `npm run build` ran after the office started. A page from a newer build than its server says so, and a request the older server can't answer says why instead of *Unknown action*; a page older than its server offers **Reload**.
  - **A restart under way:** Settings lists whom it waits on, with a countdown to its time limit, and **Restart anyway** and **Cancel** are there the whole time, not only after the timeout. Every page shows the same to admins as a banner, so nobody needs Settings open. A computer asleep under the restart is noted (`restart.slept`, and Settings says when).
  - **Never "restarted" too soon:** Settings says *Not restarted yet* until the office exits; the new office's pages say *Restarted: now running release 46 (b46b46b), started 20:25* once it answers, and `restart.exiting` and `restart.resumed` record the build left and the build now running. A lost connection now reads *Reconnecting to Mx Office…*; only the office says it is restarting.
  - **No restart loop:** the button reads **⏸ Pause, wait, then stop the office**, and Settings says the office can't restart by itself and to start it again with start-office.ps1.

## 2026-10-14 · release 45 (`361b46b`)

### New

- **Nothing waits on you unseen: answer everything from Needs you.** Agents' asks used to reach you only through channels the office didn't count (their chat, a journal's `AWAITING-PM:` line, an FYI escalation, a branch nobody merged), so you heard of them only by asking the Coordinator. Now an ask in the lead's chat that it didn't escalate is filed for it as *From the chat: …*; every item of an `AWAITING-PM` line, wherever the newest journal entry is (the project folder, an agent's worktree or its branch), becomes an escalation of its own on bench, on pause and every five minutes, and closes by itself when the line is gone; and FYI escalations show as low **FYI** rows instead of being hidden. The lead's chat judgement is **On** by default (⚙️ Settings › Jeff · Router › *The lead's chat*; set it back to Shadow there).
- **New Needs-you rows from where the team's words are.** *N agent updates aren't on main* (journals, standups and handoffs on branches nobody merged, older than a day) with **Ask the lead to open a docs PR**; *N assumptions made without your consent* (PROJECT.md decisions `ASSUMED` with no consent recorded) with **Agree** and **Discuss**; the toolkit's gate advisories, which it printed only to an agent; and *Ready for your review: 5 BRDs, design system, 9 wireframes* with **Documents**. Info rows are shown but not counted in *N waiting on you*. The lead's newer standup still on its branch adds its *Blocked on you* to the standup page and the Management team page, labelled as not on main yet.
- **Hands-on asks always reach you.** A new escalation trigger, `needs-human` (merge a PR, sign in, paste a key, install a tool, allow something, restart a preview), and `question` are never filed as FYI at any autonomy level. A standup proposal that is such an action becomes the new **human-action** kind and waits for you at every level, where an autonomous team used to approve it with nobody doing it.
### Changed

- **The Playbooks make every ask an escalation.** Where a toolkit skill says to ask in chat, an Mx Office agent files it with `office-workers escalate` (one per batch), never only in chat, a journal, a handoff or a standup page. Whoever covers Management ends a reply that asks you something with an escalation, lists only escalated items under *Blocked on you*, sweeps every place an ask hides (BRD open questions, `AWAITING-PM` lines, gate advisories, `blocked…` build-plan rows) and opens a docs-only PR with its journal and standups daily. Playbooks are rewritten as usual the next time a Lead is hired or the autonomy level changes.
- **Stuck detection reads the toolkit's question states and blocked rows.** PROJECT.md open questions marked `RAISED` or `UNRAISED` count as open, and build-plan rows whose State starts with `blocked` become a 🧱 item per blocker; a row still blocked on a decision that's resolved says to update the build plan or name the real blocker.
- **Every ✋ sign-off shows in Needs you, past Stage 4 too.** *Stage N waits for your sign-off* now comes from gate-check's verdicts for any stage it marks MANUAL, whether or not the setup panel shows.
- **A new project gets a `.gitattributes`.** LF in every checkout whatever `core.autocrlf` says, and the `.mpr`, `mprcontents/` units, images and office files binary, committed with the scaffold: agents' worktrees no longer show a couple of hundred files changed only by line endings. Existing projects aren't changed; the docs page *Workers and worktrees* says how to add it by hand.

## 2026-10-14 · release 44 (`259bf59`)

### New

- **Questions: the analysts' open questions for the client, in one place.** A new page, *Project Management › Questions*, shows every open question an analyst agent wrote into the BRDs (`openQuestions`), collected by the office from main and from every agent's working copy with the project's toolkit script (`bin/open-questions.sh`), grouped by BRD with each one's evidence, what it blocks, who can answer it, the proposed position and whose copy it came from. Accept a proposal, answer, mark it for the client or not relevant, then **Send to** the analyst: one message asks them to record your answers in the BRDs with the toolkit's vocabulary (after their current turn unless you interrupt). Each shows as recorded once the toolkit reads it so. **Export for the client** makes a CSV or a printable page with an empty Answer column, and **Import answers** takes the filled-in file (or pasted `OQ-05: answer` lines) back. Needs you has one row per project (*24 questions for the client · 5 BRDs · …*) with one notification per batch of new questions, a blocking client question waiting over a day becomes a stuck item, and the analysts' Playbooks now say to raise questions in the BRDs rather than only in chat.

## 2026-10-13 · release 43 (`14054c8`)

### New

- **Mx Office analyses an incident when it's resolved.** **✅ Resolve…** no longer asks for the root cause: it says what will happen, takes an optional *Anything you already know?* note, and resolves the incident at once. In the background Mx Office drafts the root cause, the impact and 1 to 5 corrective actions (fix, prevent, detect) from the incident's own evidence (its record, the audit events it links and those around when it happened, your note), with secrets redacted, in one capped call with no tools ($0.30 per incident, 20 an hour across the office, metered in the budget as *Incident analysis*). The incident shows it as a draft to check: *Drafted by Mx Office from the incident's evidence: check it* on each field it wrote, its confidence, what supports it and *What the evidence can't tell*. It never overwrites what a person wrote (it shows beside it as a suggestion), and a field you edit is yours. If it doesn't finish, the incident stays resolved with *Analysis didn't finish: <reason>* and **Retry analysis**. A test office drafts it with a test analyser, never Claude.

### Changed

- **A finished agent idles instead of cheering forever on the Git page.** Its robot gives one cheer as it finishes, then bobs like an idle one; its ✓ still says it's done. (In the 2D Office a finished agent already sits like an idle one, with its tick.)

### Fixed

- **A budget forecast or threshold warning can be marked as seen.** It used to stay in Needs you, with only a **Budget** button, until the budget was raised. Needs you now has **Mark as seen** beside it, and the Budget tab a new **Alerts** card listing every alert standing with the same button (admins). A seen alert leaves Needs you, its count, the phone and Teams, and stays on the Budget tab, dimmed, with who saw it and when. A seen forecast comes back if the forecast at completion grows by more than 10 %; a seen threshold when the budget changes. The 100 % alert and the budget's pause still need a budget decision.

## 2026-10-13 · release 42 (`8223a6d`)

### Fixed

- **The team phone opens beside the team-lead panel, not over it.** On a computer its window now sits left of the panel (or of the collapsed rail) with a 16 px gap, lined up with its button, and narrows when the screen is tight; on a phone it still takes the whole screen.
- **A project name too long for Studio Pro is refused at Create, not halfway through setup.** Studio Pro's `mx create-project` can't make an app in a folder path longer than 77 characters (it stops with a PathTooLongException while it unpacks the Blank template). **Create** now says so before anything is made, with the folder it would have used, its length and the longest repository name that fits there (or, when none would, to move the office's projects folder to a shorter path).
- **A failed setup step says what went wrong.** When a command fails, the step's error is the line where it said so (*ERROR: System.IO.PathTooLongException: The specified file name or path is too long…*), not the last lines of the stack trace under it; the full log still has everything.

## 2026-10-13 · release 41 (`08d49c7`)

### New

- **The team lead is docked beside every project tab.** A panel on the right of the Overview, the Board, Testing, Model and every other project page holds the agent who leads the team: the Project Coordinator, or the Chief Analyst on a Startup team and the Solo Lead on a Solo team, shown by its real name and role with a line saying what it's doing. **Chat** is its conversation; **Terminal** its live terminal, read-only, connected only while you can see it (**⤢ Expand** opens it wide; **Esc** brings you back). *N waiting on you →* counts everything in Needs you and takes you there. Ask it anything in the box (↑ recalls what you sent); while it's mid-turn you choose **Send now** or **After their turn**. **Status update**, **Run standup** and **What's blocked?** go through the usual *OK to interrupt?* check. It keeps its chat, scroll and what you're typing as you change tabs, and this browser remembers them. **»** collapses it to a slim rail with an unread badge; on a phone it's a round button that opens the chat as a bottom sheet. With nobody leading it offers to hire one; a benched lead shows its handoff note and **Hire again**.
- **Answer escalations right on the Overview.** Needs you is now a card holding every escalation in full: the question, who raised it, its options with the recommended one marked, why, and **Send answer**, **Reply in my words** or **Ask &lt;lead&gt;**. A pull request merged but not verified gets **Re-run checks**, **Waive** and **Send back**; sign-offs, agents asking and the rest are listed with a tag in words, each with its button.
- **The Overview shows the project brief, the team and the budget.** A Project brief card (the goal, the functional domains and the open questions from `docs/project-brief.md`, for projects made from an approved brief), a Team card (each member with what it's doing and its status), a Budget card (spent of the budget, today, the forecast, the alert and auto-pause) and Quick links (Open in Studio Pro, View App).
- **Stuck detection: Needs you says when work is stuck.** The office looks at each project every 5 minutes and raises, once, a pull request with no commits, comments or reviews for 24 h (with what the build plan says it blocks: *PR #51 has had no activity for 4 days. It blocks J-08 and 'Team_Travel' (build plan).*), a build-plan pending decision or PROJECT.md open question waiting on you for 24 h (*Decision waiting on you: OW-1 … Blocks build-plan rows 59–62 (J-09). Build continues on stubs.*), a test failing the same way for 48 h (on the PR's card when that PR is the cause), and agents working for 48 h with no merged PR, stage change or build-plan row change. Each item's card has the evidence (file:line at main, the PR link), what waiting costs and the next safe step, with **Ask the lead** (after their turn unless you say now), **Answer**, **Accept the current workaround for now**, **Snooze 1 day** and **Dismiss**. Items update in place and resolve by themselves when the condition clears; phone pushes and Teams cards follow the usual rules, and everything is in the audit log as stuck.*. No new GitHub calls and no GitHub writes. ⚙️ Settings › 🧭 Stuck detection turns it off or sets the thresholds (admins, audited).
- **The leads escalate what only you can clear.** The Playbook of whoever covers Management now has a blocker sweep at every standup and at least daily: a decision, an owner, an access or a stale pull request that has blocked work for more than a day goes to you as an escalation with options and a recommendation, not a silent workaround; every Lead says in its handoff when it works around a blocker. The standup page has a **Blocked on you** section.

### Changed

- **The Overview is laid out as cards.** The progress bar is the Overview's Progress card, its stage names wrapping onto a second line instead of being cut off. The project console has left the middle of the page (it's the team-lead panel now), escalations are no longer above its box, and the Technical contact card is gone (the panel shows the lead). The other themes keep their Command Center, with the panel beside it; there, **Answer** on an escalation opens Approvals.
- **Settings › You: the team-lead panel.** **Show the team-lead panel** (on by default) and **Team-lead panel view** (Chat or Terminal, the old Command Center terminal setting) are kept in this browser.

### Fixed

- **"Change an existing app" leaves a live toolkit project as it is.** On a repository that already has its `intake.md` and `PROJECT.md`, the setup no longer re-runs `init-project.sh` (it judged the scaffold by git-ignored files a fresh clone never has, and rewrote `AGENTS.md`, `CLAUDE.md` and `CLAUDE.local.md` with `.mxtk-backup` copies), never rewrites the confirmed intake answers, the Decisions rows or the register's flat lines, and doesn't run gate-check over it either (on a fresh clone its staleness checks read checkout times and moved a live Stage 5 project's stage line to Stage 3), so the project's stage and dashboard stay as committed. The approved brief is recorded as a change request instead: `docs/project-brief.md`, and Stage 0b rows (the change request, then one ASSUMED row per assumption) appended to the Decisions table, its open questions carrying on the project's OQ numbering. The scaffold check reads committed files only, so a fresh clone of any scaffolded project is not scaffolded again; the git hooks are still installed, being per machine.
- **Attached PDFs are read.** The Chief Analyst is told to read each PDF whole, without a page range (a page range needs a PDF renderer the office's machine doesn't have, so the PDF came back unread), and a brief whose PDF still comes back unread is drafted once more, naming it, while the draft's planning budget and the 20-calls-an-hour limit allow (the retry counts against both).
- **No intake answer says CONFIRMED while it holds an Unverified item.** Unverified items from any section of the brief now go to intake Q8 and the register's open questions, and each answer's kind comes from the items that are left.
- **Smaller brief fixes.** A greenfield project's constraints no longer answer Q5 ("what must stay as it is"), and the team recommendation counts distinct integrations rather than list items, so a greenfield app isn't told "several integrations must stay"; the suggested size tier no longer ends in "use cases.)."; the goal row names its source once.

## 2026-10-12 · release 40 (`a16e04b`)

### New

- **New project starts with a project brief, drafted with the Chief Analyst.** ✨ New project opens a page that asks *What would you like to build?*: pick how to start (Plan with the team, Change an existing app, Migrate an app, or Assurance only), describe the app in one box and attach documents (.pdf, .docx, .md, .txt, up to 5 MB each). **Draft project brief** has the Chief Analyst write the goal, success criteria, user roles, scope, constraints and open questions, each marked Answered, Assumed or Unverified with where it came from. You confirm or edit items, chat with the Chief Analyst to change the brief, pick the interview style, then **Approve scope**. The page says plainly which attachments were read and how.
- **Approving the brief is recorded in the project.** The approved brief goes into intake.md (the goal, scope, constraints and open questions as answers, each item with its tag and source), PROJECT.md (the Stage 0 scope approval as CONFIRMED and every item still assumed as ASSUMED), a committed docs/project-brief.md, the project's sources/ folder (the attachments) and the Discovery issue, so the Chief Analyst starts Discovery from it.
- **Functional domains after the approval.** The Chief Analyst groups the work into domains with user stories (VIS-1, …) and their acceptance criteria counts, shown as cards with a side panel each; they become the starting point for the BRDs and the build plan.
- **Drafting is capped office spend.** Each draft costs about what the start page says (worked out from the configured model, Sonnet by default) and never more than its cap ($2 by default); calls are also limited per hour and to one at a time per person, and show in the office's spend. **Fill in the brief yourself** gives the same brief without AI, and is offered whenever the Chief Analyst can't draft. Test offices use a test planner and never call the real Claude.
- **Setup knows when it isn’t sure what happened.** Creating the GitHub repository and cloning the folder are written down before they’re done and again after (an operation record, saved with an acknowledged write: if it can’t be saved, nothing is sent). If GitHub stops answering, or the office restarts, in between, the setup pauses with *Repository creation may have completed* instead of guessing: **Check GitHub again** looks (the office also looks by itself at start and before any Retry), and once it has found the repository, **Use this existing repository** carries setup on. A repository used that way is never deleted by Cancel & undo. Every step of it is in the audit log (`project.setup-operation`).

### Changed

- **New project is one flow instead of six pages.** After the brief and the domains, one Team & budget card shows the recommended team and budget level with Change; the repository, Mendix version, client, Discovery and every other setting from the old form are under Advanced, with problems shown next to the field. The old form remains for editing a project's setup answers later. The wizard's code now loads only when it's opened.
- **Cancel & undo deletes only what setup confirmed creating, and records its own deletes.** A repository counts as the setup’s only when GitHub answered the office’s create (and still shows the same id); one found afterwards, or adopted, never does. Each delete is written down before it’s sent, so one whose answer was lost is checked on GitHub when you carry on cancelling, never sent twice. Setups from before keep their earlier records and rules.

### Fixed

- **The New project brief says honestly what approving does.** Approving now reads *records your scope decision for ✋ Stage 0 in PROJECT.md. Stage 0 passes when the Chief Analyst’s triage is signed off.*, and the folded brief says *✋ Stage 0 scope · approved by you*. The toolkit passes Stage 0 on triage.md’s sign-off, not on the PROJECT.md row, so Stage 0 stays pending until then, as before.
- **Hiring no longer holds up the office on a busy machine.** A hire’s Playbook, subagent files and journals are now read and written off the main thread, so a slow disk can’t freeze the pages for a moment while they are written. The same files as before.
- **A confirmation said in the chat is recorded.** When you tell the Chief Analyst something that was already in the brief, the item now says *confirmed by you in the chat · 10:44* (Answered, even if it was Assumed), is highlighted in the reply and moves the DRAFT version on; before, the reply said so but the brief showed no change.
- **PROJECT.md agrees with itself.** Every item still Assumed at the approval is also listed under *Assumptions (ASSUMED, unresolved)* instead of *None yet.*, and the brief's open questions fill the *Open questions* table (`OQ-01`…, `OPEN`), so the setup panel lists them as questions still to answer.
- **Unknowns are open questions, not assumptions.** The Chief Analyst is told that something not stated is an open question and an assumption is a concrete default it chose; an "assumed" item that only says something is not stated, unknown or unclear becomes an open question. Open questions keep the document that raised them (*open question (from workshop.pdf p.3)*).
- **Role statements say who wrote them.** A role's *When I…, I need to…* statement that the Chief Analyst wrote says *Statement drafted by the Chief Analyst* (in the brief, `docs/project-brief.md` and the intake answers) instead of borrowing the role's Answered tag, until you edit or confirm the role.
- **The drafting estimate matches the bill.** The start page priced `sonnet` at an old $3/$15 per million tokens while the CLI runs Sonnet 5.5 at $2/$10; it now uses the price the office books, and covers the brief, one chat message and the domains: about $0.15 for a draft like the first real one ($0.125), where it said $0.20 before.
- **No doubled punctuation** ("kiosk.; Host", "90 days..") in the intake answers and the Discovery issue built from the brief.

## 2026-10-12 · release 39 (`d5a85e7`)

### New

- **App Insights › Testing: test evidence bound to revisions.** A new read-only page lists each project's test runs (from pull request checks the Board already shows, the JSON reports under `reports/testing/` and `docs/report.json` on main, and the office's own gate-check of main) with three revisions kept apart: the app commit that was tested, the commit the tests came from, and where the report is kept. A report that doesn't say what it tested shows its tested revision as *unknown* and counts for no commit. Per BRD use case (grouped by feature) and per acceptance criterion it shows coverage, latest result and freshness as separate columns, so a criterion with no linked test reads "No linked test", never "Failed", and a run on an older commit reads "Stale". Every link says whether a file recorded it or the office inferred it (and by which rule); tests that passed and failed on the same commit are marked flaky. The test plan opens in place. Nothing on the page changes the repository, GitHub or any task.

- **Merged work counts as delivered only when its checks pass on the merge commit.** Each project now has a verification policy: the checks a merged task needs on the commit that actually landed on the default branch. By default that is the pr-checks run's result there, plus end-to-end results for the acceptance criteria a pull request says it covers (`Covers: AC-04` in its description). A merged task is *Done (verified)* when every required check passed or was waived there, *Merged, not verified* when one failed, is missing or was skipped (you are asked once in Needs you: re-run checks, waive with a reason, or send it back for rework), or *Passed on PR head, integrated revision not checked* while the merge commit has no results yet. Only *Done (verified)* counts as delivered. To see the merge commit's results, the office now also reads the default branch's newest pr-checks runs and check runs, on the same schedule as the Board's pull requests, and never writes anything to GitHub.
- **Settings › Verification and waivers.** Admins set the project's required checks in a short form in ⚙️ Settings › ✅ Verification. In App Insights › Testing, a new Verification panel shows the policy, each required check on the newest merge commit, and the merged tasks not yet verified, and admins can waive a check there with a reason. Every policy change and waiver is in the audit log, and a waiver shows who gave it and why.
- **Test first, as a prompt.** Once the build plan (Stage 4) has passed and Stage 5 isn't confirmed, Needs you shows how many acceptance criteria have no linked test (raised once, then kept up to date). The Playbooks now ask the Tester Lead to write the test first and name the criteria it covers, and developers to run the task's tests before a pull request and say what it covers. Nothing waits on it.
- **The acceptance record keeps the testing picture.** Accepting a delivery now also records the Testing counts (coverage, results, freshness) and the verification policy's result at the accepted commit. Earlier records are unchanged.
- **Quality scores per commit on the Testing page.** A new Quality card in App Insights › Testing shows mxcli's report scores (Security, Quality, Architecture, Performance, Naming, Design and the overall score) and lint findings by severity with the top rules, each tied to the commit and the mxcli version they came from, with a small trend over the last 10 scored commits, the rules that could not run, and Stale when main has moved since. The office scores each new main commit once (waiting while the agents work) in its own throwaway copy of that commit, never the project's checkout, since mxcli rewrites widget docs in the folder it runs in; admins can also click Score main now.
- **Run microflow tests on main.** Admins can start `mxcli test --local --require-assertions` on main from the Testing page. It runs in the office's own copy of main's commit, one run at a time, and the run is recorded with that commit as both the tested and the tests-from revision, the mxcli and Mendix versions, start and finish times and the JUnit file. Tests are named by file and `@test` name. A JUnit error, or a run that couldn't start (no Mendix runtime, no JUnit written), shows as a harness error, never as failed tests or as passed; a JUnit file found in a repository is never taken as evidence on its own.
- **Playbooks: microflow tests must assert, and impact comes first.** The Tester Lead and the Solo Lead run new microflow tests with `mxcli test --require-assertions`. Whoever writes the model checks `mxcli refs`, `impact` or `context` before changing an entity or microflow, and never commits the widget docs that `mxcli lint`, `report` and `refresh catalog` rewrite.

### Fixed

- **A closed pull request or an agent's own "task done" no longer counts as delivered.** A team member's task used to count as finished whenever its pull request stopped being open (closed without merging included) or the agent said `task done`, so rejected or abandoned work looked delivered. Now only a merged pull request, or its issue closed as completed, counts as delivered. An issue closed as *not planned* cancels the task. A pull request closed without merging asks you in Needs you whether to rework it, cancel the task, or which PR replaced it (a newer PR from the same agent's branch replaces it by itself). An agent's own `task done` is pending verification until its PR merges or its issue closes. Neither gets back-to-work nudges: they wait for you, as a finished task does. Tasks finished before this keep the record they had.
- **A new project's setup never creates a GitHub repository on a guess.** The setup's first step used to take any failure to look the repository up (a timeout, a login that doesn't work, no permission, GitHub down) as "not there" and go on to create it. Now it creates the repository only when GitHub says plainly that it isn't there. Otherwise the step stops with *Couldn't check whether owner/name exists on GitHub: …*: check the office's GitHub login in 🔌 Connections, then Retry.
- **Cancel & undo deletes only what the setup can prove it made.** When the setup creates the GitHub repository or clones the folder, it now records that it did, with GitHub's id for the repository. Cancel & undo offers to delete the repository only on that record, and only while GitHub still shows the same repository under that name. It never deletes a repository that was there already, one that has since been replaced by another of the same name, or one it can't check right now. It offers the folder only on that record too, and never a junction or link that points outside the projects folder. The office checks all of this again on the server right before deleting, whatever the request asks for, and the dialog says why when something isn't offered.
- **A worker's token usage no longer counts the same API request twice.** Claude Code writes one response as several transcript lines that share a message id, and the office skipped only a repeat that came right after the first, so a repeat further down, or a subagent's request that shows up both in the session's transcript and in the subagent's own file, was counted again. Now each request is counted once per worker across all of its transcript files (a response whose usage grows while it streams adds only the growth), and a subagent's request is booked under the subagent only. This applies to the worker cards, the budget ledgers and App Insights' analysis; spend already booked stays as it was.

### Changed

- **Unfinished setups from an older version of the office keep their folder and repository on Cancel & undo.** They have only their log lines (*created … on GitHub*, *cloned into …*), not the new record, so the office no longer deletes on those. Cancel & undo still takes the project off the office and removes the setup. The dialog says *this setup's log says it created it, but the office didn't record proof, so delete it on GitHub yourself if you're sure*, with a link to the repository's settings.
- **Project tabs plug in from a registry (internal).** A feature now adds a page of the project view (its navigation item, view and show/hide hooks) from a module of its own (`src/client/tabs/registry.ts`, see `docs/code-layout.md`) instead of editing `lite.ts`, `lite.html` and the navigation's list. 🧪 Tests is the first; nothing looks different, and it now loads the first time it is opened.
- **The new-project setup shows five friendly groups instead of 14 technical steps.** *Here’s how I’ll set up <name>* ticks through Repository, Mendix app, Toolkit & gates, Save & publish and Team; the running group opens, and each opens to its real steps, with a skipped step’s reason. A failed step turns its group red with the error in plain words, Retry and Cancel & undo (which only removes what the setup recorded creating), and a finished setup ends on *<name> is ready* with Open project, Open in Studio Pro and View setup details. Closing Cancel & undo with ✕ or Esc now puts focus back on the button that opened it.
- **Testing's background work is off until an admin turns it on.** Two office-wide switches in ⚙️ Settings › ✅ Verification, both off by default: **Judge merged tasks against checks** (judging merged tasks on their merge commit, its *Merged, not verified* items in Needs you, the test-first prompt and the default branch's checks fetch with `gh`) and **Score main automatically with mxcli** (a quality run for each new main commit). While judging is off, merged tasks stay *integrated* and the Testing page's Verification panel shows the policy and *Judging is off*; turned on, it judges only pull requests merged from then on, so older merges never raise an item. Automatic scoring, when on, never runs while an agent on the project is working; an admin's **Score main now** works either way, and the Quality card says when automatic scoring is off. Each change is in the audit log (`settings.change`).
- **No Needs you card for pull requests closed long ago.** The *PR #… was closed without merging: rework, cancel, or replaced?* decision is only raised for pull requests closed after the office first started with this release (it records that moment once); an older closed pull request leaves its task as it was. An agent's own *task done* is still a claim pending verification.
- **Run microflow tests on main says it needs a local Mendix runtime.** The admin-only button's tooltip now says so; without one the run is recorded as a harness error, as before.

## 2026-10-11 · release 38 (`928af9b`)

### Fixed

- **No page says its title twice in Portal.** Approvals and Standup no longer repeat the page header's title in a heading of their own (Approvals keeps its count as *5 waiting on you* and its autonomy line; Standup its schedule line and Run standup), the Settings sections drawn from the team's settings drop their extra *Team settings* heading and the second *Jeff · Router* / *Documents* heading (Save settings and the note stay), and Home's 2D Overview and Audit log tabs no longer say the tab's name again under the tab row. Portal only: the other themes have no page header and keep their headings. `scripts/check-titles.mjs` checks every page in Portal Light and Dark, at 1440 and 390 px wide.
- **"Filename too long" can't stop a hire or a floor sync any more, whatever git's config says.** On Windows the office now hands every git it starts `core.longpaths=true` through the environment (`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`): clones, worktrees, the floor sync's fast-forward, toolkit pins, the wizard's steps, the Live app's checkout, meetings, deleting a project. The agents' own environment carries it too, so their `git worktree add` and `checkout` can't hit it either. Release 21 only wrote the setting into each project's own git config, and equipment-rental slipped through: its floor was cloned at 16:03 on 8 October, 45 minutes before release 21 was merged, so the clone never set it, and the one later place that would have, the worker's worktree, sits behind the hire's pause check, which every Retry hit first. The per-project setting stays (for git you run there yourself) and is now also written on each floor's first floor-sync look; when it can't be written, the Audit log says so (`git.longpaths`). First-run setup's prerequisites have a new optional row, **Long paths for git**: whether git's system or user config has it, a **Turn on for my user** button for admins (`git config --global core.longpaths true`, only when pressed), and Windows' own *LongPathsEnabled* shown read-only (the office never changes the registry). The docs: *Setting up a new machine* and *Troubleshooting › Hiring fails with "Filename too long"*.
- **Test mode can't reach a real GitHub repository through Delete project or Cancel & undo.** The check that only a test's fake gh may delete looked gh up the way a shell does (a `gh.cmd` shim counted), but the office starts gh without a shell, which only ever runs `gh.exe`: a test office with a `gh.cmd` fake ahead of the real `gh.exe` passed the check and ran the real one. It now checks the program the office really starts, and in test mode with a real gh it isn't asked anything at all. Delete project's job (and Cancel & undo's) also keeps its progress in memory while it runs, so the dialog's polling can no longer make Windows refuse the job's next save and leave it stuck on *running*.
- **Test offices can't reach GitHub with real credentials.** A test office (`--test-mode`, `AGENT_OFFICE_TEST_MODE`, or a folder under `scratch/test-offices` / `test-office…`) now drops `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN` from its environment as it starts, before anything can run gh or git, points `GH_CONFIG_DIR` at an empty folder of its own (a real gh has no stored login) and clears git's credential helpers, and says so once in its log. 🔌 Connections hands it no outside token (GitHub, Mendix, Jev, Teams webhook), not even one saved in Connections or the admin token file, and its agents inherit the scrubbed environment. A test with a fake gh that needs a token present sets `AGENT_OFFICE_TEST_ALLOW_GH_TOKEN=1`. This is a second safeguard beside the fake-gh check above: a test office's Cancel & undo had run the machine's real gh with the token it inherited from the shell. The docs: *Test offices › Running a test office safely*.

### Added
- **Unfinished setups: Retry, Cancel & undo, and New project always opens fresh.** A new-project setup that stopped used to take over ✨ New project every time it was clicked. Now New project always opens a fresh wizard, and each unfinished setup is a card at the top of the wizard's first page and on Home (Projects): where it stopped and why, how many of the 14 steps are done, **Retry**, **Show setup** (carry on in the wizard), **Open project** once its floor is there, and for admins **Cancel & undo…**. **Retry says what would stop it before it runs**: *This project is paused (by Keith): resume it, then Retry* with a **Resume project** button, and the same for a budget pause, a pause or resume under way, a safe restart, and Studio Pro open when the steps left write in the folder (equipment-rental's Retry had failed three times on *Project paused: no new agents until it's resumed*). **Cancel & undo** undoes what the setup did, in reverse, behind a GitHub-style confirmation (type `owner/name`): the project comes off the office through Delete project (agents sent home, worktrees removed, office data archived, off `floors.json`, its project id retired), then the local folder and the GitHub repository when ticked, then the setup's own record. The boxes start ticked only for what this setup made: the repository when its step *created* it (never one you created yourself), the folder when it cloned it. Deleting the repository needs a token with `delete_repo`, as Delete project does; otherwise the dialog links to its settings on GitHub. The Mendix app (`.mpr`) goes with the folder and the repository; a Mendix Portal or Team Server app is never deleted. It's refused while an agent is mid-turn, a pause or resume runs, or a safe restart is under way; one that stops part way (a locked file, GitHub down) shows on its card and carries on from that step. The audit log records `project.setup-cancel`. The docs: *Create your first project › Unfinished setups*.

## 2026-10-11 · release 37 (`d6eddd1`)

### Fixed

- **Edit in Studio Pro opens what main has.** The floor's own folder (the one the wizard cloned, which Studio Pro opens) was never moved after the clone: agents work in worktrees and merge on GitHub, so it could sit hundreds of commits behind without the `.mpr` main had, and Edit in Studio Pro said there was no `.mpr`. The office now fast-forwards it to `origin/main` when the office starts, when it notices main moved on GitHub (whenever it fetches, or the Live app sees main move), when someone walks onto the floor, and before opening Studio Pro, with no polling of its own. Only when nobody can lose anything: on main, nothing staged, changed or untracked, no merge or rebase in progress, nothing of its own GitHub hasn't got, Studio Pro not open on the project, no agent mid-turn in the folder itself. Otherwise the folder is left as it is and the button says why and what to do (*Your project folder is 386 commits behind GitHub and has local changes in README.md — commit or stash them, then try again*); a move is in the Audit log as `floor.sync`, a refusal as `floor.sync-refused` once per reason. The docs: Command Center, *The project folder stays current*.
- **Edit in Studio Pro no longer disappears when you change page.** It was offered only once the office had found an `.mpr`, and the Portal navigation asked only when the page changed, so it vanished one page after the office said there was none. It's now on every project page, greyed out with the reason as its tooltip when it truly can't work (no Studio Pro on the office's computer, not an admin, already open), and redrawn whenever what the office says about it changes.
- **After a resume, nobody reports the project as paused any more.** A safe restart pauses every agent and the
  resume wakes only those with work, so the Coordinator and the other Leads kept "the project is paused" as their
  latest context, and the Coordinator told the Project Manager to resume a project that was running. Now every
  resume (a person's, after 🔁 Restart safely, after the budget's auto-pause) tells whoever covers Management when
  and why it resumed, who's awake and who's asleep, and to re-plan: in its resume brief when it's woken for its own
  work, otherwise as an office message (it wakes a sleeping Coordinator, waits for a busy one's turn, respects the
  spend cap). Other Leads aren't woken automatically. An agent that slept through the pause hears once, at the start
  of its next message, *Note from the office: the project was resumed on Sat 10 Oct 13:20 — you're running; carry on with
  work on GitHub issue #7.* And what you ask the Coordinator from the console and its quick questions goes in with a one-line
  fact block: the run state (Running since the last resume, Paused by whom since when, Budget-paused), who's
  working, idle and asleep. The console's Chat view shows only what you typed. See
  **Resume and pause** in the docs.

## 2026-10-11 · release 36 (`35eb29a`)

### Removed

- **The old installers and server deploy scripts are gone.** `install.sh`, `install.ps1` and everything under `deploy/` (AWS, Azure, Fly.io, Railway, Coolify, Dokploy, the container image and `provision.sh`) downloaded releases from the old upstream repository, so they are removed, together with their docs pages (aws, azure, fly, railway, coolify, dokploy, self-hosting), the self-upgrade from the ☰ menu (⬆️ Upgrade the office) that only offices set up by those scripts had, and the deploy-script hints in 👥 Invite teammates and 🌐 Services. Install Mx Office by cloning it (see *Set up on a new machine*, `/docs/get-started/new-machine`); update with `git pull`, `npm run build` and **🔁 Restart safely**. CI now starts the built office and checks the launcher’s plan instead of packing a release tarball.

## 2026-10-11 · release 35 (`09c7e9b`)

### Added
- **Pages in the Model tab have a Preview: the page as the running app would look.** Pages, snippets and layouts now
  switch between **Structure | Preview | MDL**. Preview draws the page inside its layout (top bar and menu), with its
  snippets filled in, form fields per attribute type, data grids as tables with sample rows, list views as cards and
  buttons in their styles, in an Atlas-like look of our own, with sample values made up from the attribute names and a
  Desktop / Tablet / Phone width. It runs in a sealed frame (no scripts, nothing fetched) and is drawn only while
  shown, in about a millisecond for travel-approval's largest pages. The Structure view lost its banner; a small
  **Live app ↗** link sits beside the switch instead. Pages whose MDL starts with a `/** … */` comment are now read too.
- **Pages in the Model tab have a Page view next to their MDL.** A page, snippet or layout opens as a structure
  preview laid out like Studio Pro's page editor: layout grids in rows and columns, containers, data views, list
  views and data grids with their columns, text, buttons, inputs labelled with their attribute, snippets and the
  layout's placeholders, unknown widgets as labelled boxes. Click a widget for its properties and its MDL. It is
  drawn from the page's MDL in the browser (about a millisecond for travel-approval's biggest page) and only while
  the Page view is on screen; the banner says it isn't the running page and links to the Live app. **MDL** in the
  bar shows the text, and your browser remembers the choice.
- **Entities show their access rules per role.** Click an entity: under its attributes, a matrix with a column per
  module role and R / RW / – per attribute and association, create and delete on top, and each rule's XPath
  constraint. Read from the domain model itself, so it comes with the diagram.
- **System Overview and Navigation show something.** System Overview draws the module dependency graph (boxes and
  arrows with reference counts, pan, zoom and Fit); Navigation shows each profile's home pages, per-role home pages
  and menu tree, with every page a link. A module's Security shows its roles and security matrix; User Roles and
  Demo Users open Project Security, settings open Settings, and JavaScript actions and page templates say why
  there's nothing to show.
- **The Model tab's details panel closes and widens.** ✕ gives the drawing the whole width (‹ Details brings the
  panel back); ‹ Wider or dragging its edge makes it up to 60% of the tab. Remembered per viewer, in full screen too.
- **Agents file the flows they create in a folder per kind.** The Lead Developer's and Solo Lead's Playbook puts
  each new microflow or nanoflow in its module's folder for its prefix (`ACT_` → Actions, `SUB_` → SubMicroflows,
  `DS_` → DataSources, `OCH_` → OnChange, `VAL_`, `DEC_`, `SCH_`, `BCO_`, `ACO_`, and Stubs) with mxcli's folder
  clause, never moves documents a person organised or Marketplace and System modules, and lists moves in the PR.

### Changed
- **The Model tab fills the page in Portal.** Under the page header, the Model view now runs edge to edge: the
  App Explorer against the left navigation, the details panel against the window's right edge, the drawing down to
  the bottom of the window, with no frame or gap around it and no page scrollbar (on a phone too). Full screen is
  unchanged; the other themes keep their framed tab.
- **The docs and README describe Mx Office on its own.** References to the project it started from, and the team
  attributions, are gone from the README, README.html, AGENTS.md and the docs (docs/upstream-README.md is deleted; the
  older server-hosting pages say plainly that they aren't supported), the app's titles and phone app say Mx Office,
  and CI no longer carries a publish step that could never run here. The LICENSE keeps its original copyright
  notice, as the MIT license requires.

### Fixed
- **Documents shows in about a second instead of 10 to 20, and the office no longer freezes while it looks.**
  On travel-approval a cold look took 20.7 s and a repeat 9–14 s: 133 git processes one after another, each
  started on the office's main thread (up to 400 ms of the office frozen per start), and 2.5 s of matching
  every file of every branch against the catalog. Now each office branch is one cached `git diff`, a worktree
  one `git status`, every git call starts off the main thread a few at a time, and a path is classified once:
  1–2 s cold and 0.5 s warm for the scan, answered at once after that while a newer one runs behind it. The
  first look after a restart waits at most 1.5 s for the fetch from GitHub.
- **Clicking Documents again while it loads no longer stacks windows.** Each click waited for the whole scan and
  then opened its own window, so a slow scan left several to close. Repeat clicks now share one request, and a
  document already open in the viewer isn't opened twice. Call an audit, Resume on the phone and Open in Studio
  Pro had the same pattern (a click while their first fetch was on its way opened a second window) and are one
  at a time too.
- **Mermaid diagrams no longer freeze the page.** Drawing a document's diagrams held the office page for up to
  3 s each (travel-approval's domain model); they're drawn in a sandboxed frame the browser runs in a process
  of its own, so the page keeps answering.
- **The Overview's dark band is two rows again.** Since release 34 its progress bar lay on top of the floor's line
  (branch, who's here, the budget chip, Running | Pause): the Model tab's new Page view styled a class name the progress
  bar also uses. Each now has its own.
- **The Portal top bar stays put.** It is fixed at the top on the project pages, Home, The Firm and setup: on Home
  and The Firm it scrolled away with the page, and scrolling the left navigation to its end scrolled the page under
  it. The navigation scrolls on its own now, and its project card and items sit flush to the pane's edges.
- **The Overview's Team and Technical contact cards show each agent's own character**, as the office, the team
  chatter and the escalation cards draw it, in its circle with its status dot, instead of coloured initials.

## 2026-10-11 · release 34 (`622bf6d`)

### Fixed
- **The 🎨 theme picker opens as a dropdown again.** Since the 3D views were removed its list opened inside the
  top bar, stretching the bar to several times its height; it is a menu under the 🎨 once more, on every page and
  theme and on a phone, closing on a pick, Esc or a click elsewhere.
- **Everything in the Portal pages lines up.** Your avatar's initials sit in the middle of its circle (they were
  3 px left), and it is the same 32 px as the icons beside it; the bell, a dialog's ✕ and the Clean theme's 🏠, 🎨 and ☰
  are centred too, as is the count on the team phone's button. Needs you's icon is on one line with its label and
  chips, and the alert keeps the console's column: with the setup line open or finished it ran under the Team card.
  The Budget page's fields, selects and Save buttons are one height; the 2D Office view's two toolbars are one
  height, and on a phone its 🎨, avatar and zoom buttons no longer run off the screen.

### Changed
- **Deliverables are called Documents** wherever you read it: the setup panel, the team pages' panel, the
  progress bar's card, Settings (the section keeps its `deliverables` id), the acceptance record and the docs.
  The API (`/api/deliverables`) and saved links are unchanged.
- **The Mx mark is the office's icon.** The browser tab, bookmarks and the phone version's home-screen icon now show the top bar's **Mx** in white on the Portal navy, instead of the old pixel desk.
- **The dark band is on the Overview only.** The floor's line (branch, who's here, the budget chip, Running | Pause)
  and the progress bar show on General › Overview; the other pages have their header alone, their content starting
  at the same height on each. The budget is also on the Budget page and the top bar's office chip; Pause and Resume
  on the Overview, Home's project cards (⋯) and the 2D Office view's toolbar.

### New
- **A Documents page.** What the 📦 Deliverables window showed is now a page of its own: **General ›
  Documents** in the Portal navigation (the **📄 Documents** tab in the other themes, `/lite?tab=documents`),
  with the page header, every team's documents by toolkit stage (on main, on a branch, drafts, missing), a
  search, a status filter, when the office last looked and **Refresh**. It shows at once (what it found last
  time, or a skeleton) and fills in when the office answers. A document still opens in the viewer (✕ or Esc).
  The setup panel's **Open documents →**, the progress bar's later stages and the 2D view all go to the page;
  an old `?tab=deliverables` link lands there too.

### To know
- The Documents page is one of the guarded views (and in the quick run): usable once its list is drawn, again
  after Refresh, with no long task over 200 ms and the office's event loop checked meanwhile. The big test
  office's project now has a toolkit team's documents among a few thousand app files, and office branches.

## 2026-10-10 · release 33 (`fc082cc`)

### Fixed
- **Squash-merged worktrees are tidied on machines with no git name set.** The worktree cleanup works out a
  squash merge with a throwaway commit only it reads; on a machine with no git user configured (a fresh office
  machine, a CI runner) git refused to make it, so every squash-merged worktree was kept as "not merged". That
  commit now brings its own identity. Worktrees with uncommitted or unpushed work are still never removed.
- **Jeff's "is it the same ask?" always gives up after its 10 seconds.** Its deadline didn't keep the office's
  process going, so with nothing else running a judge that never answered left the escalation waiting forever.
- **First-run checks describe the machine they check.** Where Claude Code's sign-in and jq are looked for now
  follows that machine's path rules, and off Windows a missing sign-in no longer says "this Windows user".
- **The performance guard runs on Linux.** Three things only worked on Windows: the fake agent's launcher
  wasn't executable in a Linux checkout (the busy office measured an idle office), the fake agent took each line
  of a multi-line message for a prompt of its own (it now reads the office's bracketed paste as one prompt, as
  Claude Code does), and off Windows the guard ran Playwright's stripped-down headless shell, which kills a page
  that asks for on-device speech recognition; it now uses the full Chromium on every OS, as on Windows.

### Changed
- **CI on Linux is green and dependable.** The tests that only passed on a fast or Windows machine now use
  controlled events: the clone-restart test lets its fake clone finish on a signal and keep reporting progress
  (and a new test checks that a picked-up clone that goes quiet is still stopped as stalled), the "making a
  worktree never blocks the event loop" test counts event-loop turns instead of 5 ms timer ticks, the worktree
  cleanup has a test without any git identity, and the surviving-terminal test also checks a worker waiting on
  someone keeps that state and that nothing is typed into either terminal.
- **CI runs on changes to `scripts/`, `tests/` and `install.sh` too**, not only the app's own folders.
- **CI runs the performance guard's quick check** (`npm run test:perf:quick`) in a job of its own, in headless
  Chromium installed for the repository's `playwright-core`, with the budgets unchanged. A browser that can't
  launch fails it, a missed budget fails it, and its `result.json`, `summary.md` and screenshots are uploaded
  every time (the run's `perf-guard-results` artifact). It doesn't hold up the release job.

## 2026-10-10 · release 32 (`6fbdbc6`)

### Fixed
- **✅ Accept records exactly the delivery you reviewed.** The evidence (documents, gate verdicts, the
  decision register, test reports) is read at the one commit being accepted, never from the panels'
  caches or uncommitted files, so a report deleted since can't be recorded as present. If the delivery,
  its evidence or the budget changes while the dialog is open, nothing is recorded: the dialog shows the
  evidence as it is now, keeps what you typed and asks you to confirm again. Spend from agents still at
  work doesn't count as a change. A project with no GitHub remote now records its commit too.
- **The docs' Projects screenshot waits for the spend.** `scripts/docs-shots.mjs` took the Projects shot as soon as
  the cards were there (its check matched any text), so a late budget feed could leave the spend off the picture.
  It now waits until every card shows its spend, and fails with a readiness timeout saying the budget feed never
  answered instead of saving an incomplete shot.
- **The Command Center's project summary stops redrawing itself when nothing changed.** The board redraws the
  summary up to four times a second while agents work, and it built its whole panel each time; now it builds
  nothing when what it would show is the same (the same project, facts and "… ago"s), and when something did
  change only that section is replaced. On the performance guard's big floor, a minute of live updates built
  about 260 summary elements instead of about 26,000. The console's typed text, focus and the chatter's scroll
  stay put, and a summary arriving late for the project you just left no longer paints over the new one.
- **The setup panel asks the office once per project, however often the page redraws.** Redraws that came
  together each sent their own setup request; now they share one per project, a re-check always asks again,
  and an older answer arriving late can no longer replace a newer one or show another project's stages after
  you switch projects. A failed request is retried on the next redraw, and a deleted project's answer is let go.

## 2026-10-10 · release 31 (`2500beb`)

### Fixed
- **The Agents and Budget pages stay smooth on a big project.** The Agents page no longer rebuilds every card
  a few times a second while agents work: only the cards that changed are redrawn (its longest stall on the
  performance guard's big floor: about 200 ms → about 100 ms). The Budget page no longer lays the whole page
  out twice while it draws, and formats its amounts faster (about 220 ms → about 100 ms). Nothing they show
  changed, except that an opened "How agents are graded" no longer folds shut as the list updates.

### Changed
- **The 2D Office view: Return to Project, and a tidy top bar.** The 2D Office view (`/pixel`) is reached
  only from the 1D view's **Go to Office** (Home's cards, its ⋯, the 2D Overview, the launcher, notifications and
  links all open the 1D view), and its **Go to Board** is now **Return to Project**: back to the 1D view of the same
  project, on its Command Center. Its top bar is the Portal bar's shape in every theme: the launcher, **Mx Office**,
  **OFFICE · PROJECT ⌄** (the project switcher), the search, **Return to Project** as its one primary button, then
  the bell, help, dark mode, 🎨, TEST MODE and your avatar (☰); the other themes have 🏠, OFFICE / the project,
  Return to Project, 🎨 and ☰. Everything about the office itself moved onto a **toolbar over the canvas**: the
  project's status line on the left, its budget chip, **● Running | Pause** and the office's spend today beside it,
  and **− Fit +** with a **⋯** (next agent waiting, chat, fit, and the keys, which used to fill the footer) on the
  right. Home's project cards have one **🗂️ Open project** button instead of Board and Office.

### Removed
- **The 3D and Retro views.** The original three.js office you walked around in, and its chunky-pixel Retro
  version, are gone with everything only they used: the 3D page and its code (`main.ts`, `core/`, `features/`,
  `world/`, `player/`, `input/`, `sound/`, the Blender models, the graphics presets, the retro pass, the
  elevator panel's floors, the HUD, the view dropdown and the ☰ menu's 3D ↗ items), **three.js** and
  **@types/three** (and their own dependencies) from `package.json`, and the server side of the toys only the 3D
  office could play (the arcade cabinet and its high scores, the basketball, the cars in the garage, pictures on the
  walls and the `/api/image` proxy behind them, golf, darts and axes, the gong you hit and the air horn). Old
  addresses still work: `/`, `/index.html` and links like `/?view=3d`, `/?3d=1&view=retro` or `/?gfx=low`
  redirect to the 1D view (of the floor the link named, `?floor=`, else the one you were on, else Home), and the
  old 3D docs page lands on **The two views**. The client bundle is 5.4 MB smaller on disk (21.4 → 16.0 MB, the
  3.9 MB of models included), its JavaScript 1.5 MB smaller (10.75 → 9.26 MB; the 1.45 MB / 457 kB gzipped 3D
  page is gone). ➕ Add project keeps its panel (`ui/add-project.ts`, out of the old elevator). ⚙️ Settings ›
  You loses the 3D office's sounds and voice chat; the browser's old 3D settings are left alone and not read.
  The server still accepts the old presence messages (walking, sitting, emotes) and the `floor.remove` op, so an
  older page or script doesn't break.

## 2026-10-09 · release 30 (`5ef483c`)

### Changed
- **README in the Portal theme**: the README now shows the Overview and the Projects page in Portal (Light), on believable demo data, and `scripts/docs-shots.mjs` retakes the docs screenshots in one command.

## 2026-10-09 · release 29 (`daa71db`)

### New
- **🚀 First-run setup.** A new office (no projects yet, and its password still the generated one or no projects
  folder yet; an office that already has projects never) opens
  on `/setup`: a six-step stepper in the Portal look (every theme): **Welcome** (set the office password and
  your name), **Prerequisites** (a green or red row each for Node 22.5+, Git and Git Bash, `gh` and its sign-in,
  Claude Code and its sign-in, Studio Pro, mxcli, jq, the toolkit and the Live app's PostgreSQL, marked required
  or optional, with what each is for, the fix and an install link; 🔄 Re-check runs them again, off the event
  loop, and Claude Code is only ever asked `--version`), **GitHub** (the organization new projects go in, and the
  agents' and admin tokens on 🔌 Connections' own cards with their 🧪 Test), **Mendix** (the token, and the Studio
  Pro version new projects start on), **Toolkit** (pick an existing clone, or clone it with git's progress shown
  as it comes; the URL is a setting, the upstream by default), and **Done** (a summary, ✨ Create your first
  project, 📚 Open docs). Admins only after the welcome; each step is saved, so a reload or a restart opens on
  the same one; every change is in the audit log; no token is ever shown back. ⚙️ Settings › 🔌 Connections has
  **🚀 Run setup again**.
- **Start the office from the repository.** `scriptsstart-office.ps1` (Windows PowerShell 5.1 and 7) has no
  personal paths: the office home is `%USERPROFILE%mx-office` (`-OfficeHome`), `-Port` picks the port, it
  runs `npm install` / `npm run build` when they're missing, just opens the browser when an office already
  answers, says so when the port is taken, and keeps the restart loop (exit code 75,
  `AGENT_OFFICE_LAUNCHER_LOOP=1`). It reads no token files: the office keeps those in Connections. Environment
  variables already set still win, so an older launcher keeps working. `scriptsinstall-shortcut.ps1` adds a
  **Mx Office** shortcut to the desktop and Start menu.
- **Docs: Set up on a new machine** (`/docs/get-started/new-machine`): prerequisites with links, clone, install
  and build, the launcher, the first-run setup, the shortcut, and troubleshooting (Windows Terminal, long paths,
  Defender's first-run slowness, a port in use). Quick start and the README point there.

### Changed
- The GitHub organization new projects go in is a setting now (first-run setup), ahead of
  `AGENT_OFFICE_PROJECT_ORG`; an office that never set one keeps AI-Taskforce-Labs as before. The default Studio
  Pro version and mxcli's path can be set there too (mxcli's folder goes first on the agents' PATH). The toolkit
  is also looked for in `~/mendix-toolkit` (where the setup clones it), before the older agent-spike folders.
- A new office started from a terminal by `start-office.ps1` skips the terminal walkthrough
  (`AGENT_OFFICE_NO_WELCOME`): the browser's setup asks instead.

### Fixed
- **No freeze right after the office starts**: the keep-awake helper (PowerShell on Windows) was started on the server's
  main thread, which held it for 1.3 to 2 s after every start or Restart safely while Windows checked PowerShell.
  It now starts from the office's helper thread (about 20 ms on the main thread instead of about 100 ms, and no
  multi-second freeze).
- The performance guard no longer fails a whole run because Windows still held its test office folder for a
  moment at the end: removing it is retried a few times, then left with a warning.

## 2026-10-09 · release 28 (`aa67940`)

### New
- **⚠️ Delete a project, the GitHub way.** ⚙️ Settings › ⚠️ Danger zone (admins, at the bottom of the list, red
  border) has **Remove from office** and **Delete this project**, and a Portal project card's ⋯ has **Delete…**.
  Both open one confirmation: a red summary of exactly what will happen (N agents stopped, N worktrees removed and
  how many hold unpushed work, where the data is archived, folder and repository kept or deleted), then *type
  owner/name to confirm*; the red button stays disabled until it matches exactly, and the office checks it again.
  Remove stops and sends home every agent, removes the office's worktrees, archives the project's office data to
  `<data>/deleted/<project>-<time>/` and removes it, and takes the project off `floors.json`; the folder and the
  repository stay. Delete can also take the local folder and the GitHub repository, each only when ticked.
  Everyone on the project goes Home with a *Deleted shop* toast. Docs: Using the office › Delete or remove a project.
- **Model: full screen.** A **Full screen** button at the end of the Model tab's bar (or **F** / **Shift+F**
  with the focus in the tab) spreads the App Explorer, the diagram and the details over the whole window,
  fitted to it; **Esc** or **Exit full screen** brings it back, fitted again. It uses the browser's full
  screen, or covers the window where the browser has none. Pan, zoom and Fit work as before, in every
  theme. Esc with an element picked lets go of it first.

### Fixed
- **A setup step whose command's end got lost is tried again by itself.** When a step's program has
  gone but its end never reached the office (seen on Windows with freshly written programs the virus
  scanner held), the step now runs once more on its own (its log says "try 2 of 2") instead of stopping
  at once; only when that happens twice in a row does it stop and ask for Retry. Steps that talk to
  GitHub still get their three tries.
- **Portal: the top bar and the left navigation stay put while the page scrolls.** Scrolling a long page
  (the Overview, the Board) took the navy bar away with it and left the pane hanging under an empty strip.
  Now the bar stays at the top of the window and the pane under it, only the page scrolls (one
  scrollbar), and a pane longer than the window scrolls on its own. The folded rail and the phone's
  drawer work as before.
- **Portal: the progress bar's phase card is solid again.** Hovering a phase or stage in the dark band
  showed its card see-through over the page (it took the band's faint wash for a background). It's a
  white card in Portal (Light) and a dark one in Portal (Dark), with a border, a shadow and readable
  text, and so is any other tooltip or menu that opens out of the band or the top bar.
- **No more terminal windows popping up on Windows.** With Windows Terminal as the default terminal,
  programs the office (and its tests and performance checks) started from a process without a console
  each opened a terminal window of their own, most of them when an agent's terminal was stopped (the
  terminal library forks a helper from the pty host, which runs without a console). Everything the pty
  host starts, and what the office starts off its main thread, the test runner, the performance harness
  and the tests' agent shims start, now starts without a window; Studio Pro and the browser still open
  as windows.

### Good to know
- **Guarded.** Nothing starts during a pause, a resume, a safe restart or a toolkit update. Worktrees with
  uncommitted or unpushed work are listed and need **Remove them anyway**; an unpushed branch stays in the
  repository when the folder does. The folder is only deleted inside the projects folder, never through a
  junction or symlink, never the office's own checkout, and in test mode only under scratch/test-offices; junctions
  inside are unlinked, not followed; a locked file stops the step with a clear message and **Retry**. The
  repository is only deleted when the office's GitHub token has `delete_repo` (otherwise the dialog links to its
  settings page on GitHub). A Mendix Portal / Team Server app is never deleted: the dialog links to the Portal.
- **Resumable and recorded.** A failed step stops the job; Retry (even after a restart) carries on from it. The
  audit log is never deleted and gets a `project.delete` event; the project's `prj_` id is retired (adding the
  repository again makes a new project) and its evidence trace says when it was deleted.
- **Starts clean if added again.** The office lets go of everything it kept about the project in memory (team,
  budget, pause and pacing, caches, live app), and its Analysis runs and workflow runs move into the archive.
  The audit event names your account, or on the shared password the name you go by in the office.
- **Archive isn't here yet**: ⏸ Pause project stops a project's agents and keeps everything.

## 2026-10-09 · release 27 (`640ac22`)

### New
- **Portal: a left navigation on every project page.** In Portal (Light) and Portal (Dark) the 1D view's
  tab row gives way to a pane down the left, like a low-code platform's app pane: a project card at the
  top (tile, name, ⌄ to switch project), then groups that open and close (General: Overview, Team, Team
  boards, Documents; Project Management: Board, Approvals, Standup; App Insights: Analysis, Budget, Audit
  log; Repository: Git, Model; Deployment: Live app; Monitoring: Agents, Tests for admins) and, under a
  rule, Settings, View App and Edit in Studio Pro. The page you're on is a grey pill, its group opens by
  itself, each item carries its tab's badge and a closed group adds them up. Hovering a closed group
  shows its items in a flyout; the chevron on the pane's edge folds it to an icon rail with flyouts. The
  open groups and the rail are remembered per viewer in this browser. On a phone it's a drawer behind ☰.
  `?tab=` links, badges and every other way to a page work as before.
- **Portal: a page header.** Each page starts with its name and a line about it, and its buttons: the run
  state (● Running | Pause), the budget chip and a blue New task on every page, Issues / PRs / Queue on
  the Board, Pin project and Call an audit on the Overview. The progress bar sits under it. The bottom
  bar and the floor's line are folded into it.
- **Portal: the Command Center as an app Overview.** The project's tile, name and what it's for; Needs you
  as a blue info alert (✕ hides it for the session until something new needs you); the Project console;
  Recent activity as a separated list; What's happening, progress and agents; and on the right
  light-grey cards for the Team (agents' faces with a status dot, +N), the Technical contact (the
  Project Coordinator or Solo Lead) and Details (repository, branch, Mendix version, toolkit pin, last
  commit, budget, live app). The page scrolls instead of fitting the screen. The last commit is the
  default branch's newest, with its date and subject (from the Git tab's graph, asked at most every two
  minutes while the Overview redraws).
- **Portal: no repeated titles.** Agents, Settings, Budget, Audit log and Test mode no longer repeat the
  page header's title in a heading of their own (the Agents page keeps its waiting count).
- **Portal: the top bar's search finds more.** Projects, the project's pages, its agents, issues and pull
  requests (by title or #number), the office's pages and the docs (by title or heading), in groups with
  the best match first, ↑ ↓ over the headings. The docs' titles are fetched once, the first time you
  click into it; everything else was already on the page.
- **Call an audit and The Firm → are on the Audit log page** (its page header in Portal; above the log in the
  other themes), with a running audit or a ready report shown there too. The floor's line no longer keeps
  room for them at the top right.
- **Portal: the floor's line and the progress bar are one band** under the page header: branch, folder,
  who's here, the budget chip and the run-state toggle over the progress bar, on a mid dark grey with a
  faint shade and a soft shadow (a charcoal a little lighter than the page in Portal (Dark)), every text
  and status colour at 4.5:1 or more on it. Clean, Fun and Terminal keep their floor line as it was.
- **Go to Office** in the 1D view's top bar opens the project's 2D office (and **Go to Board** on the 2D
  view comes back). The view dropdown (1D / 2D / 3D / Retro) is gone from the flat views.

### Changed
- **Workers are called Agents** wherever you read it: the tab and page (Agents), Settings › Agents, the
  badges' tooltips, the audit log's filter, the queue and meeting windows, the New task window (Agent,
  "What should the agent do?", New agent), the issue and PR windows, the rankings, The Firm's report, the
  menus, tooltips, toasts and empty states. Addresses stay:
  `?tab=workers` and `section=workers` still work, and `?tab=agents` opens the Agents page too.
- **The docs are MxOffice Docs** (the brand in the docs page's bar).

### Fixed
- **Portal: one × on every window.** The close button of every window (dialogs, the PR and issue windows,
  the queue, the deliverables, the team phone) showed two × in the Portal themes: the line icon and the ✕
  text beside it. Now it's the icon alone, as in Clean.
- **Entering a project opens its Command Center** (the Portal Overview), not the tab this browser had
  last: from Home, the project switcher, the launcher, Go to Board or /lite, and when you switch project
  inside the 1D view. A link that names a tab (`?tab=…`: Needs you, notifications, a PR's View in Model)
  still opens it, and a reload keeps the tab that browser tab showed.
- Clean (Light), Clean (Dark), Fun, Fun (Dark) and Terminal keep the tab row and the bottom bar exactly as
  before.

## 2026-10-09 · release 26 (`bee523f`)

### New
- **🎨 Portal (Light) and Portal (Dark), the new default theme.** The office drawn like a low-code platform's
  web portal: a navy top bar across the window with a ⋮⋮⋮ launcher (Projects, The Firm, docs, Settings,
  every project), the **Mx Office** wordmark and the section in capitals (PROJECTS, THE FIRM, or the
  project's name, which still switches project), a search in the middle that finds a project, a tab or a
  page as you type, and at the right the team phone's bell with its count, help, a dark-mode switch, the
  🎨 and your initials for the ☰ menu. White pages, Noto Sans, the portal's blue for primary buttons,
  underline tabs, light-grey lines and table heads; no emoji, as in Clean. A browser that never picked a
  theme gets Portal (Light), or Portal (Dark) when the system is dark; a theme picked before is kept.
- **Home as a Projects page** (Portal themes): the title with Add project and New project, a filter row
  (search by name, status, sort by Pinned / Recent activity / Name with a reverse button, Pause all), and
  a card per project with its tile, name, repository, summary, progress, status and spend, plus 👁 watch,
  pin and ⋯ (open the board or the office, live app, Edit in Studio Pro, Pause / Resume). Pins and watches
  are per viewer, in this browser; an unwatched project no longer calls you over from other floors.
- Clean (Light), Clean (Dark), Fun, Fun (Dark) and Terminal look exactly as before.

### Changed
- **📐 Model tab: diagrams open at once.** Microflows, nanoflows and domain models are now drawn
  straight from the app's model files, in milliseconds, instead of one mxcli run per document (1 to 7
  seconds each). The MDL beside a diagram fills in a moment later ("Reading the MDL…"). Documents are
  kept by their content, not by commit: after an agent commits to main, everything it left alone
  opens straight away. On a copy of travel-approval, a microflow went from 1.6 to 1.9 s to under
  80 ms the first time, and from 1.8 s to 15 ms after main moved.
- **The App Explorer tree no longer waits on every commit.** It is kept by the app's structure, so a
  commit that only edits documents keeps it. When the structure changed, the last tree shows at once
  and the new one replaces it when it's ready.
- **Reading ahead.** Opening a document reads the rest of its module in the background. When main
  moves while someone used the tab in the last 15 minutes, the new tree and the changed diagrams are
  read before anyone asks.
- **Much less disk.** The office no longer keeps a full copy of the app per commit (`model/snap/`,
  19 MB each); that folder is removed on first use. mxcli reads three work folders that move from
  commit to commit by the few files that differ.

### Fixed
- **The Git tab's branch graph no longer holds up the office.** It started git on the server's main
  thread, up to 350 ms at a time on Windows, and the Model tab asks for it on every look. It now
  starts git off the event loop.
- **Aggregate and list-operation activities** in newer models get their own icon and caption ("Count
  of Orders") instead of a generic one.

## 2026-10-09 · release 25 (`9ab7e96`)

### Improved
- **📐 Model tab: domain models you can read.** Associations nobody arranged in Studio Pro (still at its
  default connection points, as agents and mxcli create them) no longer run from one box's left edge to
  another's right edge across the entities between. They leave from the sides the two entities face
  each other with, spread along a side when there are several, and run in straight horizontal and
  vertical segments around the other entities, with their names and 1/* discs where they cover no box
  when there's room. Associations someone arranged in Studio Pro keep their points exactly; colours,
  discs, owner dot and arrow are as before.
- **Tidy layout.** A new **As in Studio Pro / Tidy layout** switch in the Model tab's bar rearranges a
  domain model's entities for reading (layers along the associations, referenced entities on top,
  loose entities in a grid beside them). View only, never written to the model; your browser
  remembers the choice. An unarranged-looking model (entities on an even grid, lines at the default
  points) suggests it: *Lines overlap? Try Tidy layout*.
- **Follow one line.** Pointing at (or clicking) an association lights it and its two entities and
  dims the rest.

### Changed
- **Clean is the default theme.** A browser that has never picked a theme now opens in Clean (Light), or Clean
  (Dark) when the system is in dark mode. The 🎨 list starts with the two Clean themes, and the original
  bright look is now called **Fun** (with **Fun (Dark)**). A theme you picked before stays picked.
- **Domain models stay readable in Studio Pro too**: whoever writes the model (the Lead Developer, or a Solo Lead)
  now tidies a module's domain model with `mxcli layout` after changing its entities, in the same pull request.
  Agents used to leave entities on mxcli's default grid with every association drawn edge to edge. A module a
  person arranged in Studio Pro is never re-arranged.

## 2026-10-09 · release 24 (`b32d844`)

### New
- **📐 Model tab: the app as Studio Pro shows it.** A new tab beside 🌳 Git shows the floor's Mendix
  app the way Studio Pro does, read-only. The App Explorer is on the left: the app's tree with an icon per
  document type, a filter (Ctrl+F) and the keyboard. The chosen document is on the right: a module's
  domain model (entities by type and colour, attributes, validation, calculated and event-handler
  markers, generalizations, associations with multiplicity and owner, annotations), or a microflow or
  nanoflow (events, activities with their icons and variables, decisions with outcome labels, merges,
  loops, parameters, annotations, error handlers). Diagrams keep the developer's own positions and
  sizes. Pan, zoom and fit; click an element for its details and MDL. Light themes get Studio Pro's
  light canvas, dark themes its dark one. On a phone the explorer is a drawer.
- **What did the agent change?** Pick a worker's branch or an open pull request in the Model tab and
  tick **Changes in this branch**. The documents the branch added or changed are marked in the tree and
  listed beside the diagram, and inside a diagram the added elements are ringed green and the changed
  ones orange. A pull request's window has **📐 View in Model**, which opens it there.
- It reads each commit with mxcli from a copy in the office's data folder, never the floor's checkout
  or the .mpr itself. It reads only while the tab is open, and keeps each answer per commit, so a
  document opens straight away the second time (docs: Using the office › Model tab).

## 2026-10-09 · release 23 (`04fbd44`)

### New
- **Each project runs on its own pinned toolkit commit.** A project's toolkit is now a read-only copy of
  one commit (`mendix-toolkit-pins\<sha>`, next to the shared clone), and its instruction files, the team's
  Playbooks and the office's own gate checks use it. The toolkit's session-start ritual used to
  `git pull` the shared clone in every agent session, so new toolkit rules reached running projects
  mid-stage; for a pinned project that step now just reads the pinned commit, and an Agent Office block in
  `CLAUDE.local.md` says not to pull. New projects start pinned on the fork's newest commit. The commit is
  recorded in `agent-office.project.json` (with its history) and in `PROJECT.md`'s `Toolkit commit:` line.
- **A Toolkit line in the setup panel, and a 🧰 chip on the progress bar**: *toolkit 7b4b4cf (2026-10-08) ·
  3 newer commits available (fix/new/gate-rule changes)*. Commits are classed by their prefix and by
  whether they touch gate rules (gate-check, its tables, the runbook, the checkpoints). The fork is fetched
  in the background at most every six hours, or with **🔄 Check now**; never on a page load. When the clone
  has Maurits' repository as `upstream`, the Toolkit window shows how far behind it the fork is.
- **🧰 Update toolkit (admins), with a preview.** The preview runs the gate check over the project's
  default branch with the current toolkit and with the new one and shows what would change (*Stage 2 PASS →
  FAIL because …*), the commits in between, and a warning when the current stage is mid-way. Confirm moves
  the pin, brings untouched copied scripts up to date, runs the toolkit's own `sync-project.sh`, and pushes
  one commit `chore(toolkit): update to <sha>`; it's in the audit log as `toolkit.update`. **Roll back**
  goes to the previous pin the same way. Projects made before pins show *≈ <sha> · not pinned* (worked out
  from `PROJECT.md` or the copied scripts) and are pinned from the same window. See Toolkit versions in the
  docs, which also explain how to sync the fork with Maurits' repository.

### Fixed
- **A busy office no longer stalls on a loaded machine.** With builds running and the virus scanner busy,
  the server still blocked for 0.4 to 1.8 s at a time while six workers worked: the ranking's background
  refresh read every journal and project file and graded everyone in one go, every worker update made a
  new time-zone formatter and wrote the roster and the Office Ledger synchronously, the machine monitor's
  CPU reading (`os.cpus()`) took up to a second, and the analyzer looked for each session's transcript one
  folder at a time. The ranking now reads its files in the background (only the ones that changed) and
  grades a few workers at a time with the server free in between, giving the same ranking; the rest read
  and write off the server's main thread. The busy-office check in `npm run test:perf:quick` on this
  machine with three Mendix builds running (35 to 70 % CPU): before, up to 50 blocks over 100 ms, the
  longest 966 ms to 2.4 s; now no block over 100 ms in the last three runs.
- **Making a project stalls the server less.** The wizard's clone step and checkpoints, opening the new
  floor, a hire's Playbook files and every part of the office looking for `claude` on the PATH held it
  0.3 to 1.7 s in one go; the steps now let other work in between, checkpoints are written in the
  background and a command is looked up once. On a heavily loaded machine a few wizard steps still
  block for 0.3 to 0.6 s (the journey's server check can fail there).
- **The safe-restart panel stays true after its wait limit.** Past the limit it kept naming people who had
  long gone to sleep ("Dylan handing off"); the list and its audit line now keep updating, and the restart
  goes on by itself once nobody is left.
- **The safe restart and ⏸ Pause project say why someone is still busy.** An agent whose own turn is over
  but whose background helper (a subagent sent with the Agent tool) is still working shows as, say,
  *Katherine: background helper running (architect-agent, 18 min)*, from the team's live record of
  subagent runs or a subagent transcript still being written; the restart waits for it.
- **A new-project setup never just sits there.** A step quiet for 30 s says which command it is waiting on
  and for how long (or that none is running), in its line and its log; a command whose process has gone
  without its end coming through fails the step for a Retry instead of holding it for up to 10 minutes
  (seen once in 30 setups on the test office, release 22 too).
- **The Team tab's "last journal entry" and the chatter feed** read journals from what was last read in
  the background: a journal that just changed shows on the next look (a few seconds later).
- **The performance guard's own profilers** no longer count against the server: the busy check and the
  journey start the office's CPU profile before the stretch they measure (starting and saving one held
  the server for up to a second on a loaded machine). The journey names what ran in a stall it finds, and
  `PERF_BUSY_LOAD=<n>` runs the busy check with n disk hammers, to reproduce a loaded machine.

## 2026-10-08 · release 22 (`6c26905`)

### New
- **The office's messages never replace an agent's task.** The office now keeps what each team member
  was last given to do (its hire's task, a prompt you typed to it, what the Coordinator told it), and
  every message it writes to an agent (a standup, an autonomy or skills notice, an answer, a decision, a
  relay) ends with *When you've done this, carry on with: <task>*. An agent with no task is told to say
  what it will do next or escalate. A task is finished when its issue closes, its PR is no longer open,
  or the agent says `task done`.
- **Back to work.** When a team member stops with its task still open, nothing escalated, the office
  sends it one prompt half a minute later: *You stopped with <task> open: carry on, or escalate if you're
  blocked.* Once per stop, at most twice per task an hour, and never while it's busy, asking you,
  asleep, benched, watched, waiting on you, or the project is paused, over its cap or in Studio mode, nor
  at autonomy level 1. On by default (⚙️ Settings › 👥 Team › Review loop).
- **💤 Idle with an open task in Needs you.** A member idle 10 minutes with a task open and nothing
  escalated shows in Needs you (and the Team phone's), with a one-click **Nudge**.
- **You choose before your actions interrupt busy agents.** Run standup and the console's quick
  questions first show who is ready and who is working (on what, for how long) when anyone is mid-turn,
  and ask per person or the same for all: **Interrupt now**, **After their current turn** (the default)
  or, for the standup, **Skip: use their journal**. A quick question's choice also holds the
  Coordinator's relays of it to those Leads. What you type to the Coordinator yourself still goes
  straight in; while it's mid-turn a note says so, with **Send after their turn**.

### Changed
- **The office never cuts into a turn under way.** Its own messages (scheduled standup, autonomy and
  skills notices, relays, notes) wait for the agent's turn to end and are typed then; the scheduled
  standup reads busy Leads from their journals. Notices no longer ask for an `ok` reply.
- **No catch-up standup on a new team's first day.** A team hired after the day's standup time has its
  first standup at the next scheduled one (a team hired at 14:17 was asked for a standup three minutes
  in, and its analyst stopped there).
- **A decision a Lead was waiting on reaches it at once.** Your decision on its proposal goes out within
  ten seconds (a few in a row as one message) and wakes an asleep Lead; a busy one hears it when its turn
  ends. Answers to escalations already went straight in; now they end with the task too.

## 2026-10-08 · release 21 (`3128cec`)

### New
- **A progress bar for every project.** A thin line between the floor's top row and the tabs (the same
  on every tab, and under the top bar of the 2D view) shows the project's phases: the toolkit stages its
  entry mode runs, then Handover and Accepted. Each is coloured by what was measured (the gate verdict,
  the deliverables on main), with the ✋ gates and decisions as marks, and the current phase outlined. It
  never shows a percentage nobody measured: what the office doesn't know reads as unknown. Hover a stage
  for its deliverables, gates, dates and planned against actual spend; click it for the setup panel, the
  deliverables or the acceptance record. **▾** folds it to a thin line (remembered on your browser).
  Home's project cards show a small version. It updates when something changes (a merge, an Accept, a
  project switch), never on a timer.
- **✅ Accept a delivery, with a record of what was accepted.** The Project Manager accepts a version
  (v1, then v1.1, v2…) explicitly; a merge never counts. The dialog shows what the record will hold: the
  scope agreed and delivered, the commit at the head of the delivery branch, the gate checks, CI and test
  reports (gaps shown as gaps), the documents at that commit and the spend frozen at that moment, and asks
  for the exceptions still open, each with an owner. **↩ Reopen** starts the next version with a scope
  note and keeps the earlier record. If the branch or the deliverables move on afterwards, the record and
  the bar say **changed since acceptance**. Records are append-only and hash-chained, in the audit log as
  `acceptance.accept` / `acceptance.reopen`, and in the evidence trace. Admins only.

### Fixed
- **Agents booking their usage no longer hold the server up**: the office saved its list of workers to disk
  every time an agent's usage was counted, on the server's main thread, and with the virus scanner busy one
  save took half a second. Changes are now gathered for a second and written in the background (a shutdown
  still saves at once).
- **A project that has only just started no longer shows a failed gate.** The toolkit's gate check calls a
  ✋ gate FAIL while it waits on your sign-off (on a new project, Stage 0's "Confirmed by:" line still holds
  its template text), so the setup panel said ⚠️ FAIL and the Command Center "1 toolkit gate failing" before
  anything had happened. A gate that only waits on a person now shows as ✋ NEEDS SIGN-OFF, in the progress
  bar as waiting, and isn't counted as a risk; a gate that fails for anything else still shows as failing.
- **A page no longer looks stuck when the office stops.** When the office exits without the restart loop
  (🔁 Restart safely without it, Ctrl+C) or vanishes and doesn't answer, open pages now say **The office
  has stopped. Start it again with start-office.ps1**. During a looping restart they say **Restarting…
  reconnecting**. Either way, they reload by themselves once the office is back.
- **A new Mendix project's team can be hired on Windows.** The wizard's *Hire the project team* step failed
  with `Could not create a git worktree: … Filename too long`: a Mendix app's `javascriptsource` carries npm
  packages with deep `node_modules` folders, and inside a worker's worktree those paths pass Windows' 260
  characters. The office now sets `core.longpaths true` in the project's own git config on Windows: on the
  wizard's clone, and before it makes any worker's worktree (read from the config file, so a hire costs no
  extra git run). Floors from before this get it at their next hire.
- **No more "Do you trust the files in this folder?" on a new floor.** Every agent's terminal on a new
  project stopped on Claude Code's trust prompt until someone clicked each one. The office now marks the
  floors it manages trusted itself: the wizard's new floor in the office's own Claude Code config, and each
  floor in the config a Claude worker starts with (the office's, or the hiring account's own sign-in). The
  floor's folder covers every worktree under it. Only that one entry is written, never when it's already
  there, and a config file it can't read is left alone; test offices never touch a real config.
- **Busy offices no longer stall on reading agents' sessions.** With six busy workers the server blocked for
  up to 1.3 s at a time while it read their transcripts (each session and every subagent's, for every worker
  every 10 s), which failed the busy-office check in `npm run test:perf:quick`. Those reads now run off the
  server's main thread, a file that hasn't grown isn't opened at all, and what was read is taken half a MB
  at a time with the server free in between.

## 2026-10-08 · release 20 (`86279d8`)

### Fixed
- **Starting workers no longer freezes the office on Windows.** Every time a worker's terminal started
  (hiring, waking after a restart or a project's resume, pressing R), Windows started `claude.exe` on the
  server's main thread, and with the virus scanner reading it that held everything for 0.65 to 2.6 s per
  worker: after a safe restart that woke six agents the office stalled 2.6 s twice. Workers' terminals
  now run in a small terminal host process next to the office (one per project), so starting any number
  of them leaves pages, hooks and other workers running. The host lives and dies with the office: when
  the office stops or crashes it ends every terminal and exits, and if the host itself crashes the
  affected workers resume in a fresh one. The busy-office check in `npm run test:perf:quick` now wakes
  six workers at once on a fresh agent binary and fails on any block over 250 ms (release 19: 4.8 s; now
  none over 100 ms). `AGENT_OFFICE_PTY_HOST=off` puts terminals back in the office, for troubleshooting.

## 2026-10-08 · release 19 (`21cb589`)

### New
- **The office records what its server was doing when it stalls.** When the server stalls again within
  half an hour of a stall, the office records a CPU profile of itself (in-process, nothing to attach, at
  most once an hour) until the next stall is caught, and notes it on the stall's incident: where the
  profile was saved, what ran in the longest block and who called it, and the top 10 functions. Admins can
  also record one by hand on the Test Mode page (**⏺ Record 60 s CPU profile**, under *This office's
  server*) and download it for Chrome DevTools or VS Code. Nothing runs until one is asked for.
- **A busy-office check in the performance guard**: six fake workers working like real ones (turns that
  end, real-sized output, long sessions with subagents behind them) while pages poll, and the check fails
  if the server blocks for more than 250 ms. A minute of it is part of `npm run test:perf:quick`, three
  minutes of `npm run test:perf`. On release 18 it fails (longest block 309 ms, 18 blocks over 100 ms in
  90 s); now the longest is about 100 ms.

### Fixed
- **The office no longer freezes for a second or more every few minutes.** Release 18 stalled for 1.6 to
  3.2 s at a time (incident INC-12) even with every agent idle. Two causes: the office's own background
  calls to Claude Haiku (sorting runs, project summaries, Jeff, the ranking's highlights, the task names)
  started the `claude` program on the server's main thread, and on Windows just starting it holds that
  thread for 0.65 s every time (several seconds right after a Claude Code update); and the run analyzer
  re-read every session's whole transcript and all its subagents' (tens of MB) each time it recorded a
  run, at every turn's end and every open PR's quarter-hourly look. Programs now start from a helper
  thread, the analyzer reads only what was added since its last look, a slice at a time, and the
  terminals' scrollback is saved one terminal at a time.
- **A computer that slept is no longer reported as a server stall.** A gap of a minute or more in which
  the office used almost no CPU (or the clock jumped ahead) is logged as the computer sleeping and opens
  no incident (the 155 s "stall" on INC-12 was the PC asleep).

## 2026-10-07 · release 18 (`d07eb59`)

### New
- **`npm run test:perf` and `npm run test:perf:quick`**: the performance guard from a terminal. The quick
  check (the main views on the big test office with a short soak, three project switches, then the
  end-to-end journey; about four minutes) is what to run, with `npm test`, before committing a change to
  the pages or the server. The Test Mode page has it as **Quick performance check**, and its **Unit
  tests** run `npm test` itself, every file included.
- **The performance guard on real data shapes**: `scripts/perf/real-shape.mjs` makes a scrubbed copy of a
  real office's data (free text replaced by filler of the same length, names, floor ids, the org and
  paths renamed, tokens replaced; the floors' repositories stood in for by small ones with the same
  number of files and the workers' worktrees made again), and `run.mjs --from <office>` runs a suite
  against it. On a copy of this office's two floors every view and project switch was within budget.

### Improved
- **Budget and the setup panel open at once**: the first look at Budget took close to a second and
  the setup panel 3.5 to 4.5 s on a big office. Both are now worked out in the background a few seconds
  after the office starts (and when a project opens), cost and budget files are written in the
  background instead of holding the server up, and a cached answer comes back at once while a fresh one
  is worked out behind it. First Budget look about 130 ms, then about 20 ms; setup about 2 ms.

### Changed
- **`npm test` runs cleanly on Windows**: every test file runs (the workers, repos and DSH tests used to
  hang for good there) and the suite exits 0 in about two minutes. `npm test` is now
  `scripts/test.mjs`: each file in a process of its own, a few at a time, with a time limit per test,
  per file and on the whole run, so a file that hangs is stopped and named instead of holding the suite
  up. `npm run test:one <file>` runs one file with node's own runner.

### Fixed
- **The 1D view's tabs no longer drop below where the Command Center has them.** On a desktop window
  every tab but the Command Center pushed its tab bar and content about 40 px down, leaving an empty
  band: only the Command Center put the Firm's banner (📑 Call an audit) on the floor's line next to the
  budget chip and run state. Every tab does now, and the "someone's waiting on another floor" line sits
  below the tabs instead of above them, so the tab bar stays put on all of them in every theme.
  `scripts/check-tab-alignment.mjs` checks it in a browser on a test office.
- **No more server stall while a project is made**: the office froze for 3 to 16 s right after the
  wizard's clone step, every time. Programs (gh, git, the wizard's commands, the usage check) now start
  from a thread of their own, the common git questions (branch, origin, HEAD) are read from the
  checkout's files, and hiring into a worktree runs git without blocking. The journey test now fails if
  the server's event loop is blocked for more than 250 ms while it makes a project (it was 4.5 s; now
  nothing over 100 ms). A test office lists its blocks at `GET /api/perf/stalls`.
- **Windows**: a worker's terminal no longer leaks a pipe and a thread after it ends, and a stopping
  office no longer waits five minutes on a worker's boot timer.
- **⏸ Pause project no longer waits three minutes on a quick handoff**: an agent whose handoff turn
  was shorter than the pause's two-second look was never seen at work, so the pause waited the full
  three minutes before putting it to sleep. Every turn is now counted as it starts, so a turn that came
  and went between two looks still counts.

## 2026-10-07 · release 17 (`089e759`)

### New
- **Test Mode page** (admins): ☰ › 🧪 Test mode, Home's 🧪 Tests link or ⚙️ Settings › 🧪 Testing open
  `/lite?tab=tests`. It says whether this office is in test mode and why, lists the suites (unit tests,
  page responsiveness, end-to-end journey, Command Center check) with their last run, and charts each
  view's longest task and time to usable against the budgets. ▶ Run starts a suite against a throwaway
  test office under `scratch\test-offices` (refused when that folder isn't a test one or overlaps the
  office's data or a floor, and one run at a time), with live progress and log, ■ Stop, a history of
  the last 50 runs, failure details with stacks and screenshots, and 🚨 Open incident. Risky actions ask
  for the password again through Phone access, as Restart safely does.
- **The performance guard** (`scripts/perf/`): a seeded big-data office (about ten times mx-spike, all
  synthetic, loaded through the office's own loaders in a test), a headless page test that opens every
  main view with six fake workers live and fails a view whose longest task passes 200 ms, that isn't
  usable within 3 s, whose memory grows over a 60 s soak, or (switching projects in the 1D and 2D views
  and from Home) that takes over 1.5 s to switch, and an end-to-end journey test (wizard offline, team
  hired, Discovery, an escalation answered from the Team phone, pause and resume, a PR and a
  deliverable, the budget, Restart safely, incidents) with fake agents and no spend. Budgets are named
  constants (`PERF_BUDGETS`). See the docs' *Performance budgets* page.
- **Live performance warnings**: a page that runs one task for longer than half a second, or a server
  whose event loop stalls for more than a second, opens an incident (*A page froze*, naming the view and
  the scripts that took the time; *The server stalled*), throttled and deduplicated like the other rules.
- **One run-state control beside the budget chip.** The Command Center's ▶ Resume project and ⏸ Pause
  project pair (and the same pair on the team pages) is one control on the floor's line, beside the
  budget chip, on every 1D tab and on the 2D view's bar: ▶ Running with a green dot (*Running: 2 agents
  working, 3 asleep*), ⏸ Paused (who, when, why, and who waits on you), or ⏳ amber with a progress bar
  while a pause or resume run is going. Admins click it to pause (the same confirm), to open the Resume
  preview, or to see the run going; everyone else sees the state. Its words are Home's card state.
- **Loading overlay when you change project.** The floor picker, a *waiting on* button, `?floor=` and a
  project opened from Home show *Loading project mx-spike… 57 %* over the dimmed page, the top bar still
  usable. The percentage is real: the floor, its workers, the team, the summary, the budget, the setup
  panel and the Coordinator's console coming in, then the page drawn. Changing again cancels it; ✕ or
  Esc hides it; it says it's still loading after 5 s and goes after 15 s. Each step is a
  `performance.mark` (`ao:floor:<step>`) and each load an `ao:floor-switch` measure, for the perf guard.
- **Mx Office's loading screen.** Home, the 1D and 2D views and the phone version show *Loading Mx
  Office… NN %* from their HTML before any code loads, through the code, the sign-in, the connection,
  the office's data and the first view, then fade. While the office is down or restarting it says *Mx
  Office is restarting… reconnecting* and carries on once it answers. Both screens follow the five
  themes (no emoji in Clean), respect reduced motion and are announced as a status.

### Fixed
- **The flat views stay smooth on a big, busy floor.** The Workers view could hang the page (it redrew
  everything for every worker update); the board, the Team phone, the phone page, the tab badges, the
  title and Needs you redrew or rewrote the page hundreds of times a second. Updates are now drawn at
  most a few times a second and only when something shown changed, long lists draw their first rows
  (Show more) and skip what's off screen, and the 2D view, Home's overview and the PM terminal draw
  their first frame several hundred milliseconds sooner.
- **The Audit log and the ranking no longer stall the server**: each page of the Audit log no longer
  re-hashes the whole log, and the ranking is reused for 10 s instead of worked out for every look.
- **Switching projects asks the office less**: one shared roster fetch instead of four, and the setup
  panel's git look shared instead of run three times.
- **Test mode now covers the office's own Claude calls** (Jeff, the analyzer, task names, the usage
  limits, The Firm): a test office no longer runs the real Claude Code for them.
- **⏸ Pause project held**: a paused project no longer woke up when a page connected to its floor.
- **Held messages survive Restart safely**: a message held just before the restart no longer goes
  missing (the roster is written before the office exits).
- **A rebuild no longer crashes the office**: a page file that vanishes mid-request is a 404.
- **Switching projects no longer sometimes waits 15 s on the loading overlay**: after a quick switch the
  new floor's budget could go unloaded (an ask dropped while a load was out, and each busy worker's usage
  message pushing the next load back again). A switch on the big test office now takes about a quarter of
  a second (p90 about half a second, over 20 switches).

## 2026-10-07 · release 16 (`f52988c`)

### New
- **Stable project ids and evidence contracts** (Knowledge & Evals step F1): every floor now has a
  project id (`prj_…`) in `floors.json`, given to existing floors on the first start and kept when a
  floor is taken off and added again under another name. Audit events can carry the domain ids
  (project, execution, task, agent instance, role). A new read-only `GET /api/evidence/trace?floor=&since=`
  shows a floor's audit log, chatter, analysis runs, budget rows and incidents as one normalized trace,
  with every id it can't know listed as unknown rather than blank, and costs it can't measure as
  unknown rather than 0. No UI yet.
- **Subagents have real names**: each Lead's subagent gets a person's first name the first time the
  office sees it (*Nia · Tester (Hedy's subagent)*), kept in the roster file and unique on the floor
  among Leads and subagents; a roster from before gets them the next time the office starts, the same
  names every time. The names show on the Workers tab, in the 2D view (*Nia (Hedy's tester)*) and the
  home Overview, on the Org chart and Team boards, in the activity, approvals, Team chatter and Team
  phone, and on the Budget tab. Each Lead's Playbook names its subagents (*Nia, your Tester*) so the
  Lead calls them by name; it still dispatches them by type, so `.claude/agents/<type>.md` is
  unchanged. The Project Manager can rename one from its detail or the Org chart (✏️ Rename, audited
  as `subagent.rename`).

### Fixed
- **Held messages survive a restart**: a prompt held until an agent's turn is over (an
  `office-workers tell`, a phone reply, a subagent decision) is kept in the roster file instead of
  memory, so restarting the office no longer loses it. It goes in once the agent is next between
  turns, merged into one message, never into a dialog, and still held by the spend cap and ⏸ Pause
  project (a person's words still go). The same message held twice goes in once, and one still
  waiting after 24 hours is let go with an Activity line and a `delivery.expired` audit event.
- **A queue task no longer reads *stopped* while its agent is still working after a restart.** An agent's
  terminal outlives an office restart, but the 📋 queue marked its task *stopped* before the office had picked
  that terminal back up, inviting a requeue and duplicate work. The task now shows *🔄 Reconciling after
  restart…*, keeps its slot (nobody else is seated for it), and once the workers are back carries on if its
  agent survived, or stops with the reason if it didn't (or wasn't back within 2 minutes). Audited as
  `queue.reconciled` / `queue.abandoned`; each seating has an `attemptId`, kept through such a restart, and
  `queue.json` is now written atomically.
- **The 1D Command Center no longer freezes the browser on a busy floor.** With the Project Coordinator
  live and the console on its 💬 Chat view (or its escalation cards showing), the console kept the
  Coordinator's terminal open in a hidden box, and every redraw there forced the page to lay itself out once
  for each character on the screen: seconds at a time on mx-spike, until Edge offered to kill the page. The
  terminal now only draws while it's on screen (hidden, it keeps taking in output for the Chat view's
  fallback but draws nothing), and the Chat view no longer redraws for other workers' changes.
  `scripts/check-command-center.mjs` checks a floor's Command Center stays responsive.

## 2026-10-07 · release 15 (`62fb3cb`)

### New
- **Team shapes: Solo, Startup and Enterprise**: a project's team is one Solo Lead (Sonnet, every
  subagent type) covering every team, a Chief Analyst and a Lead Developer (design and test as their
  subagents), or the Project Coordinator and four Leads as before. Each team is covered by its own
  Lead or by another member, and relays, standups, issues, subagents, skills (strictest gate wins),
  deliverables, team pages, the 2D view's signposts, the Firm's questions, ▶ Resume and the Command
  Center go to whoever covers the team. A team without a Project Coordinator now hears its relays
  instead of dropping them. The Team tab and the Command Center show a "Solo · Lean" chip, and a Solo
  or Startup team's org chart a coverage table (read-only for now).
- **The wizard recommends a team and a budget**: the Team & budget page comes after the intake and
  pre-selects a shape and level from the tier, entry mode and the answers to Q2, Q4, Q5 and Q7, with
  why. Three shape cards, each with a Lean / Balanced / Fast switch, its budget and working days;
  Customize picks the roles and every setting by hand. The team step sets the shape, then hires its
  roles. Client and Discovery moved to the page after it.

### Improved
- **/home** has one pause button instead of two: **⏸ Pause all projects** while any project is running,
  **▶ Resume all projects** once every one is paused, and with a mix a small **▶ Resume N paused** link beside it
  that resumes just the paused ones. While a pause or resume is going it shows its progress (*⏸ Pausing… 3 of 7*)
  and can't be clicked. Each project card has a state icon by its name: ⏸ paused (hover for who, when and why:
  a person, a safe restart or the budget), ▶ running (*2 agents working, 3 asleep*), and an amber ⏳ while it's
  pausing or resuming; the 2D Overview's banners show the same. Line icons in the Clean themes; admins only for
  the button, everyone sees the state, and it keeps up by itself.
- **⚙️ Settings** is a full page on the 1D view: every setting, sections down the left (You, Workers, Team,
  Jeff · Router, Notifications, Budget, Connections, Deliverables, Incidents, Studio, Appearance, Advanced),
  each with its own address (`/lite?tab=settings&section=workers`) for links. It has everything the 3D window
  had (default worker, worker limit, keep awake, restart safely, prompts, Slack / Discord and Teams, the map,
  holiday theme, sky, dog and workspace folder) plus the team settings, Jeff, early drafts, the budget's
  settings, the incident detection rules, Studio Pro and your color theme. Admin-only parts stay read-only or
  hidden as before; it wears all five themes. The 3D office keeps its own ⚙️ window, built from the same parts,
  with an *All settings ↗* link here. On a new office with no project yet, `/home` opens it in a window.

### Changed
- **The budget plan follows the team's shape**: a Solo or Startup project's stages cost a share of the
  Enterprise rates and say who does them. A small greenfield app is about $60 at Solo · Lean; a small
  requirements-driven one $270 at Startup · Balanced.
- Existing projects are Enterprise, with every team covering itself, and behave as before.

### Fixed
- **The Discovery issue names the agent that runs it**: on a Solo team it addresses the Solo Lead (who covers Analysis), not a Chief Analyst the team doesn't have.
- No settings link sends you to the 3D view any more. The ☰ menu's **⚙️ Settings** on the 1D view, the 2D view
  and `/home` opened the 3D office's Settings window; it now opens the full Settings page on the 1D view
  (`/lite?tab=settings`). So do Needs you's *Spend cap reached → Settings*, the team phone's *Raise cap*, a
  Teams card's Open for it, the budget's *Team settings* suggestions and the team's Autonomy chip, each at its
  section (`&section=team`), and the docs' "3D view → ☰ → ⚙️ Settings" steps.
- **The project team no longer loops on its own prompts** ("project team on travel-approval: Maximum call
  stack size exceeded"). Typing into an agent makes the office announce it again at once, and the team
  handled that echo while still sending: a Lead nudged about a flagged subagent was nudged over and over
  in one go until the stack ran out (held prompts and a Lead's notes could do the same). An agent's
  update that comes back while its last one is being handled now waits its turn, and a nudge is noted
  before it's typed, so each goes once. The console line now carries the first frames of the stack.

## 2026-10-06 · release 14 (`a208a15`)

### New
- **Risky desktop actions through Phone access ask for the password again**: on the 3D office, /lite,
  /pixel or /home opened through the phone tunnel, merging a PR, hiring, raising a team cap or a budget,
  approving a merge-order, security, data-loss or budget-overrun escalation, ▶ Resume / ⏸ Pause /
  🔁 Restart safely, changing Connections (credentials, the Teams webhook, Phone access), opening Studio
  Pro and resolving an incident need a sign-in from the last 10 minutes, like the phone version. A
  password window (✕ or Esc cancels) asks, then the action goes through. The office's own address never
  asks.
- **A sev1 incident sounds on the Team phone**: a desktop notification and its sound, held by Do not
  disturb like the phone's other red items.

### Changed
- **Test mode refuses every real agent CLI**: only the fake given with `--agent` starts, and not even
  that when it is a real CLI itself (`--agent codex` for Claude workers). A fake named `claude.cmd`
  still works when it lives in a test office's folder.
- **Test mode turns itself on only for test offices**: under `scratch/test-offices` or a folder named
  `test-office…` (plus `--test-mode` and `AGENT_OFFICE_TEST_MODE`). A plain `scratch` folder no longer
  does.
- **The incidents of 2026-10-06 go only to offices that ran that day**: their audit log has events from
  that day (UTC+8); one that only ran before or after it gets none. `AGENT_OFFICE_SEED_INCIDENTS` still
  overrides.

## 2026-10-06 · release 13 (`92d43b6`)

### New
- **⏸ Pause and ▶ Resume a project from the phone**: the Status tab's Pause runs Pause project (after a
  confirmation), and Resume… shows a short Resume preview (who has work waiting and why, the cost line,
  *Those with work* or *Everyone asleep*). Both need the fresh sign-in risky actions need. Each card
  shows the pause (*⏸ Paused by Pat · 2 waiting on you*) and a run's progress, and a safe restart in
  progress is a read-only line on top (*Restarting safely: waiting on 2*).
- **📱 Phone version** at `/m`: the team phone full screen as an app for your iPhone, with tabs for
  **Needs you** (Reply / Approve / Reject, Open terminal, Merge…, Raise cap…), **Projects** (each
  floor's channel), **DMs**, **Activity** and a compact **Status** per project (working / asleep /
  asking, escalations, spend against the cap, the toolkit stage; Pause / Resume waits for that
  feature). Agents' terminals are read-only there (their Chat view).
- **Risky actions from the phone are confirmed twice**: merging, hiring, raising a cap and approving a
  merge-order escalation need a second tap and the password again unless you signed in within the
  last 10 minutes. The office enforces it, and each phone action is `phone.*` in the audit log.
- **Installable, with push notifications**: a web app manifest, pixel icons and a service worker (the
  app opens even when the office can't be reached), *Add to Home Screen* steps for iPhone Safari, and
  Web Push for the red Needs-you items (iOS 16.4+ home-screen apps), with each phone's own Do not
  disturb and digest, never for a turn the office started. Tapping one opens `/m` on that item.
  The protocol (VAPID, RFC 8291 encryption) is the office's own; the key is kept in Connections.
- **📱 Phone access** in ⚙️ Settings → 🔌 Connections: a private tunnel to the office without
  Tailscale or a VPN. **Microsoft Dev Tunnels** (sign in with your Microsoft work account from the
  card, a persistent private tunnel, the same address every time) or **Cloudflare Tunnel with
  Cloudflare Access**; a quick trycloudflare.com tunnel only behind a big warning, for an hour. A QR
  code to scan, reconnects by itself, and is checked to be private (switched off if it isn't).
  The Teams cards' Open buttons follow its address.
- **The Teams webhook URL moved into 🔌 Connections** (a 💬 Microsoft Teams webhook card, DPAPI
  encrypted): an office that had it in `notify-teams.json` moves it once at its next start.
- **⏸ A paused project hires nobody new:** the task queue holds, the meeting room seats no meeting and
  hands out no parts, a desk takes no new agent, and the Team tab, an answered escalation and The Firm
  hire no member. Each says *Project paused: no new agents until it's resumed*. In the Team tab the
  Project Manager can still **Hire anyway** after a confirm (one hire, logged as `roster.hire-override`).
- **▶ Resume project** now counts a Lead's own team's open issues with nobody assigned as work waiting
  (never another team's), and folds the Project Coordinator's queued relays into its resume brief, so it
  gets one message instead of two.
- **🚨 Incidents**, a second sub-tab of the **🧾 Audit log** (on each project and on the home page): what
  went wrong or nearly did, each with a severity (sev1 to sev3, or near miss), a status (open, mitigated,
  resolved), its impact (spend, agents, data), a timeline, the root cause, corrective actions with links,
  and the audit events and workers it's about. Filters, counts, and a detail with everything on it. Admins
  open one by hand or from an audit row (**🚨 Create incident from this event**, **Link to incident…**), add
  notes, and resolve it with its root cause. Open sev1 and sev2 incidents show in **Needs you**, on the Team
  phone and in the Teams notifications. Every change is in the audit log (`incident.*`) and the incidents
  file is hash-chained like it.
- The office opens incidents by itself: a real agent launched in a test office, a spend spike, the spend
  cap reached, workers interrupted mid-turn by a stop, escalation answers not delivered after 30 minutes,
  worker crash loops, Studio mode holding writes again and again, failing workflows or gate-checks, worktree
  cleanup errors and repeated failed sign-ins. Each rule can be turned off and its thresholds changed under
  **⚙️ Detection rules**; a rule firing again counts into its open incident instead of opening another.
- The incidents of 2026-10-06 are recorded once, retrospectively, in an office that ran that day.
- **Test mode** (`--test-mode`, `AGENT_OFFICE_TEST_MODE=1`, and by itself when the office or a floor is under
  a `scratch` or `test-offices` folder): no real agent CLI starts, only the fake `--agent`; a refused start
  says why on the worker's card and opens a near-miss incident, and the top bar shows **TEST MODE**.
- **💰 Budget: what each project spent.** A new 💰 Budget tab on the 1D view shows a project's spend
  by stage, role, agent (subagents nested under the Lead that hired them), model, day and issue/PR,
  in dollars and a local currency (SGD by default, ECB rate fetched daily or set by hand). The top bar
  shows `$42 today · $252 / $600 · 42 %` next to the branch and `Office $110 today` at the far right.
  The office's own model calls (Jeff, the analyzer, task naming, the summary, the Firm) are now
  metered and booked on the floor they served. History from before the ledger started is filled in
  from the workers and `analysis/runs.jsonl`, marked as estimated.
- **💰 Budget: a plan, a forecast, alerts and auto-pause.** Each project gets an expected plan per
  toolkit stage (and per build module), priced from this office's history or default rates, editable
  line by line, or re-forecast from a Firm audit in one click. A chart compares expected and actual
  spend; the forecast at completion colours the top-bar chip. Alerts fire at 80 % (changeable per
  project and office-wide), at 100 % and when the forecast goes over budget, once each, through Needs
  you, the Teams cards and the audit log. At 100 % the project is paused with ⏸ Pause project (its line reads *⏸ Paused: budget reached*;
  people's messages still go through) until the budget is raised or someone resumes it from the
  Needs-you item, which opens the ▶ Resume project preview.
- **New project wizard: a Budget page.** Lean, Balanced or Fast, each with a preset budget from the
  plan estimate (travel-approval: $220 / $330 / $530), its time and what it changes (models, early
  drafts, autonomy by stage, and how many subagents a Lead runs at once, written into the Leads'
  Playbooks), or Manual. The team is hired on the level's choices;
  **Change level** on the Budget tab does the same for a running project from the next hire.
- **💰 Budget insights and an all-projects view.** The Budget tab names what drives the spend ("Opus
  Leads are 71 % of spend", the Lead Tester's review loop this week, the Coordinator's relays a day)
  and suggests savings, each linked to the action that does it: swap a Lead's model, delegate to its
  subagents, idle benching, Jeff's real-ask mode, early drafts off, with the worker ranking's token
  efficiency. A new 💰 Budget tab on the home page lists every project's spend against its budget,
  forecast, status and a 14-day sparkline, with the office's background calls and the Firm's audits.

### Improved
- **🧩 Subagents: runs only the transcript saw finish count.** A background run that only the Lead's transcript
  reports as finished (no hook does) is now a run of its subagent's record, unreviewed until the Lead's
  `office-workers subagent review`, which lands on that run rather than adding one. Grades still count only
  reviewed runs; cards and hover cards say *N unreviewed*. A late SubagentStop for the same run isn't counted again.
- **🧩 Subagents live about the 2D view.** Idle subagents no longer vanish: they take the same breaks benched
  Leads do (the lounge TV, the balcony, the kitchen's coffee, walking the aisle), still small and tagged
  *tester (Hedy's)*, with a speech bubble when two stand close; when a run starts they walk back to the stool
  behind their Lead, and away when it ends. Benched ones do the same with a 🪑 tag. The home Overview matches.
- **🧩 Never-run subagents are hidden.** The Workers tab shows only subagents that have run (or are at work for
  the first time, or are benched or on warning) unless **☐ Include never-run** is ticked next to Show
  subagents. The 2D view shows only subagents that have run at least once.

### Fixed
- A fake `--agent` (or `AGENT_OFFICE_AGENT`) now runs Claude Code workers whatever its file is called: only one
  named `claude` did, so test offices with a `fake-agent.cmd` started real Claude sessions.

### To know
- Resume, Pause and Restart safely are admin-only on every route, not just hidden for others; tests pin it.
- **The budget's spend ledger starts with estimated history.** The first time a project's Budget is
  opened, what it spent before is filled in from its workers and `analysis/runs.jsonl`, spread over the
  days and marked as estimated; everything after is booked as it happens. The office's own model calls
  now count in the office's total spend too, so it reads a little higher than before.

## 2026-10-06 · release 12 (`18ff64d`)

### New
- **▶ Resume project** (Command Center heading and team pages; **▶ Resume all projects** on Home): a
  preview first, listing every asleep or benched agent with the work waiting for it and why (answers owed,
  held prompts, queued relays and notes, cut off mid-turn, failing PR checks, an assigned issue, an
  unhanded standup page) plus safety checks (the spend cap blocks, Studio mode warns, a missing worktree or
  lost session re-hires from the handoff note, a merged branch offers Send home, behind or uncommitted is
  noted). Wakes those with work by default, the Coordinator first and then the most blocking Leads, 2 at a
  time 45 s apart (team settings), each with a short brief as your turn. Runs as a checkpointed workflow
  that carries on after a restart; audited as `resume.started` / `agent.woken` / `agent.skipped` /
  `resume.finished`.
- **⏸ Pause project** (and **⏸ Pause all projects**): agents finish their turn (never interrupted, nothing
  typed into a question), write a handoff note and sleep with their session kept; the office's own prompts
  to the floor (nudges, standups, relays, review nudges, Firm interviews) are held until it's resumed, while
  what a person sends still goes through. Shown as *⏸ Paused by … at … · N waiting on you*.
- **🔁 Restart safely** (**⚙️ Settings → Workers**, or `POST /api/office/restart`): pauses every project,
  waits until no agent is mid-turn (timeout: keep waiting, restart anyway, or cancel), optionally builds new
  commits first, then exits with code 75 for a looping launcher; the next start resumes exactly the floors
  it paused.
- **🧩 Subagents as workers.** A Lead's subagents now show as workers of their own. On the **👷 Workers**
  tab each gets a card right after its Lead's (*🧩 tester · hired by Hedy (Lead Tester)*): working on what and
  for how long, idle since its last run, or benched; its model, runs and A–F grade. Click it for its recent
  runs, the Lead's verdicts, Warn/Bench/Model/Reinstate (Project Manager) and a link to the Lead's terminal.
  **☑ Show subagents** hides them. In the **2D view** (and the home page's 2D Overview) a subagent at work
  sits on a stool behind its Lead's chair, tagged *tester (Hedy's)*; benched ones take breaks with benched Leads.
- The office follows each run live from the hooks (the Agent call going out and coming back, SubagentStart /
  SubagentStop) and, every 10 seconds, from the Lead's transcript, which is the only place a background
  run says it's finished. A floor's last 50 runs are kept in its roster file.
### Fixed
- A subagent run in the background (newer Claude Code's default) no longer counts twice in its track record:
  its launch made a run of its own besides the one its SubagentStop records. The SubagentStop's run now
  carries the task.
- **The Command Center no longer scrolls outside its parts**: on a desktop window it's a fixed-height
  layout with no page scroll and no column scrollbars (the project details on the left and the console in
  the middle used to scroll as a whole, sometimes twice). Each card scrolls inside its own frame with a
  thin scrollbar in the theme's colors; the console's chat or terminal fills the middle and is the only
  thing there that scrolls, with the escalation cards behind a one-line bar that swaps them in. The tabs
  are a little smaller, Needs you and the folded setup line share a row, and on a short window the setup
  panel starts folded. The short page scroll at 1280×720 is gone; phones still scroll the stacked page.
- **The Team phone's button shows its messages icon in the Clean themes**: Clean gave every button its
  ink colour, so the icon was drawn in the button's own colour and vanished. It's now its own colour (a
  white icon on an accent-blue disc in Clean (Light) and Clean (Dark)), and checked in all five themes.

### To know
- The launcher needs the restart loop (`AGENT_OFFICE_LAUNCHER_LOOP=1` and `do { … } while ($code -eq 75)`,
  in Running the office → Releasing and restarting safely); without it, Restart safely only pauses, waits
  and exits. The pauses live in `<office data>/project-run.json`, so they survive a restart.

## 2026-10-06 · release 11 (`a52ebae`)

### New
- **📱 Team phone**: a button at the bottom right of the 1D and 2D views, above the Issues / PRs /
  Queue / New task bar (a pixel-art iPhone in the Default theme, a round messages button in the
  others), with a red count of what needs you or a grey dot for unread messages. It opens a chat like
  Slack's: **Needs you** pinned on top, **All projects**, a channel per floor with its team chatter
  (escalations and conversations as threads with reply counts, the old filters as chips, *working…*
  while an agent is mid-turn), and DMs with the floor's agents.
- **Message the team from the phone**: a plain message goes to the floor's Project Coordinator (the
  Chief Analyst or another Lead when there's none, and it says so), `@Name` to that agent with
  @-autocomplete, `@team` to every active Lead after a *This wakes N agents (≈N turns)* warning, a DM
  to its agent, a reply in an escalation's thread answers the escalation. It goes through the same
  delivery as the office's own prompts (held until the turn is over, never typed into a dialog, as
  your turn, through a reached spend cap), is kept in the chatter as yours, and the agent's reply is
  read off its transcript into the same thread (*replied in its terminal → Open* without one).
- **Notifications in the phone**: every Needs-you item arrives as a message from Jeff (escalations,
  with his priority) or the office, with **Reply / Approve / Reject**, **Open terminal**, **Merge…**,
  **Review** or **Raise cap**; answering there resolves it everywhere. Desktop alerts and a short sound
  only for those, with **Do not disturb** (until off, 1 hour, until 9:00 tomorrow) and a **Digest**
  (every 15, 30 or 60 minutes) in the phone's settings. What you've read is kept per person by the office.

### Improved
- **The Command Center fits a laptop screen**: Needs you is one row of counts that opens the phone,
  the setup panel folds to one line once its gates are fine (Show / Hide, remembered), the summary's
  columns take the window's height with the console the widest and each scrolling on its own, its
  sections fold (remembered), and Recent activity shows the newest 8 with **More**.
- **💬 Team chatter moved into the team phone**: it's off the Command Center, and each team page
  has **Open in the team phone →** filtered to that team instead of its short thread. The chatter's
  data and `GET /api/chatter` are unchanged.

## 2026-10-06 · release 10 (`3db2145`)

### New
- **📣 Microsoft Teams notifications.** Add the *Post to a channel when a webhook request is received*
  workflow to a Teams channel, paste its URL in **⚙️ Settings → Notifications → Microsoft Teams** (admins;
  masked once saved) and press **Send a test card**. The office posts an Adaptive Card when something needs
  a person, by the same rules as the Command Center's Needs you (now in `src/shared/needsyou.ts`, shared by
  the browser and the server): an agent asking in its terminal, an escalation, the spend cap, failing PR
  checks, a Firm report, a gate to sign off, Studio Pro changes to commit. Each card has the project, who,
  a line, urgency, age, Jeff's rank and an Open button (when a public office address is set). One card per
  item, never again after a restart; items within a minute share a card; quiet hours and a pause hold them
  for one catch-up card. Optionally a daily digest per floor after its standup. Pick the floors that post.
- **☕ Keep awake while agents work** (on by default, **⚙️ Settings → Workers**): while any worker is
  working, or a queued task, a Firm audit or a gate-check runs, the office asks Windows not to sleep (a
  hidden PowerShell helper, no new dependency; the screen may still turn off), and lets go after 10 idle
  minutes. Settings says what it's doing and how to set *When I close the lid* to *Do nothing* so work
  carries on with the lid closed.

### To know
- Teams posts are logged as `notify.teams.sent` / `notify.teams.failed` in the audit log, never with the
  URL. The URL sits in `.agent-office/notify-teams.json` (mode 0600) until Settings → Connections stores
  it encrypted. Failed posts are retried with backoff and never hold the office up.
- Keep-awake stops idle sleep only; closing the lid still sleeps the laptop unless Windows' lid setting is
  *Do nothing* when plugged in. The office never changes power settings itself.

## 2026-10-06 · release 9 (`4b1eb83`)

### Improved
- **Folders follow the new workspace layout**: with nothing picked in Settings → Connections → Folders and no
  environment variable, the office looks for the toolkit at `agent-spike/mendix-toolkit` and mxcli at
  `agent-spike/tools/mxcli`, then at their old places (`mxcli-project-toolkit`, `bin`), so it works before and
  after the folders are reorganised.

## 2026-10-06 · release 8 (`17ebd7f`)

### New
- **🔌 Connections**: the office's credentials in one admin page (☰ → 🔌 Connections, ⚙️ Settings,
  the home page, or the wizard when the admin token is missing): the GitHub token for agents, the
  GitHub admin token, the Mendix personal access token, the Jev key and the office password. Each has
  a status (connected, missing, invalid, expiring), 🧪 Test (for GitHub: who it is, its expiry, the
  repositories it sees and whether it reaches every project), replace and remove, and how to make one
  with the exact permissions and a pre-filled GitHub link. Saved values are encrypted with Windows DPAPI
  in `credentials.json` in the office's data folder and never shown again; the audit log records who
  changed which, never a value. The office uses Connections first, then the environment variable, then
  the old dot-file, so `start-office.ps1` keeps working; **📥 Import from files** moves the dot-files in
  with one click. The wizard's admin-token box now saves straight into Connections.
- **Mendix token, per project**: kept in Connections for the wizard (Mendix Projects API, coming next);
  a project's agents get `MENDIX_TOKEN` / `MX_PAT` only when you tick it for that project, off by default.
- **git & gh check** in Connections: git and gh installed, gh signing in with the agents' token (in a
  throwaway config, your own gh login untouched), git's commit identity, and a one-click commit
  identity for the workers when git has none.
- **Folders in Connections**: the projects folder and the mxcli-project-toolkit folder (checked for
  `bin/init-project.sh`), used by the wizard and the Playbooks without a restart.
- **Worktrees stay in the project**: a hook on every Claude worker refuses `git worktree add` outside
  the floor's `.agent-office/worktrees/` and gives the exact path to use, so no more worktrees in Temp
  or next to the project.
- **Worktree cleanup**: every hour, worktrees under `.agent-office/worktrees/` that no worker has,
  whose branch is merged (squash merges too) and that hold no changes are removed with their branch,
  each in the audit log; links inside them (node_modules junctions) are unlinked, never followed.
  Worktrees elsewhere are only reported. On by default; switch it off in Connections.

### Improved
- **📦 Deliverables reads "main" from GitHub.** *On main* now means on the project's default branch
  (`origin/main`), read the same way and with the same 90-second fetch as the setup panel, not whatever
  branch the floor's folder is on; the panel says so at the top when the folder is on another branch or
  behind. A project with no remote still uses its folder.
- **Mermaid diagrams render in the Deliverables viewer**: a Markdown file's ```mermaid blocks (a
  domain model, a process flow, the blueprint) are drawn, light or dark to match your theme, with the
  source folded under each; a block Mermaid can't parse stays as source with the reason.
- **Each team has its own reports.** The analysts' toolkit reports stay where they are
  (`reports/validation-report.md`, now an expected Stage 2 item, plus `summary.md` and `gaps-report.md`);
  the other teams' go in `reports/design/`, `reports/development/`, `reports/testing/` and
  `reports/management/`, and the Playbooks say so. A stray report straight under `reports/` shows as
  **Unsorted reports** on the Management page instead of under Testing.

### To know
- mermaid and playwright-core are now runtime dependencies of the office (pinned to 11.17.2 and
  1.63.0). export-pdf and screenshot answer 501 only when Chromium isn't downloaded on the machine.
  They stay commands, with no MCP tools, so their schemas don't cost every agent context on every turn.

## 2026-10-06 · release 7 (`a603397`)

### New
- **📦 Deliverables**: every team page starts with a checklist of what that team owes at each toolkit
  stage (triage, source ledger, knowledge base, BRDs and the BRD report; brand, ds.css, design system,
  wireframes, storyboard; blueprint, domain model, ADRs, fit-gap, build plan, module briefs; test plan,
  journeys, UI reviews, evidence; standups), each **On main**, **On a branch** (not merged, with the
  branch and who), **Draft** or **Missing**, plus what the team made beyond the list. The office looks
  in the floor's checkout, in each hired Lead's worktree (uncommitted work too) and on every `office/*`
  branch, so work like travel-approval's Stage 1–2 reports on unmerged branches finally shows. Click a
  file to read it: HTML reports in a sandboxed frame (no network, no origin), Markdown, pictures, PDFs,
  a CSV's first rows, JSON. The setup panel shows the counts per stage with **Open deliverables →**.
- **office-workers export-pdf** and **office-workers screenshot**: a Lead turns an HTML file of its
  worktree into a PDF or a PNG with the office's own headless Chromium (no network, files inside its
  worktree only), for a BRD PDF or a storyboard of wireframes, with nothing installed in the project.
- **Early drafts** (⚙️ Settings → Deliverables, on by default): while the Chief Analyst is on Stages
  0–2, the Lead Designer makes low-fi wireframes, the Lead Developer a draft domain model and
  architecture sketch, and the Lead Tester a test-plan outline, all marked as drafts, small, and revised
  once the BRDs are confirmed. Turn it off and they wait for their stage.

### Improved
- Every Lead's Playbook now has a **Your deliverables** section: the exact files it hands over per
  stage (for the Chief Analyst also `docs/requirements/BRD-<feature>.pdf`, `use-cases.xlsx` and a
  Mermaid `process-flow.md`; for the Lead Designer a storyboard; for the Lead Developer
  `architecture/domain-model.md` and ADRs; for the Lead Tester `tests/test-plan.md`), how to make them
  on the office machine (`py` with openpyxl and matplotlib, Mermaid, the new render commands), and to
  keep them on a branch with a pull request so they merge.
- The Design team page's 🖼️ Design artifacts panel is replaced by 📦 Deliverables, which covers it.

### Fixed
- **The setup panel no longer trusts a stale floor folder.** It reads `PROJECT.md`, `intake.md`,
  `triage.md` and the gate dashboard from the project's default branch on GitHub (`origin/main`), after
  a quiet fetch at most every 90 seconds, instead of whatever branch the floor's folder is on
  (travel-approval's folder sat on an old branch, 23 commits behind, and showed Stage 0 failing long
  after main had it signed off). When `origin/main` moves, the office re-runs the toolkit's gate-check
  on it in a temporary worktree it deletes afterwards (at most every three minutes per floor), so the
  verdicts follow merges; 🔄 Re-check gates does the same now. The panel says when the folder is on
  another branch or behind, and more than 10 commits behind adds a 🌿 item to Needs you.

### To know
- Branch work shows as *not merged*: only what lands on main counts, so Leads still need their PRs
  merged. The scan is read-only and never touches a branch or worktree.
- Mermaid diagrams in Markdown show as their source in the viewer (the page has no diagram renderer);
  an HTML report that loads Mermaid from a CDN (the toolkit's `blueprint.html`) gets the office's own copy.
- Excel workbooks are offered as a download, not previewed (the office has no xlsx parser).
- The render commands need playwright-core and its Chromium on the office machine (this office has
  both); without them they say so. A project with no remote keeps the old setup-panel behaviour.

## 2026-10-06 · release 6 (`c1c4a1e`)

### New
- **Chat view on the Command Center**: the Project Coordinator console in the middle of the Command
  Center has **Chat | Terminal** on its header. Chat (the default) shows the conversation as messages:
  your prompts, its replies in Markdown with its icon, each tool call as one line (*Ran mxcli check*,
  *Edited 3 files*), and a highlighted **Open terminal to answer** card for a question or a permission
  (answered in its terminal, never from the chat). Terminal is the live terminal as before. The office
  reads it off the Coordinator's Claude Code transcript and never sends what a tool printed or read;
  another agent (Codex, OpenCode…) shows its terminal's text instead. Which view it opens in is kept
  per browser: **Command Center terminal** in the ⚙️ Settings tab (*Your view*) or the 3D office's
  ⚙️ Settings › You.
- **Autonomy by pipeline stage**: a new team setting (⚙️ Settings → Autonomy → *By pipeline stage*,
  off by default) lets a toolkit project's stage pick its level: 2 Guided while it analyses,
  specifies and designs, 3 Delegated once the build plan's gate (Stage 4) has passed (both levels
  yours to pick). The office changes the level exactly as if you had: Playbooks rewritten, the Leads
  at work told, the cap for the new level, a line in the recent activity and the Audit log. While it's
  on, the Team tab's chip reads *Autonomy 2 · by stage* and the level buttons only show the level.

### Improved
- **Quieter finished turns**: a turn the office started itself (the team's relays and notes, review
  nudges, standup questions, waking a Lead with something for it) now finishes without a ✅ Review in
  Needs you, a ding or a desktop notification, and so does a team member's routine turn at autonomy 3
  and up (its card still shows it done; anything that needs you comes as an escalation). A question or
  a permission prompt still flags as before, and so does any turn you start.
- **Relays ask for no reply**: the Project Coordinator's relays (new escalations, your proposal
  decisions, the Leads' subagent decisions) and the Leads' notes say *no reply needed* instead of
  asking for `noted`, so each one no longer costs a turn that nobody reads.
- **Your decisions reach the Lead that proposed**: approving, rejecting or asking for changes to a
  standup proposal now tells the proposing Lead too, in one short note a minute after your last
  decision, between its turns. A subagent request you decide while its Lead is asleep or busy asking
  someone is kept for it rather than lost.
- **Restarts wake only who was mid-turn**: after a restart the office resumes just the agents it cut
  off in the middle of a turn; everyone who was at rest, finished or asleep stays asleep (session kept)
  until someone, or the office, prompts them, or you press R. Walking onto a floor no longer wakes
  them either. The turn it carries on is told its escalations are still open, by title, instead of
  "ask again", which brought a fresh round of the same escalations after every restart.
- **The review loop is bounded**: the office counts a subagent's revision rounds from its Lead's
  `subagent review` verdicts. One rework past the autonomy level's allowance (2 rounds at levels 1–2,
  3 at 3–4) raises one `revisions-exhausted` escalation for the Lead (an FYI at levels 3–4), tells the
  Lead not to send it back again, and stops the review nudge for that subagent until you answer or the
  work is accepted.
- **The review nudge stops when it isn't heeded**: after 3 nudges in a row with no review verdict
  from the Lead and no one else prompting it, the office stops nudging (one *Stopped nudging …* line in
  the Activity) until the Lead records a verdict.
- **`office-workers tell` can't ping-pong**: at most 5 tells from one agent to the same agent in 10
  minutes; past that it's refused with a word to use the team journal or escalate instead. A tell to an
  agent with a question open in its terminal is held and goes in when its turn is over.
- **Reworded duplicate escalations join the open one**: when a new escalation's title matches no open
  one, Jeff is asked whether it's the same ask in other words (mx-spike raised nine escalations about
  two CI secrets, each worded differently). Only a pick he's at least 85% sure of joins it as a +1;
  otherwise, or if he doesn't answer within 10 seconds, it's raised as its own.

### Fixed
- **Relays survive a restart**: what the office still had to tell the Project Coordinator (new
  escalations, your proposal decisions, subagent news) and the Leads is now kept in the floor's roster
  file instead of memory, so a restart, or a Coordinator that's asleep or benched for a while, no
  longer loses it. They wait there while the daily cost cap holds and go out once it lifts. A
  Coordinator left asleep (after a restart, say) is woken with everything it's owed in one message, at
  most once a minute. A floor with no Coordinator skips its relays (each Lead hears its own decisions).
  The turn that acts on your answer to an escalation is yours, not the office's: it still flags when
  it's done.
- **Go home once merged leaves the team alone**: a Lead whose pull request merged is no longer sent
  home without a handoff note; the project team goes through its own bench and handoff, and
  `office-workers home --merged` lists it as skipped (*on the project team*).
- **Answers no longer typed into a permission dialog**: an answer to an escalation went into the
  agent's terminal even while it had a permission prompt or a question open, where the Enter after it
  picked one of the dialog's options: the answer was lost but shown as delivered. Now nothing the office
  types (your answers, a +1's answer, a Lead told about your subagent decision, relays to the Project
  Coordinator, The Firm's questions, one agent's `office-workers tell` to another) goes in while a
  dialog may be up (*needs input*, or still starting). Your answer waits and goes in once that turn is
  over, with any others it's owed, in one message, and counts as delivered only then. The Activity
  says *… has a question open in its terminal: the answer goes in once that's answered*.
- **The daily cost cap holds the office's own prompts, not only new hires**: once a floor's cap is
  spent the office no longer sends review nudges, a scheduled standup's questions, relays to the
  Coordinator, autonomy and skill change notes, The Firm's interview questions or wakes, and one agent
  can't `tell` another. Needs you and Approvals say **💸 Spend cap reached: office prompts paused;
  agents finish their current turn**. What you send (your answers, your typing, a standup you call, a
  wake from the Team tab) still goes through, and no running turn is stopped.

### To know
- The same-ask check follows Jeff's **Waiting on you** setting: it runs in Shadow too (it only joins,
  never raises), and not when that's Off. It's at most 30 questions an hour per floor.
- `office-workers escalate` now waits up to 30 seconds for the office (was 15), for Jeff's answer.
- Held prompts live in memory: a tell held for an agent is lost if the office restarts before its turn
  ends. Escalation answers aren't: an undelivered one is still owed after a restart.

## 2026-10-06 · release 5 (`1cff8c8`)

### New
- **Open in Studio Pro**: a button in a Mendix project's Command Center heading (and ☰ → 🧱 Open in
  Studio Pro) opens the floor's `.mpr` in Studio Pro on the office's computer, in the version the
  project was saved in (through Mendix's Version Selector). Admins only, after a confirm that warns
  that no agent may run `mxcli exec` while Studio Pro has the project open and lists the agents busy on
  the floor. Each open is in the Audit log (`studio.open`) and in Team chatter. It only works when the
  office runs on a Windows desktop with Studio Pro installed; otherwise the button is greyed out and
  says why.
- **Studio mode**: the office now sees for itself when Studio Pro has a floor's project open (its
  `studiopro.exe` naming the `.mpr`, or the `.mpr.lock`'s process still running), however it was
  opened, and pauses that floor's agents' mxcli writes until it closes: a PreToolUse hook on every
  Claude worker denies `mxcli exec`, `fix`, `layout`, `rename`, a writing `mxcli -c`, the toolkit's
  `bin/exec.sh` and the like, and tells the agent to route the write through Studio Pro's MCP server
  (`mxcli --mcp http://localhost:7782/mcp`, on 11.10 and up) or work on something else. Reads still
  run. The Command Center shows **Studio Pro open · mxcli paused** while it
  is, and the button says **Studio Pro is open**. Opening and closing are in Team
  chatter and the Audit log (`studio.opened`, `studio.closed`, `studio.stale-lock`, and each held
  write as `studio.denied`). Closing it with model changes uncommitted puts *Commit your Studio Pro
  changes so the agents build on them* in Needs you. Workers already running get the hook when
  they're next started or resumed; agents other than Claude Code aren't held.

### Improved
- **New project wizard creates the Mendix app**: a new project gets a blank app from Studio Pro's own
  `mx create-project` (`travel-approval` → `TravelApproval.mpr`, at the repository's root where the
  toolkit looks for it), before the toolkit's init so the scaffold names it, and committed with the
  scaffold in one commit. Mendix's generated files (`deployment/`, `.mendix-cache/`, `theme-cache/`,
  `*.mpr.lock` …) go into `.gitignore`. Falls back to `mxcli new` when that Studio Pro has no `mx`. The
  live app no longer stops at "No Mendix project (.mpr)" on a fresh project.
- **New project wizard hires the team**: the Project Coordinator and the Leads you tick are hired on
  the new floor at the end of the setup (the Team tab's hire, each on its role's model), so they're at
  their desks when you arrive. A Retry never hires anyone twice. With the Chief Analyst on the team,
  the Discovery issue is its first task instead of going to a worker off the queue.
- **Studio Pro 11.12.4 by default**: the wizard picks the newest 11.12 installed (11.6.4 when there is
  none); the dropdown still lists every version. For an existing app that's already a floor, it picks
  the version the app was last saved with.
- **Interview mode in the toolkit's words**: Steering (default), Assist or Auto, the modes the toolkit's
  `interview-mode.sh` reads from `PROJECT.md`. The wizard used to write "attended"/"unattended", which
  the toolkit didn't recognise and quietly treated as steering.
- **Each project builds with its own Studio Pro**: agents, queue workers, 🔄 Re-check gates, the
  wizard's toolkit runs and the live app get the floor's `.claude/toolkit.env` (`MXBUILD_PATH` and the
  rest) over the office's environment. An office started with `MXBUILD_PATH` for 10.24 no longer makes
  an 11.12.4 project's agents build with 10.24's mxbuild (the toolkit lets the environment win over
  `toolkit.env`). A floor without `toolkit.env` is unchanged.
- **Edit answers hires roles ticked since**: editing a project's answers later also hires the roles
  newly ticked, and only those: never one the floor already has, at work, benched or sent home on
  purpose. Unticking a role sends no one home.
- **Chief Analyst on the Discovery model**: handed the Discovery issue, the Chief Analyst is hired on
  the model picked in the wizard (Opus by default), now shown as "Chief Analyst's model for Discovery".
  Its role's model on the Team tab stays for later hires.

- **New project wizard survives restarts and flaky steps**: the setup now runs on the office's new
  workflow engine. It's saved after every step, so an office restart halfway loses nothing: the step
  it was on shows as failed and 🔁 Retry carries on from there. Creating the repository, cloning,
  creating the app, pushing and opening the Discovery issue try again by themselves (up to three tries,
  waiting a few seconds longer each time) when the connection drops or GitHub is busy; the log says
  *↻ … trying again in 3s*. Otherwise the wizard looks and works as before.

### Fixed
- **No more false "needs input" at boot**: a Claude worker in a project with a slow SessionStart hook
  (a toolkit project's `mxcli init --sync-skills` and `mxcli run --setup`) shows as starting until its
  session is up, instead of jumping to 🙋 *Waiting on a setup prompt* after 12 seconds. It's flagged
  only when the trust or login screen is actually on its terminal. Once its session is up, the
  *Waiting on a setup prompt* line goes from its card (idle workers used to keep it for good).
- **Jeff escalates only real asks**: with *Waiting on you* On, Jeff raises an escalation only when the
  end of the agent's message really asks you something (a question to you, a request or approval, an
  `AWAITING-PM:` line). Progress reports he thinks are waiting ("Still running: …", "I also told
  Keith …", "Merging that branch will need your approval when I open its PR") are logged as
  disagreements, marked *held* on the Analysis tab, and not raised. He no longer raises what the agent
  already raised (open, or answered in the last 6 hours).
- **Duplicate escalations merge**: an agent escalating what's already open on the floor (nearly the
  same title) adds a **+1 from** *name* with its details to the open one instead of opening another,
  and hears your answer too.
- **Haiku workers stop asking for every edit**: Claude Code's auto mode isn't available for Haiku, so
  Haiku workers start in *accept edits* mode: file edits in their worktree don't ask. The hire window
  and the Team tab's model picker say so.

### To know
- Workflows (Docs → Automation → Workflows): runs are kept in the office's data folder under
  `flows/<workflow>/`, each run's start, finish, failure and pause is in the Audit log (`flow.*`, by
  Workflows), and `GET /api/flows` lists them. Setups saved before this are taken in on first use; their
  old file in `wizard/` is kept as `<id>.json.migrated`.
- Setups saved with "attended"/"unattended" read as Steering/Auto. Creating the app takes about 15
  seconds with `mx`; `mxcli new` takes longer (it downloads MxBuild first).
- Jeff's old behaviour is still there: Settings → Jeff · Router → **When to escalate** → *His say-so*.
- Haiku's shell commands (`git`, `gh`, builds) still follow the project's permission settings and may
  still ask. A `--permission-mode` or `--dangerously-skip-permissions` in `--agent-args` overrides the
  accept edits mode. Other agents (Codex, Grok, Muse, Pi), which can't be read off the screen, are
  still flagged when they haven't said they're up 12 seconds in.

## 2026-10-05 · release 4 (`6639313`)

### New
- **🎨 Clean (Light) and Clean (Dark)** themes: plain and quiet like VS Code's classic light and dark
  themes. Neutral greys, a blue accent, a sans-serif font with a strict type scale and no heavy weights,
  small corners and 1px borders, flat buttons and tabs, and no emoji anywhere (line icons on buttons
  that were only an emoji). The 🎨 button now opens a list of all five themes.
- **📚 Documentation at `/docs`**: the whole office explained, in the office's themes: a sidebar of
  sections (Get Started, Concepts, Using the Office, Teams & Agents, Automation, Integrations,
  Administration, Reference, Troubleshooting, FAQ), search as you type, "On this page", deep links,
  and these release notes. ☰ → 📖 Documentation, or 📚 Docs on Home. Same sign-in as the office. The
  pages are Markdown in `docs/site/`; this file is the Release notes page, so there is one copy.
- **🏛️ The Firm** (`/firm`): independent Reviewer Agents on Fable 5.1. An Engagement Partner plus a
  reviewer attached to each project team (Design, Code & Architecture, QA & Test, Requirements &
  Delivery; Security and Cost & Performance optional). Call an audit from a project's Command Center
  or from `/firm`: scope, test types, artifacts, depth, model per reviewer, budget cap, with a cost
  estimate. Reviewers work in an isolated clone at a pinned commit, without the team's instructions or
  GitHub write access, and interview the Leads (`office-workers firm ask` / `firm answer`). The report:
  executive summary, app statistics, findings register, pros and cons, root causes, re-forecast
  timeline, expectations vs reality, worker performance with "slacking?" flags, risks and
  recommendations. Budget warnings at 80 %, wrap-up at 100 %.
- **🧾 Audit log**: a tab on each project and on Home. Who did what and when (people, agents, the
  office, Jeff, reviewers), with filters, a histogram, expandable before/after details, CSV/JSONL
  export, and a hash chain that shows "Chain verified" or where it was edited. Prompt text is not
  logged unless an admin turns it on.
- **🧑‍⚖️ Jeff sorts your escalations**: open escalations are ranked by how blocking and risky they are
  (older blockers rise) and listed in that order in Escalations to you, Approvals and Needs you, with
  "#1 · resolve first" chips. A critical or urgent one he hasn't rated yet stays on top. Setting:
  Settings → Jeff · Router → Priority.
- **💬 Team chatter**: a chat thread on each project's Command Center, beside Recent activity, showing
  what the agents say to each other as it happens: escalations and your answers, the office's relays
  to the Project Coordinator, standups, review nudges, subagent tasks and their reviews, handoff
  notes, PRs handed over, team journal entries (a line naming a teammate is shown as said to them)
  and The Firm's interview questions and answers. Each message shows who said it, to whom, and opens
  what it's about. Filter by All, Between agents, With me, or one person; new messages slide in on
  top without moving your scroll. Each team's page has a short version. Nothing is made up: only
  what was really said or written.

### Improved
- **New project wizard**: client, operator and role settings are committed with the project
  (`agent-office.project.json`), not kept only on this machine. **Re-check gates** is admins-only,
  with an explanation of what it does.

### To know
- Test a real audit first with a quick depth, 2 reviewers and a small cap (e.g. $10): Fable is
  priced at $10 / $50 per million input / output tokens.

## 2026-10-05 · release 3 (`b740e6f`)

### New
- **🧰 Agent skills**: a Skills panel on every Org chart card, in three groups (Manage up, Manage
  down, Craft), each skill with a switch and a gate (Ask / Propose / Tell / FYI). Gates follow the
  project's autonomy level unless you override them per agent. The office enforces them.
- **Subagent track record and benching**: Leads record a verdict on each subagent run
  (`office-workers subagent review`); each subagent gets an A–F grade per model. Leads (within their
  gates) or you can warn, bench, swap the model of, or reinstate a subagent. Benched subagents are
  removed from the Lead's toolbox and denied in its settings; they come back after a cool-down
  (24 h by default, Settings → Subagents).
- **Escalation cards show who raised them**: the agent's 2D character, big, with a casual speech
  bubble saying what it needs; the details sit underneath.

### Improved
- **Rankings**: a Lead's Review turnaround and Review quality now come from its subagent reviews.

## 2026-10-05 · release 2 (`86e3955`)

### New
- **🏅 Worker rankings** on the Workers tab: an A–F grade for every agent from four standard criteria
  (model benchmark, delivery, autonomy, token efficiency) plus specialist duties for the Project
  Coordinator and each Lead, with evidence, confidence and highlights. Leaderboard, This floor / All
  floors, grouped by model or role. Agents that went home stay listed.
- **🗺️ 2D Overview** on Home: every project's office side by side, live, with zoom and pan like the
  2D view; click a floor's banner to open it.
- **Benched Leads take breaks** in the 2D view and the Overview: TV in the lounge, a smoke on the new
  balcony, coffee at the kitchen.
- **☰ is the last item on every top bar**, Home included.

### Improved
- **Workers tab** uses the full page width, cards in a grid.
- **Waiting on another floor**: the jump lands on that floor's Command Center; Needs you lists agents
  that finished a turn you haven't looked at (Review →), and their worker card says so.
- **Answer →** in Needs you lands on the escalation in one step and the card pulses.

## 2026-10-05 · release 1 (`70a37c3`)

### New
- **Needs you** strip at the top of the Command Center: everything blocked on you, most urgent first,
  each with one button to fix it, and a count on the Command Center tab.
- **🌳 Git tab**: the branches as a railway map, with agents' robots at their branch tips, PR pills by
  CI result, ahead/behind chips and stale-branch markers.
- **Top bar**: the ☰ menu with every 3D item on the 1D and 2D views, one view dropdown (1D / 2D / 3D /
  Retro), red badges on the tabs; the 2D view follows the 1D colour theme.
- **🧑‍⚖️ Jeff · Router**, the office's quick judge (Jev by TypeSafe AI, Claude Haiku as fallback), in
  shadow mode: "is this agent waiting on you?" at each turn end, and team triage of new issues.
  His own room in the 2D office, a staff card on the Org chart, a section on the Analysis tab.

### Fixed
- **Leads stuck waiting on you**: questions to you go through escalations, a Lead with an open
  escalation isn't benched, answering a benched Lead's escalation hires it back, and a Lead's
  handoff note that says it's waiting on you raises an escalation for it.
- **Idle benching is off by default**: Leads are benched only when you say so (Settings to turn it
  back on).
- **Board scroll**: hovering a card no longer jumps the columns back to the top.

## Before 2026-10-05 (`f4eaf2f`)

The App Factory baseline: floors and the 1D / 2D / 3D / Retro views, the Command Center with the
project console, the board and team boards, the project team (Project Coordinator and four Leads)
with autonomy levels, standups and the review loop, the new project wizard with the
mxcli-project-toolkit, the live app, analysis and model comparison, themes (Default / Dark /
Terminal), and the README guides.
