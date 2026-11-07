// The page's one connection to the office (shared/session.ts makes it), for a feature module that needs it
// and isn't handed it by the page: a registered tab (tabs/registry.ts) mounts with only its container.

import type { Net } from '../net';

let net: Net | undefined;

export function setPageNet(n: Net): void {
  net = n;
}

/** The page's connection, once the session made it. */
export const pageNet = (): Net | undefined => net;
