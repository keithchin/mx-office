// 🚀 First-run setup: a brand-new office (its password still the generated one, or no folder for
// projects yet) walks its first admin through the office password, the machine's prerequisites,
// GitHub, Mendix and the toolkit, then the first project, on the /setup page (client/first-run/). What
// it has done is kept in office-settings.json (connections/store.ts: `setup`, `projectOrg`,
// `defaultMendix`, `toolkitRepo`, `mxcliPath`), so a reload opens on the same step, and every change is
// in the audit log. Tokens go through 🔌 Connections (its own routes and cards), so nothing secret is
// ever kept or shown here. ⚙️ Settings › Connections has Run setup again.

import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TOOLKIT_REPO, GITHUB_OWNER, firstRunReasons, isFirstRunStep, type FirstRunStep, type FirstRunView, type SetupRecord } from '../../shared/first-run.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { tildify } from '../building.js';
import { officeSettings, toolkitDirState, updateOfficeSettings } from '../connections/store.js';
import { passwordView } from '../connections/password.js';
import { toolkitProblem } from '../connections/paths.js';
import { credential } from '../connections/resolve.js';
import { liveAppConfig } from '../liveapp/config.js';
import { mendixVersions, preferredMendix, projectOrg, wizardConfig } from '../wizard/config.js';
import { checkPrereqs, machineDeps } from './checks.js';

export type Who = { name: string; id?: string };

const setupRecord = (): SetupRecord => (officeSettings().setup ?? {}) as SetupRecord;

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Where the Toolkit step clones to by default: the first place the office looks for it. */
export const defaultCloneDir = () => path.join(os.homedir(), 'mendix-toolkit');

function passwordState(ctx: Ctx): FirstRunView['password'] {
  const adminAccount = ctx.accounts.state(new Set()).accounts.some((a) => a.role === 'admin');
  if (!ctx.accounts.sharedPassword && adminAccount) return { set: true, source: 'accounts' };
  const source = passwordView(ctx.cfg, undefined).source;
  if (source === 'connections') return { set: true, source: 'connections' };
  if (source === 'env' || !ctx.cfg.passwordGenerated) return { set: true, source: 'env' };
  return { set: adminAccount, source: adminAccount ? 'accounts' : 'generated' };
}

/** Why the office should open the setup by itself now (empty: it shouldn't). */
export function setupReasons(ctx: Ctx): string[] {
  const pw = passwordState(ctx);
  return firstRunReasons({ passwordGenerated: pw.source === 'generated', adminAccount: pw.source === 'accounts', projectsDirExists: isDir(ctx.building.projectsDir), setup: setupRecord() });
}

export function firstRunView(ctx: Ctx, admin: boolean): FirstRunView {
  const rec = setupRecord();
  const why = setupReasons(ctx);
  const pw = passwordState(ctx);
  const base = { needed: why.length > 0, why, admin, step: rec.step ?? 'welcome', completedAt: rec.completedAt, completedBy: rec.completedBy, password: pw };
  const cfg = wizardConfig();
  const versions = mendixVersions(cfg.mendixDir);
  const t = toolkitDirState();
  const view: FirstRunView = {
    ...base,
    org: projectOrg(),
    mendix: { versions, dir: cfg.mendixDir, preferred: preferredMendix(versions), saved: officeSettings().defaultMendix },
    toolkit: { dir: tildify(t.dir), problem: toolkitProblem(t.dir), repoUrl: officeSettings().toolkitRepo ?? DEFAULT_TOOLKIT_REPO, defaultCloneDir: tildify(defaultCloneDir()) },
    projectsDir: ctx.building.projectsDirState().dir,
    home: tildify(ctx.cfg.dir),
  };
  // Someone who isn't an admin only learns that there's a setup to do, and who can do it.
  if (!admin) return { ...view, org: { value: '', source: view.org.source }, mendix: { versions: [], dir: '', preferred: '' }, toolkit: { dir: '', repoUrl: '', defaultCloneDir: '' }, projectsDir: '', home: '' };
  return view;
}

function record(who: Who, id: string, label: string, summary: string, details?: Record<string, unknown>) {
  audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id, label }, summary, details, severity: 'notice' });
}

/** Moves the setup to `step` (a reload opens there). Returns why it couldn't. */
export function setStep(step: unknown, who: Who): string | undefined {
  if (!isFirstRunStep(step)) return 'No such step';
  const rec = setupRecord();
  if (rec.step === step) return undefined;
  updateOfficeSettings({ setup: { ...rec, step } });
  record(who, 'firstRun', 'First-run setup', `${who.name} moved first-run setup on to ${step}`, { after: { step } });
  return undefined;
}

