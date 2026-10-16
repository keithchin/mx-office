// Client design systems, Increment 1 (docs/site/using-the-office/design-systems.md): a client (or an
// independent project) owns a design system; each published version is an immutable package in the office's
// data folder (<data>/design-systems/packages/<id>/v<n>/), with a digest over its files. A project adopts one
// exact version (a binding, also committed in agent-office.project.json); changing the client's default never
// changes a binding. Pure: the server, the pages and the tests import it.

import { ulid } from '../evidence/ids.js';

export const mintDesignId = (now = Date.now()) => `dsg_${ulid(now)}`;
export const isDesignId = (v: unknown): v is string => typeof v === 'string' && /^dsg_[0-9A-HJKMNP-TV-Z]{26}$/.test(v);

/** Atlas defaults: Atlas as it ships, no theme change. Branded Atlas: the short form's tokens through `mxcli theme`. */
export type DesignKind = 'atlas' | 'branded';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type Corners = 'square' | 'soft' | 'round';
export type VersionStatus = 'draft' | 'approved' | 'superseded';
/** The one experience preset of Increment 1. */
export const PRESET = 'administration';

/** Said wherever Branded Atlas is offered: what it covers and what it doesn't. */
export const BRANDED_SCOPE = 'Branded Atlas covers colours, type, density and shape. Logo, fonts, layouts and the toolkit’s extra components are separate work.';

/** The Branded Atlas short form (every colour a #rrggbb). The other ~30 tokens are derived from these (./tokens.ts). */
export interface DesignInput {
  name: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** The app background (--mxt-ground). */
  background: string;
  /** Cards, panels, modals (--mxt-surface). */
  surface: string;
  /** Body text (--mxt-ink). */
  text: string;
  /** A font family name ("Inter"); empty for the fallback alone. */
  font: string;
  /** What renders when the font isn't installed: a CSS font stack. */
  fallback: string;
  density: Density;
  corners: Corners;
}

export interface DesignOwner {
  client?: string;
  /** An independent project (no client) owns it. */
  floor?: string;
}

export interface VersionEntry {
  n: number;
  digest: string;
  status: VersionStatus;
  publishedAt: number;
  by: string;
  /** Who approved it, when. */
  approvedBy?: string;
  approvedAt?: number;
}

/** One design system in <data>/design-systems/index.json. */
export interface DesignSystem {
  id: string;
  name: string;
  kind: DesignKind;
  owner: DesignOwner;
  /** The next version, being edited (never a published one: editing a published version starts a draft). */
  draft?: DesignInput;
  versions: VersionEntry[];
  createdAt: number;
  createdBy: string;
}

export interface DesignDefault {
  systemId: string;
  n: number;
}

export interface Compat {
  studioPro: string;
  atlas: string;
  /** `mxcli --version` when it was published: the version the package was made and tested with. */
  mxcli: string;
  /** The theme `mxcli theme create` scaffolds from. */
  themeBase: string;
}

/** manifest.json of a published version (frozen; status changes live in the index, not here). */
export interface PackageManifest {
  id: string;
  name: string;
  kind: DesignKind;
  version: number;
  /** sha256 over the package's other files (sorted path + bytes). */
  digest: string;
  owner: DesignOwner;
  preset: string;
  compat: Compat;
  /** `<slug>-<digest8>`: the mxcli theme name, so the fences in theme/web/*.scss carry the package digest. Atlas defaults: none. */
  themeName?: string;
  patterns: { id: string; version: number; file: string }[];
  /** What tokens can't express, said plainly (logo, fonts, layouts…). */
  gaps: string[];
  publishedAt: number;
  by: string;
}

export type StartPoint = 'atlas' | `mxcli:${string}` | 'custom' | 'unknown';

export interface Approval {
  kind: 'wizard' | 'decision';
  by: string;
  at: number;
  /** The proposal's card id, for a decision. */
  ref?: string;
}

export interface DesignException {
  scope: string;
  reason: string;
  by: string;
  at: number;
}

/** A project's adoption of one exact version (<data>/design-systems/bindings.json and agent-office.project.json `design`). */
export interface ProjectDesignBinding {
  systemId: string;
  name: string;
  n: number;
  digest: string;
  kind: DesignKind;
  themeName?: string;
  preset: string;
  approval: Approval;
  exceptions: DesignException[];
  /** What the project looked like before it was applied. */
  start?: StartPoint;
  /** The theme apply's result: when, and mxcli's fence digest per file. Atlas defaults: no apply. */
  applied?: { at: number; fences: Record<string, string>; mxcli?: string; branch?: string };
  /** The mxcli used differs from the one the package was published with (a warning, not a refusal). */
  warnings?: string[];
}

/** What the theme scan of a project found (server/design/scan.ts). */
export interface ThemeScan {
  start: StartPoint;
  /** The mxcli themes whose fences are there. */
  fenced: string[];
  /** Atlas variables set outside the fences that a theme also sets: they'd stop applying, as main.scss imports the theme last (0a, 7b). */
  overrides: { file: string; line: number; name: string }[];
  /** Files with rules of their own outside the fences. */
  custom: string[];
  /** themesource modules that aren't Atlas's own. */
  modules: string[];
  /** No theme/web folder at all. */
  noTheme?: boolean;
}

/** A pending existing-app adoption: one ✋ card until it's approved or kept. */
export interface DesignProposal {
  floor: string;
  systemId: string;
  name: string;
  n: number;
  digest: string;
  scan: ThemeScan;
  since: number;
  by: string;
}

export type SelectionScope = { issue: number } | { page: string } | { project: true };

export interface PatternSelection {
  patternId: string;
  version: number;
  scope: SelectionScope;
  by: string;
  at: number;
  /** Recorded by an operator on the client's behalf. */
  onBehalfOfClient?: boolean;
}

/** A runtime screenshot (captures/<floor>/index.jsonl). */
export interface CaptureRecord {
  id: string;
  file: string;
  url: string;
  viewport: { width: number; height: number };
  scheme: 'light' | 'dark';
  appSha?: string;
  /** `<id>@v<n>#<digest7>` or 'none'. */
  design: string;
  at: number;
  by: string;
}

/** One line of <data>/context-manifests/<floor>.design.jsonl: what a task was SUPPLIED, never that it was read. */
export interface DesignContextRecord {
  floor: string;
  taskId: string;
  systemId: string;
  n: number;
  digest: string;
  patternIds: string[];
  guidance: string;
  line: string;
  /** The guidance file's size in characters; tokens ≈ chars / 4 (an estimate, labelled so). */
  guidanceChars: number;
  at: number;
}

/** A spend row's design pointer: `<id>@v<n>#<digest7>`. */
export const pointerOf = (b: Pick<ProjectDesignBinding, 'systemId' | 'n' | 'digest'>) => `${b.systemId}@v${b.n}#${b.digest.slice(0, 7)}`;
