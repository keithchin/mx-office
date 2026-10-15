// "Add a source folder" on the New project start page (Migrate an app, Change an existing app): the person
// types or pastes a local folder's path, the office checks and scans it (POST /api/source-folder/scan) and
// the dialog shows what will be copied before anything is ("212 files, 9 MB; skipped: node_modules, 2 .env
// files"). The folder is copied into the project's sources/legacy/<name>/ at setup and never uploaded; the
// Chief Analyst sees only its file index. The draft keeps it, so a resumed draft still has it.
import type { DraftView } from '../../../../shared/brief';
import { bytesText, legacyRel, summaryText, type SourceFolder } from '../../../../shared/source-folder';
import { h, toast } from '../../dom';
import { briefApi } from './api';
import { openDialog } from './dialog';
import { icon } from './parts';
import './source-folder.css';

export interface SourceHost {
  /** The start page's root, where the dialog opens. */
  host: HTMLElement;
  draft(): DraftView | null | undefined;
  /** A draft to keep the folder on: made on first need. */
  ensureDraft(): Promise<DraftView>;
  setDraft(d: DraftView): void;
  say(text: string): void;
}

/** The summary and the confidentiality line, for the dialog and the chip's title. */
export function sourceLines(s: SourceFolder): string[] {
  return [summaryText(s), `Copied into ${legacyRel(s.name)}/ at setup, on this machine only. Marked confidential in the brief and the Discovery task; never uploaded.`];
}

/** The chip under the description: the folder's name, its summary, and ✕ to forget it. */
export function sourceChip(s: SourceFolder, o: SourceHost): HTMLElement {
  const remove = h('button.nw-iconbtn', { type: 'button', 'aria-label': `Remove the source folder ${s.name}` }, icon('x'));
  remove.addEventListener('click', () => {
    const d = o.draft();
    if (!d) return;
    void briefApi.unsource(d.id).then((x) => (o.setDraft(x), o.say('Source folder removed')), (e: Error) => toast(e.message, 'error'));
  });
  return h('span.nw-chip.nw-src-chip', { title: sourceLines(s).join(' ') }, icon('folder'), h('span.nw-fn', {}, `${s.name}/`), h('span.nw-sz', {}, `${s.files} files · ${bytesText(s.bytes)} · confidential`), remove);
}

/** The dialog: a path field, Check folder, and the summary before anything is copied. */
export function sourceDialog(o: SourceHost, opener: HTMLElement) {
  const had = o.draft()?.source;
  const input = h('input', { type: 'text', id: 'nw-src-path', autocomplete: 'off', spellcheck: 'false', placeholder: 'C:\\work\\legacy-app', value: had?.path ?? '' }) as HTMLInputElement;
  const check = h('button.btn', { type: 'button' }, 'Check folder') as HTMLButtonElement;
  const err = h('p.nw-problem', { role: 'alert' });
  const result = h('div.nw-src-result', { 'aria-live': 'polite' });
  const show = (s: SourceFolder | undefined) =>
    result.replaceChildren(
      ...(s
        ? [
            h('p.nw-src-sum', {}, icon('folder'), h('strong', {}, `${s.name}/`), ' ', h('span', {}, summaryText(s))),
            h('p.nw-hint', {}, icon('lock'), ` ${sourceLines(s)[1]}`),
            h('p.nw-hint', {}, `The Chief Analyst gets only the file index (paths and sizes of up to ${s.index.length} files), never the code. The team reads the code after setup.`),
            h('ul.nw-src-index', { 'aria-label': 'First files in the index' }, ...s.index.slice(0, 8).map((f) => h('li', {}, h('code', {}, f.path), h('span.nw-faint', {}, ` ${bytesText(f.size)}`))), s.files > 8 ? h('li.nw-faint', {}, `… and ${s.files - 8} more`) : null),
          ]
        : []),
    );
  show(had);
  const run = async () => {
    err.textContent = '';
    check.disabled = true;
    check.textContent = 'Checking…';
    try {
      const d = await o.ensureDraft();
      const next = await briefApi.source(d.id, input.value);
      o.setDraft(next);
      show(next.source);
      o.say(next.source ? `Source folder checked: ${summaryText(next.source)}` : 'Source folder checked');
    } catch (e) {
      err.textContent = (e as Error).message;
      input.setAttribute('aria-invalid', 'true');
    } finally {
      check.disabled = false;
      check.textContent = 'Check folder';
    }
  };
  check.addEventListener('click', () => void run());
  input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), void run()));
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  const body = [
    h('div.nw-field', {}, h('label', { for: 'nw-src-path' }, 'The folder’s full path on the office’s machine'), h('div.nw-row', {}, input, check), h('span.nw-hint', {}, 'Copy it from File Explorer’s address bar. Left out: node_modules, .git, .next, dist, build, coverage, .turbo, __pycache__, files over 5 MB, and secrets-like files (.env*, *.pem, *.key, *.pfx).')),
    err,
    result,
  ];
  const done = h('button.btn.primary', { type: 'button' }, 'Done');
  const dlg = openDialog(o.host, 'Add a source folder', body, { opener, foot: [done] });
  done.addEventListener('click', () => dlg.close());
}
