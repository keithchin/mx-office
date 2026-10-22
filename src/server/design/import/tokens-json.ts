// Design-token JSON for the import (./scan.ts): W3C DTCG (`$value`, `$type` inherited from groups, `{a.b}`
// aliases, colour objects with `hex`), Style Dictionary (`value`, `{a.b.value}` aliases) and Tokens Studio
// (`value` + `type`, token sets at the top, `$themes`/`$metadata` left alone). A set or path with `dark` in it
// is the dark variant. Lines come from the order the value keys appear in the text. Never evaluated.

export interface JsonToken {
  path: string;
  value: string;
  type?: string;
  dark: boolean;
  line: number;
  text: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A DTCG colour object ({colorSpace, components, hex}) or a plain value, as text. */
function valueText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return (v as string[]).map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(', ');
  if (isObj(v) && typeof v.hex === 'string') return v.hex;
  if (isObj(v) && (typeof v.value === 'number' || typeof v.value === 'string') && typeof v.unit === 'string') return `${v.value}${v.unit}`;
  return undefined;
}

export function readTokensJson(text: string): JsonToken[] | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObj(doc)) return undefined;
  const lines = text.split('\n');
  // The value keys in text order: the k-th token found below is the k-th of these (JSON.parse keeps key order).
  const keyLines: { line: number; dollar: boolean }[] = [];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/"(\$?value)"\s*:/g)) keyLines.push({ line: i + 1, dollar: m[1] === '$value' });
  });
  const out: {
    path: string;
    raw: unknown;
    type?: string;
    dark: boolean;
    dollar: boolean;
  }[] = [];
  const visit = (node: Record<string, unknown>, path: string[], type: string | undefined, dark: boolean) => {
    const t = typeof node.$type === 'string' ? node.$type : type;
    if ('$value' in node)
      return void out.push({
        path: path.join('.'),
        raw: node.$value,
        type: (node.$type as string) ?? t,
        dark,
        dollar: true,
      });
    if ('value' in node && !isObj(node.value))
      return void out.push({
        path: path.join('.'),
        raw: node.value,
        type: typeof node.type === 'string' ? node.type : t,
        dark,
        dollar: false,
      });
    if ('value' in node && isObj(node.value) && ('hex' in node.value || 'unit' in node.value))
      return void out.push({
        path: path.join('.'),
        raw: node.value,
        type: typeof node.type === 'string' ? node.type : t,
        dark,
        dollar: false,
      });
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || !isObj(v)) continue;
      visit(v, [...path, k], t, dark || /(^|[-_ .])dark($|[-_ .])/i.test(k));
    }
  };
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('$') && isObj(v)) visit(v, [k], undefined, /(^|[-_ .])dark($|[-_ .])/i.test(k));
  if (!out.length) return undefined;
  // A Tokens Studio file keeps each set at the top: `global.color.primary` is known as `color.primary` too.
  const byPath = new Map<string, unknown>();
  for (const o of out) {
    byPath.set(o.path, o.raw);
    const short = o.path.split('.').slice(1).join('.');
    if (short && !byPath.has(short)) byPath.set(short, o.raw);
  }
  const resolve = (raw: unknown, seen = 0): string | undefined => {
    const s = valueText(raw);
    if (s === undefined) return undefined;
    const m = /^\{([^}]+)\}$/.exec(s.trim());
    if (!m) return s.replace(/\{([^}]+)\}/g, (all, ref: string) => (seen > 8 ? all : (resolve(byPath.get(ref.replace(/\.value$/, '')), seen + 1) ?? all)));
    if (seen > 8) return undefined;
    return resolve(byPath.get(m[1].replace(/\.value$/, '')), seen + 1);
  };
  let iDollar = 0;
  let iPlain = 0;
  const dollarLines = keyLines.filter((k) => k.dollar);
  const plainLines = keyLines.filter((k) => !k.dollar);
  const tokens: JsonToken[] = [];
  for (const o of out) {
    const line = (o.dollar ? dollarLines[iDollar++] : plainLines[iPlain++])?.line ?? 1;
    const value = resolve(o.raw);
    if (value === undefined) continue;
    tokens.push({
      path: o.path,
      value,
      ...(o.type ? { type: o.type } : {}),
      dark: o.dark,
      line,
      text: (lines[line - 1] ?? '').trim().slice(0, 200),
    });
  }
  return tokens;
}
