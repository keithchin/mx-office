// A source folder attached to a New project draft (Migrate an app, Change an existing app): a local folder
// of legacy code the setup copies into the project's sources/legacy/<name>/, never uploaded anywhere. What
// is skipped (dependency and build folders, secrets-like files, large files), the caps, the summary the
// page shows before anything is copied, and the short file index the Chief Analyst's planning call gets
// instead of the tree. Pure: the walking and copying is server/wizard/source-folder.ts.

/** Folders never copied, wherever they are in the tree: dependencies, build output, caches, version control. */
export const SKIP_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo', '__pycache__'] as const;

/** Secrets-like files, never copied: .env and its variants, keys and certificates. */
export function isSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === '.env' || n.startsWith('.env.') || /\.(pem|key|pfx)$/.test(n);
}

/** One file larger than this is skipped (bundles, images, binaries): code and docs are smaller. */
export const SOURCE_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** The whole copy, at most (after skipping). */
export const SOURCE_MAX_BYTES = 200 * 1024 * 1024;
/** Files in the whole copy, at most (after skipping). */
export const SOURCE_MAX_FILES = 20_000;
/** Paths in the planner's file index, at most. */
export const INDEX_MAX = 150;

export interface SourceFile {
  /** Relative to the folder, with forward slashes. */
  path: string;
  size: number;
}

/** What a scan of the folder found: what will be copied, and what won't be and why. */
export interface SourceFolder {
  /** The folder on the office's machine, as typed (resolved). */
  path: string;
  /** Its own name: the copy goes to sources/legacy/<name>/. */
  name: string;
  files: number;
  bytes: number;
  skipped: {
    /** Each skipped folder name, and how many of them were found. */
    dirs: Record<string, number>;
    secrets: number;
    large: number;
    /** Symbolic links and anything that isn't a plain file or folder: never followed. */
    links: number;
  };
  /** The first INDEX_MAX files, shallowest first (the planner's index; never their contents). */
  index: SourceFile[];
  scannedAt: string;
}

/** The project's copy of the folder, relative to the project. */
export const legacyRel = (name: string) => `sources/legacy/${name}`;

/** A folder name safe to use as the copy's own folder. */
export function legacyName(base: string): string {
  const clean = base.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/^\.+/, '').trim().slice(0, 80);
  return clean || 'source';
}

export const bytesText = (n: number) => (n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "212 files, 9 MB; skipped: node_modules, 2 .env files": said before anything is copied. */
export function summaryText(s: Pick<SourceFolder, 'files' | 'bytes' | 'skipped'>): string {
  const skipped = [
    ...Object.entries(s.skipped.dirs)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([d, n]) => (n > 1 ? `${d} (${n})` : d)),
    ...(s.skipped.secrets ? [plural(s.skipped.secrets, 'secrets-like file')] : []),
    ...(s.skipped.large ? [`${plural(s.skipped.large, 'file')} over ${bytesText(SOURCE_FILE_MAX_BYTES)}`] : []),
    ...(s.skipped.links ? [plural(s.skipped.links, 'link')] : []),
  ];
  return `${plural(s.files, 'file')}, ${bytesText(s.bytes)}${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}`;
}

/** The file index the planning prompt gets: paths and sizes only, capped, and what the team does with the code. */
export function fileIndexText(s: SourceFolder, max = INDEX_MAX): string {
  const shown = s.index.slice(0, max);
  return [
    `The legacy source folder "${s.name}" is attached (${summaryText(s)}). It is confidential and stays on the office's machine.`,
    `You have not read it and cannot: the team reads the code after setup. Here is only its file index (${shown.length} of ${s.files} files, shallowest first, path and size):`,
    ...shown.map((f) => `- ${f.path} (${bytesText(f.size)})`),
    'Use the index only to see what kind of app it is (its stack, its main areas). Anything about its behaviour that the description and documents do not say is an open question, never an assumption.',
  ].join('\n');
}

/** Index order: shallower paths first, then by name. */
export const indexOrder = (a: SourceFile, b: SourceFile) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path);

/** The ways in that can attach a source folder: Migrate an app and Change an existing app. */
export const takesSource = (mode: string) => mode === 'migrate' || mode === 'change';
