// The home page's door to 🚀 first-run setup: a new office (password still the generated one, no folder
// for projects) sends its admin to /setup once, and the setup's last step comes back with ?new to open
// the new-project wizard. Read at load, before the home page tidies its address away.
import { SETUP_PAGE } from '../../shared/first-run';

const askedNew = new URLSearchParams(location.search).has('new');

/** Checks once (on load, never again) whether the office wants its setup; `newProject` opens the wizard when ?new asked for it. */
export function firstRunGate(newProject: () => void): void {
  if (askedNew) newProject();
  void fetch('/api/setup/needed', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ needed: boolean; admin: boolean }>) : undefined))
    .then((v) => {
      if (v?.needed && v.admin && !askedNew) location.replace(SETUP_PAGE);
    })
    .catch(() => undefined);
}
