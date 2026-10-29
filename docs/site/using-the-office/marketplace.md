---
title: Add from Marketplace
description: How a project gets a Mendix Marketplace widget or module - an agent asks, you approve on Needs you, and the office downloads it with its own credential (or takes a package file you picked), checks it and commits it to the agent's branch. No terminal, no token for agents.
weight: 2.35
---

Some apps need a widget or module from the **Mendix Marketplace**: the File Uploader for a receipt upload, a charting widget, a utility module. In Mendix 11 even "core" upload widgets are packages: until the package is in the app's `widgets/` folder, mxcli refuses a page that uses it with `MDL-WIDGET25 "… package not in widgets/"`.

Agents never install these themselves and never get a token for it. They **ask**, you **approve**, and the **office** does the download, the check and the commit.

## How it goes

1. **An agent asks.** From its terminal, `office-marketplace add --id 235351 --version 2.5.1 --kind widget --name com.mendix.widget.web.FileUploader --why "receipt upload"` (the same as `office-workers marketplace add …`, or the MCP tool `marketplace_add`). The id is the number in the item's Marketplace URL. The agent is told the request is with you and carries on with what doesn't need it.
2. **You see a card in Needs you** (Overview › Needs you, a *Decision*): *Add widget File Uploader 2.5.1 to dev/receipts?* It names the Marketplace item and its link, the version, the **publisher** and the **licence** (when the office could look them up: only with its own Mendix token), the package name to check, who asked and why, and the branch it goes into.
3. **You answer** with one of three buttons:
   - **Download and add**: the office downloads the package with **its own** Mendix credential (🔌 Connections › Mendix). Off, with the reason beside it, when the office has none it may use (a test office, no token saved).
   - **Use a package file…**: a dialog where you pick a `.mpk` you downloaded from the item's page on the Marketplace website, or give its full path on the office's machine. No token needed. This is the way for **test offices** and for anyone without a Mendix token.
   - **Decline: tell &lt;agent&gt;**: with the note you typed in the card's field. The agent is told not to install it some other way.
4. **The office checks the package** before anything changes: it must be a Mendix package (a zip with a `package.xml`), of the kind asked for (widget or module), with the **name** asked for (a widget's id, its package name or its client module name; a module's name) and the **version** asked for. A wrong file is refused in the dialog, with why (*This package is version 2.4.1, and the request is for 2.5.1*), and nothing is written.
5. **The office places and commits it** in the requesting agent's folder, on the branch it asked from, as the office's commit identity (🔌 Connections › git identity, else *Mx Office*). Nothing is pushed.
   - **A widget**: the `.mpk` is copied to `<app>/widgets/` under Studio Pro's file name (`com.mendix.widget.web.FileUploader.mpk`) and only that file is committed, so whatever the agent has staged stays as it was.
   - **A module**: installed with `mxcli marketplace install --file` (mxcli's own writer, which keeps the project's storage format). Only into an app with **no uncommitted changes** (the install rewrites model files the agent may be editing); everything the install changed under the app folder is committed. If the app has uncommitted changes when you approve, that isn't a failure: the checked package is kept, the card says *approved, waiting for &lt;agent&gt; to commit its work* (only **Decline** is left), the agent is told to commit (or put its work aside), and the office tries again every minute and adds the module as soon as the app is clean. After 8 hours of waiting it gives up and the card says why, to approve again later.
