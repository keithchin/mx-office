// Adding a Mendix Marketplace widget or module to a project (server/marketplace/): an agent asks with
// `office-workers marketplace add` (or the MCP tool), the Project Manager approves it on a Needs-you card,
// and the office, never the agent, downloads it with the office's own Mendix credential (or takes a
// package file the PM picked), checks it, puts it in the requesting agent's branch and commits it as the
// office. The types, the request as an agent sends it, and the package check, written once for the server,
// the page and the tests. Pure.

export type MarketplaceKind = 'widget' | 'module';
export const MARKETPLACE_KINDS: readonly MarketplaceKind[] = ['widget', 'module'];

/** What an agent asks for. */
export interface MarketplaceAsk {
  /** The Marketplace content id (the number in the item's URL, e.g. 235351). */
  id: string;
  /** The version wanted; none means the latest the office can get. */
  version?: string;
  kind: MarketplaceKind;
  /** The package's own name, to check a file against: a widget's id or package name (com.mendix.widget.web.FileUploader), a module's name. */
  name?: string;
  /** What it's for, in a sentence. */
  why?: string;
}

/** What the Marketplace says about the item, when the office could look it up (only with its own Mendix credential). */
export interface MarketplaceInfo {
  title?: string;
  publisher?: string;
  licence?: string;
  latest?: string;
}

/** What a package file holds (server/marketplace/mpk.ts reads it). */
export interface PackageFacts {
  kind: MarketplaceKind;
  /** A widget's clientModule name, a module's module name. */
  name: string;
  /** A widget's clientModule version; a module package states none (read from its file name when it has one). */
  version?: string;
  /** Where the version came from. */
  versionFrom?: 'package' | 'file name';
  /** A widget's widget ids (com.mendix.widget.web.fileuploader.FileUploader). */
  widgetIds: string[];
  sha256: string;
  bytes: number;
}

export type MarketplaceStatus = 'pending' | 'working' | 'added' | 'declined' | 'failed';

export interface MarketplaceRequest extends MarketplaceAsk {
  /** mkt_<base36 time><random>. */
  rid: string;
  floor: string;
  status: MarketplaceStatus;
  /** The agent that asked: its id and name, and the folder and branch it asked from. */
  by: { id: string; name: string };
  folder: string;
  branch?: string;
  at: number;
  info?: MarketplaceInfo;
  /** Set once it was added: how, the package as checked, the commit and the file(s) it put in the project. */
  added?: { how: 'download' | 'file'; pkg: PackageFacts; commit?: string; files: string[]; by: string; at: number };
  /** Why it was declined or failed, in words (never a token). */
  note?: string;
  done?: { by: string; at: number };
}

/** GET /api/marketplace?floor=: the project's requests, newest first, and what the office can do. */
export interface MarketplaceView {
  floor: string;
  admin: boolean;
  /** Whether the office can download from the Marketplace itself (it has a Mendix credential it may use). */
  canDownload: boolean;
  /** Why it can't, when it can't ("this is a test office…", "no Mendix token in Connections"). */
  noDownload?: string;
  requests: MarketplaceRequest[];
}

const ID = /^\d{1,9}$/;
const VERSION = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;

/** An agent's request, read and checked, or why it won't do. */
export function readMarketplaceAsk(body: unknown): MarketplaceAsk | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = typeof b.id === 'number' ? String(b.id) : typeof b.id === 'string' ? b.id.trim() : '';
  if (!ID.test(id)) return 'Give the Marketplace content id: the number in the item’s Marketplace URL (e.g. --id 235351)';
  const kind = b.kind;
  if (kind !== 'widget' && kind !== 'module') return 'Say what it is: --kind widget or --kind module';
  const version = typeof b.version === 'string' && b.version.trim() ? b.version.trim() : undefined;
  if (version !== undefined && !VERSION.test(version)) return `--version is a version number like 2.5.1 (got ${version.slice(0, 40)})`;
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : undefined;
  if (name !== undefined && !NAME.test(name)) return '--name is the package’s own name: a widget id or package name (com.mendix.widget.web.FileUploader) or a module name';
  const why = typeof b.why === 'string' ? b.why.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  return { id, kind, ...(version ? { version } : {}), ...(name ? { name } : {}), ...(why ? { why } : {}) };
}

const low = (s: string) => s.toLowerCase();

/** The names a package answers to: its own name, its widget ids, and each widget id's package (com.mendix.widget.web.fileuploader). */
export function packageNames(p: Pick<PackageFacts, 'name' | 'widgetIds'>): string[] {
  const out = new Set<string>([low(p.name)]);
  for (const id of p.widgetIds) {
    out.add(low(id));
    const dot = id.lastIndexOf('.');
    if (dot > 0) out.add(low(id.slice(0, dot)));
  }
  return [...out];
}

/**
 * Whether package `p` is what request `r` asked for: the same kind, its name when the request gave one, and
 * its version when the request gave one. A module package states no version of its own: its file name's is
 * checked when it has one, else the version is left unconfirmed (said so on the card, never refused for it).
 * Returns the reason it isn't, or undefined when it is.
 */
export function packageMismatch(p: PackageFacts, r: Pick<MarketplaceAsk, 'kind' | 'name' | 'version'>): string | undefined {
  if (p.kind !== r.kind) return `This is a ${p.kind} package (${p.name}), and the request is for a ${r.kind}`;
  if (r.name && !packageNames(p).includes(low(r.name))) return `This package is ${p.name}${p.widgetIds.length ? ` (${p.widgetIds.join(', ')})` : ''}, not ${r.name}`;
  if (r.version && p.version && p.version !== r.version) return `This package is version ${p.version}${p.versionFrom === 'file name' ? ' (by its file name)' : ''}, and the request is for ${r.version}`;
  return undefined;
}

/** What a package is, in words: "widget FileUploader 2.4.1 (com.mendix.widget.web.fileuploader.FileUploader)". */
export const packageWords = (p: PackageFacts): string => `${p.kind} ${p.name}${p.version ? ` ${p.version}` : ' (version not stated in the package)'}${p.widgetIds.length ? ` (${p.widgetIds.join(', ')})` : ''}`;

/** The item, in words, for a card or a message: "widget 235351 (File Uploader) 2.5.1". */
export const askWords = (r: MarketplaceAsk & { info?: MarketplaceInfo }): string => `${r.kind} ${r.info?.title ?? r.name ?? `Marketplace item ${r.id}`} ${r.version ?? '(latest)'}`;

/** Where a package goes in the app folder: a widget's file under widgets/, named as Studio Pro names it. */
export function widgetFileName(p: Pick<PackageFacts, 'name' | 'widgetIds'>): string {
  const id = p.widgetIds[0];
  // com.mendix.widget.web.fileuploader.FileUploader → com.mendix.widget.web.FileUploader.mpk (Studio Pro's own name for it).
  const base = id && id.includes('.') ? `${id.slice(0, id.lastIndexOf('.', id.lastIndexOf('.') - 1) + 1)}${p.name}` : p.name;
  return `${base.replace(/[^A-Za-z0-9_.-]/g, '_')}.mpk`;
}

/** A version read from a module package's file name (BusinessEvents_3.12.0.mpk, Connector-v6.3.0.mpk), if it has one. */
export function versionFromFileName(file: string): string | undefined {
  const m = /[_-]v?(\d+(?:\.\d+){1,3})(?:\.mpk)?$/i.exec(file.replace(/\.mpk$/i, ''));
  return m?.[1];
}
