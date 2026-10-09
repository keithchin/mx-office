import './connections.css';
/**
 * 🔌 Connections: the office's credentials (the agents' and admin GitHub tokens, the Mendix token, the
 * Jev key, the office password), the git / gh check, the office's folders and the worktree cleanup, for
 * admins. A window of its own (☰ → Connections, the home page, the wizard) and a pane of ⚙️ Settings.
 * It talks to the office over plain fetches (server/http/routes/connections.ts) and never holds a
 * secret: what it shows comes back as statuses and masked tails.
 */
import { CREDENTIAL_META, type ConnectionsView, type CredentialId } from '../../../shared/connections';
import { h, openModal, toast } from '../dom';
import { connectionsApi, type ImportResult } from './api';
import { credentialCard, type Run } from './cards';
import { pathsSection, sweepSection, toolsSection } from './extras';
import { phoneAccessSection } from '../phone-access';

export interface ConnectionsPanel {
  el: HTMLElement;
  refresh(): Promise<void>;
}

function importBanner(view: ConnectionsView, run: Run, result?: ImportResult): HTMLElement | null {
  if (result?.imported.length) {
    return h(
      'div.cx-banner.good',
      {},
      h('p', {}, h('b', {}, `✅ Imported ${result.imported.map((id) => CREDENTIAL_META[id].label).join(', ')}.`), ' The office now uses the copies in Connections, so you can delete these files:'),
      h('ul', {}, ...result.files.map((f) => h('li', {}, h('code', {}, f)))),
      h('p.cx-note', {}, 'If you start the office with a launcher script that reads them (start-office.ps1), make that file optional first.'),
      ...result.errors.map((e) => h('p.cx-err', {}, e)),
    );
  }
  if (!view.importable.length) return null;
  const go = h('button.btn.primary', { type: 'button' }, '📥 Import from files');
  go.addEventListener('click', () => {
    go.disabled = true;
    void run(async () => {
      const r = await connectionsApi.importFiles();
      lastImport = r.imported;
      return r;
    });
  });
  return h(
    'div.cx-banner',
    {},
    h('p', {}, h('b', {}, `Found ${view.importable.length} credential${view.importable.length === 1 ? '' : 's'} in files: `), view.importable.map((i) => `${CREDENTIAL_META[i.id].label} (${i.file})`).join(', '), '.'),
    h('p.cx-note', {}, 'One click stores them here, encrypted, so nothing depends on those files any more.'),
    go,
  );
}

let lastImport: ImportResult | undefined;

/** The page itself, to put in a window or a pane. `focus` opens on one credential (its form, when it's missing). */
export function connectionsPanel(focus?: CredentialId | 'paths' | 'tools'): ConnectionsPanel {
  const el = h('div.cx', {}, h('p.cx-note', {}, 'Loading…'));
  let view: ConnectionsView | undefined;
  const tools = toolsSection((what, done) => run(what, done));
  // 📱 Phone access keeps its own state (ui/phone-access/): made once, so a repaint doesn't reload it.
  const phone = phoneAccessSection();
  const paint = () => {
    if (!view) return;
    const v = view;
    const result = lastImport;
    lastImport = undefined;
    el.replaceChildren(
      h('p.cx-intro', {}, 'Everything the office and its agents sign in with, in one place. Saved values are ', v.storage.scheme === 'dpapi' ? 'encrypted with Windows DPAPI for the office’s Windows user' : 'kept in a file only the office’s user can read', ` (${v.storage.file}) and never shown again. The office uses, in order: what’s saved here, then its environment variables, then the old dot-files.`),
      v.storage.warning ? h('p.cx-warn', {}, `⚠️ ${v.storage.warning}`) : '',
      importBanner(v, run, result) ?? '',
      h('h3.cx-h', {}, '🔑 Credentials'),
      ...v.credentials.map((c) => credentialCard(c, v, run, focus)),
      h('h3.cx-h', {}, '🧰 Setup'),
      tools,
      phone,
      pathsSection(v, run),
      sweepSection(v, run),
    );
    if (focus) requestAnimationFrame(() => el.querySelector(`#cx-${focus}`)?.scrollIntoView({ block: 'start' }));
    focus = undefined;
  };
  async function run(what: () => Promise<ConnectionsView>, done?: string) {
    try {
      view = await what();
      paint();
      if (done) toast(`🔌 ${done}`);
    } catch (err) {
      toast((err as Error).message, 'warn');
      paint();
    }
  }
  const refresh = async () => {
    try {
      view = await connectionsApi.view();
      paint();
    } catch (err) {
      const status = (err as { status?: number }).status;
      el.replaceChildren(h('p.cx-note', {}, status === 403 ? '🔒 Only admins (operators) can see the office’s connections.' : `Couldn’t load the connections: ${(err as Error).message}`));
    }
  };
  void refresh();
  return { el, refresh };
}

/** The window: ✕ or Esc closes it. */
export function openConnections(focus?: CredentialId | 'paths' | 'tools', onClose?: () => void) {
  const panel = connectionsPanel(focus);
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.connections', { role: 'dialog', 'aria-label': 'Connections' }, h('header', {}, h('h2', {}, '🔌 Connections'), close), h('div.body', {}, panel.el));
  const modal = openModal(el, { doing: '🔌 in Connections', onClose: () => onClose?.() });
  close.addEventListener('click', () => modal.close());
  return modal;
}
