// Reading a Mendix package file (.mpk, a zip) without unpacking it: its central directory, its package.xml
// (a widget's <clientModule name version>, a module's <modelerProject><module name>), and a widget's own
// XML for its widget ids. Only those few small entries are inflated; nothing is written, nothing is run. A
// file that isn't a zip, has no package.xml, or says neither kind is refused with why.

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type { PackageFacts } from '../../shared/marketplace.js';
import { versionFromFileName } from '../../shared/marketplace.js';

/** The largest package the office takes (a module with its jars can be tens of MB). */
export const MPK_MAX_BYTES = 150 * 1024 * 1024;
/** The largest entry it inflates to read (package.xml, a widget's XML). */
const ENTRY_MAX = 2 * 1024 * 1024;

interface Entry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** The zip's entries from its central directory, or why it isn't a zip. */
export function zipEntries(buf: Buffer): Entry[] | string {
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  const from = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return 'not a package file (no zip directory found)';
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return 'not a package file (its zip directory is damaged)';
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compressed, size, offset });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/** One entry's bytes (stored or deflated), or undefined when it can't be read or is too big. */
export function entryBytes(buf: Buffer, e: Entry): Buffer | undefined {
  if (e.size > ENTRY_MAX || e.compressed > ENTRY_MAX) return undefined;
  const h = e.offset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50) return undefined;
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const data = buf.subarray(start, start + e.compressed);
  try {
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: ENTRY_MAX });
  } catch {
    return undefined;
  }
  return undefined;
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];
const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * What package `buf` (named `fileName`) is, or why it isn't a Mendix package. A widget: its clientModule's
 * name and version and each widget file's widget id. A module: its module's name, and the version in its
 * file name when there is one (a module package states none of its own).
 */
export function readPackage(buf: Buffer, fileName: string): PackageFacts | string {
  if (buf.length > MPK_MAX_BYTES) return `the file is over ${MPK_MAX_BYTES / 1024 / 1024} MB`;
  const entries = zipEntries(buf);
  if (typeof entries === 'string') return entries;
  const pkgEntry = entries.find((e) => e.name.toLowerCase() === 'package.xml');
  if (!pkgEntry) return 'not a Mendix package (no package.xml in it)';
  const xml = entryBytes(buf, pkgEntry)?.toString('utf8');
  if (!xml) return 'not a Mendix package (its package.xml can’t be read)';
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const client = /<clientModule\b[^>]*>/.exec(xml)?.[0];
  if (client) {
    const name = attr(client, 'name');
    if (!name) return 'a widget package with no name in its package.xml';
    const widgetIds: string[] = [];
    for (const m of xml.matchAll(/<widgetFile\b[^>]*\bpath\s*=\s*"([^"]+)"/g)) {
      const e = entries.find((x) => x.name === unxml(m[1]));
      const wx = e && entryBytes(buf, e)?.toString('utf8');
      const id = wx && /<widget\b[^>]*\bid\s*=\s*"([^"]+)"/.exec(wx)?.[1];
      if (id) widgetIds.push(unxml(id));
    }
    const version = attr(client, 'version');
    return { kind: 'widget', name: unxml(name), ...(version ? { version: unxml(version), versionFrom: 'package' as const } : {}), widgetIds, sha256, bytes: buf.length };
  }
  if (/<modelerProject\b/.test(xml)) {
    const mod = /<module\b[^>]*>/.exec(xml)?.[0];
    const name = mod && attr(mod, 'name');
    if (!name) return 'a module package with no module name in its package.xml';
    const version = versionFromFileName(fileName);
    return { kind: 'module', name: unxml(name), ...(version ? { version, versionFrom: 'file name' as const } : {}), widgetIds: [], sha256, bytes: buf.length };
  }
  return 'not a widget or module package (its package.xml names neither)';
}
