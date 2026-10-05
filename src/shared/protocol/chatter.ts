// Team chatter (shared/chatter.ts): the thread is fetched over HTTP (GET /api/chatter); the socket
// only brings each new message as it happens.

import type { ChatterMessage } from '../chatter.js';

export type ChatterServerMsg = { t: 'chatter.new'; floor: string; message: ChatterMessage };
