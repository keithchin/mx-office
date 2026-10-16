// The administration preset's five starter patterns: each a stable id and version, when to use it, its required
// states, its constraints and a Mendix implementation reference in stock Atlas classes and widgets only (a
// token theme reaches Atlas, not the toolkit StyleGallery's own ds.css classes: 0a finding, learned-stylegallery
// L56-66). The MDL skeletons come from the Atlas gallery page that passed `mxcli check` on Studio Pro 11.12.4
// in step 0a (scratch/design-0a/work/atlas-gallery.mdl, built on the toolkit StyleGallery @7b4b4cf demo data)
// and were re-checked (16 Oct 2026) with `mxcli check -p`, references resolved, against a blank 11.12.4 app.
// They are references to adapt, not pages to paste.
// Each is written into the package as patterns/<id>.md. Pure.

export interface PatternState {
  id: string;
  label: string;
  /** How the state shows in Atlas terms. */
  how: string;
}

export interface Pattern {
  id: string;
  version: number;
  title: string;
  whenToUse: string;
  states: PatternState[];
  constraints: string[];
  /** Atlas classes, button styles and design properties it uses. */
  atlas: string[];
  /** An MDL skeleton (entity, microflow and page names are placeholders: Module.Entity, DS_…). */
  mdl: string;
}

export const PATTERN_VERIFIED = 'MDL checked with `mxcli check -p` (nightly-20261003, references resolved) on a blank Studio Pro 11.12.4 Atlas app; Atlas classes only.';

