// 🔌 Connections: the credentials the office and its agents use, kept in one place an admin manages
// from the office (☰ → Connections, ⚙️ Settings, the home page, the wizard) instead of dot-files and a
// launcher script. Saved values are encrypted (vault.ts), resolved Connections → environment variable →
// dot-file (resolve.ts) and handed out where they're used: the workers' environment (env.ts), the
// wizard's admin token (wizard/admin-token.ts), Jeff's key (judge/key.ts) and the office password
// (password.ts). The page only ever gets a status and a masked tail; the audit log gets who changed what.

import path from 'node:path';
import { CREDENTIAL_IDS, CREDENTIAL_META, maskTail, withExpiry, type ConnectionsView, type CredentialCheck, type CredentialId, type CredentialView } from '../../shared/connections.js';
import { normalizeRepo } from '../../shared/floors.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { tildify } from '../building.js';
import { wizardConfig } from '../wizard/config.js';
import { testCredential } from './checks.js';
import { changePassword, passwordView, releasePassword } from './password.js';
import { applyAgentToken, dotFiles, readAll, resolveCredential } from './resolve.js';
import { connectionsVault, officeSettings, openConnections, secretsHome, updateOfficeSettings } from './store.js';
import { pathsView } from './paths.js';
import { sweepView } from '../worktree-sweep/index.js';
import type { Cipher } from './vault.js';
import { wireTeamsWebhook } from './teams-webhook.js';

/** Opens the vault at start (office/core.ts), before any worker starts, and puts the agents' token in the office's environment. */
export function startConnections(dataDir: string, cipher?: Cipher) {
  openConnections(dataDir, cipher);
  applyAgentToken();
  // The Teams webhook URL lives here too (notify-teams moves it out of its own file once).
  wireTeamsWebhook();
}

const label = (id: CredentialId) => CREDENTIAL_META[id].label;

/** The repositories of the office's floors: what the agents' token has to reach. */
const floorRepos = (ctx: Ctx) => [...new Set([...ctx.floors.values()].map((f) => normalizeRepo(f.def.repo ?? '')).filter((r): r is string => !!r))];

function credentialView(ctx: Ctx, id: CredentialId): CredentialView {
  const home = secretsHome();
  if (id === 'password') return passwordView(ctx.cfg, tildify(path.join(home, '.agent-office-password')));
  const vault = connectionsVault();
  const entry = vault?.entry(id);
  const r = resolveCredential(id);
  const view: CredentialView = { id, status: r.value ? 'connected' : 'missing', source: r.source, where: r.where, tail: r.value ? maskTail(r.value) : undefined };
  if (entry) Object.assign(view, { savedAt: entry.savedAt, savedBy: entry.savedBy });
  if (entry?.unreadable) {
    view.warning = 'The saved value can’t be decrypted here (saved by another Windows user, or on another machine): replace it.';
    if (!r.value) view.status = 'invalid';
  } else if (vault?.scheme === 'file' && r.source === 'connections') {
    view.warning = 'Kept base64-encoded in a file only the office’s user can read (no Windows DPAPI on this machine).';
  }
  const check = r.value && vault ? vault.check(id, r.value) : undefined;
  if (check) {
    view.check = check;
    view.status = withExpiry(check.status, check.expiresAt);
  }
  return view;
}

/** What Import from files would take: dot-files with a value that isn't in Connections yet. */
function importable(cfg: Ctx['cfg']): ConnectionsView['importable'] {
  const vault = connectionsVault();
  const files = dotFiles(secretsHome());
  const out: ConnectionsView['importable'] = [];
  for (const id of CREDENTIAL_IDS) {
    if (id === 'password' || CREDENTIAL_META[id].hidden || vault?.get(id)) continue;
    const f = files[id].find((d) => d.read({ read: readAll }));
    if (f) out.push({ id, file: tildify(f.file) });
  }
  const pw = files.password[0];
  if (pw.read({ read: readAll }) && passwordView(cfg, undefined).source !== 'connections') out.push({ id: 'password', file: tildify(pw.file) });
  return out;
}

export function connectionsView(ctx: Ctx): ConnectionsView {
  const vault = connectionsVault();
  const scheme = vault?.scheme ?? (process.platform === 'win32' ? 'dpapi' : 'file');
  const mendixDirs = officeSettings().mendixFloors ?? [];
  const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  return {
    storage: {
      scheme,
      file: tildify(vault?.file ?? path.join(ctx.cfg.dataDir, 'credentials.json')),
      warning: scheme === 'file' ? 'No Windows DPAPI on this machine: saved values are in a file only the office’s user can read (0600), not encrypted. Keep the office’s data folder private.' : undefined,
    },
    credentials: CREDENTIAL_IDS.filter((id) => !CREDENTIAL_META[id].hidden).map((id) => credentialView(ctx, id)),
    importable: importable(ctx.cfg),
    mendixFloors: [...ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name, dir: f.dir, on: mendixDirs.some((d) => same(d, f.dir)) })),
    paths: pathsView(ctx),
    sweep: sweepView(),
    org: wizardConfig().org,
  };
}

