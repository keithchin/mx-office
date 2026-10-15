// 🚀 First-run setup's one-click fixes (server/first-run/fixes.ts): admins only, from the office's own
// page. POST /api/setup/fix/plan says what a row's Fix (or Set up everything) would run and hands back
// a confirm token; POST /api/setup/fix/run runs that confirmed plan and streams its progress (a JSON
// line each, FixEvent), and refuses without the token; POST /api/setup/claude-key saves an Anthropic
// API key into 🔌 Connections. Nothing secret is ever sent back: every streamed line goes through the
// redactor, gh's token never leaves the server, and the key is never echoed. Each run is audited.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { audit, human } from '../../audit/index.js';
import { saveCredential } from '../../connections/index.js';
import { credential } from '../../connections/resolve.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { redactor } from '../../wizard/admin-token.js';
import { holdPlan, takePlan } from '../../first-run/confirm.js';
import { fixDepsFor } from '../../first-run/fix-machine.js';
import { fixesFor, planFixes, runFixes } from '../../first-run/fixes.js';
import { prereqIdsFor } from '../../first-run/checks.js';
import type { Who } from '../../first-run/index.js';
import { isFixId, type FixEvent, type FixId, type FixPlan } from '../../../shared/first-run-fix.js';

const ADMINS_ONLY = 'Only an admin can run the office’s setup';

function record(who: Who, summary: string, details: Record<string, unknown>, severity: 'notice' | 'warning' = 'notice') {
  audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'firstRunFix', label: 'First-run setup fixes' }, summary, details, severity });
}

/** What may never show in a streamed line: every token the office holds, and the GitHub token shapes (redactor). */
const hideSecrets = () => redactor([credential('github-agents'), credential('github-admin'), credential('anthropic'), process.env.GH_TOKEN, process.env.GITHUB_TOKEN, process.env.ANTHROPIC_API_KEY]);

export const firstRunFixRoutes = {
  api: {
    path: ['/api/setup/fix/plan', '/api/setup/fix/run', '/api/setup/claude-key'],
    method: 'POST',
    auth: 'session',
    async handle(ctx, { req, res, path: p, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: ADMINS_ONLY });
      if (refuseStale(ctx, req, res)) return;
      let body: Record<string, unknown> = {};
      try {
        const text = await readBody(req, 16 * 1024);
        body = text ? JSON.parse(text) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const named = typeof body.by === 'string' ? body.by.slice(0, 60).replace(/[^\p{L}\p{N} ._'-]/gu, '').trim() : '';
      const who: Who = { name: session.account?.name ?? (named || 'an admin'), id: session.account?.id };
      const owner = session.account?.id ?? 'shared-password';

      if (p === '/api/setup/claude-key') {
        // Saved as 🔌 Connections' Anthropic API key (audited there); never sent back, not even its tail.
        const err = await saveCredential(ctx, 'anthropic', typeof body.key === 'string' ? body.key.slice(0, 400) : '', who);
        return err ? send(res, 400, { error: err }) : send(res, 200, { saved: true });
      }

      const d = fixDepsFor(ctx, who);
      if (p === '/api/setup/fix/plan') {
        let ids: FixId[];
        if (body.ids === 'all') {
          const rows = await Promise.all(prereqIdsFor(d.platform).map((id) => d.check(id)));
          ids = fixesFor(rows, d.hasAgentToken());
        } else ids = (Array.isArray(body.ids) ? body.ids : []).filter(isFixId);
        if (!ids.length && body.ids !== 'all') return send(res, 400, { error: 'Which fix?' });
        const plan: FixPlan = await planFixes(ids, d);
        if (plan.steps.length) Object.assign(plan, holdPlan(plan.steps, owner));
        return send(res, 200, plan);
      }

      // /api/setup/fix/run: only a plan this office handed out, confirmed, runs.
      const taken = takePlan(body.confirm, owner, body.skip);
      if ('error' in taken) {
        record(who, `${who.name} tried to run first-run fixes without a valid confirm (refused)`, { refused: taken.error }, 'warning');
        return send(res, 400, { error: taken.error });
      }
      const steps = taken.steps;
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      const ac = new AbortController();
      res.on('close', () => !res.writableEnded && ac.abort());
      record(who, `${who.name} confirmed and started first-run fixes: ${steps.map((s) => s.title).join('; ')}`, { steps: steps.map((s) => ({ id: s.id, commands: s.commands, sources: s.sources })) });
      const emit = (e: FixEvent) => {
        const hide = hideSecrets();
        const out: FixEvent = e.t === 'line' ? { t: 'line', text: hide(e.text) } : e.t === 'done' && !e.ok ? { ...e, error: hide(e.error) } : e.t === 'step-done' && e.error ? { ...e, error: hide(e.error) } : e;
        if (out.t === 'step-done') record(who, `First-run fix ${out.ok ? 'done' : 'failed'}: ${steps.find((s) => s.id === out.id)?.title ?? out.id}${out.error ? ` (${out.error})` : ''}`, { id: out.id, ok: out.ok, error: out.error }, out.ok ? 'notice' : 'warning');
        if (!res.writableEnded) res.write(`${JSON.stringify(out)}\n`);
      };
      await runFixes(steps, d, emit, ac.signal);
      return res.end();
    },
  },
} satisfies Record<string, Route>;
