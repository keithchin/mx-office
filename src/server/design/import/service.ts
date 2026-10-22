// Import a design system from a folder: scan (./scan.ts) → suggestion (shared/design/import/suggest.ts) → the
// person's review on the client's page → Save as draft (a Branded Atlas draft with its provenance beside it,
// ./record.ts). Nothing is published by itself: Publish stays the normal step. A scan is kept here, in memory, for
// the review (a few at a time, half an hour); the save takes values only from that scan or as #rrggbb, never a
// path or a token value from the page. Audited (design.import).

import { randomBytes } from 'node:crypto';
import type { AuditInput } from '../../../shared/audit.js';
import { cleanOverrides, inputOf, overridesOf, type Choices } from '../../../shared/design/import/apply.js';
import { suggestMapping } from '../../../shared/design/import/suggest.js';
import { COLOUR_FIELDS, FIELDS, type FieldChoice, type FieldId, type ImportScan, type ImportScanView, type ImportSuggestion, type ImportSummary } from '../../../shared/design/import/types.js';
import { DEFAULT_INPUT, deriveTokens, isHex, type TokenMap } from '../../../shared/design/tokens.js';
import type { OfficeFolders } from '../../wizard/source-folder.js';
import type { DesignService } from '../service.js';
import { buildRecord, packageImport, packageTokens, summaryOf } from './record.js';
import { checkImportPath, scanDesignSource, IMPORT_CAPS, type ImportCaps } from './scan.js';

interface Held {
  client: string;
  scan: ImportScan;
  suggestion: ImportSuggestion;
  baseline?: ImportScanView['baseline'];
  at: number;
}

const KEEP = 8;
const TTL = 30 * 60_000;

export interface ImportDeps {
  design: DesignService;
  office(): OfficeFolders;
  audit(e: AuditInput): void;
  now(): number;
  caps?: ImportCaps;
}

export interface SaveBody {
  scanId?: unknown;
  name?: unknown;
  choices?: unknown;
  passthrough?: unknown;
  dark?: unknown;
}

export class DesignImports {
  private held = new Map<string, Held>();
  /** One scan per client at a time. */
  private busy = new Set<string>();

  constructor(private deps: ImportDeps) {}

  private gc() {
    const now = this.deps.now();
    for (const [k, h] of this.held) if (now - h.at > TTL) this.held.delete(k);
    while (this.held.size > KEEP) this.held.delete(this.held.keys().next().value!);
  }

  /** The tokens a re-import is compared with: the waiting draft, else the newest published version. */
  private async baseline(client: string): Promise<ImportScanView['baseline']> {
    const store = this.deps.design.store;
    await this.deps.design.ready();
    const s = store.ofOwner({ client });
    if (!s || s.kind !== 'branded') return undefined;
    if (s.draft) {
      const imp = await store.draftImport(s.id);
      return {
        label: 'the waiting draft',
        ...deriveTokens(s.draft, imp?.record.overrides),
      };
    }
    const top = s.versions.at(-1);
    const t = top ? await packageTokens(store.packageDir(s.id, top.n)) : undefined;
    return t && top ? { label: `v${top.n}`, ...t } : undefined;
  }

  async scan(client: string, raw: unknown): Promise<ImportScanView | string> {
    if (this.busy.has(client)) return 'Already scanning a folder for this client: wait for it to finish';
    this.busy.add(client);
    try {
      const checked = await checkImportPath(raw, this.deps.office());
      if ('error' in checked) return checked.error;
      const source = String(raw)
        .trim()
        .replace(/^"(.*)"$/, '$1');
      const scan = await scanDesignSource(source, checked, this.deps.caps ?? IMPORT_CAPS, () => new Date(this.deps.now()));
      if ('error' in scan) return scan.error;
      const { suggestion, unmapped } = suggestMapping(scan);
      const baseline = await this.baseline(client);
      const scanId = `imp_${randomBytes(9).toString('hex')}`;
      this.gc();
      this.held.set(scanId, {
        client,
        scan,
        suggestion,
        ...(baseline ? { baseline } : {}),
        at: this.deps.now(),
      });
      return {
        scanId,
        source: scan.source,
        kind: scan.kind,
        files: scan.files.map((f) => ({ path: f.path, format: f.format })),
        skippedCounts: scan.skippedCounts,
        skipped: scan.skipped,
        remote: scan.remote,
        notImported: scan.notImported,
        darkHow: scan.darkHow,
        ...(scan.truncated ? { truncated: scan.truncated } : {}),
        suggestion,
        unmapped,
        ...(baseline ? { baseline } : {}),
      };
    } finally {
      this.busy.delete(client);
    }
  }

