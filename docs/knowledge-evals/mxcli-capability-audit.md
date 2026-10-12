# mxcli capability audit (installed nightly, 12 October 2026)

Back to the [gap map](gap-map.md).

This is a read-only review. It checks what the mxcli that Mx Office and its agents actually run can do, before any work on the Graph Studio, Testing dashboard, Knowledge Base (Library) or token-per-task plans. It also checks what Mx Office already uses. The aim is to stop us building things mxcli already does, without overstating what it does.

Rules for this review:
- No application code changed, nothing was upgraded, and no live project or Studio Pro session was touched.
- No paid agent runs, no Graph Studio calls, and no GitHub calls with credentials.
- Every mxcli command that writes files ran only against a **disposable clone** of travel-approval, frozen at `ff1c9d2`, with its remote removed.
- `mxcli eval run`, the Project Brain write commands and the Studio Pro MCP commands were read through help and source only. None of them was run.

Evidence labels used throughout:
- **[local]**: run here with the installed binary, on the disposable copy.
- **[source]**: read in the mxcli source at the installed commit (`14a0a7c0c`).
- **[web]**: documented on mxcli.org (built from upstream `main`) or present only in newer source. Not available in the installed binary.

Paths: `<spike>` is the `agent-spike` folder, `<home>` the office home (`agent-office`), and `<copy>` the disposable clone (`<spike>\scratch\mxcli-audit\travel-approval-copy`).

## Contents

