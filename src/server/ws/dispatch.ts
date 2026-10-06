import type { ClientMsg } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { handlers } from './handlers/index.js';
import { refuseStaleMsg } from './reauth.js';

type AnyHandler = (ctx: Ctx, c: Client, msg: ClientMsg) => void;

/**
 * Hands a message to the handler for its type. Only a string that is one of the map's own keys is
 * a type, so a message that says it's a `constructor` or a `__proto__` goes nowhere, like one of a
 * type nobody handles, and so does one whose type only turns into a key (`['ping']`). A risky one from a
 * socket that came through Phone access waits for the password to be typed again (reauth.ts).
 */
export function dispatch(ctx: Ctx, c: Client, msg: ClientMsg): void {
  if (typeof msg.t !== 'string' || !Object.hasOwn(handlers, msg.t)) return;
  if (refuseStaleMsg(ctx, c, msg)) return;
  (handlers[msg.t] as AnyHandler)(ctx, c, msg);
}
