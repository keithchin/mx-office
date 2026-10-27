// Mojibake repair for text the office stores (reasons, notes, what agents send to the hook server): UTF-8 read as
// Windows-1252 somewhere on the way ("Testing â€º Prepare", "â€œThe usernameâ€\u009d") becomes what was meant
// ("Testing › Prepare"). Only a run that decodes as valid UTF-8 from its Windows-1252 bytes is changed, so real
// accented text ("café", "Zürich") stays as it is. Pure (TextDecoder is in browsers and Node).

const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

const CONT = '\\u0080-\\u00BF\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201E\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122';
/** A lead byte (Â..ô) followed by one to three continuation-looking characters, repeated. */
const RUN = new RegExp(`(?:[\\u00C2-\\u00F4][${CONT}]{1,3})+`, 'g');

function bytesOf(s: string): Uint8Array | undefined {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = ch.charCodeAt(0);
    const b = c <= 0xff ? c : CP1252[ch];
    if (b === undefined) return undefined;
    out[i] = b;
  }
  return out;
}

let decoder: TextDecoder | undefined;

/** The text with its mojibake runs repaired (anything that doesn't decode cleanly is left as it was). */
export function fixText(s: string): string {
  if (!s || !/[Â-ô]/.test(s)) return s;
  decoder ??= new TextDecoder('utf-8', { fatal: true });
  return s.replace(RUN, (run) => {
    const bytes = bytesOf(run);
    if (!bytes) return run;
    try {
      const fixed = decoder!.decode(bytes);
      return fixed.length < run.length ? fixed : run;
    } catch {
      return run;
    }
  });
}

/** Every string in a JSON value repaired (objects and arrays walked; at most `depth` levels). */
export function fixDeep<T>(v: T, depth = 6): T {
  if (typeof v === 'string') return fixText(v) as T;
  if (depth <= 0 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => fixDeep(x, depth - 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = fixDeep(x, depth - 1);
  return out as T;
}