1. [Answers in short](#1-answers-in-short)
2. [Versions](#2-versions)
3. [Method and side effects](#3-method-and-side-effects)
4. [A. Dependency graph and architecture analysis](#4-a-dependency-graph-and-architecture-analysis)
5. [B. Project Brain](#5-b-project-brain)
6. [C. Session measurement and evaluations](#6-c-session-measurement-and-evaluations)
7. [D. Testing and structured results](#7-d-testing-and-structured-results)
8. [E. Live Studio Pro MCP](#8-e-live-studio-pro-mcp)
9. [Reuse matrix](#9-reuse-matrix)
10. [Amendments to the existing plans](#10-amendments-to-the-existing-plans)
11. [Smallest next step](#11-smallest-next-step)
12. [What could not be verified](#12-what-could-not-be-verified)
13. [Appendix: commands run](#13-appendix-commands-run)

---

## 1. Answers in short

- **The website is ahead of the installed binary.** mxcli.org is built from upstream `main` (645 commits and catalog schema 23 past our nightly, which has schema 15; the latest release is v0.26.0, 11 Oct). `mxcli diag session-report`, `mxcli eval run` and `mxcli playwright check` are **not in our binary**: they landed on 5 October, two days after our nightly was built. `tools/reference-tracking.html` returns 404. There is no `mxcli mcp connect` command: "mcp-connect" is only the name of the page.
- **mxcli already has the dependency graph we were about to build.** A full catalog refresh fills a `refs` table with typed edges. On travel-approval that is 1,923 edges over 29 reference kinds, including **page → entity / attribute / microflow / nanoflow / page / snippet / layout / widget**, **workflow → microflow / page / entity**, and **attribute-level** edges. The fit assessment's F6 ("no dependency index, phase 0 must extract edges itself") and the "pages aren't parsed" part of F7 describe **gaps in Office's reader, not in mxcli**. One call exports all edges as JSON in 0.57 s. **[local]**
- **GUIDs are partly exposed.** Every catalog element table carries the Mendix id. `refs.SourceId` is filled for most sources, but `refs.TargetId` is empty for 1,890 of 1,923 rows. A qualified-name join against the element tables resolved **100%** of entity, attribute, association, microflow, page/snippet and workflow targets. Document (unit) ids are the same GUIDs Office's reader uses (`mprcontents/<xx>/<yy>/<guid>.mxunit`). **[local]**
- **The graph has known holes, and they matter.** References that only appear in free-text expressions are not edges. Examples: a decision's `if $TravelRequest/IsEscalated`, conditional visibility, workflow conditions. Constants and dynamic calls aren't edges either. For `TravelRequest.IsEscalated`, `refs` found 4 documents and full-text search found 11. Snippet calls are stored as `PAGE → PAGE show_page`, not as snippet references. **[local]**
- **Catalog freshness is the `.mpr` file's path and modification time**, nothing else. It is not keyed by revision. Its snapshot columns (`SourceRevision`, `SourceBranch`) are empty. In practice the `.mpr` changes with every commit, so a checkout invalidates the cache (verified). Office must still bind every derived answer to the commit itself. **[local] [source]**
- **Measured on the same frozen snapshot** (558 units, 18 MB; a 32-thread laptop with the live office running):
  - cold refresh: 11.4 s for the very first run, 4.6 s with no catalog but warm OS caches;
  - forced rebuild: 2.2–2.9 s;
  - valid-cache hit: 0.49 s;
  - each query: 0.47–0.77 s wall, of which the query itself is about 64 ms (the rest is process start).
- **Graph analysis is a separate pass.** Before `refresh catalog communities`, `graph_cycles` answers 0 rows with a warning. After it, it answers 5 assets in a cycle. Status JSON (`graphAnalysis`) says which case applies. **[local]**
- **Office uses very little of mxcli today.** It runs `project-tree`, `describe` (MDL and `--format elk`), `run --local`, `new` and `--version`. Agents are told to run `check`, `exec`, `lint` and `layout`, and to use `brain capture` "if available". The toolkit's `app-facts.sh` and `graph-sweep.sh` already read the catalog's `refs` table directly. Office itself reads no catalog, graph report or JUnit file.
- **Session accounting:** Office's ledger is incremental, priced and attributed, and it should stay. mxcli's session-report (website only) has a stricter de-duplication rule that Office should adopt. `diag loop-report` is installed, works on an isolated log folder, and gives per-command mxcli call counts and times. **[local] [web]**
- **Test outputs need an Office wrapper.** `mxcli test --junit` has names, files, assertion counts and pass/fail/error/skip. It has no timestamps, no revisions and no environment. List ids (`test_1…`) are positional. Exit code 1 means both "a test failed" and "the run broke". **[local] [source]**
- **Project Brain** has sound ideas: content-hash ids, `rename` keeping anchors, derived progress. But its staged queue is **per checkout and git-ignored**. Agent captures in an Office worktree are lost if that worktree is removed before someone promotes them. None of the four floors has a `docs/brain/` store. **[local] [source]**

## 2. Versions

| Item | Value | How established |
|---|---|---|
| Mx Office `main` (release 38, live) | `f092418a74dd3767bef931dfaacded18dc07b71f` | `git -C office-source log -1 main` |
| Mx Office `staging/integration` | `30e3ace85d2028446dda82604059b1d00ebfbadd` (Testing release 1 merged; 11 commits ahead of main) | `git -C office-staging log -1` |
| mxcli used by Office and agents | `nightly-20261003-14a0a7c0c` (built 2026-10-03T08:29:41Z), `<spike>\tools\mxcli\mxcli.exe` | `start-office.ps1` sets `AGENT_OFFICE_LIVE_MXCLI`, `AGENT_OFFICE_MXCLI` and prepends the folder to `PATH`; `mxcli --version` |
| Per-project mxcli | `mx-spike` and `travel-approval` have an `mxcli.exe` in the project root. It is a **hard link of the same nightly** (link count 27, same size and time) and is git-ignored. `equipment-rental` and `equipment-loan-desk-test` have none, so they use `PATH`. All four `toolkit.env` files say `MXCLI_VERSION=nightly` (mx-spike has none). | `ls -la`, `--version`, `.claude/toolkit.env` |
| Older mxcli on the machine | `~/.local/bin/mxcli.exe` = **v0.21.0** (2026-09-06), plus `mxcli_v0.7.0-dirty.exe.bak`. They are used only when `tools\mxcli` isn't first on `PATH`, for example by a shell not started by the launcher, or by `findMxcli`'s last fallback (`'mxcli'` on `PATH`). | `--version` |
| Moving-target risk | `.claude/bootstrap-mxcli.sh` links an mxcli found on `PATH`. Otherwise it downloads `MXCLI_TAG` (default **`nightly`**), which today is schema 23, not 15. `MXCLI_VERSION=nightly` is a label, not a pin. | `<copy>/.claude/bootstrap-mxcli.sh:12-46` |
| mxcli source read | Installed: `14a0a7c0ca4d7a8e2350b546b76ff9be8c00002a` (git worktree). Upstream `main` at the time of reading: `aa8c25be1e51…` (2026-10-12). The website matches `main`. | clone in `<spike>\scratch\mxcli-audit\` |
| Catalog schema | Installed **15**; upstream `main` **23** | `catalog_meta.schema_version`; `mdl/catalog/tables.go` |
| Toolkit (shared clone) | `mendix-toolkit` at `7b4b4cf13b9f…` (2026-10-08) | `git log -1` |
| Toolkit per project | travel-approval `PROJECT.md`: **8abd614** (2026-09-30, 3 commits behind the clone); equipment-rental 7b4b4cf; equipment-loan-desk-test a877728. No pin book (`<home>/.agent-office/toolkit-pins.json`) and no `mendix-toolkit-pins/` folder exist yet, so the toolkit-pin feature (on main) hasn't pinned any floor on this machine. travel-approval has no `agent-office.project.json` (it predates it). | files listed |
| Mendix version (travel-approval) | **11.12.2**, from the model (catalog `mendix_version`, connect log `mpr_format: 2`). Its floor `toolkit.env` still has `MXBUILD_PATH=…\11.6.4\…`, a mismatch. Whether a toolkit script on that floor currently uses it wasn't checked (read-only). New projects default to 11.12.4. | `show catalog status --json`; `toolkit.env` |
| Frozen snapshot | travel-approval `ff1c9d2d827a195a1635efcd06e7ad1991209176` (453 commits), cloned to `<copy>`, remote removed | `git log -1` |

### Documentation versus the installed binary

Where they differ, this review follows the installed help.

| Documented on mxcli.org | Installed nightly | Note |
|---|---|---|
| `mxcli diag session-report` | **absent** (`diag` has only `loop-report`) | Added upstream `04f1ba51f`, 5 Oct |
| `mxcli eval run` (headless Claude benchmark) | **absent** (`eval` has only `check` and `list`) | Added `efc30c396`, 5 Oct |
| `mxcli playwright check` (page verdicts, exit 0/1/2) | **absent** (`playwright` has `open`, `status`, `close` and `verify`) | Added `7677c1413`, 5 Oct |
| `tools/reference-tracking.html` | — | **404**. The internals page exists. |
| `internals/reference-tracking.html`: RefKinds `Call, Retrieve, DataSource, ShowPage, Parameter, Association, Generalization, SnippetCall, Enumeration` | The catalog writes **29 lower-case kinds**: `call, create, retrieve, show_page, generalize, associate, layout, datasource, parameter, action, home_page, login_page, menu_item, change, delete, calculate, return, schedule, validate, widget, settings, sync, publish, event, member, xpath, type, value, mapping` (`mdl/catalog/builder_references.go:18-46`) | The internals page is stale. There is no `SnippetCall`: snippet calls come out as `show_page`, with the snippet as a `PAGE` target. |
| `graph-analysis.html`: "references inside expressions / XPath constraints (and enum/constant usage) are not yet edges" | XPath (`xpath`), enumeration values in expressions (`value`) and enumeration types (`type`) **are** edges. Free-text attribute paths and constants are not. | The page is partly out of date. `mxcli impact --help` states the expression limit correctly. |
| "mcp-connect" (page name) | No `mcp connect` command. `mxcli mcp capabilities` plus the global `--mcp*` flags. | — |
| `search --format json` | Deprecated alias; use `--json`. `--format names` also prints progress lines on **stdout**. | Parse `--json` only. |

## 3. Method and side effects

- **Copy:** `git clone <home>\AI-Taskforce-Labs\travel-approval <copy>`, `checkout ff1c9d2…`, `remote remove origin`. Only that copy was given to mxcli's write-capable commands.
- **Logs:** mxcli writes a session log for every run to `~/.mxcli/logs` (argv, timings). For the loop-report test, `MXCLI_LOG_DIR` pointed at `<spike>\scratch\mxcli-audit\logs`, so only this audit's own runs were read. The real agent logs and transcripts were not opened.
- **Unexpected writes into the project tree, seen on the copy:**
  1. The first catalog refresh **regenerated `.ai-context/skills/widgets/*.md`** (44 tracked files). The content was identical, but line endings changed, so `git status` showed them modified.
  2. It **created `.claude/skills/widgets/`** (untracked).
  3. It wrote `.mxcli/catalog.db` (4.6 MB, git-ignored) and `.mxcli/widgets/`.

  The source is `RegenerateWidgetDocs` / `WidgetDocsDirs` (`mdl/executor/widget_defs.go:652-958`): it writes wherever `.ai-context/` or `.claude/` exists. **Consequence:** a "read-only" catalog refresh is not read-only for a checkout. Office must run it in its own work folder, never in a floor's checkout. Office's commit work folders (`src/server/model/workdir.ts`, `<data>/model/work/`) hold only the `.mpr` and `mprcontents/`, so these writes wouldn't happen there. The Studio guard rightly treats `refresh` as a model read (`bin/studio-guard.js:133`), since it doesn't touch the model.
- **Timings** are wall clock from Git Bash `time`, on the same frozen snapshot, with the live office (port 4600) running on the same 32-thread machine. Each run was single; noise of about ±0.1 s per query is likely.

## 4. A. Dependency graph and architecture analysis

### What is available

`refresh catalog full` builds the `refs` table (`SourceType, SourceId, SourceName, TargetType, TargetId, TargetName, RefKind, ModuleName, ProjectId, SnapshotId`; `mdl/catalog/tables.go:1035`). On travel-approval it held 1,923 rows (1,809 distinct; repeated uses are kept). **[local]** Distribution:

| Source → target | Kinds seen (count) |
|---|---|
| **Microflow** → microflow / Java action / workflow | `call` (157 / 11 / 1) |
| Microflow → entity | `parameter` 120, `retrieve` 51, `change` 50, `create` 32, `return` 29, `delete` 4 |
| Microflow → attribute | `member` 174, `xpath` 64 |
| Microflow → association | `member` 99, `retrieve` 72, `xpath` 50 |
| Microflow → enumeration value / enumeration | `value` 96, `xpath` 40 / `type` 17 |
| Microflow → page | `show_page` 14 |
| **Nanoflow** → attribute / entity / microflow / nanoflow / page | `member` 33; `parameter`, `change`, `return`, `create` (26); `call` 5; `call` 3; `show_page` 5 |
| **Page** → attribute / association | `member` 139, `xpath` 8 / `member` 28, `xpath` 12 |
| Page → entity | `datasource` 29, `parameter` 16 |
| Page → microflow / nanoflow (buttons, events **and** microflow data sources) | `action` 38 / 18 |
| Page → page **(includes snippet calls)** | `show_page` 19, of which 6 are snippet calls |
| Page → layout / widget / enumeration value | `layout` 29, `widget` 31, `value` 32 + `xpath` 7 |
| **Snippet** → attribute / association / entity / microflow / nanoflow / widget / enum value | `member` 44, `xpath` 4 / `member` 15 / `datasource` 5 / `action` 9 / 1 / `widget` 2 / `value` 17 + `xpath` 2 |
| **Workflow** → microflow / page / entity / enum value | `call` 30 / `show_page` 8 (user task pages) / `parameter` 1 / `value` 4 |
| **Entity** → enumeration / association / attribute / entity / microflow | `type` 31 / `xpath` 19 + attribute `xpath` 2 (access-rule XPath) / `generalize` 6 / `event` 1 |
| Association → entity | `associate` 136 |
| Navigation, scheduled event, project settings, import/export mapping | `menu_item`, `home_page`, `schedule`, `settings`, `mapping`, `member` |

Command-level queries over this table, all checked **[local]**:
- `refs <qn>` (one row per source and kind; works for an attribute or an enum value);
- `callers [--transitive]`, `callees`;
- `impact` (counts distinct elements; includes enum-value uses);
- `context --depth N [--json]`, which supports microflows, nanoflows, entities, pages, workflows, enumerations, snippets, Java actions and OData. The JSON is `{name, type, depth, context}` with `context` as Markdown;
- `graph-report --format json`;
- `report --format json`;
- `lint --format json`;
- `search` (full-text; MDL source only after `refresh catalog full source`).

**Answers to the brief's questions:**

1. **Relationships by element type.** Microflows, entities, attributes, pages, snippets and workflows are all covered as **sources** and as **targets**, as in the table above. Snippets are targets only through `PAGE → PAGE show_page` (a labelling quirk). A workflow is a target of `MICROFLOW call` (call workflow). Access rules live in the `permissions` table (with `XPathConstraint`), not in `refs`, apart from their XPath member edges.
2. **Stable GUIDs.**
   - Element tables (`entities.Id`, `attributes.Id` plus `EntityId`, `microflows.Id`, `pages.Id`, `snippets.Id`, `workflows.Id`, `associations.Id`) carry the Mendix ids.
   - `refs.SourceId` is empty for 184 rows: some page data-source edges, navigation and scheduled events.
   - `refs.TargetId` is empty for 1,890 of 1,923 rows.
   - Joining `TargetName` to the element tables resolved 507/507 entity, 483/483 attribute, 295/295 association, 243/243 microflow, 53/53 page-or-snippet and 1/1 workflow targets. Enumeration values, Java actions, layouts and widgets need other tables. Nanoflows resolved 16/22 through my join, which simply omitted the `nanoflows` table.
   - Document ids are the unit GUIDs Office already reads: page `d97b8d49…` is `mprcontents/d9/7b/d97b8d49….mxunit`.
   - **Stability:** mxcli's ADR-0008 (`docs/13-decisions/0008-identity-and-idempotence.md`) measured that Studio Pro keeps document GUIDs but renumbers element `$ID`s freely (0 of 94 kept in a module update). Cross-document references are by qualified name. So **document GUIDs are stable keys; element-level ids are not**, except attribute ids, which the runtime's database sync depends on. This affects the fit assessment's claim that flow-element GUIDs are stable ids.
3. **Excluded.**
   - Attribute paths through a variable inside a free-text expression: decisions, conditional visibility, captions, workflow conditions. `mxcli impact --help` says so. Probe: `refs TravelApproval.TravelRequest.IsEscalated` returned 4 documents, while `search IsEscalated` (source mode) returned 11. Among those missed are `SUB_TravelRequest_BuildRoute` (`if $TravelRequest/IsEscalated then`, `mdlsource/3-microflows/31-route.mdl:162`), `SNIP_Request_Form` (a visibility expression) and `WF_TravelApproval`.
   - Constants (no `CONSTANT` target type).
   - Dynamic behaviour: call-by-name or reflection, Java and JavaScript action bodies, URL navigation, REST endpoint strings, and runtime security.
   - Loop bodies have no containment column in schema 15 (the toolkit's `app-facts.sh:20-23` works around it). Upstream added `ParentLoopId` later.
4. **Export without another parser: yes.** `mxcli -p app.mpr --json -c "select SourceType, SourceId, SourceName, TargetType, TargetName, RefKind from CATALOG.refs order by …"` returned all 1,923 edges as clean JSON on stdout in **0.57 s**. Run twice around a forced rebuild, the output was byte-identical (sha256 `ad2a8cbb2b07…`). MDL `select` doesn't accept `with` (CTE), so the GUID join is done either by Office after export, or read-only over `.mxcli/catalog.db` with `node:sqlite`, which Office already uses for `.mpr` files (`src/server/model/mpr.ts`).
5. **Freshness.**
   - `isCacheValid` (`mdl/executor/cmd_catalog.go:372-410`) compares the MPR path, the `.mpr` modification time in seconds, and the build mode (`fast < full < source`).
   - `show catalog status --json` gives `valid`, `invalidReason`, `buildMode`, `buildTime`, `mendixVersion` and `graphAnalysis`.
   - Checking out another revision changed the `.mpr` and gave `invalidReason: "project file modified"`; the rebuild took 2.3 s. Switching back invalidated it again (2.2 s). There is no content-addressed reuse.
   - Every travel-approval commit with unit changes also changed `project.mpr` (14 of 14 sampled), so mtime works in practice. It is still not a revision binding: snapshot columns such as `SourceRevision` are empty.
6. **Costs** (same snapshot):

| Operation | Wall time |
|---|---|
| Cold full refresh: fresh clone, first run (includes the widget-doc rewrite, cold OS cache) | **11.4 s** (mxcli reports a 7.9 s build) |
| Full refresh, no catalog, warm OS cache | 4.6 s |
| `refresh catalog full force` (×3) | 2.2 / 2.2 / 2.9 s |
| Rebuild after a revision switch | 2.3 s |
| Warm refresh (cache valid, nothing to do) | **0.49 s** |
| `refresh catalog full source` (full-text index of MDL) | 4.7 s |
| `refresh catalog communities` | 0.72–0.78 s |
| `refs`: snippet / entity / attribute / entity with `--json` | 0.48 / 0.47 / 0.48 / 0.49 s |
| `callers` / `callers --transitive` / `callees` | 0.47 / 0.49 / 0.49 s |
| `impact` (entity) | 0.48 s |
| `context`: microflow / workflow `--json` / snippet | 0.50 / 0.67 / 0.77 s |
| `graph-report --format json` (catalog warm) | 0.49–0.53 s |
| `report --format json` | 1.38 s |
| `lint --format json` | 1.20 s |
| All edges as JSON (one `-c select`) | 0.57 s |
| Query time inside the process (session log, `show REFERENCES`) | 64 ms |

   Process start dominates. Batching statements into one `-c` call, or reading `catalog.db` directly, removes most of the cost. Behaviour on a large app wasn't measured; travel-approval has 558 units.

7. **Does Office consume any of this?** **No.** Office's reader shows per-flow targets as display text by qualified name (`src/server/model/flow-details.ts`), and parses page MDL on the client (`src/client/ui/model/page-model.ts`, `mdl-tree.ts`). It runs mxcli only for `project-tree` and `describe` (`src/server/model/index.ts:175-288`). The toolkit does read the catalog: `project-bin/app-facts.sh` runs `graph-report` and then reads `refs` through SQLite, and `graph-sweep.sh` reads `refs` with its own staleness and emptiness guards. The toolkit also documented known faults in the stock graph views: module derived from text before the dot, a phantom "Navigation" module, and `graph_cycles` empty on tangled module pairs (`app-facts.sh:11-23`).

### Graph analysis is a separate prerequisite

- With only a full catalog, `select * from CATALOG.graph_cycles` gave `Warning: CATALOG.GRAPH_CYCLES requires refresh catalog communities (not run for this catalog)` and **0 rows**, and status said `Graph analysis: ✗ Not run`.
- After `refresh catalog communities` (17 communities), the same query gave **5 assets in one cycle** (the `Responsibility` entity, its three associations and `VAL_Responsibility`), and status said `✓ Available (resolution 1)`.
- `graph-report` reads only the plain views (god nodes, coupling, cohesion, dead documents, ref kinds, entity hotspots), so it works without the pass. **[local]**
- **Rule for Office:** read `graphAnalysis` from `show catalog status --json` before reading `graph_cycles`, `graph_layers`, `communities` or `graph_centrality`. A warning goes to stderr, which Office's runner discards on success (`src/server/model/mxcli.ts`), so empty rows must not be shown as "no cycles".
- `graph_cycles` (structural kinds only) and `graph_module_cycles` (every kind) answer different questions (`graph-analysis.md`, mendixlabs/mxcli#1060).
- The graph-report JSON is `{project, sections: [{title, rows}]}`. Sections are keyed by display title, with no build sha, catalog time or mxcli version in it. Office would have to add those.

## 5. B. Project Brain

**Support:** installed in full: `brain init | capture | staged | promote | resolve | drop | check | plan | brief | show`. Run on the copy **[local]**, read-only:
- `brain check`, `brain show`: "No store yet";
- `brain plan`: "No slices yet";
- `brain staged --json`: `{"count":0,"queue_size":0,"staged":[]}`.

Write commands were read in help and source only.

**Contracts** **[source]**:
- An entry (`cmd/mxcli/brain/entry.go:36-56`) is `{id, kind?: requirement, slice?, open?, title, body?, anchors[], date}`.
- `check --json` reports per anchor `{shard, entry_id, title, anchor, state, kind}`, plus misfiled entries and open questions (`check.go:92-122`).
- `plan` gives `{slice, built, planned, unanchored}`.
- `brief --json` gives `{slice?, shards[{shard, path, body, lines}], lines, bytes}`.
- `staged --since <id> --fail-if-empty` lets a dispatcher refuse to move on from a slice that recorded nothing.

**How things are identified and linked:**
- Anchors are qualified names: `@Module`, `@Module.Element`, `@Module.Entity.Attribute`.
- A **decision** anchors backward: an anchor that doesn't resolve fails `check`.
- A **requirement** (`--slice`) anchors forward: an anchor that doesn't resolve counts as "planned".
- An **open question** (`--open`) has unchecked anchors until `resolve` turns it into a decision in place, keeping its id.
- Resolution uses the catalog's `objects` view plus a type-agnostic unit lookup. "Not indexable" (for example a scheduled event) passes.

**Do ids survive edits and renames?**
- The id is the first 6 hex characters of a sha256 over the normalised title, slice and anchors, worked out once at capture (`entry.go:90-102`). Capturing the same fact twice gives the same id, which is how duplicates are refused.
- After capture the id is stored and **not** re-derived:
  - `mxcli rename` rewrites anchors and keeps the id (`brain/rename.go:28-40`);
  - `resolve` keeps it;
  - hand-editing the title keeps it.
- A rename made **outside mxcli** (in Studio Pro) is not followed. A decision then fails `check`. A requirement silently drops from "built" back to "planned"; the source notes the observed symptom "65/65 → 63/65".
- The ids are 24 bits, which is fine within one project but not a global key.

**Where the store lives, which matters for Office:**
- Promoted entries are in `docs/brain/` (committed, reviewed in PRs).
- The **staged queue is `.mxcli/brain/staged.jsonl`, next to the `.mpr` of the checkout where the capture ran**, and git-ignored (`brain/staged.go:22`). In Office every agent works in its own worktree, so each worker has its own queue. A queue in a worktree that is swept or benched before promotion is lost.
- Office's bench prompt already asks Leads to "capture there too" (`src/server/roster/prompts.ts:65`, `playbooks.ts:239`). Those captures go into exactly such queues.
- On this machine, `mx-spike` has a 2-entry queue in its main checkout that was never promoted. No floor has `docs/brain/`.

**Human review without duplicating the store:**
- Office can list the queues read-only, by running `brain staged --json` in each member worktree and the main checkout, and show them in Needs you as "knowledge waiting for review".
- Promotion stays a commit in the repo, either the agent promoting at the PM's request or a PM action that runs `brain promote <id>` in that worktree and is audited.
- Office keeps no copy. The ids are the handles.
- Before relying on this, the queue has to survive worktree removal. Options: promote or export before sweep, or have mxcli use a shared queue path; neither exists today.

**How this fits existing records, and who should own what:**

| Information | Owner (proposed) | Why |
|---|---|---|
| Model facts: entities, references, callers, pages | **mxcli catalog**, derived on demand, never stored | Brain's own rule: anything mxcli can answer doesn't belong in a note |
| Business requirements (UC, BR, NFR, fit-gap) | **BRD JSON** in the repo (`analysis/knowledge-base/brd/*.brd.json`) | Already the source the Testing dashboard links to. Brain's `plan/` is for a source that leaves **no** trace in git, which isn't the case here. |
| Acceptance criteria → journeys | `architecture/acceptance-criteria.md` | Recorded links, already imported by Testing release 1 |
| Build plan, sequencing | Toolkit build plan | Stage gates read it |
| Project and business decisions with approval provenance | `PROJECT.md` Decisions table plus escalation ids | It records who decided (the wizard, escalations) |
| Model-anchored engineering decisions and open questions ("why this pattern here", "this mxbuild error means…") | **Project Brain `docs/brain/`** | Anchors are checked against the model, so stale decisions fail loudly |
| Tool gotchas not tied to the model | Lessons skill (`mxcli-field-lessons` / `project-lessons`) | Brain anchors don't help here. Stop asking agents to write the same lesson in two places. |
| Tested / passed | **Testing records** (Testing release 1) | A requirement whose anchors resolve is **built**, not tested |
| Accepted | **Acceptance record** (`src/server/acceptance/`) | An explicit PM action |
| Curated cross-project knowledge | **Library (K1)**, which indexes Brain shards, lessons and decisions as read-only sources | Nothing is copied as accepted on import |

`brain plan`'s "built" must never show as tested or accepted. If Office ever shows it, label it "anchors resolve (model element exists)".

## 6. C. Session measurement and evaluations

### `mxcli diag loop-report`: installed **[local]**

- It reads mxcli's own session logs (JSONL): `session_start` with argv, version and pid; `connect`; `execute` with statement type, summary and `duration_ms`; `session_end`.
- `--json` gives `{invocations, runs_with_statement_errors, unclosed, spawned_by_mxcli, wall_seconds, by_verb[{verb, count, unclosed, total_seconds, median_ms}], check_then_exec_pairs, span}`.
- On five isolated runs (`MXCLI_LOG_DIR`) it reported 5 invocations, refs ×2, callers, describe and lint. The failed `describe` showed as `unclosed: 1`: a run that exits through `os.Exit` writes no summary, and the report says so rather than calling it a failure.
- The logs carry no session, worker or task id, only pid and parent pid. For per-attempt numbers, Office would set `MXCLI_LOG_DIR` per attempt, or filter by time window and project path.

### `mxcli diag session-report`: **not installed** **[web] [source at upstream main]**

What the upstream code does (`cmd/mxcli/sessionreport/transcript.go`):
- **Model calls and de-duplication:** one API response is written as several records. A call is a distinct `message.id` (else `requestId`, else `uuid`) per conversation. Usage is the **last** usage seen for that id, and is summed once per id (`:270-290`, `finish :406-416`).
- **Token fields:** `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`. There is no 1-hour cache-write split, no model price and no cost.
- **Subagents:** it reads `<session>/subagents/*.jsonl` unless `--subagents=false`. Conversations are keyed `main`, or the record's `agentId` for `isSidechain` records. A sidechain record that appears in both the main file and the subagent file lands in the **same** conversation and is de-duplicated by message id. If a sidechain record has no `agentId`, it goes to the key `sidechain` and could be counted again.
- **Estimated, not observed:** tool-result size (characters ÷ 4; images by pixels, capped), "re-read cost" (size × later calls up to the next compaction), categories and retry chains.
- **Ingestion:** reads whole files on every run (`ParseFile`). There is no offset cursor or incremental state.
- **Privacy:** prints counts and short snippets, never prompt or result text, and shortens paths. `--json` carries the same fields.

### Office's ledger, compared

Office's ledger is `src/server/usage.ts` (tracker) plus `src/server/budget/` (project ledger and attribution).

| Rule | Office today | session-report | Assessment |
|---|---|---|---|
| Source | Main transcript plus `subagents/*.jsonl` | Same | Same layout |
| Ingestion | **Incremental**: a byte-offset cursor per file, half-written last lines wait (`readNewLines`, `usage.ts:259`) | Full re-parse | Keep Office's |
| De-duplication | **Only against the previous record in the same file** (`cur.lastId === msg.id`, `usage.ts:224`). Last usage wins by delta. | A per-conversation set of every message id; last usage wins | Adopt the set rule. A non-adjacent repeat would be counted twice by Office. |
| Parent / subagent | Main-file lines are counted even when `isSidechain` (only the model attribution skips them, `:220`). Each file has its own cursor. | Keyed by `agentId`, de-duplicated across files | If a Claude Code version writes sidechain records into the main file **and** a subagent file, Office counts them twice. Not observed with the current layout (subagents only in `subagents/`), but V8 should test it. |
| Observed versus estimated | Tokens observed. Cost **estimated** from a dated price table, except after a `cost-state` line, which is Claude Code's own tally including calls not in the transcript (`:235`). 1-hour cache writes are priced separately. | Tokens observed. No cost. Result sizes estimated. | Office is richer on cost. session-report is richer on where the calls went. |
| Attribution | Per worker. Deltas booked when the office polls. A subagent type comes from `agent-<id>.meta.json`. | Per session file | Neither binds usage to a task or attempt |

**Conclusions:**
- **Don't replace the ledger with session-report.** It has no incremental mode, no prices, no `cost-state` handling and no task binding.
- **Use it to validate totals:** on a frozen, sanitized transcript fixture, Office's token sums per conversation should equal session-report's. This needs an mxcli that has the command (v0.26.0 or later), evaluated outside the office.
- **What remains Office's job** (Testing release 3):
  - bind attempt to session (and the first message id) at start;
  - attribute **per message id and timestamp** to the attempt window that contains it;
  - attribute delayed records the same way when they are read;
  - one global id set across parent and subagent files;
  - separate Coordination and Unattributed lines;
  - label cost "estimated (price list of date)".
- The loop-report rule for runs that "did not close" is a good model for how Office should report a gap.

### `mxcli eval`

- **Installed:** `eval check` / `eval list` **[local help]**.
  - Static checks from Markdown and YAML test files: `entity_exists`, `entity_has_attribute`, `page_exists`, `page_has_widget`, `microflow_exists`, `navigation_has_item`, `mx_check_passes`, `lint_passes`.
  - Pattern names (`*.Book`). `--output` writes reports.
  - Useful as the **structural part** of the benchmark's verification interface (benchmark discovery, decision 1). It doesn't replace runtime verifiers.
- **Not installed:** `eval run` **[web] [source at upstream main, `cmd/mxcli/cmd_eval_run.go`]**.
  - It runs `mxcli new` (which downloads and runs `init`), then `claude -p <prompt> --dangerously-skip-permissions` with a known session id.
  - It copies the transcript, writes `session-report.txt`/`.json`, and runs the checks.
  - It removes `CLAUDECODE` / `CLAUDE_CODE_*` from the environment. It needs the agent's own credentials.
  - Flags: `--version`, `-p`, `-o`, `--claude`, `--model`, `--timeout`, `--claude-arg`, `--skip-mx-check`, `--skip-tests`, `--top`. There is **no spend cap**.
  - **Not run**, as instructed.

  What it could contribute: a ready **arm-A (single agent) runner** and a fixed brief (`BENCH-001`) for regression runs of mxcli and toolkit changes. Isolation it would need:
  - a test office or a separate OS user;
  - **no GitHub token**, per the test-office hard rule;
  - a scratch folder outside every floor;
  - an external budget ceiling;
  - an approved paid-run budget;
  - transcripts kept under the gap map's retention decision.

  It doesn't replace the gap map's harness (frozen snapshot, hidden verifiers, same evaluator for every arm).

## 7. D. Testing and structured results

| Runner | Verifies | Input | Structured output | Exit codes |
|---|---|---|---|---|
| `mxcli test` (installed) | **Business assertions in microflows at runtime**: `@expect` Mendix expressions, `@verify` OQL post-conditions, `@throws`, `@setup`, `@cleanup rollback\|none`. Not UI. | `.test.mdl`, `.test.md` | `--junit`. Testsuite: `name, tests, failures, errors, skipped, time`. Testcase: `name, classname` (from the file), `file, time`, property `assertions`, plus `failure` / `error` / `skipped` (`cmd/mxcli/testrunner/junit.go`). `--require-assertions` turns a test that asserts nothing into an error. | 0 all passed; **1 any failure, error or infrastructure error** (`cmd_test_run.go:225-236`); 0 for a watch stopped before a result |
| `mxcli playwright verify` (installed) | UI flows via `playwright-cli` bash scripts | `tests/verify-*.test.sh` | `--junit`: `name, classname, time, failure / error, system-out`. **No `skipped`, no properties** (`playwright/junit.go`). A failure screenshot is saved to `<script>-failure.png` in the working folder and only printed, not referenced in the XML (`runner.go:214-218`). | 0 all passed; **1 a script failed or the run broke** |
| `mxcli playwright check` (**not installed**) | Page renders: HTTP status, sign-in, error banner, console errors, failed requests, `--assert-text` / `--assert-count` | URLs | Text verdict lines; optional screenshot | 0 passed / 1 a page failed / **2 couldn't run** [web] |
| Model validity | `mxcli check` (MDL script), `mx check` / toolkit `verify-model.sh`, `lint` / `report --format json` | — | See [benchmark discovery §4](benchmark-discovery.md#4-model-checks-exact-commands-outputs-exit-codes) | — |

**Local check:** `mxcli test tests/ -p project.mpr --list` on the copy listed **57 tests** in 0.44 s without starting a runtime. Ids are `test_1…test_57`, numbered by position across the run (`testrunner/parser.go:230,303`), so adding one test renumbers the rest. `playwright verify tests/ --list` listed one script. **[local]**

**What the outputs include and lack:**
- Stable test id: **no** (use file path plus `@test` name).
- Tested app revision, test-definition revision, environment or build identity (mxcli, Mendix and runtime version; `--local`, `--attach` or Docker): **no**.
- Timestamps: **no** (the suite has a duration only).
- Skipped and error states: yes for `mxcli test`; `playwright verify` has no skip.
- Evidence paths: **no** (the screenshot path is only on stdout).

Note also: `--attach` tests run against the live app's database. The Docker path always commits. `--local` injects an `MxTest` module and restores it afterwards.

**What Office and the toolkit use today:**
- Testing release 1 imports the JSON reports under `reports/testing/` (`{capturedAt, run, results[{name, ok, detail}]}`), the journey runner's `*-findings.json`, the toolkit's `docs/report.json`, CI checks and gate runs (`src/server/testing/import-reports.ts:1-14`).
- It reads **no JUnit**. The toolkit's scripts don't pass `--junit` anywhere (0 files).
- Travel-approval's e2e checks are its own Node scripts (`tests/e2e/*.js`), not `playwright verify`.

**Metadata an Office wrapper must add** (it never infers the tested revision from the commit that holds the report):
- run id;
- runner and mxcli version;
- Mendix version and runtime mode;
- **tested app revision**, taken from the checkout the runner built (`git rev-parse HEAD` of a clean tree, refused when the tree is dirty);
- **test-definition revision** (the same checkout, or the tests' own commit when they're separate);
- the environment (local, attach or Docker, with ports and the database name);
- start and finish times;
- exit code;
- a status mapping (JUnit `error` means a harness fault, `failure` a test failure; exit 1 with no JUnit means the run couldn't run);
- evidence locators for the JUnit file, logs and screenshots;
- the stable test id (`<relative file>#<@test name>`) and the declared links (UC, BR, AC) parsed from names.

## 8. E. Live Studio Pro MCP

**Installed:**
- Global flags: `--mcp <url>` (route model writes to Studio Pro's embedded MCP server "PED", Studio Pro 11.11 or later), `--mcp-dial`, `--mcp-verbose`, `--mcp-trace`, and `--mcp-concord <url>` (a second, companion server, default port 7783, that adds delete, save, validate and run), with `--mcp-save`, `--mcp-check` and `--mcp-run`.
- One command, `mxcli mcp capabilities`, prints what the connected Studio Pro can author. **[local help]**

**Documented** (installed docs; identical upstream) **[source]**:
- Reads always come from the local `.mpr` given with `-p`, not from Studio Pro's memory.
- Authorable over MCP: entities, associations, enumerations, constants, microflows, pages and workflows.
- Not authorable: nanoflows, Java actions, business-event services, view entities, security, navigation and `MOVE`.
- PED binds IPv6 loopback with a `Host: localhost` guard, and its port can change between sessions.
- Troubleshooting says "a timed-out write may still have applied".
- Where Concord comes from isn't documented in the installed docs. **Not verified.**

**Implications for Office:**
- **Writer controls.** The Studio guard already lets `--mcp` writes through and suggests them while Studio Pro is open (`bin/studio-guard.js:158-185,279-286`). That stays correct. But an MCP write is a **second writer path that the planned mutation lease (gap map C3) must cover**: one writer at a time across file writes and MCP writes.
- **Unsaved model state.** An MCP write lands in Studio Pro's memory. Until a save (Concord) and a commit, the `.mpr`, git, the catalog, Office's commit-based Model tab and every test record still show the old model. Office should label such work "applied in Studio Pro, not saved / not committed", and never verify or accept against it.
- **Recovery after a timed-out write.** The write's outcome is unknown, and mxcli can't read Studio Pro's in-memory state back (reads come from disk). Office should treat it as "outcome unknown", re-run `mcp capabilities` to reconnect, and retry only idempotent scripts. mxcli skips canonically unchanged writes on the file backend (`internals/idempotent-writes.md`); whether that holds over MCP wasn't verified. Record it as an operation record (reliability step 3), and ask the PM to save and check in Studio Pro before an agent continues.
- **Separate experimental integration.** Nothing was connected. Capability discovery against a real Studio Pro is **not verified**.

## 9. Reuse matrix

| Capability | Installed support | Office usage today | Output / API contract | Limitations | Recommendation | Evidence |
|---|---|---|---|---|---|---|
| Full catalog plus `refs` edges | Yes (schema 15) | None (toolkit `app-facts.sh`, `graph-sweep.sh` read it) | SQLite `.mxcli/catalog.db`; `--json -c "select … from CATALOG.refs"` | `TargetId` mostly empty (join by name); expression-only refs, constants and dynamic calls missing; snippet = `PAGE show_page`; writes widget docs into a checkout | **Wrap with a small adapter**: run in Office's commit work folder, export JSON, join GUIDs, label coverage | §4; `refs` distribution; 0.57 s export; byte-identical |
| `refs` / `callers` / `callees` / `impact` | Yes | None | `--json` arrays `{RefKind, SourceName, SourceType}` | One element per call (0.5 s each); no target GUID | **Reuse directly** for agents and single questions; the adapter for bulk | §4 timings |
| `context` | Yes | None | `--json {name, type, depth, context(markdown)}` | Markdown, not a graph | **Reuse directly** as an agent tool (briefs), not as a data source | `18-context-wf` |
| Catalog freshness | Yes (path plus `.mpr` mtime plus mode) | None | `show catalog status --json` | Not revision-bound; snapshot columns empty | **Keep Office's own binding**: key by commit sha and force-rebuild on mismatch | `cmd_catalog.go:372`; revision-switch test |
| `graph-report` | Yes | None (toolkit keeps it "for cross-checking") | `{project, sections[{title, rows}]}` | Keyed by title; no sha or version; module derived from the name (toolkit finding) | **Wrap with a small adapter** (add sha, version, catalog time), or read the views directly | `graph.json` |
| Graph analysis (`communities`, cycles, layers, centrality) | Yes, separate pass | None | `CATALOG.graph_*` tables; `graphAnalysis` in status | Empty until the pass runs; betweenness skipped above about 6k nodes | **Wrap**: check status first; never show "none" without the pass | §4 before/after |
| `search` (full-text) | Yes; MDL only after `full source` | None | `--json` | `--format names` puts progress on stdout | **Reuse directly** as the "textual mention" fallback for expression gaps | IsEscalated probe |
| `report` / `lint` JSON | Yes | Agents only; benchmark discovery pinned the commands | `{projectName, date, overallScore, summary, categories, violations[{ruleId, …, documentId}]}` | — | **Reuse directly** as eval graders (already planned) | `report.json` |
| Project Brain | Yes | A prompt line "capture if available"; no floor has a store | `staged`, `check`, `plan`, `brief --json` | Per-checkout, git-ignored queue; anchors by name; renames outside mxcli not followed | **Defer** UI adoption until queue survival is solved; set ownership rules now (§5) | §5; `staged.go:22` |
| `diag loop-report` | Yes | None | `--json` (by verb) | No session or task id in the logs | **Wrap**: per-attempt `MXCLI_LOG_DIR`, or a time window | §6 local run |
| `diag session-report` | **No** | — | `--json` (upstream) | Full re-parse; no cost | **Defer until a compatible version is evaluated**; then validator only. Adopt its de-dup rule now. | §6; `transcript.go` |
| `eval check` / `list` | Yes | None | Reports to `--output` | Static presence only | **Reuse directly** as the structural grader in E4 | help |
| `eval run` | **No** | — | Run folder with transcript and session report | `--dangerously-skip-permissions`; no spend cap | **Defer** (and isolate) | `cmd_eval_run.go` |
| `mxcli test --junit` | Yes | None (not imported) | JUnit with assertions; pass, fail, error, skip | No revision, time or env; positional list ids; exit 1 ambiguous | **Wrap with a small adapter** (an Office run envelope) | `junit.go`; 57 tests listed |
| `playwright verify --junit` | Yes | None | Thin JUnit | No skip; evidence only on stdout | **Keep Office's implementation** (the project's own e2e JSON) for now; wrap only if a project adopts `.test.sh` | `playwright/junit.go` |
| `playwright check` | **No** | — | Text; exit 0/1/2 | — | **Defer until a compatible version is evaluated** (useful smoke check) | web |
| Studio Pro MCP (`--mcp*`, `mcp capabilities`) | Yes (flags plus capabilities) | The guard allows and suggests `--mcp` | Live writes; reads from disk | Unsaved state invisible; timeout means outcome unknown; Concord needed for save, check and run | **Requires new work** (lease coverage, unsaved-state labels, operation records), as a separate experiment | §8 |
| Model tree / MDL | Yes | **Used** (`project-tree`, `describe`) | JSON tree; MDL; elk JSON | — | **Reuse directly** (as now) | `model/index.ts:175-288` |

## 10. Amendments to the existing plans

These are proposals only. The plan files in `docs/mockups/` were not changed.

### Office reader gaps versus mxcli gaps

| Gap as stated in the plans | Gap in Office's reader? | Gap in mxcli? |
|---|---|---|
| F6: no cross-document "used by" index | **Yes** | **No**: `refs` has it |
| F7 / plan v2 point 9: page relations only from client-side MDL | **Yes** (the parser is on the client) | **No**: page → entity, attribute, microflow, nanoflow, page, snippet, layout and widget edges exist |
| F8: attributes have no id on the wire | **Yes** (`src/shared/model.ts`) | **No**: `attributes.Id` plus `EntityId` |
| Flow-element GUIDs as stable graph ids | — | Element `$ID`s are **not** stable across Studio Pro edits (ADR-0008). Use document GUID plus qualified name. |
| References in expressions (decisions, visibility, workflow conditions) | Yes | **Yes**: only textual search finds them |
| Constants, dynamic calls, Java/JS bodies | Yes | **Yes** |
| Snippet usage | — | Present, but labelled `PAGE show_page` |
| Revision binding of derived data | Office has commit work folders | **Yes**: freshness is by mtime and snapshot fields are empty |

### 10.1 Graph Studio integration

- **Remove** the planned new dependency extractor in phase 0 (fit assessment F6, §4.1 step 3). `model.ttl` is generated from the catalog export: `refs` plus element tables, with GUIDs by join. **Include page and snippet edges now.** Drop "page edges are excluded until page parsing exists" (§8). Office's page parser stays a viewer concern.
- **Ids:**
  - documents by unit GUID;
  - attributes by `attributes.Id` (or entity GUID plus name, labelled);
  - elements inside a flow by qualified name plus position, labelled "not stable across Studio Pro edits".
- **Coverage labels on every answer:** what the graph can't see (expression-only references, constants, dynamic calls). Q5's "can't conclude" list gets "attribute read only inside an expression" in addition to unbound test evidence.
- **A stronger phase 0 baseline.** Each of the five questions is answered three ways:
  - (a) SPARQL on the remote graph;
  - (b) **mxcli local graph queries**: `refs`, `impact`, `callers --transitive`, `context`, `graph-report`, the `graph_*` tables after `communities`, and `search` for textual mentions;
  - (c) the current manual workflow.

  The exit rule becomes: a concrete benefit **over (b)** for at least 3 of 5 questions.
- **The extra question the remote graph answers.** Single-app model impact (Q4 and "Request.Status impact") is already answered locally in under a second. The remote graph earns its place only for:
  1. **cross-source delivery traceability**: requirement → task → PR → commit → changed GUIDs → check → acceptance, which joins Office records, git and the model, something no mxcli query can do;
  2. **cross-app portfolio questions**: the same entity modelled differently across apps;
  3. **enterprise data in Discovery.**

  Model edges in the graph are a joinable copy of mxcli's catalog at a commit, never a second extractor.
- **Freshness:** each exported graph carries `{commit sha, mxcli version, catalog schema, build mode, graphAnalysis, export time}`. The exporter refuses a catalog whose status isn't valid for that commit's work folder.

### 10.2 Testing dashboard and revision-bound evidence

- **Add JUnit as an import source** (release 2 or later), through an **Office run envelope**: `{runId, runner, mxcliVersion, mendixVersion, mode, testedAppRevision, testDefinitionRevision, environment, startedAt, finishedAt, exitCode, junit locator, logs, screenshots}`.
  - The envelope is written by the wrapper that **launched** the run from a clean checkout. A JUnit file without an envelope imports as "tested revision: unknown", exactly like today's reports.
- **Stable test id** = `<repo-relative file>#<@test name>`. Never `test_N`.
- **Status mapping:**
  - JUnit `error` means **harness error**, not failed;
  - exit 1 with no JUnit means "run could not complete";
  - `--require-assertions` on by policy, so a test with 0 assertions never counts as passed.
- **"Declared coverage" can use mxcli's graph:** a test file's `CALL MICROFLOW` targets plus `callees --transitive` give the declared reach of a test. It stays labelled "declared", never "executed".
- **Release 5's "move the page parser to shared code"** is no longer needed for links: page → data source and page → microflow come from `refs`. The parser move remains only if the client view itself needs it.
- Ask the toolkit to emit `appRevision` / `testRevision` in its reports (already plan v2, question 2), and to pass `--junit` in its pipelines.

### 10.3 Knowledge Base (Library) and Evals

- **Library sources:** add `docs/brain/` shards as a read-only source adapter, with entry ids as stable handles. Don't import the staged queue as knowledge.
- **Ownership rules** as in §5. In particular, remove the duplicate instruction to write lessons both to the lessons skill and to `brain capture` (`prompts.ts:65`, `playbooks.ts:239`). Keep model-anchored decisions for Brain and tool gotchas for lessons.
- **Before any Brain UI:** solve queue survival across worktree removal. Options: promote or export before the worktree sweep; ask upstream for a shared queue path; or ask agents to capture only in the main checkout. None is chosen here.
- **Evals:**
  - `eval check` becomes the structural grader for the benchmark's verification interface;
  - `report` / `lint` JSON stay the pinned model-quality graders;
  - `diag loop-report` (per-attempt log dir) adds an observed "mxcli calls by verb" dimension to process metrics;
  - `session-report` categories (orientation, write, apply, validate, verify, retry) are a ready taxonomy for process metrics once a compatible version is evaluated;
  - `eval run` is considered only as an isolated arm-A runner, after a separate decision on paid runs and permissions.
- **Pin mxcli per project and per eval:** record the mxcli version and catalog schema in `agent-office.project.json` and in every eval config manifest. Treat `bootstrap-mxcli.sh`'s moving `nightly` default as a compatibility risk.

### 10.4 Task / attempt token accounting

- **Keep Office's ledger** (incremental, priced, `cost-state`, Coordination and Unattributed). Don't reuse session-report as the meter.
- **Adopt the de-dup contract:** one id set across main and subagent files (`message.id`, then `requestId`); last usage per id wins; subagent conversations keyed by `agentId`. This removes Office's adjacent-only de-dup weakness and the sidechain double-count risk. **V8 gets a fixture** with a non-adjacent duplicate and a sidechain record present in both files.
- **Attempt attribution** stays Office work: bind at start (session id plus first message id), attribute each message by its own timestamp and id to the attempt window, and attribute delayed lines when read. Neither mxcli report can do this.
- **Validation, after an mxcli upgrade is evaluated:** on a frozen, sanitized fixture, Office's per-conversation token totals equal session-report's `--json` totals. Cost is compared only where `cost-state` exists.

### Custom work we can remove, contracts to adopt, and what remains Office's

- **Remove:** the Graph phase 0 edge extractor and GUID resolver for model edges; "move page parser to shared code" as a prerequisite for links; any plan to compute module coupling or cycles ourselves (read `graph_*` instead, checking for the pass).
- **Adopt:**
  - `refs` / element-table schema (export JSON);
  - `show catalog status --json`;
  - `graph-report` and `report` / `lint` JSON;
  - JUnit plus Office envelope;
  - Brain entry ids and `check --json` states;
  - session-report's de-dup rule;
  - loop-report JSON.
- **Remains Office's:**
  - revision binding of everything derived;
  - commit-pinned work folders and the catalog cache key;
  - coverage and limitation labels;
  - test-run envelopes and freshness;
  - task and attempt identity and usage attribution;
  - pricing;
  - human review, acceptance and audit;
  - writer controls (lease, MCP unsaved state);
  - test-mode credential rules.

## 11. Smallest next step

**Experiment (post-demo, about half a day, scratch only): "catalog-backed impact baseline".**

Steps:
1. In the disposable copy at `ff1c9d2`, with the installed nightly, export the `refs` JSON and element tables, and join the GUIDs.
2. Repeat at one earlier commit, for example the parent of PR #77's merge.
3. Write expected answers first for three questions:
   - Graph Studio Q4 (a two-hop microflow → sub-microflow → entity path);
   - "what does changing `TravelRequest.Status` affect";
   - "which pages show `TravelRequest` data".
4. Answer them from the export and from `refs`, `impact` and `callers --transitive` alone.
5. Diff the two commits' edge sets.

Nothing touches Office code or a live floor.

**Prerequisites:** the frozen copy (exists), the installed nightly unchanged, and `node:sqlite` or plain JSON processing in a scratch script. No credentials and no paid calls.

**Acceptance criteria (measurable):**
1. **Resolution:** at least 99% of edges whose target is an entity, attribute, association, microflow, nanoflow, page, snippet or workflow get a target GUID. Today's partial join: 100% for those types except nanoflows, which weren't in the join.
2. **Determinism:** two exports of the same commit, with a forced rebuild in between, are byte-identical (shown once today).
3. **Cost** per commit on travel-approval: at most 15 s cold, at most 3 s after a revision switch, and at most 1 s for the export call.
4. **Honesty:** for 5 sampled attributes, the report lists `refs` recall against `search`. Each miss is classified (expression-only, constant, dynamic), and none is reported as "no dependency".
5. **Freshness:** switching commits shows `valid: false` before the rebuild and `valid: true` after, and the export records the commit sha it came from.
6. **Usefulness:** all three questions answered correctly against the expected answers, with the time and number of calls recorded. This becomes baseline (b) for Graph Studio phase 0.

**Independently useful** (each worth doing without Graph Studio):
- a catalog-backed "used by" panel in the Model tab, built on the commit work folders;
- pinning mxcli per project;
- the JUnit envelope importer;
- the de-dup fix in `usage.ts`;
- dropping the duplicate lessons instruction;
- per-attempt `MXCLI_LOG_DIR` for loop metrics.

**Dependencies of larger features:**
- the graph exporter (Graph Studio phases 0–2);
- attempt-bound usage (Testing release 3, which needs F2);
- the Brain review UI (needs queue survival);
- the Library source adapter (K1);
- the MCP writer path in the mutation lease (C3);
- evaluating a newer mxcli (session-report, playwright check, schema 23) in a separate folder, with the user's approval, before any upgrade of the office's binary.

## 12. What could not be verified

- `diag session-report`, `eval run` and `playwright check` behaviour: not in the installed binary. Read from upstream source and docs only. No synthetic transcript fixture was run, because no installed command could read it.
- Whether the de-dup double-count case (sidechain records in both the main and subagent files) occurs with the Claude Code version in use. Real transcripts were deliberately not opened.
- Studio Pro MCP capability output, Concord's origin and installation, idempotence over MCP, and behaviour after a timed-out write.
- `mxcli test` and `playwright verify` real runs, JUnit files from them, and the lint exit code with error-severity findings (also open in benchmark discovery).
- Catalog cost on a large app (only 558 units measured), and the cost and benefit of upstream schema 23 (loop containment, commit ref kind, widget tree).
- Whether `brain capture` has been used by any agent in a worktree (queues weren't searched across worktrees). Only the main checkouts were listed.
- Whether travel-approval's floor scripts currently use the 11.6.4 `MXBUILD_PATH` in its `toolkit.env`.
- The website's full print edition (about 820k characters) was not read page by page. The relevant pages were read from the docs source at the installed commit and at upstream `main`, and spot-checked on the site (`session-report.html` present, `tools/reference-tracking.html` 404).

## 13. Appendix: commands run

All in Git Bash. `M` is `<spike>\tools\mxcli\mxcli.exe`. All runs were in `<copy>`, with `GH_TOKEN`, `GITHUB_TOKEN` and `GH_CONFIG_DIR` unset.

```text
M --version; M --help; M <cmd> --help                  # help text for every command named above
M -p project.mpr -c "show catalog status" [--json]
M -p project.mpr -c "refresh catalog full" | "... full force" | "... full source" | "refresh catalog communities"
M -p project.mpr -c "select SourceType, TargetType, RefKind, count(*) ... from CATALOG.refs group by ..."
M -p project.mpr --json -c "select SourceType, SourceId, SourceName, TargetType, TargetName, RefKind from CATALOG.refs order by ..."
M refs|callers [--transitive]|callees|impact|context [--json] -p project.mpr <qualified name>
M graph-report -p project.mpr --format json -o graph.json
M report -p project.mpr --format json -o report.json ; M lint -p project.mpr --format json
M -p project.mpr -c "select * from CATALOG.graph_cycles"     # before and after communities
M search -p project.mpr IsEscalated --format names
M test tests/ -p project.mpr --list ; M playwright verify tests/ --list
M brain check|plan|show|staged -p project.mpr --json
MXCLI_LOG_DIR=<scratch>/logs M diag loop-report --log-dir <scratch>/logs --json
git checkout 0a88767~1 / ff1c9d2 in <copy>                    # freshness test
python -I (read-only sqlite URI) over <copy>/.mxcli/catalog.db  # GUID resolution join
```