  /** The page's choices checked against the held scan: a candidate's value, the default, or the person's own (checked). */
  private choicesOf(h: Held, raw: unknown): Choices {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Partial<FieldChoice>>;
    const out: Choices = {};
    for (const f of FIELDS) {
      const c = r[f] ?? {};
      const list = h.suggestion.fields[f];
      const cand = typeof c.candidate === 'string' ? list.find((x) => x.id === c.candidate) : undefined;
      const value = typeof c.value === 'string' ? c.value.trim().slice(0, 200) : '';
      if (cand && (!value || cand.value === value)) {
        const first = list.find((x) => !x.filler);
        out[f] = {
          value: cand.value,
          how: cand === first ? 'suggested' : 'alternative',
          candidate: cand.id,
          confidence: cand.confidence,
          ...(cand.loc ? { from: { ...cand.loc, name: cand.label } } : {}),
        };
      } else if (c.how === 'default' || !value) out[f] = { value: defaultValue(f), how: 'default' };
      else if (ownValueOk(f, value))
        out[f] = {
          value: (COLOUR_FIELDS as readonly string[]).includes(f) ? value.toLowerCase() : value,
          how: 'hand',
        };
      else out[f] = { value: defaultValue(f), how: 'default' };
    }
    return out;
  }

  /** Save as draft: the client's Branded Atlas draft, with import.json beside it. */
  async save(client: string, body: SaveBody, by: string): Promise<string | { ok: true; overrides: number }> {
    const id = typeof body.scanId === 'string' ? body.scanId : '';
    this.gc();
    const h = this.held.get(id);
    if (!h || h.client !== client) return 'That scan has expired: scan the folder again';
    const choices = this.choicesOf(h, body.choices);
    const label = this.deps.design.store.ofOwner({ client })?.name;
    const name = typeof body.name === 'string' && body.name.trim() ? body.name : (label ?? 'Design system');
    const input = inputOf(choices, name);
    const overrides = cleanOverrides(
      overridesOf(h.suggestion, choices, {
        passthrough: body.passthrough !== false,
        dark: body.dark !== false,
      }),
    );
    const imported = buildRecord(h.scan, choices, overrides, input, h.baseline);
    const s = await this.deps.design.store.saveImportedDraft({ client }, input, imported, by);
    if (typeof s === 'string') return s;
    const n = Object.keys(overrides.light).length + Object.keys(overrides.dark).length;
    const changes = imported.record.diff?.changes.length;
    this.deps.audit({
      actor: { kind: 'human', name: by },
      action: 'design.import',
      target: { kind: 'design-system', id: s.id, label: s.name },
      summary: `Imported ${s.name} as a draft from ${h.scan.kind === 'file' ? 'the file' : 'the folder'} ${h.scan.source} (${h.scan.files.length} files read${n ? `, ${n} tokens taken as they were` : ''}${changes !== undefined ? `, ${changes} tokens changed against ${imported.record.diff!.against}` : ''})`.slice(0, 240),
      details: { files: h.scan.files.length },
    });
    this.held.delete(id);
    return { ok: true, overrides: n };
  }

  /** What the client's page says of an import: the waiting draft's, else the newest version's. */
  async summary(client: string): Promise<
    | (ImportSummary & {
        tokens?: { light: Partial<TokenMap>; dark: Partial<TokenMap> };
      })
    | undefined
  > {
    const store = this.deps.design.store;
    await this.deps.design.ready();
    const s = store.ofOwner({ client });
    if (!s) return undefined;
    if (s.draft) {
      const d = await store.draftImport(s.id);
      return d ? { ...summaryOf(d, 'draft'), tokens: d.record.overrides } : undefined;
    }
    const top = s.versions.at(-1);
    const d = top ? await packageImport(store.packageDir(s.id, top.n)) : undefined;
    return d && top ? summaryOf(d, top.n) : undefined;
  }
}

function defaultValue(f: FieldId): string {
  if (f === 'border' || f === 'font') return '';
  return String(DEFAULT_INPUT[f as keyof typeof DEFAULT_INPUT]);
}

function ownValueOk(f: FieldId, v: string): boolean {
  if ((COLOUR_FIELDS as readonly string[]).includes(f)) return isHex(v);
  if (f === 'corners') return v === 'square' || v === 'soft' || v === 'round';
  if (f === 'density') return v === 'compact' || v === 'comfortable' || v === 'spacious';
  return /^[^;{}<>\\]{1,200}$/.test(v);
}
