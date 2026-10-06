// The Command Center console's Chat view (ui/pm/chat/): a worker's conversation, read off its Claude
// Code session transcript by the office (server/convo/) and sent only to the browsers watching it.
// What a tool printed or read is never sent: only a short line of why one failed.

/** Who said it, or what happened: one row of the conversation. */
export type ConvoMsg =
  /** Something a person (or the office, for them) typed to the agent. */
  | { id: string; kind: 'user'; text: string; at?: number }
  /** The agent's reply: its text blocks, Markdown. */
  | { id: string; kind: 'agent'; text: string; at?: number }
  /** A tool call, as a line: "Ran npm test", "Edited src/a.ts". `status` follows its result. */
  | { id: string; kind: 'tool'; tool: string; summary: string; status: ConvoToolStatus; target?: string; preview?: string; at?: number }
  /** AskUserQuestion: the agent asking you to pick. It's answered in the terminal, never from the chat. */
  | { id: string; kind: 'ask'; question: string; options: string[]; answered: boolean; at?: number };

export type ConvoToolStatus = 'running' | 'ok' | 'error';

/** Why there's no conversation to show: not a Claude Code session, or its transcript isn't known yet. */
export type ConvoUnavailable = 'no-transcript' | 'not-found';

export type ConvoClientMsg =
  /** Start sending me this worker's conversation (a `convo.snapshot`, then `convo.append`s). */
  | { t: 'convo.watch'; workerId: string }
  | { t: 'convo.unwatch'; workerId: string };

export type ConvoServerMsg =
  /** The latest of a worker's conversation, oldest first; or why there's none. */
  | { t: 'convo.snapshot'; workerId: string; available: boolean; reason?: ConvoUnavailable; messages: ConvoMsg[] }
  /** What's new or changed since: a message whose id is already there replaces it, a new one goes on the end. */
  | { t: 'convo.append'; workerId: string; messages: ConvoMsg[] };
