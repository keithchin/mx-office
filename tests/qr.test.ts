// The QR encoder 📱 Phone access draws its address with (shared/qr.ts): Reed-Solomon against the
// standard's worked example, the format and version bits against its tables, every block a valid
// codeword, and the symbol's shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allCodewords, dataCodewords, encodeQr, formatBits, qrSvg, rsEncode, versionBits, QR_MAX_BYTES } from '../src/shared/qr.ts';

test('Reed-Solomon matches the worked "HELLO WORLD" 1-M example', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('format bits for level M and every mask match the standard table', () => {
  const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  table.forEach((bits, mask) => assert.equal(formatBits(mask).toString(2).padStart(15, '0'), bits, `mask ${mask}`));
  assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
});

/** Syndromes of a codeword over GF(256): all zero when it's a valid RS codeword. */
function syndromesZero(cw: number[], n: number): boolean {
  const exp: number[] = [];
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp.push(x);
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  const log = new Map(exp.map((v, i) => [v, i]));
  const mul = (a: number, b: number) => (a && b ? exp[(log.get(a)! + log.get(b)!) % 255] : 0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of cw) s = mul(s, exp[i]) ^ c;
    if (s) return false;
  }
  return true;
}

test('each block of a version 8 code (two block sizes) is a valid codeword', () => {
  const bytes = [...new TextEncoder().encode('https://agent-office-4600.euw.devtunnels.ms/m?item=esc-123456789-abcdefghijklmnopqrstuvwxyz-0123456789-abcdefghijklmnopqrstuvwxyz-0123')];
  const data = dataCodewords(bytes, 8);
  assert.equal(data.length, 2 * 38 + 2 * 39);
  const all = allCodewords(data, 8);
  assert.equal(all.length, 242);
  // De-interleave: data columns over 4 blocks (the last two one longer), then 22 EC each.
  const lens = [38, 38, 39, 39];
  const blocks: number[][] = lens.map(() => []);
  let at = 0;
  for (let i = 0; i < 39; i++) for (let b = 0; b < 4; b++) if (i < lens[b]) blocks[b].push(all[at++]);
  for (let i = 0; i < 22; i++) for (let b = 0; b < 4; b++) blocks[b].push(all[at++]);
  for (const b of blocks) assert.ok(syndromesZero(b, 22));
  assert.deepEqual(blocks.flatMap((b, i) => b.slice(0, lens[i])), data);
});

test('symbols: the smallest version that fits, finder patterns in three corners', () => {
  const q = encodeQr('https://example.com');
  assert.equal(q.version, 2);
  assert.equal(q.size, 25);
  for (const [x, y] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) {
    assert.equal(q.dark[y][x], true);
    assert.equal(q.dark[y + 1][x + 1], false);
    assert.equal(q.dark[y + 3][x + 3], true);
  }
  assert.equal(q.dark[q.size - 8][8], true, 'the dark module');
  assert.ok(encodeQr('x'.repeat(QR_MAX_BYTES)).version === 10);
  assert.throws(() => encodeQr('x'.repeat(QR_MAX_BYTES + 1)));
  assert.match(qrSvg('hi'), /^<svg [^>]*viewBox="0 0 29 29"/);
});
