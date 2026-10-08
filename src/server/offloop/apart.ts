// Work on a list one item per turn of the event loop, so a timer with something heavy to do for each
// worker (a terminal's scrollback serialized, a transcript looked at) lets pages, hooks and workers in
// between items instead of holding them up for the whole list.

/** Calls `fn` on each of `items`, each in a turn of its own (setImmediate between them). Resolves when done. */
export function eachApart<T>(items: Iterable<T>, fn: (item: T) => unknown): Promise<void> {
  const list = [...items];
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= list.length) return resolve();
      try {
        fn(list[i++]);
      } catch (err) {
        console.error(`agent-office: ${(err as Error).message}`);
      }
      setImmediate(next);
    };
    next();
  });
}
