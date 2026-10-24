// The Preview's stylesheet (page-preview.ts): our own CSS that resembles a Mendix app in its default Atlas
// look: a white top bar with the menu, a light grey page, a 12-column layout grid, form groups with labels
// above their inputs, tables, cards, buttons in their styles and Atlas's spacing helpers. Written here, not
// copied: no Mendix assets, nothing fetched. It lives inside the preview's sandboxed frame, so none of it
// reaches the office's own page.
//
// Also: Atlas's common layout and helper classes (flex rows, alignment, spacing, cards, badges), so tiles and
// grids that use them sit side by side; the bounded preview's own marks (conditional tags, "more rows", the cut,
// boxes for widgets it can't draw, the dialog of a pop-up page); and Select element's outlines (preview-pick.ts).
// The project's own layout classes, read from its theme, are added after this sheet (page-preview.ts).

/** Atlas-like layout and helper classes that place things side by side (written here, not copied). */
const ATLAS_CSS = `
.d-flex,.flexcontainer,.flex-row{display:flex;flex-wrap:wrap;gap:8px}
.flex-column{display:flex;flex-direction:column}
.flex-wrap{flex-wrap:wrap}.flex-nowrap{flex-wrap:nowrap}
.flex-1,.flex-grow{flex:1 1 0;min-width:0}
.justify-content-between,.justify-content-space-between{justify-content:space-between}.justify-content-center{justify-content:center}.justify-content-end,.justify-content-right{justify-content:flex-end}
.align-items-center,.align-children-center{align-items:center}.align-children-right,.align-right{display:flex;justify-content:flex-end}
.align-children-center{display:flex;justify-content:center}
.pull-right{float:right}.pull-left{float:left}.clearfix::after{content:"";display:table;clear:both}
.text-center{text-align:center}.text-right{text-align:right}.text-left{text-align:left}
.text-bold,.text-semibold{font-weight:600}.text-primary{color:#264ae5}.text-success{color:#3cb33d}.text-danger{color:#e33f4e}.text-warning{color:#b37a0e}.text-small{font-size:12px}.text-large{font-size:17px}
.btn-block{display:flex;width:100%}.btn-lg{min-height:44px;padding:10px 22px;font-size:16px}
.badge,.label{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#e7e7e9;color:#3b4251}
.label-success,.badge-success{background:#e3f4e4;color:#24782a}.label-danger,.badge-danger{background:#fde6e8;color:#b21f2d}.label-warning,.badge-warning{background:#fdf1d9;color:#8a5a00}.label-info,.badge-info,.label-primary,.badge-primary{background:#e8edfd;color:#264ae5}
.spacing-outer-right{margin-right:16px}.spacing-outer-left{margin-left:16px}.spacing-inner-left{padding-left:16px}.spacing-inner-right{padding-right:16px}.spacing-inner-top{padding-top:16px}.spacing-inner-bottom{padding-bottom:16px}
.spacing-outer-bottom-medium{margin-bottom:16px}.spacing-outer-top-medium{margin-top:16px}.spacing-inner-medium{padding:16px}.spacing-outer-bottom-small{margin-bottom:8px}.spacing-outer-top-small{margin-top:8px}
.card-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;font-weight:600}
.cards,.card-grid,.tiles,.tile-grid,.grid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.tile,.widget-tile{background:#fff;border:1px solid #e7e7e9;border-radius:6px;padding:16px}
.listview-lined .mx-listview-item,.listview-stylingless .mx-listview-item{border:0;border-bottom:1px solid #e7e7e9;border-radius:0;box-shadow:none}
.listview-stylingless .mx-listview-item{border:0;padding:0;background:none}
.img-circle{border-radius:50%}
`;

