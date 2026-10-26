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
`mxcli marketplace search "<what>"` (a pluggable widget or module that does it: ask for it with
`office-marketplace add`, never install it yourself); `--engine legacy` for a
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
- **Workaround:** get Mendix's pluggable **File Uploader** widget from the Marketplace (content 235351,
  Apache-2.0) through the office, then place it in MDL:
  1. `office-marketplace add --id 235351 --kind widget --version <x.y.z> --name com.mendix.widget.web.FileUploader --why "…"`.
     The Project Manager approves it on Needs you; the office downloads it (or takes a package file the PM
     picked), checks it and commits `widgets/com.mendix.widget.web.FileUploader.mpk` to your branch, then tells
     you. Never install it yourself and never ask for a token (a test office has none).
  2. `mxcli widget init -p <app>.mpr`. The `.mpk` in `widgets/` alone is not enough: `MDL-WIDGET25` stays until
     `widget init` has extracted its definition.
  3. `mxcli widget describe fileuploader -p <app>.mpr` for its properties.
  4. `fileuploader` in the page's MDL, inside a data view of the context object, bound to an entity that
     specialises `System.FileDocument` (files; `uploadMode: 'images'` and `associatedImages` for `System.Image`
     photos), with its required properties:
     ```
     create persistent entity Notices.Attachment extends System.FileDocument ();
     create association Notices.Attachment_Notice from Notices.Attachment to Notices.Notice;
     create nanoflow Notices.ACT_Attachment_Create ($Notice: Notices.Notice)
     returns Notices.Attachment as $Attachment
     begin
       $NewAttachment = create Notices.Attachment (Attachment_Notice = $Notice);
       return $NewAttachment;
     end;
     create page Notices.Notice_Attachments (Title: 'Notice attachments', Layout: Atlas_Core.Atlas_Default, Params: ( $Notice: Notices.Notice )) {
       dataview dv (DataSource: $Notice) {
         fileuploader up (uploadMode: 'files', associatedFiles: $currentObject/Notices.Attachment_Notice, createFileAction: call nanoflow Notices.ACT_Attachment_Create)
       }
     };
     ```
     plus `grant execute` on the nanoflow, `grant view` on the page and entity access for the roles (without
     them `mx check` says CE0106).
  5. `mxcli check -p <app>.mpr`, then apply as usual (the one writer, `mxcli exec`), then `mx check`.
- **Verified with:** mxcli nightly-20261003, Mendix 11.12.4, File Uploader 2.4.1, 26 Oct 2026, on a copy of
  a neutral sample app: `MDL-WIDGET25` with the package in `widgets/` before `widget init`; `mxcli check`
  passed after it; `mx check` 0 errors and `mxbuild` built the package with the page above. (Without
  `associatedFiles` and a create action `mx check` says CE0642.) The upload itself in a running app: not
  verified by the office.
- **Source:** A migration project, the Lead Developer's "Studio Pro hand-add needed: photo upload control" escalation
  (16 Oct 2026).
