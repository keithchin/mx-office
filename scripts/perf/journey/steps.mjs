// The journey's bookkeeping, kept pure so tests/perf-journey.test.ts can pin it: each step's result in
// the shape src/shared/testlab.ts StepResult says, steps that need a failed one marked as skipped
// rather than run, and the Markdown summary.

/** Runs steps in order, each `{ id, name, needs?, run }`: `run` returns a detail line or throws. */
export class StepBook {
  constructor({ now = () => Date.now(), onProgress = () => {}, log = () => {}, total = 0 } = {}) {
    this.steps = [];
    this.now = now;
    this.onProgress = onProgress;
    this.log = log;
    this.total = total;
  }

  /** Whether step `id` ran and passed. */
  passed(id) {
    return this.steps.some((s) => s.id === id && s.ok);
  }

  /** The first of `needs` that didn't pass, if any. */
  blocker(needs = []) {
    return needs.find((n) => !this.passed(n));
  }

  async run({ id, name, needs = [], run }) {
    this.onProgress({ done: this.steps.length, of: this.total || this.steps.length + 1, label: name });
    const missing = this.blocker(needs);
    if (missing) {
      const r = { id, name, ok: false, ms: 0, detail: `skipped: needs ${missing}` };
      this.steps.push(r);
      this.log(`SKIP ${id}: ${r.detail}`);
      return r;
    }
    const t0 = this.now();
    let r;
    try {
      const out = await run();
      const detail = typeof out === 'string' ? out : out?.detail;
      r = { id, name, ok: true, ms: this.now() - t0, ...(detail ? { detail } : {}), ...(out?.screenshot ? { screenshot: out.screenshot } : {}) };
    } catch (e) {
      r = { id, name, ok: false, ms: this.now() - t0, detail: String(e?.message ?? e).slice(0, 1500), ...(e?.screenshot ? { screenshot: e.screenshot } : {}) };
    }
    this.steps.push(r);
    this.log(`${r.ok ? 'ok  ' : 'FAIL'} ${id} (${Math.round(r.ms / 100) / 10} s)${r.detail ? `: ${r.detail}` : ''}`);
    return r;
  }

  result() {
    return { ok: this.steps.length > 0 && this.steps.every((s) => s.ok), steps: this.steps };
  }
}

/** A short Markdown summary of a journey run. */
export function journeySummary(res) {
  const steps = res.steps ?? [];
  const passed = steps.filter((s) => s.ok).length;
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [
    `# End-to-end journey: ${passed}/${steps.length} steps passed${res.error ? ` (${cell(res.error)})` : ''}`,
    '',
    '| Result | Step | Time (s) | Detail |',
    '| --- | --- | --- | --- |',
    ...steps.map((s) => `| ${s.ok ? 'pass' : '**FAIL**'} | ${cell(s.name)} | ${(s.ms / 1000).toFixed(1)} | ${cell(s.detail)} |`),
    '',
  ].join('\n');
}

/** Polls `fn` until it returns something truthy (that's the result) or `ms` pass (throws `what`). */
export async function waitFor(fn, { ms = 30000, every = 500, what = 'the condition' } = {}) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out after ${Math.round(ms / 1000)} s waiting for ${what}${last ? ` (last error: ${last.message})` : ''}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Incidents that mean the journey didn't stay clean: safety and reliability rules, not page/server stalls (the page suite's job). */
export const DIRTY_RULES = new Set(['realLaunch', 'launchRefused', 'interrupted', 'escalationUndelivered', 'crashLoop', 'flowFailed', 'spendCap', 'spendSpike', 'studioDenied', 'sweepErrors', 'loginFailed']);

/** Splits open incidents into the ones that fail the journey and the ones it only reports. */
export function judgeIncidents(incidents) {
  const open = (incidents ?? []).filter((i) => i.status !== 'resolved');
  const rule = (i) => i.detectedBy?.rule ?? i.dedupeKey?.split(':')[0] ?? 'manual';
  return {
    dirty: open.filter((i) => DIRTY_RULES.has(rule(i)) || /launch|crash/i.test(rule(i))),
    noted: open.filter((i) => !(DIRTY_RULES.has(rule(i)) || /launch|crash/i.test(rule(i)))),
    rule,
  };
}
