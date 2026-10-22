// Importing a design system from a folder (docs/site/using-the-office/design-systems.md#import-from-a-folder):
// what the scanner (server/design/import/) found in the client's own files, what the mapping suggests for the
// Branded Atlas form, and the provenance (import.json) a draft and its published version keep. Pure types.

import type { TokenMap } from '../tokens.js';

export interface SrcLoc {
  /** Relative to the folder, forward slashes (the file's name for a single file). */
  file: string;
  line: number;
}

export type Scheme = 'light' | 'dark';
export type UseKind = 'background' | 'text' | 'border' | 'other';
export type SourceFormat = 'css' | 'scss' | 'html' | 'json' | 'tailwind';

/** A named value: a CSS custom property, a Sass variable, a design token or a Tailwind colour. */
export interface FoundVar {
  /** As written: `--primary`, `$brand`, `color.brand.primary`, `colors.primary.500`, `meta:theme-color`. */
  name: string;
  raw: string;
  /** The value with var()/$var/{alias} chains resolved within the folder (raw when it can't be). */
  value: string;
  /** The value as #rrggbb, when it's one plain colour. */
  hex?: string;
  scheme: Scheme;
  loc: SrcLoc;
  /** The source line, trimmed (an excerpt for provenance). */
  text: string;
  origin: SourceFormat;
  /** A design token's type ($type / type), when the file says. */
  type?: string;
  /** How the folder uses it through var(--x): as a background, a text colour, a border. */
  uses?: Partial<Record<UseKind, number>>;
}

/** A colour literal written straight into rules, with how often and where. */
export interface FoundColour {
  hex: string;
  count: number;
  uses: Record<UseKind, number>;
  /** Set on the page itself (html, body, :root). */
  page?: Partial<Record<UseKind, number>>;
  scheme: Scheme;
  loc: SrcLoc;
  text: string;
}

/** A font stack, a radius or a control height, with how often it's written. */
export interface FoundValue {
  value: string;
  count: number;
  loc: SrcLoc;
  text: string;
  /** Set on the page itself, or under a name that says what it is. */
  strong?: boolean;
  name?: string;
}

export interface ScanFile {
  path: string;
  size: number;
  sha256: string;
  format: SourceFormat;
}

export interface ImportScan {
  /** The path as the person typed it. */
  source: string;
  kind: 'folder' | 'file';
  scannedAt: string;
  /** The text files read. */
  files: ScanFile[];
  /** Left out, with why (at most SKIP_LIST_MAX listed; skippedCounts has them all). */
  skipped: { path: string; reason: string }[];
  skippedCounts: Record<string, number>;
  vars: FoundVar[];
  colours: FoundColour[];
  fonts: FoundValue[];
  radii: FoundValue[];
  heights: FoundValue[];
  /** How light/dark variants were told apart (prefers-color-scheme, .dark, [data-theme=dark], a token set). */
  darkHow: string[];
  /** @import url(http…) and <link href="http…">: never fetched. */
  remote: string[];
  /** Found, not imported (separate work): Branded Atlas covers colours, type, density and shape only. */
  notImported: { fonts: string[]; logos: string[]; layouts: string[] };
  /** A cap was reached: what was left out. */
  truncated?: string;
}

export type ColourField = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'background' | 'surface' | 'text' | 'border';
export type FieldId = ColourField | 'font' | 'corners' | 'density';
export const COLOUR_FIELDS: readonly ColourField[] = ['primary', 'success', 'warning', 'danger', 'info', 'background', 'surface', 'text', 'border'];
export const FIELDS: readonly FieldId[] = [...COLOUR_FIELDS, 'font', 'corners', 'density'];
export const FIELD_LABELS: Record<FieldId, string> = {
  primary: 'Primary (brand)',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
  background: 'Background',
  surface: 'Cards (surface)',
  text: 'Text',
  border: 'Borders',
  font: 'Font',
  corners: 'Corners',
  density: 'Density',
};

export type Confidence = 'high' | 'medium' | 'low';

