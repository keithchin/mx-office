// The incident a data file the office couldn't read raises (store safety, 2026-10-17; durable/health.ts
// keeps the problems): a locked or refused file is sev2 (Needs you lists it: the office won't write to it
// until it can read it, so changes to it are refused meanwhile), a corrupt one is sev2 too (something was
// lost, and the aside file is where to look), a file put back from its backup or a temporary file is sev3.
// One incident per file (its place), folded together when it happens again. Problems noted before the
// incidents were installed (the stores read at start-up) are raised once they are.

import path from 'node:path';
import { onStoreProblem, type StoreProblem } from '../durable/health.js';
import type { Detection } from './index.js';

/** What a problem raises. */
export function storeDetection(p: StoreProblem, where: (file: string) => string = (f) => f): Detection {
  const file = where(p.file);
  const name = path.basename(p.file);
  if (p.kind === 'locked') {
    return {
      rule: 'storeUnreadable',
      place: name,
      severity: 'sev2',
      title: `The office couldn't read ${name}`,
      summary: `The office couldn't read ${file} (${p.error}); it won't write to it until it can. Changes to it are refused meanwhile. Close what holds it (a virus scanner, the search indexer or a sync tool), then restart the office.`,
      again: `Still couldn't read ${name} (${p.error})`,
    };
  }
  if (p.kind === 'corrupt') {
    return {
      rule: 'storeUnreadable',
      place: name,
      severity: 'sev2',
      title: `${name} was corrupt and was kept aside`,
      summary: `${file} couldn't be read (${p.error}). It was kept as ${p.aside ? where(p.aside) : 'a copy beside it'}, never deleted. ${p.lost ?? ''}`.trim(),
      again: `Corrupt again: ${name} (${p.error})`,
    };
  }
  return {
    rule: 'storeUnreadable',
    place: name,
    severity: 'sev3',
    title: `${name} was missing and was put back`,
    summary: `${file} was missing. ${p.lost ?? ''}`.trim(),
    again: `Put back again: ${name}`,
  };
}

/** Raises every problem so far and from now on through `raise`. Returns the way to stop. */
export function raiseStoreProblems(raise: (d: Detection) => unknown, where?: (file: string) => string): () => void {
  return onStoreProblem((p) => {
    try {
      raise(storeDetection(p, where));
    } catch (err) {
      console.error(`agent-office: store health incident: ${(err as Error).message}`);
    }
  });
}
