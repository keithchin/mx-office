// Save to repo: a walkthrough goes to its home, the project's private repository, through a reviewed change.
// A temporary worktree on a new branch (agent-office/walkthroughs-<workflow>-<sha7>) from origin's default
// branch; the files copied to docs/walkthroughs/<workflow>/ (the video, captions.vtt, chapters.vtt,
// steps/NN.png, manifest.json); docs/walkthroughs/index.md written again from every manifest there; one
// commit; the branch pushed (never the default branch, never forced); a pull request opened with gh. Nothing
// lands on main until someone merges it.
//
// Big media: when the repo's .gitattributes sends videos to git LFS (and git lfs works here), the video goes
// that way; otherwise it stays compressed, a video over WARN_BYTES is called out in the PR, and one over
// HARD_BYTES is refused (GitHub refuses files over 100 MB). The repository's pack size goes in the PR too.

import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git, gitRun, remoteDefault, revParse } from '../toolkit-pin/git.js';
import { HARD_BYTES, WARN_BYTES, type SavedToRepo, type WalkManifest } from '../../shared/walkthroughs/types.js';
import { indexMd } from '../../shared/walkthroughs/vtt.js';
import { repoDirOf } from '../../shared/walkthroughs/script.js';
import { fileBytes } from './media.js';

export type Gh = (args: string[], cwd: string) => Promise<string>;

export interface SaveInput {
  /** The project's folder (its git repository). */
  repo: string;
  m: WalkManifest;
  /** The recording's working folder. */
  from: string;
  by: string;
  gh: Gh;
  now?: number;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Whether the checkout sends videos through LFS (and LFS works here). */
async function usesLfs(dir: string): Promise<boolean> {
  const attrs = await readFile(path.join(dir, '.gitattributes'), 'utf8').catch(() => '');
  if (!/^\s*\S*\.(mp4|webm)\b[^\n]*filter=lfs/im.test(attrs)) return false;
  return (await gitRun(['lfs', 'version'], dir)).ok;
}

/** The manifests of every walkthrough folder in the checkout. */
async function manifestsIn(dir: string): Promise<{ dir: string; m: WalkManifest }[]> {
  const root = path.join(dir, 'docs', 'walkthroughs');
  const out: { dir: string; m: WalkManifest }[] = [];
  for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    try {
      out.push({ dir: d.name, m: JSON.parse(await readFile(path.join(root, d.name, 'manifest.json'), 'utf8')) as WalkManifest });
    } catch {
      // Not one of ours.
    }
  }
  return out;
}

