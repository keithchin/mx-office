// Neutral Model preview fixtures (made up, no real names): a list page, an edit page and a dialog in a visitor
// desk app, their layouts and a header snippet, with the shapes the bounded preview must handle (tiles in a
// project class, a 3-column gallery of cards with status chips picked by condition, an empty state, a nested
// list, a layout grid form, a pop-up). Used by scripts/element-pick-shots.mjs for the neutral screenshots.

export const LAYOUT = `create or modify layout Desk.Layout_Main (layouttype: 'Responsive') {
  region top { container ctnTop (Class: 'app-bar') { snippetcall scHeader (Snippet: Desk.SNIP_Header) menubar mb (Profile: 'Responsive') } }
  region center { placeholder Main }
}`;
export const POPUP = `create or modify layout Atlas_Core.PopupLayout (layouttype: 'Popup') { placeholder Main }`;
export const HEADER = `create or modify snippet Desk.SNIP_Header { dynamictext txtBrand (Content: 'Visitor desk', Class: 'wordmark') actionbutton btnHelp (Caption: 'Help', ButtonStyle: Link) }`;

export const LIST = `create or modify page Desk.Visit_Overview (Title: 'Today’s visitors', Layout: Desk.Layout_Main, Url: 'visitors') {
  container ctnPage (Class: 'page') {
    container ctnHead (Class: 'page-head') {
      container ctnTitle { dynamictext txtCrumb (Content: 'Home / Visitors', Class: 'crumb') dynamictext txtTitle (Content: 'Today’s visitors', RenderMode: H1) }
      actionbutton btnNew (Caption: '+ Register visitor', ButtonStyle: Primary)
    }
    dataview dvFilter (DataSource: microflow Desk.DS_Filter) {
      container ctnCounters (Class: 'counters') {
        container ctnExpected (Class: 'counter') { dynamictext txtExpectedN (Content: '{1}', ContentParams: ({1} = CountExpected)) dynamictext txtExpectedL (Content: 'Expected') }
        container ctnArrived (Class: 'counter') { dynamictext txtArrivedN (Content: '{1}', ContentParams: ({1} = CountArrived)) dynamictext txtArrivedL (Content: 'Arrived') }
        container ctnLeft (Class: 'counter') { dynamictext txtLeftN (Content: '{1}', ContentParams: ({1} = CountLeft)) dynamictext txtLeftL (Content: 'Left') }
        container ctnLate (Class: 'counter') { dynamictext txtLateN (Content: '{1}', ContentParams: ({1} = CountLate)) dynamictext txtLateL (Content: 'Late') }
      }
      container ctnEmpty (Class: 'empty', Visible: $currentObject/CountAll = 0) { dynamictext txtEmpty (Content: 'No visitors expected today. Use + Register visitor to add one.') }
      gallery galVisits (DataSource: database from Desk.Visit, DesktopColumns: 3) {
        template {
          container ctnCard (Class: 'visit-card') {
            container ctnCardTop (Class: 'top') {
              dynamictext txtVisitor (Content: '{1}', ContentParams: ({1} = VisitorName), Class: 'title')
              dynamictext chipExpected (Content: 'Expected', Class: 'chip', Visible: $currentObject/Status = Desk.VisitStatus.Expected)
              dynamictext chipArrived (Content: 'Arrived', Class: 'chip', Visible: $currentObject/Status = Desk.VisitStatus.Arrived)
              dynamictext chipLeft (Content: 'Left', Class: 'chip', Visible: $currentObject/Status = Desk.VisitStatus.Left)
            }
            dynamictext txtHost (Content: 'Host: {1}', ContentParams: ({1} = Visit_Host/Name))
            dynamictext txtWhen (Content: 'Expected at {1}', ContentParams: ({1} = ExpectedAt))
            listview lvBadges (DataSource: association Visit_Badge) { dynamictext txtBadge (Content: 'Badge {1}', ContentParams: ({1} = BadgeNumber)) }
            container ctnActions (Class: 'card-actions') { actionbutton btnCheckIn (Caption: 'Check in', ButtonStyle: Primary, Visible: $currentObject/Status = Desk.VisitStatus.Expected) actionbutton btnOpen (Caption: 'Open') }
          }
        }
      }
    }
  }
}`;

export const EDIT = `create or modify page Desk.Visit_NewEdit (Title: 'Register visitor', Layout: Desk.Layout_Main) {
  dataview dvVisit (DataSource: $Visit) {
    layoutgrid lgForm {
      row {
        column (DesktopWidth: 8) {
          dynamictext txtFormTitle (Content: 'Register visitor', RenderMode: H2)
          textbox tbName (Label: 'Visitor name', Attribute: VisitorName, Class: 'field-req')
          textbox tbCompany (Label: 'Company', Attribute: Company)
          datepicker dpExpected (Label: 'Expected at', Attribute: ExpectedAt)
          combobox cbHost (Label: 'Host', Attribute: Desk.Visit_Host)
          textarea taNote (Label: 'Note for reception', Attribute: Note)
          checkbox cbParking (Label: 'Needs a parking spot', Attribute: NeedsParking)
        }
        column (DesktopWidth: 4) {
          groupbox gbBadge (Caption: 'Badge') { image imgBadge dynamictext txtBadgeHint (Content: 'Printed at reception on arrival.') }
          signaturepad spConsent
        }
      }
    }
    footer ftActions { actionbutton btnSave (Caption: 'Save', ButtonStyle: Primary) actionbutton btnCancel (Caption: 'Cancel') }
  }
}`;

export const DIALOG = `create or modify page Desk.Visit_Cancel (Title: 'Cancel visit', Layout: Atlas_Core.PopupLayout) {
  dataview dvCancel (DataSource: $Visit) {
    dynamictext txtAsk (Content: 'Cancel the visit of {1}?', ContentParams: ({1} = VisitorName))
    textarea taReason (Label: 'Reason', Attribute: CancelReason)
    footer ftCancel { actionbutton btnKeep (Caption: 'Keep the visit') actionbutton btnConfirm (Caption: 'Cancel visit', ButtonStyle: Danger) }
  }
}`;

/** The project's layout classes, as the server reads them from a theme (server/app-explorer/theme.ts). */
export const THEME = [
  '.page-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}',
  '.counters{display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:16px;margin-bottom:16px}',
  '.counter{display:flex;flex-direction:column;gap:4px;padding:16px;border:1px solid #e2e4e8;border-radius:8px;background:#fff}',
  '.visit-card{display:flex;flex-direction:column;gap:8px}',
  '.visit-card .top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}',
  '.card-actions{display:flex;gap:8px;flex-wrap:wrap}',
  '.app-bar{display:flex;align-items:center;gap:16px}',
].join('\n');

/** By type and qualified name, as the Model tab's document request answers them. */
export const DOCS: Record<string, string> = {
  'page:Desk.Visit_Overview': LIST,
  'page:Desk.Visit_NewEdit': EDIT,
  'page:Desk.Visit_Cancel': DIALOG,
  'layout:Desk.Layout_Main': LAYOUT,
  'layout:Atlas_Core.PopupLayout': POPUP,
  'snippet:Desk.SNIP_Header': HEADER,
};