/** One value a field could take, with where it came from. */
export interface Candidate {
  /** Stable within one scan (`c12`). */
  id: string;
  /** #rrggbb for a colour, a font stack, or a Corners/Density word. */
  value: string;
  /** `--primary`, `colour literal`, `border-radius`… */
  label: string;
  loc?: SrcLoc;
  text?: string;
  confidence: Confidence;
  /** Why it was suggested, in words. */
  why: string;
  /** The same name's dark value (#rrggbb), when the folder has a dark variant: primary, background, cards and text only. */
  dark?: string;
  darkLoc?: SrcLoc;
  /** Only an alternative (another colour the folder names): never suggested by itself. */
  filler?: true;
}

/** What the import suggests: per field, the best first; a field with none keeps the office's default. */
export interface ImportSuggestion {
  fields: Record<FieldId, Candidate[]>;
  /** The folder's own --mxt-* tokens (mxcli's vocabulary), taken as they are. */
  passthrough?: {
    light: Partial<TokenMap>;
    dark: Partial<TokenMap>;
    locs: Record<string, SrcLoc>;
  };
  /** --mxt-* names mxcli doesn't know (mxcli would refuse the file), or whose value couldn't be used. */
  ignored: { name: string; loc: SrcLoc; reason: string }[];
}

/** What the person chose per field: a candidate, their own value, or the office's default. */
export interface FieldChoice {
  value: string;
  how: 'suggested' | 'alternative' | 'hand' | 'default';
  candidate?: string;
  from?: SrcLoc & { name?: string };
  confidence?: Confidence;
}

export interface TokenChange {
  token: string;
  scheme: Scheme;
  from?: string;
  to?: string;
}

/** import.json, in a draft and in the version published from it (covered by the digest). */
export interface ImportRecord {
  version: 1;
  source: string;
  kind: 'folder' | 'file';
  scannedAt: string;
  files: ScanFile[];
  skipped: { path: string; reason: string }[];
  skippedCounts: Record<string, number>;
  mappings: Partial<Record<FieldId, FieldChoice>>;
  /** Tokens taken as they were, light and dark, and where each came from. */
  overrides: { light: Partial<TokenMap>; dark: Partial<TokenMap> };
  overrideSources: Record<string, SrcLoc>;
  /** Values found and not used (named values no field took), at most UNMAPPED_MAX. */
  unmapped: { name: string; value: string; loc: SrcLoc }[];
  ignored: { name: string; loc?: SrcLoc; reason: string }[];
  remote: string[];
  notImported: ImportScan['notImported'];
  darkHow: string[];
  /** What changed against the version (or draft) before it. */
  diff?: { against: string; changes: TokenChange[] };
  /** The form was changed by hand after the import (overrides it changed were dropped). */
  editedAfterImport?: boolean;
  /** Carried into a new draft from this published version (Edit as new draft). */
  carriedFrom?: number;
  truncated?: string;
}

/** What GET /api/design?client= says of the draft's (or newest version's) import. */
export interface ImportSummary {
  source: string;
  kind: 'folder' | 'file';
  scannedAt: string;
  files: number;
  overrides: number;
  notImported: ImportScan['notImported'];
  editedAfterImport?: boolean;
  /** Where it is: the waiting draft, or a published version. */
  on: 'draft' | number;
}

/** POST /api/design/import {action: 'scan'}: the review's material. */
export interface ImportScanView {
  scanId: string;
  source: string;
  kind: 'folder' | 'file';
  files: { path: string; format: SourceFormat }[];
  skippedCounts: Record<string, number>;
  skipped: { path: string; reason: string }[];
  remote: string[];
  notImported: ImportScan['notImported'];
  darkHow: string[];
  truncated?: string;
  suggestion: ImportSuggestion;
  /** Named values no field suggested (for the unmapped list). */
  unmapped: { name: string; value: string; loc: SrcLoc }[];
  /** The tokens a re-import is compared with: the waiting draft or the newest version. */
  baseline?: {
    label: string;
    light: Partial<TokenMap>;
    dark: Partial<TokenMap>;
  };
}

export const SKIP_LIST_MAX = 200;
export const UNMAPPED_MAX = 200;
