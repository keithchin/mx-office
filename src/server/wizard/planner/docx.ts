// The text of an attached .docx, without a dependency: a .docx is a zip, its body is word/document.xml, and
// its words are the <w:t> runs, a paragraph per </w:p>. Images, text boxes in drawings, headers, footers and
// comments aren't read, and the page says so ("text extracted (no images)").

import { inflateRawSync } from 'node:zlib';

/** One file out of a zip's central directory, or undefined when it isn't there (or the zip is odd). */
export function unzipEntry(zip: Buffer, want: string): Buffer | undefined {
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return undefined;
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== want) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) return undefined;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 });
    return undefined;
  }
  return undefined;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)));

/** word/document.xml as plain text: one line per paragraph, tabs kept. */
export function docxXmlText(xml: string): string {
  const out: string[] = [];
  let para = '';
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<\/w:p>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] !== undefined) para += decode(m[1]);
    else if (m[0] === '<w:tab/>') para += '\t';
    else if (m[0] === '<w:br/>') para += '\n';
    else {
      out.push(para);
      para = '';
    }
  }
  if (para) out.push(para);
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The text of a .docx, or undefined when it can't be read as one. */
export function docxText(file: Buffer): string | undefined {
  try {
    const xml = unzipEntry(file, 'word/document.xml');
    return xml ? docxXmlText(xml.toString('utf8')) : undefined;
  } catch {
    return undefined;
  }
}
