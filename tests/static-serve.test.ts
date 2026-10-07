// Serving the client bundle's files (server/http/static.ts). The journey test (scripts/perf/journey.mjs)
// found the whole office going down when a page's file vanished between the route's look and the read
// (a rebuild emptying dist/public): the read stream's error was unhandled. Now that's a 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { serveFile } from '../src/server/http/static.js';

async function serving(file: string) {
  const server = http.createServer((_req, res) => serveFile(res, file, false));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

test('a file that is there is served with its type and the safety headers', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'static-'));
  const file = path.join(dir, 'page.html');
  writeFileSync(file, '<p>hi</p>');
  const s = await serving(file);
  try {
    const r = await fetch(s.base);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(await r.text(), '<p>hi</p>');
  } finally {
    await s.close();
  }
});

test('a file gone before it is read is a 404, and the server keeps answering', async () => {
  const gone = path.join(mkdtempSync(path.join(os.tmpdir(), 'static-')), 'lite.html');
  const s = await serving(gone);
  try {
    const first = await fetch(s.base);
    assert.equal(first.status, 404);
    const again = await fetch(s.base);
    assert.equal(again.status, 404, 'still up');
  } finally {
    await s.close();
  }
});
