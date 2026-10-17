// Waiting in tests for the office's fire-and-forget work. A held answer or a hire waits on fsynced critical
// writes first (flow/critical-write.ts: on Linux the folder is synced too), which on a busy CI runner take
// longer than any fixed sleep; so what must happen is waited for by its end state (`until`), and a short
// `settle` is kept only for checks that something did NOT happen.
import assert from 'node:assert/strict';

/** Waits until `ok()` holds, failing with `what` after `ms`. */
export async function until(ok: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