/** The bounded preview's own marks: tags for conditions, more rows, the cut, widgets it can't draw, dialogs. */
const BOUNDS_CSS = `
.mx-cols-1{grid-template-columns:1fr}.mx-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.mx-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.mx-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.mx-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}.mx-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}
@media (max-width:767px){[class*=mx-cols-]{grid-template-columns:1fr}}
.mx-cond{position:relative;display:block;margin:2px 0 6px;padding:16px 6px 6px;border:1px dashed #b9c3f5;border-radius:4px}
.mx-cond-inline{display:inline-block;padding:14px 4px 2px;margin:0 4px 4px 0;vertical-align:top}
.mx-cond-tag{position:absolute;top:1px;left:5px;max-width:calc(100% - 10px);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:600 10px/14px "Segoe UI",Arial,sans-serif;color:#4a5fc1;letter-spacing:.01em}
.mx-cond-empty{border-color:#d7d9dd;background:repeating-linear-gradient(135deg,transparent 0 8px,rgba(10,19,37,.025) 8px 16px)}
.mx-cond-empty>.mx-cond-tag{color:#6c717c}
.mx-more{padding:8px 12px;color:#6c717c;font-size:12px;font-style:italic;list-style:none;border:1px dashed #d7d9dd;border-radius:6px;background:transparent;text-align:center}
tr.mx-more td{border:0;padding:6px 12px;text-align:center}
.mx-cut{margin:8px 0;padding:12px;border:1px dashed #e0a43a;border-radius:4px;color:#7a5200;background:#fff8ea;font-size:13px}
.mx-unsupported{margin-bottom:12px;padding:6px;border:1px dashed #b4b8c0;border-radius:4px}
.mx-unknown-tag{display:inline-block;margin:0 6px 4px 0;font:600 11px/16px "Segoe UI",Arial,sans-serif;color:#6c717c;text-transform:none}
.mx-popup-backdrop{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;background:rgba(10,19,37,.45)}
.mx-dialog{width:min(620px,100%);background:#fff;border-radius:8px;box-shadow:0 12px 40px rgba(10,19,37,.3);overflow:hidden}
.mx-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid #e7e7e9}
.mx-dialog-title{font-weight:600;font-size:17px}.mx-dialog-close{color:#6c717c}
.mx-dialog-body .mx-page{padding:20px}
`;

/** Select element (preview-pick.ts): the outline under the pointer or keyboard, the one selected, and its label. */
const PICK_CSS = `
.mx-picking [data-mx-el]{cursor:pointer}
.mx-picking [data-mx-el]:focus{outline:none}
.mx-hover{outline:2px solid #264ae5 !important;outline-offset:1px}
.mx-sel{outline:2px solid #e8590c !important;outline-offset:1px;box-shadow:0 0 0 4px rgba(232,89,12,.18)}
.mx-pick-label{position:absolute;z-index:99;pointer-events:none;padding:2px 8px;border-radius:4px;background:#264ae5;color:#fff;font:600 12px/18px "Segoe UI",Arial,sans-serif;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 6px rgba(10,19,37,.25)}
.mx-pick-label.sel{background:#e8590c}
`;

