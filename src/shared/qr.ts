// A small QR code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1 to 10 (up
// to 213 bytes, plenty for an office's address). Pure, no DOM, no dependency and no CDN: 📱 Phone
// access draws the tunnel's address with it (ui/phone-access/), and the tests check its Reed-Solomon
// against the standard's worked example.

/** Per version (1-10) at level M: EC codewords per block, and the blocks as [count, data codewords]. */
const BLOCKS_M: readonly { ec: number; groups: readonly [number, number][] }[] = [
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
  { ec: 26, groups: [[4, 43], [1, 44]] },
];

const ALIGN: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const dataCapacity = (v: number) => BLOCKS_M[v - 1].groups.reduce((n, [c, d]) => n + c * d, 0);

/** The most bytes a version-10 code at level M holds. */
export const QR_MAX_BYTES = dataCapacity(10) - 3;

// ---- GF(256) and Reed-Solomon ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The `n` error correction codewords of `data` (the remainder of data·x^n by the generator). */
export function rsEncode(data: readonly number[], n: number): number[] {
  // The generator: (x - α^0)(x - α^1)…(x - α^(n-1)), highest power first, leading 1 left off.
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array<number>(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

// ---- Encoding --------------------------------------------------------------------------------------------

function utf8(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/** The data codewords for `bytes` at `version`: mode, count, data, terminator and padding. */
export function dataCodewords(bytes: readonly number[], version: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCapacity(version) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < dataCapacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Data and EC codewords, interleaved block by block as they're placed. */
export function allCodewords(data: number[], version: number): number[] {
  const { ec, groups } = BLOCKS_M[version - 1];
  const blocks: number[][] = [];
  let at = 0;
  for (const [count, len] of groups) for (let i = 0; i < count; i++) (blocks.push(data.slice(at, at + len)), (at += len));
  const ecs = blocks.map((b) => rsEncode(b, ec));
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

/** The 15 format bits for level M and `mask` (BCH, then the fixed XOR mask). */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | (rem & 0xfff);
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** A QR code: `size`×`size` modules, `dark[y][x]`. */
export interface QrCode {
  version: number;
  size: number;
  mask: number;
  dark: boolean[][];
}

class Grid {
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  constructor(readonly size: number) {
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    this.dark[y][x] = dark;
    this.fixed[y][x] = true;
  }
}

function drawFunctions(g: Grid, version: number) {
  const n = g.size;
  for (let i = 0; i < n; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const pos = ALIGN[version - 1];
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(g, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, bit);
      g.set(b, a, bit);
    }
  }
}

function drawFormat(g: Grid, mask: number) {
  const n = g.size;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(i));
  g.set(8, 7, bit(6));
  g.set(8, 8, bit(7));
  g.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.set(8, n - 15 + i, bit(i));
  g.set(8, n - 8, true);
}

function drawData(g: Grid, codewords: number[]) {
  const n = g.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (g.fixed[y][x]) continue;
        if (i < codewords.length * 8) g.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

/** How bad a masked symbol is to scan (the standard's four penalty rules). */
function penalty(d: boolean[][]): number {
  const n = d.length;
  let score = 0;
  const lines = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      // 1:1:3:1:1 with four light either side, a finder look-alike.
      for (let b = 0; b + 10 < n; b++) {
        const s = Array.from({ length: 11 }, (_, k) => get(a, b + k));
        const core = s[4] && !s[5] && s[6] && s[7] && s[8] && !s[9] && s[10];
        const core2 = s[0] && !s[1] && s[2] && s[3] && s[4] && !s[5] && s[6];
        if (core && !s[0] && !s[1] && !s[2] && !s[3]) score += 40;
        if (core2 && !s[7] && !s[8] && !s[9] && !s[10]) score += 40;
      }
    }
  };
  lines((y, x) => d[y][x]);
  lines((x, y) => d[y][x]);
  let darkCount = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (d[y][x]) darkCount++;
      if (x < n - 1 && y < n - 1 && d[y][x] === d[y][x + 1] && d[y][x] === d[y + 1][x] && d[y][x] === d[y + 1][x + 1]) score += 3;
    }
  }
  const k = Math.ceil(Math.abs(darkCount * 20 - n * n * 10) / (n * n)) - 1;
  return score + Math.max(0, k) * 10;
}

/** The QR code for `text` (UTF-8, byte mode, level M): the smallest version it fits, the best mask. */
export function encodeQr(text: string): QrCode {
  const bytes = utf8(text);
  let version = 1;
  while (version <= 10 && dataCapacity(version) - (version < 10 ? 2 : 3) < bytes.length) version++;
  if (version > 10) throw new Error(`Too long for a QR code here (${bytes.length} bytes, at most ${QR_MAX_BYTES})`);
  const codewords = allCodewords(dataCodewords(bytes, version), version);
  const size = version * 4 + 17;
  let best: QrCode | undefined;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(size);
    drawFunctions(g, version);
    drawData(g, codewords);
    const m = MASKS[mask];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!g.fixed[y][x] && m(x, y)) g.dark[y][x] = !g.dark[y][x];
    drawFormat(g, mask);
    const s = penalty(g.dark);
    if (s < bestScore) {
      bestScore = s;
      best = { version, size, mask, dark: g.dark };
    }
  }
  return best!;
}

/** The code as an SVG (a 4-module quiet zone round it), for an <img> or innerHTML. */
export function qrSvg(text: string, px = 4): string {
  const q = encodeQr(text);
  const n = q.size + 8;
  let path = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark[y][x]) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
