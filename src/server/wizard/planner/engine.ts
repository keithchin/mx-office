// What drafts a brief: the real Chief Analyst (the `claude` CLI, cli.ts) or the test planner (fake.ts).
// Both answer the same three requests; the Planner (index.ts) applies the caps, the honesty rules and the
// metering around them, so an engine only has to answer.

import { cleanBrief, cleanDomains, type Brief, type ChatMsg, type Domains, type StartMode } from '../../../shared/brief.js';
import { BRIEF_SCHEMA, CHAT_SCHEMA, DOMAINS_SCHEMA } from '../../../shared/brief-schema.js';
import { briefInput, briefSystem, chatInput, chatSystem, domainsInput, domainsSystem } from './prompts.js';
import { runPlannerCall, type CliRunner } from './cli.js';

/** An attached file as the planner hands it on: its text (md, txt, docx) or, for a PDF, its path to read. */
export interface PlannerFile {
  name: string;
  path: string;
  text?: string;
  note?: string;
}

export interface Answer<T> {
  value: T | null;
  cost: number;
  error?: string;
  budgetHit?: boolean;
}

export interface PlannerEngine {
  kind: 'cli' | 'fake';
  model: string;
  /** Why it can't run now, or undefined when it can. */
  why(): string | undefined;
  brief(req: { mode: StartMode; prompt: string; files: PlannerFile[]; budgetUsd: number }): Promise<Answer<{ brief: Brief; filesRead: string[] }>>;
  chat(req: { mode: StartMode; brief: Brief; history: ChatMsg[]; text: string; budgetUsd: number }): Promise<Answer<{ brief: Brief; reply: string }>>;
  domains(req: { brief: Brief; budgetUsd: number }): Promise<Answer<Domains>>;
}

export interface CliEngineOpts {
  claude: string | null;
  env: Record<string, string>;
  model: string;
  timeoutMs: number;
  /** Why it mustn't run even with a CLI (test mode), asked each time. */
  refused?: () => string | undefined;
  run?: CliRunner;
}

export function cliEngine(o: CliEngineOpts): PlannerEngine {
  const call = (system: string, input: string, schema: object, budgetUsd: number, files?: PlannerFile[]) =>
    runPlannerCall(o.claude!, o.env, { model: o.model, system, input, schema, timeoutMs: o.timeoutMs, budgetUsd, files: files?.map((f) => ({ name: f.name, path: f.path })) }, o.run);
  return {
    kind: 'cli',
    model: o.model,
    why: () => o.refused?.() ?? (o.claude ? undefined : 'The office can’t find the claude CLI on its machine'),
    async brief(req) {
      const texts = req.files.filter((f) => f.text !== undefined).map((f) => ({ name: f.name, text: f.text!, note: f.note }));
      const pdfs = req.files.filter((f) => f.text === undefined);
      const r = await call(briefSystem(req.mode), briefInput(req.prompt, texts, pdfs.map((f) => f.name)), BRIEF_SCHEMA, req.budgetUsd, pdfs);
      const brief = r.value ? cleanBrief(r.value) : undefined;
      const filesRead = Array.isArray(r.value?.filesRead) ? (r.value.filesRead as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      return brief ? { value: { brief, filesRead }, cost: r.cost } : { value: null, cost: r.cost, error: r.error ?? 'The brief came back empty', budgetHit: r.budgetHit };
    },
    async chat(req) {
      const r = await call(chatSystem(req.mode), chatInput(req.brief, req.history, req.text), CHAT_SCHEMA, req.budgetUsd);
      const brief = r.value ? cleanBrief(r.value) : undefined;
      const reply = typeof r.value?.reply === 'string' ? r.value.reply.trim().slice(0, 1200) : '';
      return brief ? { value: { brief, reply: reply || 'Done: I updated the brief.' }, cost: r.cost } : { value: null, cost: r.cost, error: r.error, budgetHit: r.budgetHit };
    },
    async domains(req) {
      const r = await call(domainsSystem(), domainsInput(req.brief), DOMAINS_SCHEMA, req.budgetUsd);
      const d = r.value ? cleanDomains(r.value) : undefined;
      return d ? { value: d, cost: r.cost } : { value: null, cost: r.cost, error: r.error ?? 'No domains came back', budgetHit: r.budgetHit };
    },
  };
}
