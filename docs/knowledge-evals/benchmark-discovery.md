# Knowledge & Evals: leave-approval benchmark discovery (E3)

Back to the [gap map](gap-map.md).

This is increment **E3** of the [gap map's build order](gap-map.md#5-implementation-order): build the synthetic baseline app for the spec's leave-approval case (§9), find the supported way to check a running app, pin the model-check commands, and design the hidden verifiers. Everything here was **run locally on 7 October 2026**. No model calls were made and no agents ran. It closes the first three items of the gap map's "Not verified" list (runtime assertion path, `mxcli check`/`lint` command lines, `gate-check.sh`) and the question of two live apps side by side.

The user's decisions this builds on: runtime checks use the live app, Playwright and database reads; the benchmark runs in this office in test mode; the cap is $100 per arm; evals are advisory by default.

Scripts and fixtures are under [`scripts/benchmark/`](../../scripts/benchmark/). Scratch output (the baseline repo, logs, the bundle) is under `C:\Users\z00556et\agent-spike\scratch\benchmark\`, outside every project folder.

## Contents

1. [Answers in short](#1-answers-in-short)
2. [Pinned versions](#2-pinned-versions)
3. [The baseline app](#3-the-baseline-app)
4. [Model checks: exact commands, outputs, exit codes](#4-model-checks-exact-commands-outputs-exit-codes)
5. [Running-app checks](#5-running-app-checks)
6. [Hidden verifier suite design](#6-hidden-verifier-suite-design)
7. [Reset per trial](#7-reset-per-trial)
8. [Importing an external Claude Code session as arm A](#8-importing-an-external-claude-code-session-as-arm-a)
9. [Open problems and decisions needed](#9-open-problems-and-decisions-needed)
10. [E4 plan](#10-e4-plan)

---

## 1. Answers in short

- **Baseline built.** A Mendix 11.12.4 app called `LeaveBaseline`, made with `mx create-project` and extended with two MDL scripts. It has an HR module (employees with logins and line managers), an unrelated Notices module, three user roles, six test identities, seed data loaded at startup, two pages and navigation, with security set to Production. `mx check` reports 0 errors. It's a git repo with three commits, HEAD `1cd01e4`. The bundle is 19.2 MB, sha256 `a52d735c…f3ae`.
- **Model checks pinned.**
  - `mx check` and the toolkit's `verify-model.sh` give the consistency verdict.
  - `mxcli lint --format json` and `mxcli report --format json` give the findings.
  - The toolkit's `lint-gate.sh` is the ratchet.
  - **`gate-check.sh` is a process-stage gate** (intake, BRDs, blueprint and so on), not a delivery check. It shouldn't grade criterion 8. At most it's an advisory process-adherence signal.
- **Runtime path.** All three channels work, and they complement each other:
  - **(a) Playwright** against the app's own UI. playwright-core 1.63.0 with its headless Chromium, logging in at `login.html`.
  - **(b) Persisted state.** The app runs on **PostgreSQL** (18.3, `127.0.0.1:5432`). Read it with `mxcli oql --direct` through the runtime's admin API, using entity names. Plain SQL also works: tables are named `module$entity` in lowercase.
  - **(c) Acting as a user, below the UI.** Log in a Playwright browser context as the test user, then call the Mendix client API (`mx.data.get/action/create/commit`) inside the page. The **runtime enforces entity access and microflow access** on these calls. They return `"Executing action failed for security reasons"` for a microflow the role can't run, and a refused commit for an entity the role can't create. This is the "direct supported data/API access" channel for the negative tests (criteria 3 to 5), and it doesn't depend on how the agent built its UI.
- **Side by side.** Two live apps ran at once (ports 8210–8212 and 8220–8222, databases `bench_baseline_t1` and `bench_baseline_t2`) without interfering. Parallel trials are possible if each gets three ports and its own database.
- **Blockers found and worked around** (both affect E4):
  1. On this machine `mxcli run --local` fails on its first use of a version, because it tries to create a symlink and Windows denies that without the privilege. A directory junction fixes it once per version.
  2. The ambient `MXBUILD_PATH` points at Studio Pro 10.24, so toolkit scripts refuse an 11.12.4 model unless the harness pins `MXBUILD_PATH`, as the office already does with `toolkit.env`.
- **The main open design problem: binding.** Hidden verifiers can't know the names the agent picks for its entity, attributes, pages and microflows. A small public **verification interface** is needed, with fixed names or a manifest the agent fills in (section 9, decision 1). Without one, criteria 1 to 7 can't be checked mechanically.

## 2. Pinned versions

| Component | Version / identity | How read |
|---|---|---|
| Studio Pro / mx Toolset | **11.12.4** (`C:\Program Files\Mendix\11.12.4`) | `mx show-version LeaveBaseline.mpr` → `11.12.4` |
| mxbuild | Studio Pro 11.12.4's bundled `modeler\mxbuild.exe` | `--mxbuild-path` / `MXBUILD_PATH` |
| Mendix runtime | 11.12.4, cached at `%USERPROFILE%\.mxcli\runtime\11.12.4` (345 MB download from cdn.mendix.com on first `run --local`) | run log |
| mxcli | **nightly-20261003-14a0a7c0c** (2026-10-03T08:29:41Z), `C:\Users\z00556et\agent-spike\tools\mxcli\mxcli.exe` | `mxcli --version` |
| Toolkit | mendix-toolkit at **a877728** | `git log -1` |
| JDK | Eclipse Temurin 21.0.5.11 (on PATH; the model's Java version is 21) | `show settings` → `Java: 21` |
| PostgreSQL | **18.3** x86_64-windows, service on `0.0.0.0:5432`, user `postgres`/`postgres` (the office's live-app defaults) | `select version()` |
| Node | 24.19.0 | `node --version` |
| playwright-core | 1.63.0 (an office dependency); browsers in `%LOCALAPPDATA%\ms-playwright` (chromium-1247, headless shell) | `package.json` |
| Baseline | git HEAD `1cd01e4c2ce661a45264af45a9dddb89bb216d68`; bundle sha256 `a52d735c9d308a33fb7de9752fce84e205012a003837194c53281ce91d8ef3ae` | `git rev-parse`, `sha256sum` |

**License.** The runtime starts with a **trial license** and logs: "the framework will be terminated when the maximum time is exceeded". The time limit and any named-user limit weren't measured. A trial whose live app stays up for hours could be stopped by the runtime itself (section 9).

## 3. The baseline app

**How it's built** (reproducible from nothing with [`scripts/benchmark/baseline/build-baseline.sh`](../../scripts/benchmark/baseline/build-baseline.sh)):

1. `mx create-project --app-name LeaveBaseline --output-dir <dir>`, the same command the office wizard uses (`src/server/wizard/mendix-app.ts:98`). This uses the Blank template and took **41 s**.
2. A `.gitignore` with the wizard's `MENDIX_IGNORES` list, then `git init -b main`.
3. `mxcli exec 01-domain.mdl -p LeaveBaseline.mpr` (8.6 s). This creates:
   - modules `HR` and `Notices`;
   - `HR.Employee` (`EmployeeNumber` unique, `FullName`, `Email`);
   - `HR.Employee_User` (to `System.User`);
   - `HR.Employee_Manager` (Employee → Employee);
   - `Notices.Notice` (`Title`, `Body`, `PublishedOn`).
4. `mxcli exec 02-security-seed-ui.mdl -p LeaveBaseline.mpr` (27 s). This adds:
   - Module roles `HR.Employee`, `HR.Manager`, `HR.Admin`, `Notices.Reader` and `Notices.Editor`.
   - Entity access. Every employee can read the directory; only admins write.
   - The after-startup microflow `HR.ASu_SeedBaseline`. It seeds six employees, linked to their logins and managers, and one notice, but only into an empty database.
   - Pages `HR.Employee_Directory` (`/p/directory`) and `Notices.Notice_Overview` (`/p/notices`), with page access.
   - User roles `Employee`, `Manager` and `Administrator`. The template's `User` role and demo users are dropped.
   - Six demo users.
   - **Security level Production**, with demo users enabled.
   - Navigation (Home, Employee directory, Notices).
5. `mx check` (59 s): `The app contains: 0 errors.`
6. One mxbuild build, then commit. The first build regenerates about 50 generated JavaScript and Java action stubs. Without this commit, every fresh clone's first build leaves them dirty.

**Test identities** ([`fixtures/identities.json`](../../scripts/benchmark/fixtures/identities.json)). All six share the password `Bench-Passw0rd-2026`. The template's policy needs at least 12 characters and a digit.

| Login | User role | Employee | Manager |
|---|---|---|---|
| emp.alice | Employee | E001 | mgr.maria |
| emp.bob | Employee | E002 | mgr.maria |
| emp.carol | Employee | E003 | mgr.mark |
| mgr.maria | Manager | M001 | — |
| mgr.mark | Manager | M002 | — |
| admin.ada | Administrator | A001 | — |

These were verified on a running app:
- **Seed data:** six `hr$employee` rows with the right logins and managers, and `Baseline: Seeded 6 employees and 1 notice` in the runtime log. Demo users already exist when the after-startup microflow runs, so the links are filled in.
- **UI:** as alice and as maria, `/p/directory` shows 6 rows and `/p/notices` shows the welcome notice. Anonymous visitors are sent to `login.html#/directory`.

**What the baseline deliberately leaves out:** anything about leave. Also note:
- The Manager user role contains the `HR.Employee` module role as well. Authorization tests must use user roles, not module roles.
- The Administration module from the template lets every `Administration.User` read all `Account` names (alice could list 6 accounts through the client API). That's template behaviour, left as it is.
- Lint finding `SEC003` (demo users at Production level) is expected. Demo users *are* the test identities.

**What remains for the case freeze (not done here):**
- Decide whether the starting bundle includes the **toolkit scaffold**, by running `init-project.sh` once and committing the result (section 9, decision 2). It was tried on a clone (`scratch\benchmark\toolkit-probe`): **1496 s** (25 min, just under the wizard's 25-minute limit), exit 0, 72 changed or new files.
- Configure the scaffold's lint rule `CONV020` (`PROJECT_MODULES`) for HR and Notices.
- Add the verification interface text (decision 1) to the public case.

## 4. Model checks: exact commands, outputs, exit codes

All of these were run on the baseline. Times are wall-clock on this laptop.

| Check | Exact command | Result on baseline | Exit codes / parsing |
|---|---|---|---|
| Model consistency (Studio Pro) | `"C:\Program Files\Mendix\11.12.4\modeler\mx.exe" check LeaveBaseline.mpr` | `The app contains: 0 errors.` (59 s) | 0 = ok. Parse `The app contains: (\d+) errors`. |
| Model consistency (toolkit gate) | `MXBUILD_PATH='C:\Program Files\Mendix\11.12.4\modeler\mxbuild.exe' bash bin/verify-model.sh --no-stamp` (in a project with the toolkit scaffold) | `✓ mxbuild: 0 errors — model is clean.` (61 s) | 0 clean · 1 errors · **2 = the gate couldn't run (nothing verified)**. With the ambient `MXBUILD_PATH` (10.24) it exited 2: `Project version '11.12.4' does not exactly match MxBuild version '10.24.25.122571'`. |
| MDL script check (before exec) | `mxcli check <file.mdl> -p LeaveBaseline.mpr` | `Check passed!` | 0 ok. Warnings such as MDL077 don't fail it. |
| Lint (built-in rules; Starlark rules only when `.claude/lint-rules/` exists) | `mxcli lint -p LeaveBaseline.mpr --format json` (or `-m HR,Notices` to scope it) | 1 finding: `SEC003` warning (3–6 s) | **Exit 0 with warnings.** Parse `summary.errors/warnings`. The exit code with *error*-severity findings wasn't observed. |
| Best-practice report | `mxcli report -p LeaveBaseline.mpr --format json -o report.json` | `overallScore: 99.2`; categories Security 97, the others 100 (9 s) | 0. Keys: `projectName, date, overallScore, summary, categories[], violations[]`. |
| Lint ratchet (toolkit) | `bash bin/lint-gate.sh` (`--update-baseline` once at freeze) | First run: exit 2, `no baseline …`. After a baseline: `36 findings on our modules (baseline 36)`, `PASS — nothing got worse`, but **exit 1** because `CONV020` "inspected NOTHING". | 0 clean · 1 a rule rose **or a rule couldn't read the model** · 2 couldn't run. It also needs `mxcli.exe` in the project root (git-ignored, so it's copied in per trial). Fix CONV020 in the baseline, or parse the verdict line. |
| Security overview (static authorization) | `mx.exe export-security-overview -t json -e -o security.json LeaveBaseline.mpr` | Full JSON: `entityAccess[]` (per user role: XPath, canCreate/canDelete, member access), `documentAccess[]`, `userRoles[]` (14 s) | **Exits 1 even though the export is complete.** Validate the JSON, not the exit code. |
| Security matrix (mxcli) | `mxcli -p LeaveBaseline.mpr --json -c "show security matrix in HR;"` | Rows `{ObjectType, QualifiedName, Rights, Roles}` | 0 |
| Stage gate (toolkit) | `bash <toolkit>/bin/gate-check.sh --no-html <project-dir> [stage]` | Informational run, 186 s: stage PENDING rows (BRDs, blueprint, wireframes…) | No stage given: always 0. With a stage: PASS/WAIVED 0, FAIL 1, MANUAL 2, PENDING 3. **Not a delivery check** (it checks the conversion process). The wizard calls it the same way (`src/server/wizard/steps.ts:268`). |

**Other findings:**
- `mxcli test` (microflow tests, `--local` boots its own runtime on 8081/8091 with a `<project>_test` database) **injects generated microflows into the model** and runs them as the system. That's useful for seeding inside the throwaway verifier clone, but useless for authorization.
- `mxcli eval check` checks static presence (entity_exists, page_exists) against Markdown eval files. It could cover the structural part of the verification interface.

## 5. Running-app checks

### Starting an app the way the office does

The office's live app (`src/server/liveapp/app.ts:166-170`) runs, in the app's folder:

```
mxcli run --local -p LeaveBaseline.mpr --mxbuild-path "C:\Program Files\Mendix\11.12.4\modeler\mxbuild.exe" \
  --app-port 8210 --admin-port 8211 --serve-port 8212 \
  --db-host 127.0.0.1:5432 --db-user postgres --db-password postgres --db-name bench_baseline_t1 --ensure-db
```

The office passes `MXBUILD_PATH` through the floor's `toolkit.env` rather than `--mxbuild-path`. It puts PostgreSQL's `bin` on PATH, because `--ensure-db` calls `psql`/`createdb`. It treats any HTTP response below 500 on the app port as "up". [`scripts/benchmark/trial-app.sh`](../../scripts/benchmark/trial-app.sh) `start` does the same with pinned inputs.

| Start | Time to HTTP 200 | Notes |
|---|---|---|
| First ever for 11.12.4 | 248 s | Runtime already downloaded. Web client bundling took 2 min 8 s. |
| Fresh clone #2, run while #1 was still up | 105 s | Bundling 21 s |
| Fresh clone #3, from the bundle via `trial-app.sh` | 147 s | Clone took 2 s |

**Blocker 1: symlink privilege.** On its first use of a version, `mxcli run --local` links `~\.mxcli\runtime\<v>\runtime` into `~\.mxcli\mxbuild\<v>\runtime` and fails with `A required privilege is not held by the client`. That happens even with `--mxbuild-path`. The workaround is a one-time junction per version (no privilege needed):
`mklink /J %USERPROFILE%\.mxcli\mxbuild\11.12.4\runtime %USERPROFILE%\.mxcli\runtime\11.12.4\runtime`.
The 11.12.2 link from earlier today exists as a real symlink, so whatever made it ran with the privilege. E4's environment preflight must check for this link.

**Blocker 2: ambient `MXBUILD_PATH`.** This machine's user environment has `MXBUILD_PATH=…\10.24.25.122571\modeler\mxbuild.exe`. Every trial process (agents included) must get 11.12.4's path explicitly, as `withFloorToolkitEnv` does for floors. Otherwise toolkit gates exit 2 and builds fail.

**Runtime facts:**
- The app writes its log to `<project>\.mxcli\runtime.log`.
- `.mxcli\run-local.json` holds `pid`, `appPort`, `adminPort`, `adminPass` and `bootConfig` (`DTAPMode: "D"`).
- Stopping means killing the whole mxcli tree (`taskkill /T /F`, as `liveapp/process.ts` does).
- Port 8080 (mxcli's default) is taken on this machine by an unrelated Python process. That's another reason to always pass ports.

### (a) Driving the UI with Playwright

See [`scripts/benchmark/probe-ui.mjs`](../../scripts/benchmark/probe-ui.mjs). Run it from the office checkout so `playwright-core` resolves: `node scripts/benchmark/probe-ui.mjs --url http://127.0.0.1:8210 --user emp.alice,mgr.maria`.

- **Login:** `GET /login.html`, then fill `#usernameInput` and `#passwordInput`, then click `#loginButton`. Wait for `.mx-page`. Login took 1.5–2.8 s.
- **Pages** open by URL at `/p/<url>` (for example `/p/directory`). Anonymous users are sent to `login.html#/<url>`.
- **Data grid 2** rows are `.widget-datagrid [role="row"]` and cells are `[role="gridcell"]`.
- `mx.session.getUserRoleNames()` returns the user role, for example `["Employee"]`.
- The full probe (anonymous plus two users, two pages each, screenshots) took 69 s, mostly fixed waits.

UI selectors for the *agent's* screens can't be known in advance. That's why the verification interface (decision 1) names pages and field labels, and why negative tests don't go through the UI.

### (b) Reading persisted state

- **Database:** PostgreSQL, one database per app (`--db-name`). The office keys it by floor: `databaseName(floorId)` gives `<floor>_live`.
- **Schema naming:**
  - Tables are `public."<module>$<entity>"` in lowercase (`hr$employee`, `notices$notice`, `system$user`, `administration$account`).
  - Attributes are lowercase columns.
  - A one-to-many association is a column named after the association (`"hr$employee_user"`, `"hr$employee_manager"`) holding the other row's `id`.
  - A many-to-many association is its own table (for example `system$userroles`).
  - Metadata is in `mendixsystem$entity` and `mendixsystem$attribute`, which can map entity names to tables.
  - **System members** (`createddate`, `changeddate`, `owner`, `changedby`) only exist if the agent enables them. The baseline has none.
- **Preferred read path: OQL through the runtime's admin API**, using entity names, so it doesn't depend on storage. It's read-only (it runs in rollback mode) and takes about 2 s:
  ```
  mxcli oql --direct --host 127.0.0.1 --port <adminPort> --token <adminPass from .mxcli/run-local.json> --json \
    "SELECT e.EmployeeNumber AS Num, u.Name AS Login FROM HR.Employee AS e LEFT JOIN e/HR.Employee_User/System.User AS u"
  ```
  stdout is clean JSON (warnings go to stderr). Values come back as **strings** (`"n": "6"`). `mxcli oql -p app.mpr` without `--direct` looks for Docker on 8090 and fails for `run --local`. Wrapped as `trial-app.sh oql <dir> "<OQL>"`.
- Direct SQL (`psql -h 127.0.0.1 -U postgres -d <db>`) works too. It's useful for the reset (drop and create) and as a fallback grader.

### (c) Calling the app as different users (authorization negative tests)

See [`scripts/benchmark/probe-client-api.mjs`](../../scripts/benchmark/probe-client-api.mjs). Each user logs in through a Playwright context, then `page.evaluate` calls the Mendix client API that ships with the React client. The runtime checks every call against that user's session.

| Probe (as `emp.alice`) | Result | Meaning |
|---|---|---|
| `mx.data.get({xpath:'//HR.Employee'})` | 6 objects | Arbitrary XPath is accepted, filtered by entity access (here: read all). |
| `mx.data.action({params:{actionname:'HR.ASu_SeedBaseline'}})` | `Executing action failed for security reasons: HR.ASu_SeedBaseline.` | **Microflow access is enforced by name**: this is how criterion 4 is tested. |
| `mx.data.create` + `commit` on `Notices.Notice` (Reader only) | Commit fails (`Internal server error`) | Entity create rights are enforced. |
| Same create as `admin.ada` (Editor) | Committed | It's a positive control, so the probe itself works. |

- Raw `/xas/` calls from curl worked for `login` (they return `csrftoken` plus the `XASSESSIONID` cookie). `retrieve_by_xpath` with a guessed payload returned `{"type":"exception","result":560}`. The internal protocol wasn't pursued: the browser's own client API is the supported surface.
- **Caveat:** `mx.data` is Mendix's *legacy* client API. It's present and working in 11.12.4's React client but deprecated. Pin the Mendix version per case revision, and keep the probe helpers in one module so a replacement can be swapped in.

### Two live apps side by side

This was verified. App 1 (8210/8211/8212, `bench_baseline_t1`) and app 2 (8220/8221/8222, `bench_baseline_t2`, a separate clone) were both up, and each served its own seed. Requirements for each app:
- three free ports;
- its own database;
- its own checkout. `deployment/` and `.mxcli/` live in the project folder, so two apps can't share one.

Use a benchmark port range outside the office's `8110-8199` (for example 8200–8299) and never 4600. Each app is two JVM-heavy processes (mxbuild serve plus runtime), so machine memory is the practical limit. It wasn't measured here.

## 6. Hidden verifier suite design

### Check types

| Code | Type | Tool |
|---|---|---|
| **UI** | Playwright as a test identity, through the agent's pages named in the verification interface | `runtime-fixture` grader |
| **API** | Playwright login plus the `mx.data.*` client API in the page: runtime-enforced access, independent of the UI | `runtime-fixture` |
| **DB** | OQL through the admin API (SQL as fallback). This is the ground truth for persisted state | `runtime-fixture` |
| **STATIC** | `mx export-security-overview` / `mxcli` describe on the frozen model | `mxcli-check` |
| **GATE** | `mx check`, `verify-model.sh`, `mxcli lint`, `lint-gate.sh` | `mxcli-check` / `gate-check` |

### Per criterion

The names `Leave.LeaveRequest`, `StartDate`, `EndDate`, `Status`, `Reason`, `DecidedBy` and `DecidedOn`, and the microflows `ApproveRequest` and `RejectRequest`, stand for whatever the verification interface fixes (decision 1). The setup steps of each fixture use alice, bob and carol to submit requests through the UI path of criterion 1. If setup fails, criterion 1 fails and the dependent criteria are recorded as `inconclusive (dependency)`, not as passes or harness faults.

| # | Criterion | Checks | Pass when |
|---|---|---|---|
| 1 | Valid request persists and shows for its owner | **UI** alice submits 2026-11-02 to 2026-11-04 → **DB** exactly one new row owned by alice's employee/user, status Submitted, dates equal → **UI** alice's own list shows it after a reload | All three hold |
| 2 | End before start is rejected, nothing invalid persisted | **UI** alice submits end < start → a validation message is visible → **DB** count unchanged and no row with `EndDate < StartDate`. **API** bypass: if the role can create the entity, create and commit end < start through `mx.data` → refused → **DB** still none | No invalid row exists at any point. A client-only check fails the bypass. |
| 3 | Employee can't read another's request (UI or direct access) | Setup: alice and bob each have one. **UI** bob's list has no alice rows. **API** as bob: `get('//Leave.LeaveRequest')` contains only bob's; `get` with alice's request id → empty. **STATIC** the Employee user role's read rule on the entity has a non-empty owner XPath (advisory evidence) | The UI and API checks pass. STATIC alone never passes it. |
| 4 | Employee can't invoke decision actions directly | **API** as alice on her own Submitted request: `action('Leave.ApproveRequest', guids:[id])` and the reject equivalent → security error. If Status/DecidedBy/Reason are writable members: `set` plus `commit` → refused → **DB** status, decider and reason unchanged | DB unchanged and no success from any call |
| 5 | Manager can't decide an unassigned employee's request | **API** as mgr.mark on alice's request (alice reports to maria): approve and reject calls → error or no effect. `get` by id ideally empty → **DB** unchanged. **UI** mark's approval list has no alice rows | DB unchanged. Visibility to mark is reported as a finding, not a fail, because the requirement only forbids deciding. |
| 6 | Submitted → approved or rejected once; terminal decisions can't be overwritten | **UI** maria approves alice's → **DB** Approved. Then **API** maria rejects the same → **DB** still Approved, decision fields unchanged. The same with bob's: reject with a reason, then try approve | Both terminal states are stable against the decider's own second attempt |
| 7 | Rejection needs a reason; actor, timestamp and reason persist | **UI** and **API** mgr.mark rejects carol's request with an empty reason → error → **DB** still Submitted. With a reason: **DB** Reason equals the input, DecidedBy is mark's user or employee, DecidedOn is inside [t_before, t_after]. The same actor and time check for an approval | All of these hold |
| 8 | Baseline regression and model consistency | **GATE** `mx check` 0 errors (or `verify-model.sh` exit 0). `mxcli lint` no new *error* findings; `lint-gate.sh` no rule rises (advisory until CONV020 is fixed). **UI** all six identities log in; `/p/directory` shows 6 rows; `/p/notices` shows the welcome notice; anonymous users go to login. **DB** the six seeded employees and their manager links are intact. **STATIC** the baseline entities' access (HR.Employee, Notices.Notice) and page access are unchanged against the frozen `security.json` from the baseline | All of these hold |

**General rules:**
- Every runtime fixture records its own HTTP and console evidence plus the OQL results. Screenshots are kept as evidence only, never graded.
- A failed Postgres or port, a build that fails *before* the model is checked (`verify-model.sh` exit 2), the junction preflight, or a Playwright launch failure → `error` with `harnessFault: true`. The grading is retried under the predeclared policy (for example 2 retries).
- An agent's build that fails its model check is a **criterion 8 failure**, not a harness fault. Criteria 1 to 7 are then `inconclusive (no runtime)`.
- Fixtures only test what the public text states. "Approve or reject once" and "reason required for rejection" are both in the requirement. Hidden tests add data shapes (bob, carol, mark), not rules.

### Where the hidden fixtures live

- Case revision: `<officeDir>/benchmarks/leave-approval/<rev>/`, which is outside `<data>/floors`, outside every floor checkout and outside the scratch trial folders. It contains:
  - `case.json` (public prompt and verification interface, the 8 criteria, limits: $100 per arm and a wall-clock ceiling, environment pins from section 2);
  - `starting/baseline.bundle` plus its sha256;
  - `verifiers/` (`c1.mjs` … `c8.mjs`, the shared `lib/session.mjs` with login and `mx.data` helpers, `expected/security-baseline.json`);
  - `MANIFEST.sha256` (one line per file plus a tree hash).
- Grading copies `verifiers/` into `<data>/evals/verify/<runId>/` next to a detached clone of the trial's `finalSha` (remotes removed, as in `firm/isolation.ts`). It runs them **with the office's own `node` and `playwright-core`**, with `cwd` set to the verifier folder, never the trial checkout. It re-hashes the folder before and after.
- It also checks that no verifier file name or content hash appears in the delivered repo, and greps the trial's transcripts for the verifier folder's path. A hit is a harness fault and voids the trial.
- Limit (as in the gap map): agents run as the same OS user, so this is tamper-*evidence*, not a security boundary. For the paid experiment, consider a separate Windows user for `benchmarks/`.

## 7. Reset per trial

Measured with `scripts/benchmark/trial-app.sh`:

1. **Fresh checkout:** `trial-app.sh reset <bundle> <trial-dir>` clones the bundle and removes origin (2 s). It then checks `HEAD == 1cd01e4…` (the case's base sha). In the office, the trial dir becomes a **new test-mode floor** (`src/server/testmode.ts`) with its own id, so its live-app database name `<floor>_live` is new by construction.
2. **Pinned environment:** `MXBUILD_PATH` set to 11.12.4's mxbuild through the floor's `.claude/toolkit.env` (written by the harness, never inherited), `MXCLI_VERSION`, and the trial's config manifest (shape, models, effort, autonomy, budget cap of $100, toolkit commit, mxcli version, Library corpus hash).
3. **Fresh database:** refuse to start if the target database already exists (`trial-app.sh start` does). `--ensure-db` creates it. On startup the runtime syncs the schema and the after-startup microflow seeds it (about 10 s inside the start).
4. **Fresh runtime state:** a new clone means no `deployment/` and no `.mxcli/`, so the first build is cold (105–250 s). Before grading, the verifier workspace gets its *own* fresh database (`<runId>_verify`). Grading never reuses the database the agents worked against, because agents may have left data in it.
5. **Teardown:** `trial-app.sh stop <dir>` (kills the tree by the pid in `.mxcli/run-local.json`), `trial-app.sh drop <db>`, and archive or remove the trial folder after the freeze. No sessions are carried over: new worktrees, new PTYs, no resumed Claude sessions.
6. **One writer per trial:** use the mutation lease (C3 in the gap map) when it exists. Until then, record writer counts from the trace.

Expected overhead per trial, outside agent time: about 5 min for setup and about 5–8 min for grading. Grading is one cold start (about 2.5 min), `mx check` (1 min), lint and security export (under 30 s) and the 8 fixtures (estimated 2–3 min, since the probes took 1–1.5 min per three users).

## 8. Importing an external Claude Code session as arm A

- **Where transcripts are:** `%USERPROFILE%\.claude\projects\<encoded cwd>\<sessionId>.jsonl`. The encoding is `path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-')` (`src/server/analysis/transcript.ts:31-32`). **Subagent transcripts are in `<encoded cwd>\<sessionId>\subagents\*.jsonl`** (seen in this session's own folder). `readSession()` reads only the main file, so an import that skips the subagent files would undercount tokens and cost.
- **Procedure for arm A:**
  1. Reset as in section 7, into a folder that isn't an office floor.
  2. Write the same pinned `toolkit.env`.
  3. Run `claude` there with the identical public prompt, the same tools and permissions, and the same $100 ceiling, enforced by the operator and by `cost-state` if present.
  4. Record the start and finish time and any interventions.
  5. Create a git bundle of the final state.
  6. Build the import bundle the gap map defines: `{schemaVersion, caseRevisionId, declaredConfig, startedAt, finishedAt, git:{baseSha:'1cd01e4…', finalSha, bundle}, transcripts:[main + subagents], interventions}`.
- **Server side** (E5): validate the schema; check that `baseSha` matches the case's bundle; parse each JSONL with `readSession` (tokens, calls, cost from the price table, so marked `estimated` unless there's a `cost-state` line) and `TranscriptReader.feed` (tool calls, active time); sum the main and subagent files; grade `finalSha` with exactly the same verifier run as arms B and C.
- **Fairness note:** arm A doesn't get the office's live app, Firm or board. That's the point of the comparison. It does get the same baseline, toolkit scaffold (if decision 2 says yes), test identities and verification interface.

## 9. Open problems and decisions needed

1. **Binding (verification interface). Blocks E4 fixtures.** The spec's requirement text says nothing about names. The options are:
   - **(a)** Add a short public technical appendix with fixed names: entity `Leave.LeaveRequest`; attributes `StartDate`, `EndDate`, `Status` (enumeration `Leave.RequestStatus` with values Submitted, Approved and Rejected), `Reason`, `DecidedOn`; associations to the owner `HR.Employee` and the decider `System.User`; microflows `Leave.ApproveRequest` and `Leave.RejectRequest` taking the request; pages at `/p/my-leave` and `/p/leave-approvals`, with field labels "Start date", "End date" and "Reason" and buttons "Submit", "Approve" and "Reject".
   - **(b)** The agent writes a `benchmark-binding.json` manifest that the verifier validates against the model.
   - **(c)** A human or LLM maps names after delivery. This adds grader subjectivity.

   **Recommendation: (a).** It's deterministic, it states no new business rules, and it costs every arm the same. It changes the prompt from the spec's verbatim text, so record that in `case.json`.
2. **Starting bundle with or without the toolkit scaffold.** Office floors always have it; an external arm A doesn't need it. Recommendation: **with**, committed once at freeze (25 min, one-off), so every arm starts from the identical tree.
3. **Trial-license runtime limit.** The runtime warns it will terminate after a maximum time. Measure it in E4. If it's shorter than a trial, the live app needs a restart policy, and grading always uses its own fresh start anyway.
4. **Symlink privilege and junction.** This needs an E4 preflight check, and possibly a fix in mxcli (fall back to a junction on Windows).
5. **`lint-gate.sh` exits 1 on a baseline with no `ACT_` microflows** (CONV020 "inspected nothing"). Either seed one `ACT_` microflow in the baseline or treat that line as advisory. Until then, criterion 8 uses the `mxcli lint` JSON summary (`errors`) plus "no rule rose".
6. **`mx export-security-overview` exit code 1 on success.** The grader validates the JSON instead.
7. **`mx.data` is the legacy API.** It's fine for 11.12.4. Re-verify when the case's Mendix version moves.
8. **Not verified here:**
   - the `mxcli lint` exit code when there are error-severity findings;
   - memory use per live app, and how many trials fit in parallel;
   - the license time limit;
   - whether the office's test mode can host a benchmark floor without GitHub. The wizard has an offline-floor path (`steps.ts:160-167`), which looks usable.

## 10. E4 plan

Builds on E2 (eval runner, graders, `eval` billing source). Effort is about 6–8 days, as in the gap map.

1. **Case store** (`src/server/evals/bench/case-store.ts`): create a revision from `scripts/benchmark/baseline/build-baseline.sh` output plus the verifier folder. Compute `MANIFEST.sha256` and freeze on first use. `case.json` carries the pins from section 2 and the verification interface (decision 1). Tests: immutability; manifest mismatch → refusal.
2. **Environment preflight** (`env.ts`): Studio Pro 11.12.4 `mx.exe` and mxbuild present; `mxcli --version` matches the pin; the runtime cache link exists (create the junction if it's missing, or report it); `psql` reachable; JDK 21; playwright-core and a Chromium present; the benchmark port range is free and away from 4600 and 8110–8199. Every failure is a harness fault before any spend.
3. **Trial reset** (`trial.ts`): port `trial-app.sh` reset/start/stop/drop to TypeScript, reusing `liveapp/process.ts` (`startTree`, `stopTree`, `pgBinDir`) and `liveapp/ports.ts` (`pickPorts`). Create the trial as a test-mode floor with a written `toolkit.env`. Base-sha check. One trial at a time at first; parallelism behind a setting once memory is measured.
4. **Freeze and verifier workspace** (`verify.ts`):
   1. take the clone of `finalSha` into `<data>/evals/verify/<runId>/`;
   2. copy the verifiers in and hash them before and after;
   3. scan for leaks in the repo and transcripts;
   4. start the clone's app on a fresh `<runId>_verify` database, with readiness as in `liveapp/app.ts`;
   5. run the GATE checks (`mx check`, lint JSON, security export) and the fixtures with the office's node, one child process per criterion, with a timeout each;
   6. collect one JSON result per criterion: `pass/fail/inconclusive/error`, evidence refs and `harnessFault`;
   7. stop the app and drop the database.
5. **Fixtures** (in the case revision, not in `src/`): `lib/session.mjs` (login, `mx.data` promise wrappers and OQL via the admin API, from `probe-client-api.mjs`); `c1`–`c8` as in section 6; `expected/security-baseline.json` exported from the frozen baseline. First validate them against two hand-built reference solutions in Studio Pro or with mxcli, one correct and one with seeded defects (no owner XPath, client-only date validation, overwritable decision), so each fixture is shown to both pass and fail before any paid trial.
6. **Graders:** `runtime-fixture` (runs one fixture and maps its JSON to a grader result) and `mxcli-check` / `gate-check` (the commands and parsing rules in section 4, with a parse failure giving `error`, never `pass`).
7. **Dry trial in test mode:** a fake agent commits the correct reference solution onto the reset trial. The full pipeline then runs with no paid calls. Then a fake agent that commits the defective solution, to confirm the expected fails. These are the E4 acceptance tests, together with the path-isolation and tamper tests from the gap map.
8. **Then E5 (import and comparison) and X1:** the arm order is randomized; one trial per arm validates the harness (spec §9: not a claim of superiority); the cap is $100 per arm.
