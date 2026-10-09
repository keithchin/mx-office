// A small BSON reader for the Mendix model's units (the .mxunit files of an MPR v2 project, or the
// Contents column of an MPR v1 one). Read-only and only what the model uses: documents, arrays,
// strings, numbers, booleans, null and binary (ids, which come back as their GUID string).
//
// Mendix arrays carry a marker as their first element (1, 2 or 3: how the list is stored); `list()`
// drops it, so callers see the items only.

export type BsonValue = string | number | boolean | null | BsonDoc | BsonValue[];
export interface BsonDoc {
  [key: string]: BsonValue;
}

const utf8 = new TextDecoder('utf-8');

/** The 16 bytes of a .NET Guid (little-endian first three groups), as the usual 8-4-4-4-12 string. */
export function guidOf(b: Uint8Array): string {
  if (b.length !== 16) return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const h = (i: number) => b[i].toString(16).padStart(2, '0');
  return (
    h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' + h(8) + h(9) + '-' + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

function readDoc(buf: Uint8Array, view: DataView, off: number, isArr: boolean, depth: number, maxDepth: number): BsonDoc | BsonValue[] {
  const len = view.getInt32(off, true);
  const end = off + len;
  const out: BsonDoc | BsonValue[] = isArr ? [] : {};
  let p = off + 4;
  while (p < end - 1) {
    const t = buf[p++];
    let z = p;
    while (buf[z] !== 0 && z < end) z++;
    const key = utf8.decode(buf.subarray(p, z));
    p = z + 1;
    let v: BsonValue;
    switch (t) {
      case 0x01:
        v = view.getFloat64(p, true);
        p += 8;
        break;
      case 0x02: {
        const n = view.getInt32(p, true);
        v = utf8.decode(buf.subarray(p + 4, p + 4 + n - 1));
        p += 4 + n;
        break;
      }
      case 0x03:
      case 0x04: {
        const n = view.getInt32(p, true);
        v = depth < maxDepth ? readDoc(buf, view, p, t === 0x04, depth + 1, maxDepth) : null;
        p += n;
        break;
      }
      case 0x05: {
        const n = view.getInt32(p, true);
        const data = buf.subarray(p + 5, p + 5 + n);
        v = data.length === 16 ? guidOf(data) : data.length ? `bin:${data.length}` : '';
        p += 5 + n;
        break;
      }
      case 0x07:
        v = '';
        p += 12;
        break;
      case 0x08:
        v = buf[p] !== 0;
        p += 1;
        break;
      case 0x09:
      case 0x11:
      case 0x12:
        v = Number(view.getBigInt64(p, true));
        p += 8;
        break;
      case 0x0a:
        v = null;
        break;
      case 0x10:
        v = view.getInt32(p, true);
        p += 4;
        break;
      case 0x13:
        v = null;
        p += 16;
        break;
      default:
        throw new Error(`bson: unknown type 0x${t.toString(16)} at ${p}`);
    }
    if (Array.isArray(out)) out.push(v);
    else out[key] = v;
  }
  return out;
}

/** Decodes a whole BSON document. `maxDepth` stops early (1 = only the top level's plain fields). */
export function decodeBson(buf: Uint8Array, maxDepth = 64): BsonDoc {
  if (buf.length < 5) throw new Error('bson: too short');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = view.getInt32(0, true);
  if (len > buf.length || len < 5) throw new Error('bson: bad length');
  return readDoc(buf, view, 0, false, 0, maxDepth) as BsonDoc;
}

/** A Mendix list's items, without its leading storage marker. */
export function list(v: BsonValue | undefined): BsonDoc[] {
  if (!Array.isArray(v)) return [];
  const items = typeof v[0] === 'number' ? v.slice(1) : v;
  return items.filter((x): x is BsonDoc => !!x && typeof x === 'object' && !Array.isArray(x));
}

/** Plain strings in a Mendix list (e.g. AllowedModuleRoles), without the marker. */
export function strings(v: BsonValue | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return (typeof v[0] === 'number' ? v.slice(1) : v).filter((x): x is string => typeof x === 'string');
}

export const str = (v: BsonValue | undefined): string => (typeof v === 'string' ? v : '');
export const doc = (v: BsonValue | undefined): BsonDoc | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
export const typeOf = (v: BsonValue | undefined): string => str(doc(v)?.$Type);

/** "x;y" as numbers. */
export function point(v: BsonValue | undefined): { x: number; y: number } {
  const [x, y] = str(v).split(';').map(Number);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** The text of a Texts$Text in the first language that has one (en_US first). */
export function textOf(v: BsonValue | undefined): string {
  const items = list(doc(v)?.Items);
  const en = items.find((t) => str(t.LanguageCode) === 'en_US' && str(t.Text));
  return str((en ?? items.find((t) => str(t.Text)))?.Text);
}
