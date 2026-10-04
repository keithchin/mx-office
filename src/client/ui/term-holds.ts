// Who else on this page is watching a worker's terminal. The office attaches a browser to a terminal
// once per connection, not once per window: when the full terminal window or a card's hover preview
// closes and detaches, every other view of that terminal on the page stops getting its output too.
// A view that stays up for a long time (the board's project manager console, ui/pm/console.ts) holds
// the terminal here, and the windows that come and go leave it attached while it's held.

const holds = new Map<string, number>();

/** Keeps `workerId`'s terminal attached when other views of it close; call what it returns to let go. */
export function holdTerminal(workerId: string): () => void {
  holds.set(workerId, (holds.get(workerId) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const n = (holds.get(workerId) ?? 1) - 1;
    if (n > 0) holds.set(workerId, n);
    else holds.delete(workerId);
  };
}

/** Is something on this page still showing `workerId`'s terminal (so closing a window mustn't detach it)? */
export const terminalHeld = (workerId: string): boolean => (holds.get(workerId) ?? 0) > 0;
