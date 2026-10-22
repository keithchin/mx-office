// An import's provenance (shared/design/import/types.ts ImportRecord): kept beside the draft it made
// (<data>/design-systems/imports/<id>.json, never in index.json: it can be a few hundred files' hashes), and
// written into the version published from it as import.json plus import/excerpts.txt (the source lines each
// chosen value came from). Both are package files, so the digest covers them.

import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonCritical } from '../../flow/critical-write.js';
import { cleanOverrides, diffTokens, overrideCount, parseTokensCss, type Choices } from '../../../shared/design/import/apply.js';
import { suggestMapping } from '../../../shared/design/import/suggest.js';
import { deriveTokens, type TokenMap } from '../../../shared/design/tokens.js';
import type { DesignInput } from '../../../shared/design/types.js';
import { FIELDS, type ImportRecord, type ImportScan, type ImportSummary, type SrcLoc } from '../../../shared/design/import/types.js';

export interface DraftImport {
  record: ImportRecord;
  excerpts: string;
}

export const draftImportFile = (root: string, id: string) => path.join(root, 'imports', `${id}.json`);

function cleanRecord(raw: unknown): ImportRecord | undefined {
  const r = raw as ImportRecord | undefined;
  if (!r || r.version !== 1 || typeof r.source !== 'string' || !Array.isArray(r.files)) return undefined;
  return { ...r, overrides: cleanOverrides(r.overrides) };
}

export async function readDraftImport(root: string, id: string): Promise<DraftImport | undefined> {
  try {
    const raw = JSON.parse(await readFile(draftImportFile(root, id), 'utf8')) as Partial<DraftImport>;
    const record = cleanRecord(raw.record);
    return record
      ? {
          record,
          excerpts: typeof raw.excerpts === 'string' ? raw.excerpts : '',
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeDraftImport(root: string, id: string, d: DraftImport | undefined): Promise<void> {
  const f = draftImportFile(root, id);
  if (!d) return void (await rm(f, { force: true }));
  await mkdir(path.dirname(f), { recursive: true });
  await writeJsonCritical(f, d);
}

/** A published version's import.json, when it was made by an import. */
export async function packageImport(dir: string): Promise<DraftImport | undefined> {
  try {
    const record = cleanRecord(JSON.parse(await readFile(path.join(dir, 'import.json'), 'utf8')));
    if (!record) return undefined;
    const excerpts = await readFile(path.join(dir, 'import', 'excerpts.txt'), 'utf8').catch(() => '');
    return { record, excerpts };
  } catch {
    return undefined;
  }
}

/** A published version's tokens, read back from its tokens.css (a re-import's baseline). */
export async function packageTokens(dir: string): Promise<{ light: Partial<TokenMap>; dark: Partial<TokenMap> } | undefined> {
  const css = await readFile(path.join(dir, 'tokens.css'), 'utf8').catch(() => '');
  return css ? parseTokensCss(css) : undefined;
}

/** The package files an import adds (covered by the digest). */
export function importFiles(d: DraftImport | undefined): Record<string, string> {
  if (!d) return {};
  return {
    'import.json': `${JSON.stringify(d.record, null, 2)}\n`,
    'import/excerpts.txt': d.excerpts,
  };
}

export function summaryOf(d: DraftImport, on: ImportSummary['on']): ImportSummary {
  const r = d.record;
  return {
    source: r.source,
    kind: r.kind,
    scannedAt: r.scannedAt,
    files: r.files.length,
    overrides: overrideCount(r.overrides),
    notImported: r.notImported,
    ...(r.editedAfterImport ? { editedAfterImport: true } : {}),
    on,
  };
}

/**
 * The record a save writes: the scan's files and skips, what each field was set from, the overrides and their
 * sources, what was found and not used, and the diff against the baseline. Excerpts: the source line of every
 * value used, `file:line: text`, at most 300 lines.
 */
export function buildRecord(
  scan: ImportScan,
  choices: Choices,
  overrides: { light: Partial<TokenMap>; dark: Partial<TokenMap> },
  input: DesignInput,
  baseline?: {
    label: string;
    light: Partial<TokenMap>;
    dark: Partial<TokenMap>;
  },
): DraftImport {
  const { suggestion, unmapped } = suggestMapping(scan);
  const overrideSources: Record<string, SrcLoc> = {};
  for (const scheme of ['light', 'dark'] as const)
    for (const t of Object.keys(overrides[scheme])) {
      const loc = suggestion.passthrough?.locs[`${scheme}:${t}`];
      if (loc) overrideSources[`${scheme}:${t}`] = loc;
    }
  const lines = new Map<string, string>();
  const note = (loc: SrcLoc | undefined, text: string | undefined) => {
    if (loc && lines.size < 300) lines.set(`${loc.file}:${loc.line}`, (text ?? '').slice(0, 200));
  };
  for (const f of FIELDS) {
    const ch = choices[f];
    const c = ch?.candidate ? suggestion.fields[f].find((x) => x.id === ch.candidate) : undefined;
    if (c) {
      note(c.loc, c.text);
      if (c.dark) note(c.darkLoc, '(dark variant)');
    }
  }
  for (const v of scan.vars) if (overrideSources[`${v.scheme}:${v.name.replace(/^--mxt-/, '')}`]) note(v.loc, v.text);
  const after = deriveTokens(input, overrides);
  const record: ImportRecord = {
    version: 1,
    source: scan.source,
    kind: scan.kind,
    scannedAt: scan.scannedAt,
    files: scan.files,
    skipped: scan.skipped,
    skippedCounts: scan.skippedCounts,
    mappings: choices,
    overrides,
    overrideSources,
    unmapped,
    ignored: suggestion.ignored,
    remote: scan.remote,
    notImported: scan.notImported,
    darkHow: scan.darkHow,
    ...(baseline
      ? {
          diff: {
            against: baseline.label,
            changes: diffTokens(baseline, after),
          },
        }
      : {}),
    ...(scan.truncated ? { truncated: scan.truncated } : {}),
  };
  const excerpts = [`Imported from ${scan.source} (${scan.kind}) on ${scan.scannedAt}. The source lines each value was taken from:`, ...[...lines].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([k, t]) => `${k}: ${t}`), ''].join('\n');
  return { record, excerpts };
}
