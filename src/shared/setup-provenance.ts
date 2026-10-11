// What a new-project setup made itself, recorded as proof when it made it (the repo step right after
// `gh repo create`, the clone step right after cloning), kept in the setup's record (JobState.provenance)
// and carried into its Cancel & undo. Cancel & undo deletes a GitHub repository or a local folder only on
// this proof: never on the steps' human-readable lines ("created …", "cloned into …"), which an older
// setup has instead and which only ever give a hint. Versioned: a record of a version this office
// doesn't know, or one that doesn't read right, is no proof at all. Pure: the page, the server and the
// tests read the same rules.

export const PROVENANCE_VERSION = 1;

/** The GitHub repository: made by this setup (with GitHub's id for it, asked right after), or there already. */
export interface RepoProvenance {
  createdBySetup: boolean;
  /** It was on GitHub before the setup looked (or made by someone else): never the setup's to delete. */
  preExisting?: true;
  /** owner/name as GitHub spells it. */
  nameWithOwner: string;
  /** GitHub's immutable id for it (`gh repo view --json id`): a repository made later at the same name has another. */
  githubId?: string;
  at: number;
}

/** The local folder: cloned by this setup (its real path), or there already. */
export interface FolderProvenance {
  createdBySetup: boolean;
  preExisting?: true;
  /** The folder's canonical (real) path when it was recorded. */
  path: string;
  at: number;
}

export interface SetupProvenance {
  v: typeof PROVENANCE_VERSION;
  repo?: RepoProvenance;
  folder?: FolderProvenance;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 1000;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function repoOf(v: unknown): RepoProvenance | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.createdBySetup !== 'boolean' || !str(r.nameWithOwner) || !num(r.at)) return undefined;
  if (r.githubId !== undefined && !str(r.githubId)) return undefined;
  // Made by the setup and there already can't both be true: such a record proves nothing.
  if (r.createdBySetup && r.preExisting) return undefined;
  return { createdBySetup: r.createdBySetup, ...(r.preExisting === true ? { preExisting: true as const } : {}), nameWithOwner: r.nameWithOwner, ...(str(r.githubId) ? { githubId: r.githubId } : {}), at: r.at };
}

function folderOf(v: unknown): FolderProvenance | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.createdBySetup !== 'boolean' || !str(r.path) || !num(r.at)) return undefined;
  if (r.createdBySetup && r.preExisting) return undefined;
  return { createdBySetup: r.createdBySetup, ...(r.preExisting === true ? { preExisting: true as const } : {}), path: r.path, at: r.at };
}

/** A saved record as this office reads it: anything missing, odd or of another version is undefined (no proof). */
export function readProvenance(v: unknown): SetupProvenance | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (r.v !== PROVENANCE_VERSION) return undefined;
  const repo = repoOf(r.repo);
  const folder = folderOf(r.folder);
  return { v: PROVENANCE_VERSION, ...(repo ? { repo } : {}), ...(folder ? { folder } : {}) };
}

/** A record with one part replaced (the steps write theirs as they make something). */
export const withProvenance = (old: unknown, part: Partial<Pick<SetupProvenance, 'repo' | 'folder'>>): SetupProvenance => ({ ...(readProvenance(old) ?? { v: PROVENANCE_VERSION }), ...part });

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The plain sentence for a setup whose log says it made something the office holds no proof of. */
export const legacyHint = (what: 'repo' | 'folder') =>
  what === 'repo'
    ? 'this setup’s log says it created the repository, but the office didn’t record proof of that, so delete it on GitHub yourself if you’re sure'
    : 'this setup’s log says it cloned the folder, but the office didn’t record proof of that, so delete it yourself if you’re sure';

export type Proof = 'recorded' | 'pre-existing' | 'legacy' | 'none';

/**
 * Whether the record proves the setup created `repo` (owner/name), and the id GitHub must still show for
 * it. A legacy "created …" line (`legacyCreated`) never proves it, only gives the hint.
 */
export function repoProof(p: SetupProvenance | undefined, repo: string, legacyCreated: boolean): { proof: 'recorded'; githubId: string } | { proof: Exclude<Proof, 'recorded'> | 'no-id'; why: string } {
  const r = p?.repo;
  if (r && sameName(r.nameWithOwner, repo)) {
    if (r.createdBySetup && r.githubId) return { proof: 'recorded', githubId: r.githubId };
    if (r.createdBySetup) return { proof: 'no-id', why: 'this setup created it, but the office couldn’t record GitHub’s id for it, so it can’t tell it’s still the same repository: delete it on GitHub yourself if you’re sure' };
    return { proof: 'pre-existing', why: 'it was on GitHub already when the setup looked (you created it, or it was there), so the office never deletes it' };
  }
  if (legacyCreated) return { proof: 'legacy', why: legacyHint('repo') };
  return { proof: 'none', why: 'this setup didn’t create it (you created it yourself, or it was there already)' };
}

const normPath = (p: string, win: boolean) => (win ? p.replace(/[\\/]+$/, '').toLowerCase() : p.replace(/\/+$/, ''));

/** Whether the record proves the setup cloned the folder whose real path is now `real`. */
export function folderProof(p: SetupProvenance | undefined, real: string | undefined, legacyCloned: boolean, win: boolean): { proof: 'recorded' } | { proof: Exclude<Proof, 'recorded'> | 'moved'; why: string } {
  const f = p?.folder;
  if (f?.createdBySetup) {
    if (real && normPath(real, win) === normPath(f.path, win)) return { proof: 'recorded' };
    return { proof: 'moved', why: `the setup cloned ${f.path}, but this folder really is ${real ?? 'somewhere else'}, so the office won’t delete it` };
  }
  if (f?.preExisting) return { proof: 'pre-existing', why: 'it was there before the setup (a floor already), so the office never deletes it' };
  if (legacyCloned) return { proof: 'legacy', why: legacyHint('folder') };
  return { proof: 'none', why: 'this setup didn’t clone it' };
}
