// A log file written line by line without holding the event loop: a build prints hundreds of lines, and an
// appendFileSync for each (the live app's and the app instances' logs did that) stalled the server while
// several built at once on Windows. Lines are queued and appended in order, a batch at a time; a failed write
// is dropped (the log is a convenience, the page keeps its own tail).

import { appendFile } from 'node:fs/promises';

export interface LogAppender {
  (line: string): void;
  /** Resolves once everything queued so far is written. */
  flush(): Promise<void>;
}

const appenders = new Map<string, LogAppender>();

/** The appender for `file` (one per file, so two writers keep their order). */
export function logAppender(file: string): LogAppender {
  let a = appenders.get(file);
  if (a) return a;
  let queue: string[] = [];
  let writing: Promise<void> = Promise.resolve();
  let scheduled = false;
  const drain = () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    if (!batch.length) return writing;
    writing = writing.then(() => appendFile(file, batch.join('')).catch(() => undefined));
    return writing;
  };
  const fn = ((line: string) => {
    queue.push(`${line}\n`);
    if (!scheduled) {
      scheduled = true;
      setImmediate(drain);
    }
  }) as LogAppender;
  fn.flush = () => drain();
  appenders.set(file, (a = fn));
  if (appenders.size > 200) appenders.delete(appenders.keys().next().value!);
  return a;
}
