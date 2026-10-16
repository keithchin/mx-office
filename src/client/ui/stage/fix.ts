// "Ask the lead to fix the paperwork" on the stage card (shared/decisions/stage-flags.ts): after a
// confirm, POST /api/stage/fix tells the lead what the office's gate-check on main reports against
// PROJECT.md, after their current turn (server/wizard/stage-fix.ts). Nothing in the project changes.
import { toast } from '../dom';

/** Asks the lead (after a confirm); `done` runs once it went. */
export async function goStageFix(floor: string | null | undefined, done?: () => void): Promise<void> {
  if (!floor) return;
  if (!confirm("Ask the team lead, after their current turn, to fix the paperwork gate-check reports, re-run gate-check and commit? The office doesn't change the project itself.")) return;
  try {
    const res = await fetch('/api/stage/fix', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor }) });
    const r = (await res.json().catch(() => ({}))) as { lead?: string; error?: string };
    if (!res.ok) return void toast(`⚠️ ${r.error ?? `Couldn't ask the lead (${res.status})`}`);
    toast(`📨 Asked ${r.lead ?? 'the lead'} to fix the paperwork, after their current turn`);
    done?.();
  } catch {
    toast("⚠️ Couldn't reach the office to ask the lead");
  }
}
