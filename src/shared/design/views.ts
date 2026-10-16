// What the design-system routes answer (server/design/, http/routes/design.ts). Pure types.

import type { ApplyState } from './words.js';
import type { AdoptionStageId, CaptureRecord, DesignAdoption, DesignDefault, DesignInput, DesignProposal, DesignSystem, PackageManifest, PatternSelection, ProjectDesignBinding } from './types.js';

/** A published version as the pages show it. */
export interface VersionView {
  n: number;
  digest: string;
  status: DesignSystem['versions'][number]['status'];
  publishedAt: number;
  by: string;
  approvedBy?: string;
  themeName?: string;
  compat?: PackageManifest['compat'];
  gaps?: string[];
  /** Projects bound to it (names). */
  usedBy: string[];
}

/** GET /api/design?client=: the client's design system (or none). */
export interface ClientDesignView {
  client: string;
  label: string;
  system?: Omit<DesignSystem, 'versions'>;
  versions: VersionView[];
  default?: DesignDefault;
  /** The newest published version's form: where the next draft starts when there's none. */
  latest?: DesignInput;
  admin: boolean;
}

/** One choice the wizard (or Choose another) offers. */
export interface DesignChoice {
  systemId: string;
  name: string;
  n: number;
  digest: string;
  kind: DesignSystem['kind'];
  status: DesignSystem['versions'][number]['status'];
  /** The client's default (the recommendation). */
  recommended?: boolean;
}

/** GET /api/design/choices?client=: what a new project of this client may adopt. */
export interface DesignChoicesView {
  client?: string;
  choices: DesignChoice[];
}

/** GET /api/design?floor=: the project's Design gallery. */
export interface ProjectDesignView {
  floor: string;
  name: string;
  client?: { id: string; label: string };
  /** The active binding: applied in place at setup, or an adoption whose candidate is merged into the default branch. */
  binding?: ProjectDesignBinding;
  proposal?: DesignProposal;
  /** An existing app's adoption while it's open: running, failed (at a stage), or a candidate on its branch, not merged. */
  adoption?: DesignAdoption;
  apply?: { state: ApplyState; at: number; detail?: string };
  /** The client's default, when it's not what the project is bound to (an available version, never applied by itself). */
  available?: DesignChoice;
  /** An independent project's own design system. */
  own?: Omit<DesignSystem, 'versions'> & { versions: VersionView[] };
  selections: PatternSelection[];
  captures: CaptureRecord[];
  live: { running: boolean; status: string };
  admin: boolean;
}

/** GET /api/design/needs?floor=: what Needs you reads (the ✋ adoption card). */
export interface DesignNeedView {
  floor: string;
  proposal?: DesignProposal;
  adoption?: DesignAdoption;
  failed?: { detail: string; at: number; stage?: AdoptionStageId };
  admin: boolean;
}