export const PATTERNS: readonly Pattern[] = [
  {
    id: 'admin.search-results',
    version: 1,
    title: 'List with search and results',
    whenToUse: 'Finding and opening records in a dense administration list: search box, filters, a data grid and a primary "New" action.',
    states: [
      { id: 'results', label: 'Results', how: 'Data grid rows, striped on hover; the count under the grid.' },
      { id: 'empty', label: 'No results', how: 'An `alert alert-info` saying nothing matches and how to widen the search; the New button stays.' },
      { id: 'loading', label: 'Loading', how: 'Atlas’s own grid loading indicator; never a custom spinner.' },
    ],
    constraints: ['One primary action per page (`buttonstyle: Primary`); export and bulk actions are Default.', 'Search filters on the server (XPath or a microflow), never by hiding rows.', 'Columns: identifier first, status as a label, at most 6 columns on desktop.', 'A hidden New button is not security: entity access must refuse the create too.'],
    atlas: ['datagrid / Data grid 2', 'buttonstyle: Primary', 'label label-*', 'spacing-outer-bottom', 'alert alert-info'],
    mdl: `dataview searchBox (datasource: microflow Module.DS_NewSearch) {
  layoutgrid sg { row {
    column (desktopwidth: 8) { textbox search (label: 'Search', attribute: SearchText) }
    column (desktopwidth: 4) {
      actionbutton bFind (caption: 'Search', action: call microflow Module.ACT_Search)
      actionbutton bNew (caption: 'New request', action: call microflow Module.ACT_Request_New, buttonstyle: Primary)
    }
  } }
}
datagrid results (datasource: microflow Module.DS_SearchRequests) {
  column (attribute: Reference)
  column (attribute: Title)
  column (attribute: StatusText)
}`,
  },
  {
    id: 'admin.details',
    version: 1,
    title: 'Details (read-only record)',
    whenToUse: 'Showing one record before acting on it: a header with its identifier and status, grouped read-only fields, and the actions the user may take.',
    states: [
      { id: 'read-only', label: 'Read-only', how: 'Inputs with `editable: never` in a two-column layout grid; labels on top.' },
      { id: 'with-actions', label: 'With actions', how: 'Edit as Primary, destructive actions as Danger behind a confirmation.' },
      { id: 'not-allowed', label: 'Action not allowed', how: 'The button is not shown (visibility by role or condition) and the server refuses it anyway.' },
    ],
    constraints: ['Status as a `label label-*` next to the title, never colour alone (text says the status).', 'Destructive actions ask for confirmation and say what is lost.', 'Read-only means `editable: never` on the widget and access rules on the entity.'],
    atlas: ['layoutgrid (desktopwidth: 6 + 6)', 'editable: never', 'label label-success / label-warning / label-danger', 'buttonstyle: Danger', 'card'],
    mdl: `dataview record (datasource: Module.Request) {
  dynamictext title (attribute: Title, rendermode: H2)
  dynamictext status (attribute: StatusText, class: 'label label-info')
  layoutgrid fields { row {
    column (desktopwidth: 6) { textbox fRef (label: 'Reference', attribute: Reference, editable: never) }
    column (desktopwidth: 6) { textbox fOwner (label: 'Requested by', attribute: RequesterName, editable: never) }
  } }
  actionbutton bEdit (caption: 'Edit', action: show page Module.Request_NewEdit, buttonstyle: Primary)
}`,
  },
  {
    id: 'forms.validated',
    version: 1,
    title: 'Validated form',
    whenToUse: 'Creating or editing a record: grouped inputs, inline validation per field, one Save that cannot be pressed twice.',
    states: [
      { id: 'empty', label: 'Empty', how: 'Inputs with labels on top; required fields marked in the label text.' },
      { id: 'invalid', label: 'Invalid', how: 'Atlas `has-error` on the field with the message under it (validation feedback from the microflow); typed values are kept.' },
      { id: 'saving', label: 'Saving', how: 'The Save button disabled while the microflow runs (Atlas progress on the button).' },
      { id: 'read-only', label: 'Read-only', how: '`editable: never` when the record may not be changed.' },
    ],
    constraints: ['Validate in a microflow and show feedback on the field (validation feedback), not only in a popup.', 'Keep what was typed when validation fails.', 'Prevent a duplicate submit: one Save, disabled while saving.', 'Required business rules live on the server; the form only reports them.'],
    atlas: ['layoutgrid', 'has-error (set by validation feedback)', 'buttonstyle: Primary for Save, Default for Cancel', 'spacing-outer-top'],
    mdl: `dataview form (datasource: Module.Request) {
  layoutgrid g { row {
    column (desktopwidth: 6) {
      textbox fTitle (label: 'Title (required)', attribute: Title)
      textbox fCost (label: 'Cost centre', attribute: CostCentre)
    }
    column (desktopwidth: 6) { textarea fWhy (label: 'Justification', attribute: Justification) }
  } }
  container actions (class: 'spacing-outer-top') {
    actionbutton bSave (caption: 'Save', action: call microflow Module.ACT_Request_Save, buttonstyle: Primary)
    actionbutton bCancel (caption: 'Cancel', action: cancel changes)
  }
}`,
  },
  {
    id: 'admin.approval-status',
    version: 1,
    title: 'Approval and status',
    whenToUse: 'A record that moves through states (draft, submitted, approved, rejected): the current status, who acts next, and Approve / Reject for the person allowed to.',
    states: [
      { id: 'pending', label: 'Waiting for approval', how: '`label label-warning` "Submitted" and an `alert alert-info` naming who decides.' },
      { id: 'approved', label: 'Approved', how: '`label label-success`; the actions are gone.' },
      { id: 'rejected', label: 'Rejected', how: '`label label-danger` with the reason shown; Resubmit for the requester.' },
    ],
    constraints: ['Status is an enumeration on the entity; the label maps each value to one Atlas label style.', 'Approve and Reject run microflows that check the user’s role and the current status on the server.', 'Reject asks for a reason; the reason is stored and shown.', 'Never colour alone: every label says the status in words.'],
    atlas: ['label label-warning / label-success / label-danger', 'alert alert-info', 'buttonstyle: Success for Approve, Danger for Reject'],
    mdl: `dataview approval (datasource: Module.Request) {
  dynamictext st (attribute: StatusText, class: 'label label-warning')
  container who (class: 'alert alert-info') { dynamictext whoT (content: 'Waiting for the cost-centre owner') }
  actionbutton bApprove (caption: 'Approve', action: call microflow Module.ACT_Request_Approve, buttonstyle: Success)
  actionbutton bReject (caption: 'Reject', action: call microflow Module.ACT_Request_Reject, buttonstyle: Danger)
}`,
  },
  {
    id: 'states.empty-loading-error',
    version: 1,
    title: 'Empty, loading and error states',
    whenToUse: 'Every list, dashboard tile and form: what the user sees when there is nothing yet, while data loads, and when something failed.',
    states: [
      { id: 'empty', label: 'Empty', how: 'An `alert alert-info` (or a plain text block) saying what will appear here and the first action to take.' },
      { id: 'loading', label: 'Loading', how: 'Atlas’s built-in loading for data widgets and the page progress bar; no extra spinners.' },
      { id: 'error', label: 'Error', how: 'An `alert alert-danger` in plain words with what the user can do next (try again, contact).' },
      { id: 'success', label: 'Success', how: 'An `alert alert-success` or a toast-like message after a save; it does not block the page.' },
    ],
    constraints: ['Messages say what happened and what to do, never a stack trace or an error code alone.', 'Show an empty state instead of an empty grid with no explanation.', 'Use the four Atlas alert styles only; no custom colours.'],
    atlas: ['alert alert-info / alert-danger / alert-success / alert-warning', 'text-muted'],
    mdl: `container emptyState (class: 'alert alert-info') {
  dynamictext eT (content: 'No requests yet. New request creates the first one.')
}
container errorState (class: 'alert alert-danger') {
  dynamictext xT (content: 'The requests could not be loaded. Try again, or tell your administrator.')
}`,
  },
];

export const patternById = (id: string) => PATTERNS.find((p) => p.id === id);

/** patterns/<id>.md in the package: everything an agent needs to build the pattern, nothing else. */
export function patternMarkdown(p: Pattern): string {
  return [
    `# ${p.title} (\`${p.id}@${p.version}\`)`,
    '',
    `**When to use:** ${p.whenToUse}`,
    '',
    '## Required states',
    ...p.states.map((s) => `- **${s.label}** (\`${s.id}\`): ${s.how}`),
    '',
    '## Constraints',
    ...p.constraints.map((c) => `- ${c}`),
    '',
    '## Mendix implementation (Atlas)',
    `Uses: ${p.atlas.join(', ')}.`,
    '',
    '```mdl',
    p.mdl,
    '```',
    '',
    `_${PATTERN_VERIFIED} Names are placeholders: adapt them to the project's domain model._`,
    '',
  ].join('\n');
}
