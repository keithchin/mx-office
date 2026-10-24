// The App Workspace's explorer (the left sidebar): what the server sends for one level of its tree, the
// plain labels it gives the app's pages, data and logic, and the rules for the "Show all files" view (which
// paths are never shown, and which paths may be asked for at all). Pure, so the server, the page and the
// tests share it.
//
// The business tree (the default) is Pages, Data, Logic and Documents (plus Process map and Design where the
// project has them), read at the served revision. The all-files view is the project's raw files at that
// revision, read-only, minus anything on the denylist below or ignored by the project's .gitignore.

/** What a row is. */
export type ExplorerKind = 'group' | 'module' | 'page' | 'entity' | 'flow' | 'doc' | 'folder' | 'file';

export interface ExplorerNode {
  /** Unique within its tree at a revision: 'pages', 'pages/Visitors', 'page:Visitors.VisitorList', 'f:docs/a.md'. */
  id: string;
  label: string;
  kind: ExplorerKind;
  /** The tooltip (where the kind may be named). */
  hint?: string;
  /** It has children, fetched when it's opened. */
  folder?: boolean;
  /** How many children it has, when known. */
  count?: number;
  /** A document of the app: its type (page, microflow, nanoflow, domainmodel, entity) and qualified name. */
  type?: string;
  qn?: string;
  /** A page's path in the running app (/p/visitors), when it has one that needs nothing passed to it. */
  url?: string;
  /** What a "changed" dot keys on: the document (`page:M.P`, `domainmodel:M`) or the file path. */
  key?: string;
  /** A file or document's path in the project. */
  path?: string;
  size?: number;
  /** A module that came from the Marketplace (shown after the app's own). */
  addon?: boolean;
}

/** One level of the tree, at a revision. */
export interface ExplorerLevel {
  rev: string;
  /** The level asked for ('' is the top). */
  at: string;
  nodes: ExplorerNode[];
  /** More rows than this answer carries: ask again with this cursor. */
  next?: number;
  total?: number;
  /** Why the level is empty or partial, in plain words. */
  note?: string;
}

/** What changed between two served revisions: documents (`kind:qn`) and file paths. */
export interface ExplorerChanges {
  from: string;
  to: string;
  docs: string[];
  files: string[];
}

/** A file of the all-files view, to show read-only. */
export interface ExplorerFile {
  path: string;
  size: number;
  kind: 'text' | 'image' | 'binary' | 'large';
  /** Text files: the text. Images: a data URL. */
  text?: string;
  data?: string;
}

/** The most rows one folder answer carries (a bigger folder is paged). */
export const FILES_PAGE = 300;
/** The biggest file the viewer shows as text or a picture. */
export const FILE_MAX_BYTES = 512 * 1024;
export const SHA_RE = /^[0-9a-f]{40}$/;

// ---- Plain labels -------------------------------------------------------------------------------------

/** The naming conventions' prefixes (ACT_, SUB_, DS_, …): the plain label leaves them out. */
const PREFIX = /^(ACT|SUB|DS|VAL|NAV|BCO|ACO|BDE|ADE|BDL|ADL|OCH|IVK|SE|WS|REST|CALC|RUL|NF|MF|ASU|SCE|TST|JA|JSA|PG|POP|SNIP|SN|CRT|GET|SET|EVT|QUE|TSK|WF|API)_/i;

/** A name as people say it: `ACT_Visitor_NewEdit` → `Visitor new edit`, `VisitorList` → `Visitor list`. */
export function plainName(raw: string): string {
  const name = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw;
  const words = name
    .replace(PREFIX, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLowerCase();
      const plain = /^[A-Z0-9]{2,}$/.test(w) ? w : lower;
      return i === 0 ? plain.charAt(0).toUpperCase() + plain.slice(1) : plain;
    });
  return words.join(' ') || name;
}

/** The tooltip that names a document's kind (the label never does). */
export const KIND_HINT: Record<string, string> = {
  page: 'A page of the app',
  microflow: 'Logic that runs on the server',
  nanoflow: 'Logic that runs in the browser',
  domainmodel: 'The data this part of the app keeps',
  entity: 'A kind of record the app keeps',
};

/** The business tree's top groups, in their order. */
export const GROUPS = [
  { id: 'pages', label: 'Pages', hint: 'The screens of the app, by part of the app' },
  { id: 'data', label: 'Data', hint: 'What the app keeps: its kinds of records' },
  { id: 'logic', label: 'Logic', hint: 'What the app does when something happens' },
  { id: 'documents', label: 'Documents', hint: 'The project’s documents' },
  { id: 'processmap', label: 'Process map', hint: 'The business process the app supports' },
  { id: 'design', label: 'Design', hint: 'The look and feel the team agreed' },
] as const;

/**
 * A page's path in the running app from its Url property, or undefined when it has none or needs something
 * passed to it (`{Id}`): such a page only opens from another page.
 */
export function pageUrl(url: string | undefined): string | undefined {
  const u = (url ?? '').trim().replace(/^\/+/, '');
  if (!u || /[{}\s]/.test(u) || u.includes('..') || /^[a-z]+:/i.test(u)) return undefined;
  return u.startsWith('p/') ? `/${u}` : `/p/${u}`;
}

// ---- All files: what's never shown, and which paths may be asked for --------------------------------

/**
 * Paths the all-files view never lists or opens, whatever the project's .gitignore says: git's own
 * folder, the office's data folder, environment files, keys and certificates, credentials and secrets,
 * every config.json (the office's holds tokens), and tool settings that keep tokens.
 */
export function deniedPath(p: string): boolean {
  const parts = p.split('/');
  const lower = parts.map((s) => s.toLowerCase());
  const name = lower[lower.length - 1] ?? '';
  if (lower.some((s) => s === '.git' || s === '.agent-office' || s === '.ssh' || s === '.gnupg' || s === '.aws' || s === '.azure')) return true;
  if (/^\.env($|\.)/.test(name) || name === '.envrc') return true;
  if (/\.(key|pem|pfx|p12|jks|keystore|crt|cer|der|kdbx|ppk)$/.test(name)) return true;
  if (/^credentials/.test(name) || /^secrets?($|[._-])/.test(name)) return true;
  if (name === 'config.json') return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) return true;
  if (['.npmrc', '.netrc', '.pypirc', '.git-credentials', '.gitconfig', '.dockercfg', '.htpasswd', 'settings.local.json', '.agent-office-password'].includes(name)) return true;
  if (/^\.?([a-z]+-)*(token|tokens|apikey|api-key)(\.txt)?$/.test(name) || /\.(token|secret)$/.test(name)) return true;
  return false;
}

/**
 * A path inside the project as the all-files view may ask for it ('' is the top), or null: no `..` or `.`
 * parts, nothing absolute (no leading slash, no drive letter, no backslashes), no control characters.
 */
export function cleanTreePath(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string' || raw.length > 1024) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw) || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('~')) return null;
  const s = raw.replace(/\/+$/, '');
  if (!s) return '';
  const parts = s.split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..')) return null;
  return s;
}

/** How the viewer shows a file, by its name. */
export function fileKind(path: string): 'text' | 'image' | 'binary' {
  const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'image';
  if (['mpr', 'mxunit', 'zip', 'jar', 'dll', 'exe', 'mpk', 'pdf', 'xlsx', 'docx', 'pptx', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'class', 'bin', 'gz', 'tar', '7z', 'mp4', 'mp3', 'wav'].includes(ext)) return 'binary';
  return 'text';
}

export const IMAGE_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp' };
