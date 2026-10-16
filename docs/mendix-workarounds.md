# Mendix workarounds

Things mxcli can't do directly, and the standard way around each, so a team tries these before it asks the
Project Manager for a Studio Pro hand-add. Agent Office ships this list and copies it into every project
as `.ai-context/office/mendix-workarounds.md` (re-written by the office on every hire: don't edit that
copy). A project's own entries go in `.ai-context/office/mendix-workarounds.local.md`, which its agents may
add to and the office never overwrites. An entry that holds beyond one project is added here, by a pull
request to the office repo.

Every escalation that asks for a Studio Pro hand-add, or says mxcli can't do something, needs a `Tried:`
section (each attempt with its exact error), or the office hands it back to the agent. Before escalating:
`mxcli syntax <topic>`; `mxcli widget list -p <app>.mpr` / `mxcli widget describe <name> -p <app>.mpr`;
`mxcli marketplace search "<what>"` (a pluggable widget or module that does it); `--engine legacy` for a
write the default engine refuses; `mxcli check -p <app>.mpr` with the attempt; and this list.

One entry per problem, in this format (no customer content: a project or escalation id at most):

- **Problem:** what the page or model needs.
- **Why mxcli can't do it directly:** the error, exactly.
- **Workaround:** the exact commands and MDL.
- **Verified with:** mxcli version, Mendix version, date; and what was verified (and what not yet).
- **Source:** the project or escalation id it came from.

## Image or file upload on a page

- **Problem:** a page needs a control to upload a photo or a file (an Image uploader or File manager).
- **Why mxcli can't do it directly:** Studio Pro's built-in Image uploader and File manager aren't placeable
  with mxcli: `imageuploader` / `fileuploader` in MDL give `MDL-WIDGET25` ("not a widget in this project")
  in a plain Mendix 11.12.4 app.
- **Workaround:** install Mendix's pluggable **File Uploader** widget from the Marketplace (content 235351,
  Apache-2.0, v2.5.1), then place it in MDL:
  1. `mxcli marketplace search "file uploader"` (find content 235351 and its latest version).
  2. `mxcli marketplace install …` with the id and version it lists (needs the Mendix PAT, `MENDIX_PAT`).
  3. `mxcli widget init -p <app>.mpr`, then `mxcli widget describe fileuploader -p <app>.mpr` for its properties.
  4. `fileuploader` in the page's MDL, bound to an entity that specialises `System.Image` (photos) or
     `System.FileDocument` (files).
  5. `mxcli check -p <app>.mpr`, then apply as usual (the one writer, `mxcli exec`).
- **Verified with:** the `MDL-WIDGET25` error: mxcli v0.21.0 and nightly-20261003, Mendix 11.12.4,
  16 Oct 2026. The install: verified on PackTrack 16 Oct 2026 (agent-reported). MDL placement of
  `fileuploader`: not yet verified by the office.
- **Source:** PackTrack, the Lead Developer's "Studio Pro hand-add needed: photo upload control" escalation
  (16 Oct 2026).
