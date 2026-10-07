// The end-to-end office journey (the performance guard's suite 'journey'): one fresh TEST office, fake
// agents only, nothing spent and nothing sent to GitHub or Mendix. The new-project wizard makes a
// project for real (offline: local bare repositories, the stand-ins in journey/stubs.mjs), the team is
// hired with the Discovery brief handed to its analyst, an agent raises an escalation that is answered
// from the Team phone, the project is paused and resumed, a pull request and a deliverable turn up, the
// budget moves, a safe restart keeps the queue and a held message, and the incidents stay clean. Each
// step is checked through the API and the pages.
//
//   node scripts/perf/run.mjs --suite journey --root <test-offices dir> --out <dir> --id <id>
//
// run.mjs calls runJourney({ root, outDir, onProgress }); it makes its office in `root`.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { PERF_BUDGETS } from './budgets.mjs';
import { FAKEBIN, assertTestDir, killProcessesUnder, killRealAgentsUnder, login, startTestOffice } from './office.mjs';
import { findChrome } from './pages.mjs';
import { makeStubs, MENDIX_VERSION } from './journey/stubs.mjs';
import { StepBook, journeySummary, judgeIncidents, waitFor } from './journey/steps.mjs';

export { journeySummary };

const FLOOR = 'leave-app';
const PLAN = {
  kind: 'new',
  owner: 'test-org',
  name: FLOOR,
  description: 'Leave approval for a test client (journey test)',
  mendix: MENDIX_VERSION,
  entry: 'greenfield',
  tier: 'small',
  interview: 'auto',
  execApproval: 'auto',
  intake: [{ n: 2, kind: 'answered', text: 'A test client: HR wants leave requests approved in one place' }],
  clients: ['Test Client'],
  operators: [],
  roles: ['chief-analyst', 'lead-developer'],
  shape: 'startup',
  discovery: { issue: true, queue: true, model: 'sonnet' },
  budget: { level: 'lean', total: 50 },
  by: 'Journey',
};
const TOTAL_STEPS = 12;
/** What the office calls an agent that's asleep (roster/bench.ts ASLEEP). */
const ASLEEP = new Set(['exited', 'offline']);