/** The organization new projects go in ('' goes back to AGENT_OFFICE_PROJECT_ORG or the old default). */
export function setOrg(raw: unknown, who: Who): string | undefined {
  const org = typeof raw === 'string' ? raw.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '') : '';
  if (org && !GITHUB_OWNER.test(org)) return 'That isn’t a GitHub organization or user name (letters, digits and single dashes)';
  const before = projectOrg().value;
  updateOfficeSettings({ projectOrg: org || undefined });
  const after = projectOrg();
  record(who, 'projectOrg', 'GitHub organization for new projects', `${who.name} set the organization new projects go in to ${after.value}${after.source === 'settings' ? '' : ` (${after.source === 'env' ? 'AGENT_OFFICE_PROJECT_ORG' : 'the default'})`}`, { before: { org: before }, after: { org: after.value, source: after.source } });
  return undefined;
}

/** The Studio Pro version new projects start on: one that's installed ('' goes back to the wizard's own pick). */
export function setDefaultMendix(raw: unknown, who: Who): string | undefined {
  const v = typeof raw === 'string' ? raw.trim() : '';
  const versions = mendixVersions(wizardConfig().mendixDir);
  if (v && !versions.includes(v)) return `Studio Pro ${v} isn’t installed here`;
  updateOfficeSettings({ defaultMendix: v || undefined });
  record(who, 'defaultMendix', 'Default Studio Pro version', `${who.name} set new projects to start on Studio Pro ${preferredMendix(versions) || '(none installed)'}${v ? '' : ' (the wizard’s own pick)'}`, { after: { version: v || null } });
  return undefined;
}

const untilde = (s: string) => s.replace(/^~(?=$|[\\/])/, os.homedir());

/** mxcli's path ('' goes back to AGENT_OFFICE_MXCLI or where it usually is). Returns why it couldn't. */
export function setMxcli(raw: unknown, who: Who): string | undefined {
  const text = typeof raw === 'string' ? untilde(raw.trim().replace(/^"|"$/g, '')) : '';
  let p: string | undefined;
  if (text) {
    if (!path.isAbsolute(text)) return 'Use a full path, like C:\\Tools\\mxcli\\mxcli.exe';
    p = path.resolve(text);
    if (isDir(p)) p = path.join(p, process.platform === 'win32' ? 'mxcli.exe' : 'mxcli');
    if (!existsSync(p)) return `There’s no mxcli at ${tildify(p)}`;
  }
  updateOfficeSettings({ mxcliPath: p });
  record(who, 'mxcliPath', 'mxcli', p ? `${who.name} set mxcli to ${tildify(p)}` : `${who.name} cleared the mxcli path`, { after: { path: p ? tildify(p) : null } });
  return undefined;
}

/** Finished: the office stops opening the setup by itself. */
export function finishSetup(who: Who) {
  updateOfficeSettings({ setup: { step: 'done', completedAt: Date.now(), completedBy: who.name } });
  record(who, 'firstRun', 'First-run setup', `${who.name} finished first-run setup`, { after: { completed: true } });
}

/** ⚙️ Settings › Run setup again: it shows once more, from the start, keeping what's already set. */
export function rerunSetup(who: Who) {
  updateOfficeSettings({ setup: { ...setupRecord(), rerun: true, step: 'welcome' } });
  record(who, 'firstRun', 'First-run setup', `${who.name} asked for first-run setup again`, { after: { rerun: true } });
}

/** The step a finished-or-not setup is on (for tests and the page). */
export const currentStep = (): FirstRunStep => setupRecord().step ?? 'welcome';

/** The prerequisite check on this machine, with the office's own settings. */
export function runPrereqs(ctx: Ctx) {
  return checkPrereqs(
    machineDeps({
      mendix: () => {
        const dir = wizardConfig().mendixDir;
        return { dir, versions: mendixVersions(dir) };
      },
      mxcli: () => wizardConfig().mxcli,
      bash: () => wizardConfig().bash,
      jqDir: () => wizardConfig().jqDir,
      toolkit: () => {
        const dir = toolkitDirState().dir;
        return { dir: tildify(dir), problem: toolkitProblem(dir) };
      },
      db: () => liveAppConfig(ctx.cfg.dataDir).db,
      secrets: () => [credential('github-agents'), credential('github-admin'), process.env.GH_TOKEN, process.env.GITHUB_TOKEN],
    }),
  );
}