/** Opens the pull request; resolves to where it went, or rejects with why not. */
export async function saveToRepo(i: SaveInput): Promise<SavedToRepo> {
  const { m } = i;
  if (m.status !== 'passed') throw new Error(`only a passing walkthrough is saved as evidence (this one is ${m.status})`);
  if (!m.outputs.video) throw new Error('this recording has no video');
  const def = await remoteDefault(i.repo);
  const base = def && (await revParse(i.repo, `refs/remotes/origin/${def}`));
  if (!def || !base) throw new Error('the project has no origin with a default branch to open a pull request against');
  const sha7 = m.app.commit.slice(0, 7);
  const slug = repoDirOf(m.journey.id, m.kind).split('/').pop()!;
  let branch = `agent-office/walkthroughs-${slug}-${sha7}`;
  if ((await revParse(i.repo, `refs/heads/${branch}`)) || (await revParse(i.repo, `refs/remotes/origin/${branch}`))) branch += `-${(i.now ?? Date.now()).toString(36)}`;
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ao-walk-'));
  const rel = repoDirOf(m.journey.id, m.kind);
  try {
    const made = await gitRun(['worktree', 'add', '-b', branch, tmp, base], i.repo, 120_000);
    if (!made.ok) throw new Error(`couldn't check out origin/${def}: ${made.err.slice(0, 200)}`);
    const lfs = await usesLfs(tmp);
    const video = path.join(i.from, m.outputs.video);
    const bytes = await fileBytes(video);
    if (bytes > HARD_BYTES && !lfs) throw new Error(`the video is ${mb(bytes)}, over the ${mb(HARD_BYTES)} a repository takes without git LFS: record a shorter workflow, or set up LFS for *.mp4`);
    const to = path.join(tmp, ...rel.split('/'));
    await rm(to, { recursive: true, force: true });
    await mkdir(path.join(to, 'steps'), { recursive: true });
    const names = [m.outputs.video, m.outputs.captions, m.outputs.chapters, ...m.steps.flatMap((s) => (s.screenshot ? [s.screenshot] : []))].filter((x): x is string => !!x);
    for (const d of await readdir(path.join(i.from, 'cards')).catch(() => [] as string[])) names.push(`cards/${d}`);
    for (const n of names) {
      await mkdir(path.dirname(path.join(to, n)), { recursive: true });
      await copyFile(path.join(i.from, n), path.join(to, ...n.split('/')));
    }
    const { saved: _drop, ...clean } = m;
    void _drop;
    await writeFile(path.join(to, 'manifest.json'), `${JSON.stringify(clean, null, 2)}\n`);
    await writeFile(path.join(tmp, 'docs', 'walkthroughs', 'index.md'), indexMd(await manifestsIn(tmp)));
    await gitRun(['-c', 'core.safecrlf=false', 'add', '--', 'docs/walkthroughs'], tmp, 120_000);
    const who = (await git(['config', 'user.email'], tmp)) ? [] : ['-c', 'user.name=Agent Office', '-c', 'user.email=agent-office@localhost'];
    const title = m.kind === 'tour' ? `docs(walkthroughs): guided tour @${sha7}` : `docs(walkthroughs): ${m.journey.title.slice(0, 50)} @${sha7}`;
    const passed = m.steps.filter((s) => s.status === 'passed').length;
    const pack = /size-pack:\s*(.+)/.exec((await git(['count-objects', '-vH'], tmp)) ?? '')?.[1]?.trim();
    const body = [
      `${m.kind === 'tour' ? 'Guided tour' : `Walkthrough of **${m.journey.title}** (journey \`${m.journey.id}\`, ${m.journey.file})`}, recorded by Mx Office against its own copy of the app at commit \`${m.app.commit}\`${m.milestone ? ` when milestone “${m.milestone.title}” became ready` : ''}.`,
      '',
      m.kind === 'tour' ? `- ${m.parts?.length ?? 0} workflows: ${(m.parts ?? []).map((p) => p.title).join(', ')}` : `- Steps: ${passed} of ${m.steps.length} passed`,
      m.journey.requirement.length ? `- Shows: ${m.journey.requirement.join(', ')}` : '',
      `- Video: ${m.outputs.format?.toUpperCase()}, ${mb(bytes)}${lfs ? ', via git LFS' : ''}${m.outputs.narration !== 'none' ? `, narrated (${m.outputs.narration}, local)` : ', captions only'}`,
      bytes > WARN_BYTES && !lfs ? `- ⚠ The video is over ${mb(WARN_BYTES)}: consider git LFS for *.mp4 in this repository.` : '',
      pack ? `- Repository pack size before this change: ${pack}` : '',
      `- Recorded by ${m.by} (${m.trigger === 'auto' ? 'automatically, milestone ready' : 'on demand'}); saved by ${i.by}.`,
      '',
      `Evidence rule: this video is evidence only for \`${m.app.commit.slice(0, 12)}\`. Demo user and demo data only.`,
      '',
      `Files: \`${rel}/\` and \`docs/walkthroughs/index.md\`.`,
    ]
      .filter((l, k, all) => l !== '' || all[k - 1] !== '')
      .join('\n');
    const c = await gitRun([...who, '-c', 'core.safecrlf=false', 'commit', '-q', '-m', title, '-m', `Recorded at ${m.app.commit}. ${m.kind === 'tour' ? '' : `${passed}/${m.steps.length} steps passed.`}`], tmp, 120_000);
    if (!c.ok) throw new Error(`the commit failed: ${(c.err || c.out).slice(0, 200)}`);
    const p = await gitRun(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], tmp, 10 * 60_000);
    if (!p.ok) throw new Error(`couldn't push ${branch}: ${p.err.slice(0, 200)}`);
    const out = await i.gh(['pr', 'create', '--head', branch, '--base', def, '--title', title, '--body', body], i.repo);
    const url = out.trim().split('\n').pop() ?? '';
    const pr = Number(/\/pull\/(\d+)/.exec(url)?.[1]) || undefined;
    return { branch, at: i.now ?? Date.now(), by: i.by, ...(pr ? { pr } : {}), ...(/^https?:\/\//.test(url) ? { url } : {}), path: rel, lfs };
  } finally {
    await gitRun(['worktree', 'remove', '--force', '--force', tmp], i.repo, 60_000);
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await gitRun(['worktree', 'prune'], i.repo);
    await gitRun(['branch', '-D', branch], i.repo);
  }
}