function record(ctx: Ctx, who: { name: string; id?: string }, id: CredentialId, summary: string, change: string) {
  audit.record({ actor: human(who.name, who.id), action: 'connections.change', target: { kind: 'setting', id: `credential:${id}`, label: label(id) }, summary, details: { credential: id, change }, severity: 'notice' });
}

/** Saves (or for the password, changes) a credential. Returns why it couldn't. */
export async function saveCredential(ctx: Ctx, id: CredentialId, raw: string, who: { name: string; id?: string }): Promise<string | undefined> {
  const value = raw.trim();
  if (!value) return 'Paste the value first';
  if (id === 'password') {
    const why = changePassword(ctx.cfg, ctx.auth, raw, who.name);
    if (!why) record(ctx, who, id, `Office password changed by ${who.name}`, 'changed');
    return why;
  }
  const meta = CREDENTIAL_META[id];
  if (meta.hidden) return 'The office keeps this one itself';
  if (/\s/.test(value)) return 'That has spaces or line breaks in it: paste just the token';
  if (meta.shape && !meta.shape.test(value)) return meta.shapeHint;
  const vault = connectionsVault();
  if (!vault) return 'Connections isn’t open in this office';
  const had = !!vault.get(id);
  try {
    await vault.set(id, value, who.name);
  } catch (err) {
    return (err as Error).message;
  }
  if (id === 'github-agents') applyAgentToken();
  record(ctx, who, id, `${label(id)} ${had ? 'replaced' : 'added'} by ${who.name}`, had ? 'replaced' : 'added');
  // Test it straight away, so the page shows whether it works.
  await testSaved(ctx, id).catch(() => undefined);
  return undefined;
}

export function removeCredential(ctx: Ctx, id: CredentialId, who: { name: string; id?: string }): string | undefined {
  if (id === 'password') {
    releasePassword(ctx.cfg, ctx.auth);
    record(ctx, who, id, `Office password handed back to the launcher / generated one by ${who.name}`, 'removed');
    return undefined;
  }
  const vault = connectionsVault();
  if (!vault?.remove(id)) return 'Nothing saved to remove';
  if (id === 'github-agents') applyAgentToken();
  record(ctx, who, id, `${label(id)} removed by ${who.name}`, 'removed');
  return undefined;
}

/** Tests the value in use and keeps the result with it. */
export async function testSaved(ctx: Ctx, id: CredentialId): Promise<CredentialCheck | string> {
  const r = resolveCredential(id);
  if (!r.value) return 'Nothing to test: add it first';
  const run = testCredential(id, r.value, floorRepos(ctx));
  if (!run) return 'There’s no test for this one';
  const check = await run;
  connectionsVault()?.setCheck(id, r.value, check);
  return check;
}

/**
 * Import from files: every dot-file with a value that isn't in Connections yet is saved there (the
 * password as its hash). Returns what was taken and the files that can now be deleted.
 */
export async function importFromFiles(ctx: Ctx, who: { name: string; id?: string }): Promise<{ imported: CredentialId[]; files: string[]; errors: string[] }> {
  const imported: CredentialId[] = [];
  const files: string[] = [];
  const errors: string[] = [];
  const all = dotFiles(secretsHome());
  for (const id of CREDENTIAL_IDS) {
    for (const f of all[id]) {
      const value = f.read({ read: readAll });
      if (!value) continue;
      if (id !== 'password' && connectionsVault()?.get(id)) break;
      const why = await saveCredential(ctx, id, value, who);
      if (why) errors.push(`${label(id)} (${tildify(f.file)}): ${why}`);
      else {
        imported.push(id);
        files.push(tildify(f.file));
      }
      break;
    }
  }
  if (imported.length) audit.record({ actor: human(who.name, who.id), action: 'connections.import', target: { kind: 'setting', id: 'connections', label: 'Connections' }, summary: `${who.name} imported ${imported.map(label).join(', ')} from files`, details: { imported }, severity: 'notice' });
  return { imported, files, errors };
}

/** Switches the Mendix token on or off for a floor's agents. */
export function setMendixFloor(ctx: Ctx, floorId: string, on: boolean, who: { name: string; id?: string }): string | undefined {
  const floor = ctx.floors.get(floorId);
  if (!floor) return 'No such floor';
  const dirs = (officeSettings().mendixFloors ?? []).filter((d) => path.resolve(d).toLowerCase() !== path.resolve(floor.dir).toLowerCase());
  updateOfficeSettings({ mendixFloors: on ? [...dirs, floor.dir] : dirs });
  audit.record({ floor: floor.id, actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'mendixToken', label: 'Mendix token for agents' }, summary: `${on ? 'Gave' : 'Took'} the Mendix token ${on ? 'to' : 'from'} ${floor.def.name}'s agents (${who.name}); workers hired from now on`, details: { after: { on } }, severity: 'notice' });
  return undefined;
}