6. **The agent is told** (as the office's own message, after its turn): the commit, the files, and what to do next. For a widget that is `mxcli widget init -p <app>.mpr`, then `mxcli widget describe <name>` for its MDL properties.

If the folder moved to another branch meanwhile, or a step fails, nothing is committed: the card stays, says why (*the last try failed: …*), and you can try again or another way. When the agent then asks again for the same item (another version, name or id), its failed request is closed as **superseded** by the new one, so only one card is left.

The agent's folder is always taken against the **project's folder**, never the folder the office happened to be started from (an agent's worktree path can be stored relative, `.agent-office/worktrees/…`; release 78 then failed with a misleading *git isn't installed* unless the office was started from the project folder). A folder that isn't there any more is said as that; *git isn't installed* now means exactly that.

**Company-private Marketplace content.** The Marketplace API mxcli downloads through serves public content and the content private to the token owner's company. So *Download and add* can fetch your company's private items when the office's token belongs to a user in that company. When the Marketplace doesn't show an item to the office's token (not found, forbidden), the card says so in those words: either the item is private to a company that token's user isn't in, or the id or version is wrong; use a token of a user in that company (🔌 Connections › Mendix), or a package file. A refused token (expired, revoked) is said as that.

Only the **Project Manager (an admin)** can act on the card; a member reads it. Through Phone access the office asks for the password again, as for other answers that put code into the project. Every step is in the audit log: `marketplace.request`, `marketplace.added` (with the package's sha256, the commit and the files), `marketplace.decline`, `marketplace.failed`, `marketplace.waiting` (approved, waiting for a clean app) and `marketplace.superseded`.

## Tokens: who holds what

- **The office's download** uses the Mendix credential of 🔌 Connections (saved there, else `MENDIX_TOKEN` / `MX_PAT` the office was started with, else `~/Mendix/.env`). It is put into **that one mxcli child's** environment as `MENDIX_PAT`, with a home folder of its own so mxcli can't fall back on a login stored in your `~/.mxcli`. It never goes into an agent's environment through this feature, a log line, an audit record, the card or a commit; what mxcli says is redacted before anyone sees it.
- **Agents in a real office** still get the Mendix token as before (on every project unless an admin switched it off in 🔌 Connections, as `MENDIX_TOKEN`, `MX_PAT` and `MENDIX_PAT`), which `mxcli marketplace search` and `info` use. This feature doesn't widen that. With *Add from Marketplace* agents no longer need it to install anything, so switching it off per project costs them only Marketplace search.
- **A test office** holds no Mendix token at all: agents get none and the office's own download is off. *Use a package file…* works. See [the test switch](../administration/test-offices.md#marketplace-downloads-in-a-test-office) for the one narrow exception.

## For agents: the recipe

Need a Marketplace widget or module (mxcli says `MDL-WIDGET25`, or the design needs one)?

1. `office-marketplace add --id <content id> --kind widget|module --version <x.y.z> --name <package name> --why "<what for>"`. Give `--name` so a package file can be checked against it.
2. Carry on with what doesn't need it. Don't install it yourself, don't ask for a token, don't escalate a "hand-add in Studio Pro".
3. When the office says it's in your branch (pull or rebase first if you work elsewhere): `mxcli widget init -p <app>.mpr`. The package being in `widgets/` is **not** enough on its own: until `widget init` has extracted its definition (into the app's ignored `.mxcli/widgets/`), mxcli still says `MDL-WIDGET25`.
4. `mxcli widget describe <name> -p <app>.mpr` for its properties, then use it in MDL by its own name (`fileuploader up (…)`), and check with `mxcli check` and `mx check`.

Checked on Mendix 11.12.4 with mxcli nightly 2026-10-03 and the public File Uploader 2.4.1: page refused with `MDL-WIDGET25` before, `mxcli check` passed after `widget init`, `mx check` 0 errors and `mxbuild` built the package once the widget's required properties were set (its associated files over an association, and a create action).

## Limits

- No autonomy shortcut: every request is a card for the Project Manager, whatever the project's autonomy level.
- Publisher and licence are shown only when the office could look the item up with its own token; otherwise the card says to check the Marketplace page.
- A module package states no version of its own: the office checks the version in the file's name when it has one (`Utils_1.4.0.mpk`), else the card says the version was not confirmed.
- Updating a module that is already in the app is left to Studio Pro (mxcli refuses it: it could drop local edits or change entity ids).
- Packages are at most 150 MB.
