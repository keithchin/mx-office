/**
 * What the flat views (the 1D board at /lite and the 2D pixel office at /pixel) do with a worker:
 * open its terminal (waking it, or fixing its worktree, first), send it a prompt, or give someone new
 * work. No three.js here: both flat views import it.
 */
import type { Net } from '../net';
import { store } from '../state';
import { DESK_BY_ID, nextFreeSeat } from '../../shared/layout';
import { isAsleep } from '../../shared/status';
import type { WorkerInfo } from '../../shared/protocol';
import { toast } from '../ui/dom';
import { openTerminal } from '../ui/terminal';
import { openChanges } from '../ui/changes';
import { lostWorktreeDialog, openPrompt, sendHomeDialog } from '../ui/prompt';
import { openAsk } from '../ui/ask';
import { repoChoices } from './hiring';

export interface WorkerActions {
  /** Its terminal, with the keypad, waking it up first if it's asleep. */
  open(id: string): void;
  /** A prompt for it, without opening the terminal. */
  prompt(id: string): void;
  /**
   * New work: a prompt for a worker who's here, or a new one at `deskId` (else the next free desk).
   * With `issue`, the worker the prompt goes to takes that GitHub issue.
   */
  send(title: string, text?: { context?: string; initial?: string }, issue?: number, deskId?: string): void;
}

export function workerActions(net: Net): WorkerActions {
  const terminal = (id: string) => openTerminal(net, id, () => openChanges(net, id, () => open(id)), undefined, { keypad: true });

  function open(id: string) {
    const w = store.workers.get(id);
    if (!w) return;
    if (w.lost) return fixLostWorktree(w);
    if (isAsleep(w.status)) {
      if (!w.sessionId && w.kind !== 'shell') toast(`${w.name} has no saved session — starting a fresh one`, 'warn');
      net.send({ t: 'worker.resume', workerId: id });
    }
    terminal(id);
  }

  /** Its worktree was deleted outside agent-office: put it back (everyone's who lost theirs), or send it home. */
  function fixLostWorktree(w: WorkerInfo) {
    if (!w.lost || !w.worktree) return;
    const worktree = w.worktree;
    const others = [...store.workers.values()].filter((o) => o.lost && o.id !== w.id);
    lostWorktreeDialog({
      name: w.name,
      worktree,
      lost: w.lost,
      workspace: w.repos?.length ? worktree.path.replace(/[\\/][^\\/]*$/, '') : undefined,
      others: others.map((o) => o.name),
      openTerminal: isAsleep(w.status) ? undefined : () => terminal(w.id),
      rebuild: (all) => {
        toast(all ? `Rebuilding ${others.length + 1} worktrees…` : `Rebuilding ${w.name}'s worktree…`);
        net.send({ t: 'worker.rebuild', workerId: w.id, all });
      },
      sendHome: () =>
        sendHomeDialog({
          workerId: w.id,
          name: w.name,
          where: DESK_BY_ID.get(w.deskId)?.label ?? 'its desk',
          worktree,
          repos: w.repos?.length ? [worktree.path.split(/[\\/]/).pop() ?? 'its own', ...w.repos.map((r) => r.name)] : undefined,
          ask: () => net.send({ t: 'worker.worktree', workerId: w.id }),
          onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: w.id, cleanup }),
        }),
    });
  }

  function prompt(id: string) {
    const w = store.workers.get(id);
    if (!w) return;
    openPrompt({
      title: `✍️ Prompt ${w.name}`,
      subtitle: w.status === 'working' ? `${w.name} is busy, so this waits in its input box until it's done.` : undefined,
      placeholder: 'What should it do next?',
      submitLabel: 'Send',
      onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: id, prompt: text }),
    });
  }

  function send(title: string, text: { context?: string; initial?: string } = {}, issue?: number, deskId?: string) {
    if (!store.project) return toast('Pick a floor first', 'warn');
    // The back office's desks too, as far as the floor's built out (see WING).
    const desk = deskId && !store.workerAtDesk(deskId) ? deskId : nextFreeSeat((id) => !!store.workerAtDesk(id), store.floorPlan.wing)?.id;
    const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && !isAsleep(w.status));
    if (!desk && !awake.length) return toast('Every desk and bean bag is taken — send a worker home first', 'warn');
    openAsk({
      title,
      ...text,
      newDesk: desk ? DESK_BY_ID.get(desk)!.label : undefined,
      workers: awake.map((w) => ({ id: w.id, name: w.name, color: w.color, status: w.status })),
      worktreeOption: !!store.project.branch,
      providerOption: true,
      repoOptions: repoChoices(),
      onSubmit: (prompt, to, worktree, provider, model, effort, repos) => {
        if (to) net.send({ t: 'worker.prompt', workerId: to, prompt, issue });
        else if (desk) net.send({ t: 'worker.spawn', deskId: desk, prompt, worktree, provider, model, effort, issue, repos: repos?.length ? repos : undefined });
      },
    });
  }

  return { open, prompt, send };
}
