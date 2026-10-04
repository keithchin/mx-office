// Free ports for a live app. Each one needs three (the app, the runtime's admin API and mxbuild's
// serve port: mxcli's defaults of 8080/8090/6543 would clash with a second app, or with one a person
// runs by hand), taken from the configured range, skipping ports another live app holds and any
// port something on the machine already listens on.

import net from 'node:net';

/** Whether nothing on this machine answers on `port` and we could listen on it ourselves. */
export async function portFree(port: number): Promise<boolean> {
  // Something listening only on 127.0.0.1 doesn't stop a listen on every address on Windows, so ask both ways.
  if (await answers(port)) return false;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    const done = (yes: boolean) => {
      s.destroy();
      resolve(yes);
    };
    s.setTimeout(500, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/**
 * `count` ports from `range`, lowest first, none in `taken` and each one `isFree`; undefined when the
 * range hasn't that many left.
 */
export async function pickPorts(count: number, range: { from: number; to: number }, taken: ReadonlySet<number>, isFree: (port: number) => Promise<boolean> = portFree): Promise<number[] | undefined> {
  const out: number[] = [];
  for (let p = range.from; p <= range.to && out.length < count; p++) {
    if (taken.has(p)) continue;
    if (await isFree(p)) out.push(p);
  }
  return out.length === count ? out : undefined;
}
