// tailwind.config.* for the import (./scan.ts): only literal objects are read, never executed. The `colors`,
// `fontFamily` and `borderRadius` objects (in `theme` or `theme.extend`) are found in the text and read by a
// tiny parser that takes string literals, numbers, arrays of strings and nested objects; anything else (a
// function call, `colors.blue`, a spread, a template string) is skipped and said so.

export interface TwEntry {
  section: 'colors' | 'fontFamily' | 'borderRadius';
  path: string;
  value: string;
  line: number;
  text: string;
}

class Parser {
  i = 0;
  skipped = 0;
  constructor(private s: string) {}
  ws() {
    for (;;) {
      const m = /^(\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(this.s.slice(this.i, this.i + 4096));
      if (!m) return;
      this.i += m[0].length;
    }
  }
  str(): string | undefined {
    const q = this.s[this.i];
    if (q !== '"' && q !== "'") return undefined;
    let out = '';
    for (let j = this.i + 1; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === '\\') {
        out += this.s[++j] ?? '';
        continue;
      }
      if (c === q) {
        this.i = j + 1;
        return out;
      }
      if (c === '\n') return undefined;
      out += c;
    }
    return undefined;
  }
  key(): string | undefined {
    this.ws();
    const s = this.str();
    if (s !== undefined) return s;
    const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(this.s.slice(this.i, this.i + 200));
    if (!m) return undefined;
    this.i += m[0].length;
    return m[0];
  }
  /** Skips one value it can't read (to the next comma or closing bracket at its depth). */
  skipValue() {
    this.skipped++;
    let depth = 0;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '"' || c === "'" || c === '`') {
        const end = this.s.indexOf(c, this.i + 1);
        this.i = end < 0 ? this.s.length : end;
      } else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (!depth) return;
        depth--;
      } else if (c === ',' && !depth) return;
    }
  }
  /** An object literal's leaves: path → [value, position]. */
  object(prefix: string, out: [string, string, number][]) {
    this.i++; // {
    for (let guard = 0; guard < 5000; guard++) {
      this.ws();
      if (this.s[this.i] === '}') return void this.i++;
      if (this.s[this.i] === ',') {
        this.i++;
        continue;
      }
      if (this.s.startsWith('...', this.i)) {
        this.skipValue();
        continue;
      }
      const at = this.i;
      const k = this.key();
      this.ws();
      if (k === undefined || this.s[this.i] !== ':') {
        if (this.i === at) this.i++;
        this.skipValue();
        continue;
      }
      this.i++;
      this.ws();
      const path = prefix ? `${prefix}.${k}` : k;
      const c = this.s[this.i];
      if (c === '{') this.object(path, out);
      else if (c === '[') {
        const pos = this.i;
        const arr = this.array();
        if (arr) out.push([path, arr.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(', '), pos]);
      } else {
        const pos = this.i;
        const v = this.str() ?? this.num();
        if (v === undefined) this.skipValue();
        else out.push([path, v, pos]);
      }
      if (this.i >= this.s.length) return;
    }
  }
  num(): string | undefined {
    const m = /^-?\d+(\.\d+)?/.exec(this.s.slice(this.i, this.i + 40));
    if (!m) return undefined;
    this.i += m[0].length;
    return m[0];
  }
  array(): string[] | undefined {
    this.i++;
    const out: string[] = [];
    for (let guard = 0; guard < 200; guard++) {
      this.ws();
      if (this.s[this.i] === ']') {
        this.i++;
        return out;
      }
      if (this.s[this.i] === ',') {
        this.i++;
        continue;
      }
      const v = this.str();
      if (v === undefined) {
        this.skipValue();
        if (this.s[this.i] === ']') this.i++;
        return undefined;
      }
      out.push(v);
    }
    return undefined;
  }
}

/** The literal colours, font families and radii of a Tailwind config, and how many values were skipped. */
export function readTailwind(text: string): {
  entries: TwEntry[];
  skipped: number;
} {
  const lines = text.split('\n');
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (pos: number) => {
    let n = 0;
    while (n + 1 < starts.length && starts[n + 1] <= pos) n++;
    return n + 1;
  };
  const entries: TwEntry[] = [];
  let skipped = 0;
  for (const section of ['colors', 'fontFamily', 'borderRadius'] as const) {
    for (const m of text.matchAll(new RegExp(`(?:^|[\\s,{])["']?${section}["']?\\s*:\\s*\\{`, 'g'))) {
      const p = new Parser(text);
      p.i = m.index! + m[0].length - 1;
      const out: [string, string, number][] = [];
      p.object('', out);
      skipped += p.skipped;
      for (const [path, value, pos] of out) {
        const line = lineOf(pos);
        entries.push({
          section,
          path: `${section}.${path}`,
          value,
          line,
          text: (lines[line - 1] ?? '').trim().slice(0, 200),
        });
      }
    }
  }
  return { entries, skipped };
}
