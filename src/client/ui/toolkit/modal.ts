// The Toolkit window (from the setup panel's Toolkit line or the progress bar's chip): the project's toolkit
// commit and where it runs from, the fork's newer commits with what kind each is, the fork against Maurits'
// upstream, and for admins Update toolkit: a preview first (the stage verdicts on the default branch with
// the toolkit the project runs now and with the new one, the changes, the commits, a warning mid-stage),
// then Confirm, which moves the pin and commits `chore(toolkit): update to <sha>` in the project; Roll back
// goes to the previous pin the same way. A running job is asked about every two seconds while the window
// is open, nothing otherwise. openModal gives the ✕ and Esc.

import { changeText, kindCounts, short, toolkitLine, worse, type CommitKind, type ToolkitCommit, type ToolkitJobView, type ToolkitStatus } from '../../../shared/toolkit';
import { h, openModal, toast } from '../dom';
import { applyToolkit, checkToolkit, getToolkitJob, previewToolkit } from './api';
import { toolkitStatus } from './line';

const KIND: Record<CommitKind, string> = { fix: 'fix', new: 'new', gate: 'gate rule', other: 'other' };
const POLL_MS = 2_000;
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');

function commitList(list: readonly ToolkitCommit[], more = 0): HTMLElement {
  if (!list.length) return h('p.tk-dim', {}, 'None.');
  return h(
    'ul.tk-commits',
    {},
    ...list.map((c) => h('li', {}, h('code', {}, c.sha.slice(0, 7)), ...c.kinds.filter((k) => k !== 'other').map((k) => h('span', { class: `tk-kind ${k}` }, KIND[k])), h('span.tk-subj', {}, c.subject), h('small.tk-dim', {}, c.date))),
    more > 0 ? h('li.tk-dim', {}, `…and ${more} more`) : null,
  );
}

function kindsLine(list: readonly ToolkitCommit[]): string {
  const k = kindCounts(list);
  return [k.fix && `${k.fix} fix`, k.new && `${k.new} new`, k.gate && `${k.gate} gate-rule change${k.gate === 1 ? '' : 's'}`, k.other && `${k.other} other`].filter(Boolean).join(' · ');
}

function upstreamSec(s: ToolkitStatus): HTMLElement | null {
  const u = s.upstream;
  if (!u) return null;
  const text = u.behind || u.ahead ? `The fork is ${u.behind} commit${u.behind === 1 ? '' : 's'} behind ${u.remote}/${u.branch}${u.ahead ? ` and ${u.ahead} ahead (your own fixes)` : ''}.` : `The fork has everything ${u.remote}/${u.branch} has.`;
  return h(
    'section.tk-sec',
    {},
    h('h3', {}, '🔀 Fork and upstream'),
    h('p', {}, text, u.url ? h('small.tk-dim', {}, ` ${u.url}`) : null),
    h('details', {}, h('summary', {}, 'How to bring Maurits’ changes into the fork'), h('pre.tk-pre', {}, `git -C <toolkit clone> fetch upstream\ngit -C <toolkit clone> checkout main\ngit -C <toolkit clone> merge --ff-only upstream/${u.branch}   # or: git merge upstream/${u.branch}, then resolve\ngit -C <toolkit clone> push origin main`), h('p.tk-dim', {}, 'The office never adds remotes or pushes the fork; it only reads how far apart the two are. After the fork moves, each project still stays on its own pin until someone updates it here.')),
  );
}