export const PREVIEW_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font:14px/1.45 "Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,"Helvetica Neue",Arial,sans-serif;color:#0a1325;background:#f8f8f8}
h1,h2,h3,h4,h5,h6{margin:0 0 12px;font-weight:600;line-height:1.25;color:#0a1325}
h1{font-size:30px}h2{font-size:24px}h3{font-size:20px}h4{font-size:17px}h5{font-size:15px}h6{font-size:14px}
p{margin:0 0 12px}
.mx-layout{min-height:100vh;display:flex;flex-direction:column}
.mx-region-top{display:flex;align-items:center;gap:16px;min-height:60px;padding:0 24px;background:#fff;border-bottom:1px solid #e7e7e9;box-shadow:0 1px 3px rgba(10,19,37,.06)}
.mx-region-top .mx-container,.mx-region-top>div{display:flex;align-items:center;gap:16px;flex:1 1 auto;min-width:0}
.mx-brand,.wordmark{font-weight:700;font-size:17px;color:#264ae5;white-space:nowrap}
.mx-region-sidebar,.mx-region-left{flex:0 0 240px;background:#0a1325;color:#fff;padding:16px 0}
.mx-layout:has(.mx-region-sidebar),.mx-layout:has(.mx-region-left){flex-direction:row;flex-wrap:wrap}
.mx-layout:has(.mx-region-sidebar)>.mx-region-top{flex-basis:100%}
.mx-region-center{flex:1 1 auto;min-width:0}
.mx-region-bottom{padding:12px 24px;background:#fff;border-top:1px solid #e7e7e9}
.mx-page{padding:24px}
.mx-page-title-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.mx-navbar{display:flex;gap:4px;margin:0;padding:0;list-style:none;flex:1 1 auto;overflow:hidden}
.mx-navbar a{display:block;padding:19px 12px;color:#3b4251;text-decoration:none;white-space:nowrap;border-bottom:3px solid transparent}
.mx-navbar li.active a{color:#264ae5;border-bottom-color:#264ae5;font-weight:600}
.mx-navigationtree{margin:0;padding:0;list-style:none}
.mx-navigationtree a{display:block;padding:10px 20px;color:#c8cdd6}
.mx-navigationtree li.active a{background:rgba(255,255,255,.08);color:#fff;border-left:3px solid #264ae5}
.mx-language{max-width:120px}
.container-fluid{width:100%;padding:0}
.row{display:flex;flex-wrap:wrap;margin:0 -12px}
.row>[class*=col]{padding:0 12px;min-width:0}
.col-12{flex:0 0 100%;max-width:100%}
@media (min-width:576px){.col-12.col-lg,.row>.col-lg{flex:1 1 0;max-width:100%}}
${Array.from({ length: 12 }, (_, i) => `@media (min-width:768px){.col-md-${i + 1}{flex:0 0 ${((i + 1) / 12) * 100}%;max-width:${((i + 1) / 12) * 100}%}}`).join('')}
${Array.from({ length: 12 }, (_, i) => `@media (min-width:992px){.col-lg-${i + 1}{flex:0 0 ${((i + 1) / 12) * 100}%;max-width:${((i + 1) / 12) * 100}%}}`).join('')}
@media (max-width:767px){.row>[class*=col-lg-]{flex:0 0 100%;max-width:100%}.mx-page{padding:16px}.mx-region-top{padding:0 16px}.mx-region-sidebar,.mx-region-left{display:none}}
.mx-container{min-width:0}
.card,.mx-groupbox,.mx-datagrid,.mx-listview-item{background:#fff;border:1px solid #e7e7e9;border-radius:6px;box-shadow:0 1px 2px rgba(10,19,37,.04)}
.card{padding:24px;margin-bottom:24px}
.card-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.card-pad{padding:24px}
.mx-groupbox{margin-bottom:24px}
.mx-groupbox-header{padding:12px 16px;border-bottom:1px solid #e7e7e9;font-weight:600}
.mx-groupbox-body{padding:16px}
.mx-tabcontainer{margin-bottom:24px}
.mx-tabcontainer-tabs{display:flex;gap:0;margin:0 0 16px;padding:0;list-style:none;border-bottom:1px solid #ced0d3}
.mx-tabcontainer-tabs li{padding:10px 16px;color:#6c717c;border-bottom:2px solid transparent;margin-bottom:-1px}
.mx-tabcontainer-tabs li.active{color:#264ae5;border-bottom-color:#264ae5;font-weight:600}
.mx-dataview{margin-bottom:16px}
.mx-dataview-controls,.mx-footer{display:flex;flex-wrap:wrap;gap:8px;padding-top:16px;margin-top:8px;border-top:1px solid #e7e7e9}
.form-group{margin-bottom:16px}
.control-label{display:block;margin-bottom:6px;font-weight:600;font-size:13px;color:#3b4251}
.mx-required{color:#e33f4e}
.form-horizontal .form-group{display:grid;grid-template-columns:minmax(120px,30%) 1fr;gap:12px;align-items:center}
.form-horizontal .control-label{margin:0}
.form-control{display:flex;align-items:center;justify-content:space-between;min-height:36px;width:100%;padding:7px 11px;border:1px solid #ced0d3;border-radius:4px;background:#fff;color:#0a1325;font:inherit;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
input.form-control{display:block}
.form-control-static{min-height:36px;padding:7px 0;color:#0a1325}
.mx-textarea{min-height:84px;align-items:flex-start;white-space:normal}
.mx-caret{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #6c717c;flex:none;margin-left:8px}
.mx-dateinput{display:flex}
.mx-dateinput .form-control{border-radius:4px 0 0 4px}
.mx-dateinput-button{display:flex;align-items:center;padding:0 11px;border:1px solid #ced0d3;border-left:0;border-radius:0 4px 4px 0;background:#f5f6f6;color:#3b4251}
.mx-checkbox .mx-check,.mx-radios label{display:inline-flex;align-items:center;gap:8px;margin-right:16px}
.mx-check input,.mx-radios input{width:16px;height:16px;accent-color:#264ae5;margin:0}
.btn,.mx-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:7px 16px;margin:0 8px 8px 0;border:1px solid #ced0d3;border-radius:4px;background:#fff;color:#0a1325;font:inherit;font-weight:600;cursor:default;white-space:nowrap}
.btn-primary{background:#264ae5;border-color:#264ae5;color:#fff}
.btn-success{background:#3cb33d;border-color:#3cb33d;color:#fff}
.btn-info{background:#0086d9;border-color:#0086d9;color:#fff}
.btn-warning{background:#eca51c;border-color:#eca51c;color:#fff}
.btn-danger{background:#e33f4e;border-color:#e33f4e;color:#fff}
.btn-inverse{background:#252c36;border-color:#252c36;color:#fff}
.btn-link,.mx-link{background:none;border-color:transparent;color:#264ae5;text-decoration:underline;padding-left:0;padding-right:0}
.btn-sm{min-height:28px;padding:3px 10px;font-size:13px}
.mx-link{display:inline-block;margin:0 12px 8px 0;font-weight:600}
.mx-datagrid{margin-bottom:24px;overflow:auto}
.mx-datagrid-filters{display:flex;flex-wrap:wrap;gap:8px;padding:12px 12px 0}
.mx-datagrid-filters .mx-filter{max-width:220px;min-height:32px}
.table{width:100%;border-collapse:collapse}
.table th{padding:12px;text-align:left;font-size:13px;font-weight:600;color:#3b4251;border-bottom:2px solid #e7e7e9;white-space:nowrap}
.table td{padding:12px;border-bottom:1px solid #e7e7e9;vertical-align:top}
.table td .btn{margin:0 4px 4px 0}
.table td .mx-text{display:block}
.table tbody tr:nth-child(2n){background:#fafafb}
.mx-datagrid-paging{padding:10px 12px;color:#6c717c;font-size:13px;text-align:right}
.mx-listview,.mx-gallery{margin:0 0 24px;padding:0;list-style:none;display:grid;gap:12px}
.mx-gallery{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.mx-listview-item{padding:16px}
.mx-snippet-box,.mx-unknown{margin-bottom:12px;padding:12px;border:1px dashed #b4b8c0;border-radius:4px;color:#6c717c;background:#fbfbfc;font-size:13px}
.mx-placeholder{padding:24px;border:1px dashed #b4b8c0;color:#6c717c;text-align:center}
.mx-image{display:flex;align-items:center;justify-content:center;width:100%;max-width:240px;aspect-ratio:4/3;margin-bottom:12px;border-radius:6px;background:#eceef1;color:#9aa0aa}
.mx-text{display:inline}
.mx-container>.mx-text,.mx-dataview-content>.mx-text{display:block;margin-bottom:8px}
.spacing-outer-bottom{margin-bottom:16px}.spacing-outer-bottom-large{margin-bottom:24px}.spacing-outer-top{margin-top:16px}.spacing-outer-top-large{margin-top:24px}
.spacing-inner{padding:16px}.spacing-inner-large{padding:24px}
.text-muted,.muted{color:#6c717c}.small{font-size:12px}.mono{font-family:Consolas,"Cascadia Mono",monospace}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;background:#e8edfd;color:#264ae5;font-size:12px;font-weight:600}
.page-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.page-sub{display:block;color:#6c717c}
.crumb{display:block;color:#6c717c;font-size:13px;margin-bottom:6px}
.actionbar,.page-actions,.cluster{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.field-grid,.two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 24px}
.field-help{color:#6c717c;font-size:12px;margin:-10px 0 12px}
${ATLAS_CSS}
${BOUNDS_CSS}
${PICK_CSS}
`;
