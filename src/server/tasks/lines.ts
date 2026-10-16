// Lines a feature adds under a new task's `Task: tsk_…` line (prepareText, ./identify.ts): each hook is asked,
// without waiting (from what it already holds in memory), and gives back one short line or nothing. The design
// systems' pointer (server/design/line.ts) is one. A hook that throws is skipped: the task still goes.

export interface TaskLineAsk {
  floorId: string;
  taskId: string;
  issue?: number;
  /** The assignment's own reading of it (its first line). */
  text: string;
}

export type TaskLineHook = (t: TaskLineAsk) => string | undefined;

const hooks = new Set<TaskLineHook>();

/** Adds a hook; gives back the way to take it off. */
export function addTaskLineHook(fn: TaskLineHook): () => void {
  hooks.add(fn);
  return () => void hooks.delete(fn);
}

/** `text` with each hook's line under it (a line already in it isn't added twice). */
export function withExtraLines(text: string, t: TaskLineAsk): string {
  const extra: string[] = [];
  for (const fn of hooks) {
    try {
      const line = fn(t);
      if (line && !text.includes(line)) extra.push(line);
    } catch (err) {
      console.warn(`agent-office: a task line hook failed: ${(err as Error).message}`);
    }
  }
  return extra.length ? `${text}\n${extra.join('\n')}` : text;
}