/** The Toolkit window for `floor`; `moved` hears the pin move. */
export async function openToolkit(floor: string, moved?: () => void) {
  const body = h('div.tk-body', {}, h('p.tk-dim', {}, 'Loading…'));
  const footer = h('footer.tk-foot');
  const el = h('div.modal.tk-modal', { role: 'dialog', 'aria-label': 'Toolkit version' }, h('header', {}, h('h2', {}, '🧰 Toolkit')), body, footer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const modal = openModal(el, { doing: 'looking at the project’s toolkit', reading: true, onClose: () => timer && clearTimeout(timer) });
  const s = await toolkitStatus(floor, true);
  if (!s) return void body.replaceChildren(h('p', {}, "Couldn't ask the office about this project's toolkit."));
  drawStatus(s);

  function drawStatus(st: ToolkitStatus) {
    const check = h('button.btn', { type: 'button', disabled: st.fetching, title: 'Fetches the fork (and upstream) now, off the page; at most once a minute' }, st.fetching ? '⏳ Checking…' : '🔄 Check now');
    check.addEventListener('click', async () => {
      check.disabled = true;
      check.textContent = '⏳ Checking…';
      await checkToolkit(floor);
      setTimeout(async () => {
        const fresh = await toolkitStatus(floor, true);
        if (fresh && !closedYet()) drawStatus(fresh);
      }, 4_000);
    });
    const latest = st.latest;
    body.replaceChildren(
      h('p.tk-headline', {}, toolkitLine(st)),
      h('ul.tk-facts', {}, h('li', {}, st.state === 'pinned' ? `📌 Pinned: runs from ${st.runsFrom}` : `Not pinned: its scripts run from the shared clone ${st.runsFrom}, whose HEAD can move under it.`), st.detail ? h('li', {}, `How it was worked out: ${st.detail}`) : null, st.commit?.subject ? h('li', {}, `Commit: ${st.commit.subject}`) : null, latest ? h('li', {}, `Newest on the fork: ${short(latest.sha)}${latest.date ? ` (${latest.date})` : ''} on ${latest.branch}`) : null, st.previous ? h('li', {}, `Previous pin: ${short(st.previous)}`) : null, h('li', {}, `Fork last fetched: ${when(st.fetchedAt)}`)),
      ...st.problems.map((p) => h('p.tk-warn', { role: 'note' }, `⚠️ ${p}`)),
      h('section.tk-sec', {}, h('h3', {}, `Newer commits on the fork${st.newer.count ? ` (${st.newer.count})` : ''}`), st.newer.commits.length ? h('p.tk-dim', {}, kindsLine(st.newer.commits)) : null, commitList(st.newer.commits, st.newer.count - st.newer.commits.length)),
      upstreamSec(st) ?? h('span'),
    );
    const acts: HTMLElement[] = [check];
    if (st.admin && st.git) {
      if (st.state !== 'pinned' && st.commit) acts.push(h('button.btn', { type: 'button', onclick: () => void runPreview(st.commit!.sha) }, `📌 Preview pinning at ${short(st.commit.sha)}`));
      if (latest && latest.sha !== st.commit?.sha) acts.push(h('button.btn.primary', { type: 'button', onclick: () => void runPreview(latest.sha) }, `⬆ Preview update to ${short(latest.sha)}`));
      if (st.previous) acts.push(h('button.btn', { type: 'button', onclick: () => void runPreview(st.previous!) }, `↩ Preview roll back to ${short(st.previous)}`));
    } else if (!st.admin) acts.push(h('span.tk-dim', {}, '🔒 Only admins update a project’s toolkit'));
    footer.replaceChildren(...acts);
    if (st.job) void follow(st.job.id);
  }

  const closedYet = () => !el.isConnected;

  async function runPreview(to: string) {
    footer.replaceChildren(h('span.tk-dim', {}, '⏳ Starting the preview…'));
    const job = await previewToolkit(floor, to);
    if (!job) return drawStatus((await toolkitStatus(floor, true)) ?? s!);
    void follow(job.id, job);
  }

  async function follow(id: string, first?: ToolkitJobView) {
    let job = first ?? (await getToolkitJob(id));
    while (job && job.status === 'running' && !closedYet()) {
      drawJob(job);
      await new Promise((r) => (timer = setTimeout(r, POLL_MS)));
      job = (await getToolkitJob(id)) ?? job;
    }
    if (job && !closedYet()) drawJob(job);
  }

  function drawJob(job: ToolkitJobView) {
    const running = job.status === 'running';
    const verb = job.kind === 'apply' ? (job.action === 'rollback' ? 'Rolling back to' : job.action === 'pin' ? 'Pinning at' : 'Updating to') : 'Preview:';
    const sections: (HTMLElement | null)[] = [h('p.tk-headline', {}, `${verb} ${short(job.to)}${job.from ? ` (from ${short(job.from)})` : ''}${running ? ' …' : job.status === 'failed' ? ' — failed' : ''}`)];
    if (job.stageWarning) sections.push(h('p.tk-warn', { role: 'note' }, `⚠️ ${job.stageWarning}`));
    if (job.error) sections.push(h('p.tk-warn.bad', { role: 'alert' }, `✗ ${job.error}`));
    if (job.changes) {
      sections.push(
        h(
          'section.tk-sec',
          {},
          h('h3', {}, 'Stage verdicts on the default branch'),
          job.changes.length ? h('ul.tk-changes', {}, ...job.changes.map((c) => h('li', { class: worse(c) ? 'worse' : 'better' }, `${worse(c) ? '🔻' : '🔺'} ${changeText(c)}`))) : h('p', {}, `✅ No stage verdict changes (${job.after?.length ?? 0} stages checked with both).`),
        ),
      );
    }
    if (job.commits) sections.push(h('section.tk-sec', {}, h('h3', {}, `Commits (${job.commits.length})`), job.commits.length ? h('p.tk-dim', {}, kindsLine(job.commits)) : null, commitList(job.commits.slice(0, 40), job.commits.length - 40)));
    sections.push(h('details.tk-log', { open: running || job.status === 'failed' ? '' : undefined }, h('summary', {}, 'What the office did'), h('pre.tk-pre', {}, job.log.join('\n') || '…')));
    body.replaceChildren(...sections.filter((x): x is HTMLElement => !!x));
    const back = h('button.btn', { type: 'button', onclick: async () => drawStatus((await toolkitStatus(floor, true)) ?? s!) }, '← Back');
    if (running) return void footer.replaceChildren(h('span.tk-dim', {}, job.kind === 'preview' ? '⏳ Running gate-check with both toolkits, and the new one’s sync in a temporary copy (several minutes)…' : '⏳ Updating the project…'));
    if (job.kind === 'preview' && job.status === 'ready') {
      const word = job.action === 'rollback' ? 'roll back' : job.action === 'pin' ? 'pin' : 'update';
      const go = h('button.btn.primary', { type: 'button', title: `Moves the pin, runs the toolkit's sync over the project and pushes one commit chore(toolkit): ${word} ${short(job.to)}` }, `✅ Confirm ${word} to ${short(job.to)}`);
      go.addEventListener('click', async () => {
        go.disabled = true;
        const a = await applyToolkit(floor, job.to);
        if (a) void follow(a.id, a);
        else go.disabled = false;
      });
      return void footer.replaceChildren(back, h('span.tk-grow'), go);
    }
    if (job.kind === 'apply' && job.status === 'done') {
      toast(`🧰 Toolkit ${job.action === 'rollback' ? 'rolled back to' : 'now'} ${short(job.to)}${job.pushed ? `, pushed to ${job.pushed}` : ''}`);
      moved?.();
    }
    footer.replaceChildren(back);
  }
  return modal;
}