/** The API of a running test office, signed in. */
function apiOf(office, cookie) {
  return async (method, p, body) => {
    const r = await fetch(office.base + p, { method, headers: { cookie, origin: office.base, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    let b;
    try {
      b = JSON.parse(t);
    } catch {
      b = t;
    }
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${typeof b === 'string' ? b.slice(0, 200) : b?.error ?? JSON.stringify(b).slice(0, 200)}`);
    return b;
  };
}

/** Lines of every fake transcript (FAKE_DIR), as parsed objects with the file they came from. */
function transcripts(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  // ~/.claude/projects/<folder>/<session>.jsonl, as Claude Code keeps them.
  const files = fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? fs.readdirSync(path.join(dir, d.name)).map((x) => path.join(d.name, x)) : [d.name]));
  for (const f of files.filter((x) => x.endsWith('.jsonl')))
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        out.push({ file: f, ...JSON.parse(l) });
      } catch {
        // cut off mid-write
      }
    }
  return out;
}
/** The transcript file of the session that was told it's ${name} (the office's first prompt to a hire). */
/** The newest session that was told it's `name` (a re-hire starts a new one). */
const sessionOf = (dir, name) =>
  userTexts(dir)
    .filter((u) => u.text.startsWith(`You are ${name},`))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]?.file;
const userTexts = (dir) => transcripts(dir).filter((l) => l.type === 'user' && typeof l.message?.content === 'string').map((l) => ({ file: l.file, text: l.message.content, at: l.timestamp }));

export async function runJourney({ root, outDir, onProgress = () => {}, log = console.log }) {
  assertTestDir(root);
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const stubs = makeStubs(root);
  // The office runs with its own ~ (a folder of the test office): the fake agents keep their sessions where
  // Claude Code would (~/.claude/projects), so ▶ Resume carries them on as it would real ones, and nothing
  // of the person's own profile (their gh token, their git identity, their ~/.claude) is read.
  const userHome = path.join(root, 'userhome');
  fs.mkdirSync(userHome, { recursive: true });
  const fakeDir = path.join(userHome, '.claude', 'projects');
  const sep = process.platform === 'win32' ? ';' : ':';
  const env = { ...stubs.env, FAKE_MODE: 'turn', FAKE_TURN_MS: '4000', FAKE_SLOW_MS: '20000', FAKE_DIR: 'claude-home', USERPROFILE: userHome, HOME: userHome, GIT_AUTHOR_NAME: 'Journey', GIT_AUTHOR_EMAIL: 'journey@test-office.invalid', GIT_COMMITTER_NAME: 'Journey', GIT_COMMITTER_EMAIL: 'journey@test-office.invalid', PATH: `${stubs.bin}${sep}${FAKEBIN}${sep}${process.env.PATH}` };
  const book = new StepBook({ onProgress, log, total: TOTAL_STEPS });
  let office;
  let browser;
  let page;
  let api;
  const state = { workers: {} };

  const start = async () => {
    office = await startTestOffice({ home, env, agent: stubs.agent });
    api = apiOf(office, await login(office.base));
    if (browser) await openPage();
  };
  const openPage = async () => {
    const u = new URL(office.base);
    const cookie = (await login(office.base)).split('; ').map((c) => {
      const i = c.indexOf('=');
      return { name: c.slice(0, i), value: c.slice(i + 1), domain: u.hostname, path: '/' };
    });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addCookies(cookie);
    await ctx.addInitScript(() => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Journey', color: '#00a6a6', skin: 0, hair: 0, style: 0 }));
      const WS = window.WebSocket;
      window.WebSocket = class extends WS {
        constructor(...a) {
          super(...a);
          window.__ws = this;
        }
      };
    });
    page = await ctx.newPage();
    page.on('dialog', (d) => d.accept('Journey: rejected for the test').catch(() => {}));
  };
  const shot = async (name) => {
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(outDir, file), timeout: 10000 }).catch(() => {});
    return file;
  };
  const go = async (p, ready) => {
    await page.goto(office.base + p, { waitUntil: 'commit', timeout: 20000 });
    if (ready) await page.waitForSelector(ready, { state: 'visible', timeout: 20000 });
  };
  /** Sends a message on the page's own socket (as the page would). */
  const wsSend = async (msg) => {
    await page.waitForFunction(() => window.__ws && window.__ws.readyState === 1, null, { timeout: 15000 });
    await page.evaluate((m) => window.__ws.send(JSON.stringify(m)), msg);
  };
  const overview = async () => (await api('GET', '/api/home/overview')).floors.find((f) => f.id === FLOOR);
  const roster = () => api('GET', `/api/roster?floor=${FLOOR}`);
  const member = async (role) => (await roster()).members.find((m) => m.role === role);
  const workerOf = async (role) => {
    const m = await member(role);
    return m?.workerId ? (await overview())?.workers.find((w) => w.id === m.workerId) : undefined;
  };
  const prompt = async (workerId, text) => wsSend({ t: 'worker.prompt', workerId, prompt: text });

  try {
    await start();
    browser = await chromium.launch({ headless: true, executablePath: findChrome() });
    await openPage();
    log(`journey office up at ${office.base} (${root})`);

    // 1. The wizard makes the project: every setup step, offline.
    state.makingSince = Date.now();
    await book.run({
      id: 'wizard',
      name: 'Wizard creates the project',
      run: async () => {
        const info = await api('GET', '/api/wizard/info');
        if (!info.offline) throw new Error('the wizard is not offline: refusing to touch GitHub');
        if (info.problems.length) throw new Error(`the wizard reports problems: ${info.problems.join('; ')}`);
        const job = await api('POST', '/api/wizard/start', PLAN);
        const done = await waitFor(async () => {
          const j = await api('GET', `/api/wizard/job?id=${job.id}`);
          if (j.status === 'failed') throw Object.assign(new Error(`setup failed: ${j.steps.filter((s) => s.status === 'failed').map((s) => `${s.label}: ${s.detail}`).join('; ')}`), { fatal: true });
          return j.status === 'done' && j;
        }, { ms: 180000, every: 1000, what: 'the setup to finish' }).catch((e) => {
          throw e;
        });
        if (done.floor !== FLOOR) throw new Error(`the setup made floor ${done.floor}, not ${FLOOR}`);
        if (!(await overview())) throw new Error('the new floor is not on the home page overview');
        state.issue = done.issue;
        await go('/home?tab=projects', '#projects-view');
        await page.waitForFunction((f) => document.querySelector('#projects-view')?.textContent.includes(f), FLOOR, { timeout: 15000 });
        const steps = done.steps.map((s) => `${s.id}:${s.status}`).join(' ');
        return { detail: `floor ${done.floor}, Discovery issue #${done.issue}; ${steps}`, screenshot: await shot('01-home-projects') };
      },
    });

    // 2. The team is hired (the Team tab's Hire, as the Project Manager does: the offline wizard hires nobody).
    await book.run({
      id: 'team',
      name: 'Team hired',
      needs: ['wizard'],
      run: async () => {
        state.spentBefore = (await api('GET', `/api/budget?floor=${FLOOR}`)).spent;
        // The Chief Analyst takes Discovery as its first task (the wizard's own hand-off, steps.ts team()).
        const task = `Work on GitHub issue #${state.issue} in this repo: read it with \`gh issue view ${state.issue}\` and follow it exactly.`;
        await api('POST', '/api/roster/action', { floor: FLOOR, action: 'hire', role: 'chief-analyst', task, by: 'Journey' });
        await api('POST', '/api/roster/action', { floor: FLOOR, action: 'hire', role: 'lead-developer', by: 'Journey' });
        const ws = await waitFor(async () => {
          const a = await workerOf('chief-analyst');
          const d = await workerOf('lead-developer');
          return a && d && a.status !== 'starting' && d.status !== 'starting' && { a, d };
        }, { ms: 60000, what: 'both hires to start' });
        state.workers = { analyst: ws.a, dev: ws.d };
        const real = killRealAgentsUnder(root);
        if (real.length) throw new Error(`real agent CLIs started: ${real.join('; ')}`);
        const started = new Set(transcripts(fakeDir).map((l) => l.file));
        if (started.size < 2) throw new Error(`only ${started.size} fake agent session(s) wrote a transcript`);
        state.analystTranscript = await waitFor(() => sessionOf(fakeDir, ws.a.name), { ms: 15000, what: `${ws.a.name}'s fake session` });
        state.devTranscript = await waitFor(() => sessionOf(fakeDir, ws.d.name), { ms: 15000, what: `${ws.d.name}'s fake session` });
        await go(`/lite?floor=${FLOOR}&tab=org`, '#team-view');
        await page.waitForFunction((names) => names.every((n) => document.querySelector('#team-view')?.textContent.includes(n)), [ws.a.name, ws.d.name], { timeout: 15000 });
        return { detail: `${ws.a.name} (Chief Analyst, ${ws.a.status}) and ${ws.d.name} (Lead Developer, ${ws.d.status}); ${started.size} fake sessions, no real CLI`, screenshot: await shot('02-org-chart') };
      },
    });

    // 2b. The server never stalled while the project was made (wizard, clone, hiring): its event loop
    // blocks over PERF_BUDGETS.serverStallMs, as the test office recorded them (GET /api/perf/stalls).
    await book.run({
      id: 'server-stalls',
      name: `Server never stalled over ${PERF_BUDGETS.serverStallMs} ms making the project`,
      run: async () => {
        const { stalls } = await api('GET', `/api/perf/stalls?since=${state.makingSince}`);
        const fmt = (xs) => xs.map((x) => `${x.ms} ms at +${((x.at - state.makingSince) / 1000).toFixed(1)} s`).join(', ');
        const over = stalls.filter((x) => x.ms > PERF_BUDGETS.serverStallMs);
        log(`server stalls over 100 ms while making the project: ${fmt(stalls) || 'none'}`);
        if (over.length) throw new Error(`the server's event loop stalled ${over.length}× over ${PERF_BUDGETS.serverStallMs} ms: ${fmt(over)}`);
        return `longest block ${Math.max(0, ...stalls.map((x) => x.ms))} ms (${stalls.length} over 100 ms)`;
      },
    });

    // 3. Discovery is handed over: the analyst got the brief as its first prompt, and the issue is there.
    await book.run({
      id: 'discovery',
      name: 'Discovery handed over',
      needs: ['team'],
      run: async () => {
        await waitFor(() => userTexts(fakeDir).find((u) => u.file === state.analystTranscript && u.text.includes(`gh issue view ${state.issue}`)), { ms: 30000, what: "the brief in the analyst's session" });
        const issue = path.join(stubs.github, PLAN.owner, `${FLOOR}.issues`, `${state.issue}.md`);
        if (!fs.existsSync(issue) || !/Discovery/.test(fs.readFileSync(issue, 'utf8'))) throw new Error(`the Discovery issue file is missing: ${issue}`);
        await go(`/lite?floor=${FLOOR}&tab=board`, '#board');
        // The board asks GitHub every 90 s; its refresh asks now (the issue was written after the floor's first look).
        await wsSend({ t: 'gh.refresh' });
        await page.waitForFunction(() => /Discovery/.test(document.querySelector('#board')?.textContent ?? ''), null, { timeout: 30000 });
        return { detail: `issue #${state.issue} on the board; the brief reached ${state.workers.analyst.name}'s session`, screenshot: await shot('03-board-discovery') };
      },
    });

    // 4. A fake agent raises an escalation.
    await book.run({
      id: 'escalation',
      name: 'Agent raises an escalation',
      needs: ['team'],
      run: async () => {
        await prompt(state.workers.analyst.id, 'Please escalate the login question to the Project Manager');
        const e = await waitFor(async () => (await roster()).escalations.find((x) => x.status === 'open'), { ms: 30000, what: 'an open escalation' });
        state.escalation = e;
        await page.click('.tp-launch', { timeout: 10000 });
        // Its Needs you list, where the escalation waits with its buttons: shown, not just in the page.
        await page.locator('.tp-body').getByText('Needs you', { exact: false }).first().click({ timeout: 10000 });
        await page.locator('.tp-body').getByText(e.title.slice(0, 40), { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
        return { detail: `${e.by}: "${e.title}" (${e.urgency}${e.fyi ? ', FYI' : ''}); on the Team phone`, screenshot: await shot('04-phone-escalation') };
      },
    });

    // 5. Answered from the Team phone.
    await book.run({
      id: 'answer',
      name: 'Escalation answered from the Team phone',
      needs: ['escalation'],
      run: async () => {
        const before = userTexts(fakeDir).filter((u) => u.file === state.analystTranscript && /answered your escalation/i.test(u.text)).length;
        // The Approve a person sees on the phone (a visible button: Playwright won't click a hidden one).
        const approve = page.locator('.tp-body button').filter({ hasText: /^\s*Approve\s*$/ }).first();
        await approve.click({ timeout: 10000 }).catch(async (err) => {
          throw Object.assign(new Error(`no visible Approve button on the Team phone: ${err.message.split('\n')[0]}`), { screenshot: await shot('05-phone-no-approve') });
        });
        const e = await waitFor(async () => (await roster()).escalations.find((x) => x.id === state.escalation.id && x.status !== 'open'), { ms: 20000, what: 'the escalation to be resolved' });
        const typed = await waitFor(() => userTexts(fakeDir).filter((u) => u.file === state.analystTranscript && /answered your escalation/i.test(u.text))[before], { ms: 30000, what: 'the answer to reach the agent' });
        return { detail: `${e.resolution?.verdict ?? e.status} by ${e.resolution?.by ?? '?'}; typed to the agent: "${typed.text.slice(0, 80)}"`, screenshot: await shot('05-phone-answered') };
      },
    });

    // 6. Pause the project.
    await book.run({
      id: 'pause',
      name: 'Project paused',
      needs: ['team'],
      run: async () => {
        await api('POST', '/api/project-run', { floor: FLOOR, action: 'pause', by: 'Journey' });
        let seen = '';
        const f = await waitFor(async () => {
          const o = await overview();
          const agents = o.workers.filter((w) => w.kind !== 'shell');
          seen = agents.map((w) => `${w.name} ${w.status}`).join(', ');
          return agents.length && agents.every((w) => ASLEEP.has(w.status)) && o;
        }, { ms: 90000, every: 1000, what: 'every agent to be asleep' }).catch((e) => {
          throw new Error(`${e.message}; agents: ${seen}`);
        });
        const run = await api('GET', `/api/project-run?floor=${FLOOR}`);
        if (!run.pause) throw new Error(`the project is not marked paused: ${JSON.stringify(run).slice(0, 200)}`);
        await go('/home?tab=projects', '#projects-view');
        return { detail: `${f.workers.length} agents asleep; paused by ${run.pause.by ?? '?'}`, screenshot: await shot('06-paused') };
      },
    });

    // 7. Resume it: the preview first, then resume.
    await book.run({
      id: 'resume',
      name: 'Project resumed (preview first)',
      needs: ['pause'],
      run: async () => {
        const preview = await api('GET', `/api/project-run/preview?floor=${FLOOR}`);
        if (preview.blocked) throw new Error(`the preview says nothing may wake: ${preview.blocked}`);
        if (!preview.agents?.length) throw new Error(`the preview lists nobody to wake: ${JSON.stringify(preview).slice(0, 600)}; workers: ${JSON.stringify((await overview()).workers).slice(0, 800)}`);
        // Waking pace: the shortest gap the setting allows, so the journey doesn't wait 45 s between agents.
        await api('POST', '/api/project-run', { floor: FLOOR, action: 'pacing', pacing: { concurrent: 2, gapSec: 0 }, by: 'Journey' });
        // Everyone asleep, not only those with work (the preview's "all").
        await api('POST', '/api/project-run', { floor: FLOOR, action: 'resume', choice: { mode: 'all' }, by: 'Journey' });
        let seen = '';
        const f = await waitFor(async () => {
          const o = await overview();
          const agents = o.workers.filter((w) => w.kind !== 'shell');
          seen = agents.map((w) => `${w.name} ${w.status}`).join(', ');
          return agents.length && agents.every((w) => !ASLEEP.has(w.status) && w.status !== 'starting') && o;
        }, { ms: 150000, every: 1000, what: 'the agents to be back' }).catch((e) => {
          throw new Error(`${e.message}; agents: ${seen}`);
        });
        const run = await api('GET', `/api/project-run?floor=${FLOOR}`);
        if (run.pause) throw new Error('still marked paused after resuming');
        state.workers = { analyst: await workerOf('chief-analyst'), dev: await workerOf('lead-developer') };
        state.analystTranscript = sessionOf(fakeDir, state.workers.analyst.name) ?? state.analystTranscript;
        state.devTranscript = sessionOf(fakeDir, state.workers.dev.name) ?? state.devTranscript;
        return `preview: ${preview.agents.map((a) => `${a.name} (${a.action})`).join(', ')}; back: ${f.workers.map((w) => `${w.name} ${w.status}`).join(', ')}`;
      },
    });

    // 8. A pull request and a deliverable turn up.
    await book.run({
      id: 'pr',
      name: 'Fake PR and deliverable appear',
      needs: ['team'],
      run: async () => {
        const a = state.workers.analyst;
        await prompt(a.id, 'Write the triage, deliver it and open a pr');
        const w = await waitFor(async () => (await overview()).workers.find((x) => x.id === a.id && x.pr), { ms: 45000, what: "the analyst's PR" });
        const dv = await waitFor(async () => {
          const v = await api('GET', `/api/deliverables?floor=${FLOOR}&fresh=1`);
          return v.items?.find((i) => i.id === 'triage' && (i.status === 'done' || i.found?.length || i.files?.length || i.where?.length)) && v;
        }, { ms: 45000, every: 2000, what: 'the triage deliverable' });
        await go(`/lite?floor=${FLOOR}&tab=teams`, '#teams-view');
        await page.waitForFunction(() => /triage/i.test(document.querySelector('#teams-view')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
        const item = dv.items.find((i) => i.id === 'triage');
        return { detail: `PR #${w.pr} linked to ${w.name}; deliverable "${item.title}" ${item.status ?? 'found'}`, screenshot: await shot('08-deliverables') };
      },
    });

    // 9. The budget ledger moved with the fake sessions' usage.
    await book.run({
      id: 'budget',
      name: 'Budget ledger moves',
      needs: ['team'],
      run: async () => {
        const b = await waitFor(async () => {
          const v = await api('GET', `/api/budget?floor=${FLOOR}`);
          return v.spent > (state.spentBefore ?? 0) && v;
        }, { ms: 90000, every: 2000, what: 'spend on the ledger' });
        await go(`/lite?floor=${FLOOR}&tab=budget`, '#budget-view');
        return { detail: `spent $${b.spent.toFixed(4)} of $${b.settings?.total ?? '?'} (was $${(state.spentBefore ?? 0).toFixed(4)}); ${b.byAgent?.length ?? 0} agents on the ledger`, screenshot: await shot('09-budget') };
      },
    });

    // 10. Restart safely: a queued task and a held message come through it.
    await book.run({
      id: 'restart',
      name: 'Restart safely keeps the queue and held messages',
      needs: ['team'],
      run: async () => {
        const dev = state.workers.dev;
        await go(`/lite?floor=${FLOOR}&tab=board`, '#board');
        // The queue seats nobody (limit 0), so the task stays queued through the restart.
        await wsSend({ t: 'queue.limit', maxWorkers: 0 });
        await wsSend({ t: 'queue.add', prompt: 'Journey: a task that waits on the queue', title: 'Journey queued task' });
        const queueFile = path.join(home, 'projects', PLAN.owner, FLOOR, '.agent-office', 'queue.json');
        const queued = await waitFor(() => fs.existsSync(queueFile) && JSON.parse(fs.readFileSync(queueFile, 'utf8')).tasks.find((t) => t.title === 'Journey queued task'), { ms: 15000, what: 'the queued task on disk' });
        // The developer stops at a permission prompt (needs_input), which doesn't hold a restart up; a
        // message for it from the phone meanwhile is held, since typing then would answer the prompt.
        await prompt(dev.id, 'Clean the build: this needs a permission');
        let seen = '';
        await waitFor(async () => {
          const w = (await overview()).workers.find((x) => x.id === dev.id);
          seen = w?.status ?? 'gone';
          return w?.status === 'needs_input';
        }, { ms: 30000, what: 'the developer at its permission prompt' }).catch((e) => {
          throw new Error(`${e.message} (it is ${seen})`);
        });
        const heldText = 'Journey: a message held through the restart';
        const sent = await api('POST', '/api/phone/send', { floor: FLOOR, text: heldText, place: { in: 'dm', workerId: dev.id }, by: 'Journey' });
        if (!(sent.to ?? []).some((x) => x.status === 'held')) throw new Error(`the message was not held: ${JSON.stringify(sent).slice(0, 300)}`);
        // Restart safely: it pauses the project, waits until nobody is mid-turn, and exits (there's no restart loop here).
        const r = await api('POST', '/api/office/restart', { action: 'start', by: 'Journey' });
        const proc = office.proc;
        let phase = r.phase;
        await waitFor(async () => {
          if (proc.exitCode !== null) return true;
          phase = (await api('GET', '/api/office/restart').catch(() => ({ phase }))).phase ?? phase;
          return false;
        }, { ms: 120000, every: 1000, what: 'the office to exit for the restart' }).catch((e) => {
          throw new Error(`${e.message} (restart phase: ${phase})`);
        });
        const rosterFile = path.join(home, '.agent-office', 'roster', `${FLOOR}.json`);
        const heldOnDisk = fs.existsSync(rosterFile) && (JSON.parse(fs.readFileSync(rosterFile, 'utf8')).held ?? []).some((h) => h.text.includes(heldText));
        if (!heldOnDisk) throw new Error('the held message was not in the roster file when the office exited');
        const pending = fs.existsSync(path.join(home, '.agent-office', 'restart-pending.json'));
        await office.stop().catch(() => {});
        // The next office (a looping launcher's job in a real office).
        await start();
        const q = await waitFor(() => JSON.parse(fs.readFileSync(queueFile, 'utf8')).tasks.find((t) => t.id === queued.id && t.status === 'queued'), { ms: 15000, what: 'the queued task after the restart' });
        await waitFor(() => userTexts(fakeDir).some((u) => u.file === state.devTranscript && u.text.includes(heldText)), { ms: 150000, every: 1000, what: 'the held message to reach the developer after the restart' });
        const run = await api('GET', `/api/project-run?floor=${FLOOR}`);
        if (run.pause) throw new Error('the project is still paused after the restart');
        await go(`/lite?floor=${FLOOR}&tab=board`, '#board');
        await page.click('#btn-queue', { timeout: 10000 });
        await page.waitForFunction(() => document.body.textContent.includes('Journey queued task'), null, { timeout: 15000 });
        return { detail: `queued task ${q.id} still queued; the held message was saved at exit and typed to ${dev.name} after the restart; ${pending ? 'the restart resumed the project' : 'no restart-pending file'}`, screenshot: await shot('10-queue-after-restart') };
      },
    });

    // 11. The incidents stayed clean.
    await book.run({
      id: 'incidents',
      name: 'Incidents stay clean',
      run: async () => {
        const v = await api('GET', '/api/incidents');
        const { dirty, noted, rule } = judgeIncidents(v.incidents);
        const real = killRealAgentsUnder(root);
        if (real.length) throw new Error(`real agent CLIs ran: ${real.join('; ')}`);
        const list = (xs) => xs.map((i) => `#${i.number} ${rule(i)}: ${i.title}`).join('; ');
        if (dirty.length) throw new Error(`open incidents: ${list(dirty)}`);
        return `no safety incidents${noted.length ? `; noted (not failing): ${list(noted)}` : ''}`;
      },
    });
  } catch (e) {
    log(`journey stopped: ${e.message}`);
    return { ...book.result(), ok: false, error: e.message };
  } finally {
    await browser?.close().catch(() => {});
    await office?.stop().catch((e) => log(String(e.message)));
    const killed = killProcessesUnder(root);
    if (killed) log(`stopped ${killed} leftover process(es) under the test office`);
  }
  return book.result();
}
