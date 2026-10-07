// Turns a bundle's file:line:column into its source's, from the hidden source maps a PERF_SOURCEMAP=1
// build leaves beside the bundles (dist/public/assets/*.js.map). Only what the harness needs: the
// mappings' VLQ decoding and a lookup; no names.
import fs from 'node:fs';
import path from 'node:path';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VAL = new Map([...B64].map((c, i) => [c, i]));

function decodeVlq(seg) {
  const out = [];
  let v = 0;
  let shift = 0;
  for (const c of seg) {
    const d = VAL.get(c);
    v += (d & 31) << shift;
    if (d & 32) shift += 5;
    else {
      out.push(v & 1 ? -(v >>> 1) : v >>> 1);
      v = 0;
      shift = 0;
    }
  }
  return out;
}

/** Parses a source map into lines of [genCol, srcIdx, srcLine, srcCol] segments. */
function parse(map) {
  const lines = [];
  let src = 0;
  let sl = 0;
  let sc = 0;
  for (const l of map.mappings.split(';')) {
    const segs = [];
    let gc = 0;
    if (l)
      for (const s of l.split(',')) {
        const d = decodeVlq(s);
        gc += d[0];
        if (d.length >= 4) {
          src += d[1];
          sl += d[2];
          sc += d[3];
          segs.push([gc, src, sl, sc]);
        }
      }
    lines.push(segs);
  }
  return { sources: map.sources, lines };
}

/** A resolver for bundles in `assetsDir`: (fileName, line0, col0) → "src/client/x.ts:12" or undefined. */
export function sourceMaps(assetsDir) {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    let m;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(assetsDir, `${file}.map`), 'utf8'));
      m = parse(raw);
    } catch {
      m = undefined;
    }
    cache.set(file, m);
    return m;
  };
  return (file, line, col) => {
    const m = load(file);
    const segs = m?.lines[line];
    if (!segs?.length) return undefined;
    let best;
    for (const s of segs) {
      if (s[0] > col) break;
      best = s;
    }
    if (!best) return undefined;
    const src = String(m.sources[best[1]] ?? '?').replace(/^(\.\.\/)+/, '');
    return `${src}:${best[2] + 1}`;
  };
}
