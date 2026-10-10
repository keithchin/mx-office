# Release notes

What changed in the App Factory (our fork of agent-office), newest first. A release is what went
live with an office restart; **Unreleased** is merged into `staging/integration` and waits for the
next one. Each entry says what you'll notice, then anything to know. Commit hashes are on `main`.

## Unreleased

### Fixed
- **The 🎨 theme picker opens as a dropdown again.** Since the 3D views were removed its list opened inside the
  top bar, stretching the bar to several times its height; it is a menu under the 🎨 once more, on every page and
  theme and on a phone, closing on a pick, Esc or a click elsewhere.

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
