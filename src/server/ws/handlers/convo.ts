// The Command Center console's Chat view: watching a worker's conversation (server/convo/). Only a
// worker on the floor you're on, and only while you're there.
import type { ConvoClientMsg } from '../../../shared/protocol.js';
import { convoOf } from '../../convo/index.js';
import { str } from '../../office/input.js';
import { workerOf } from './common.js';
import type { FeatureHooks, HandlerMap } from './types.js';

export const convoHandlers = {
  'convo.watch'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (!w || ctx.floorOf(c) !== w.floor) return;
    convoOf(ctx).watch(c, w.wid);
  },
  'convo.unwatch'(ctx, c, msg) {
    convoOf(ctx).unwatch(c, str(msg.workerId, 32));
  },
} satisfies HandlerMap<ConvoClientMsg>;

export const convoHooks: FeatureHooks = {
  leaving: (ctx, c) => convoOf(ctx).unwatchAll(c),
  closed: (ctx, c) => convoOf(ctx).unwatchAll(c),
};
