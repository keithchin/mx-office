// The design-system import's composition (./service.ts): one per office, on the office's design service, with
// the office's own folders (never a source) and its audit log.

import type { Ctx } from '../../office/context.js';
import { audit } from '../../audit/index.js';
import { designOf } from '../index.js';
import { DesignImports } from './service.js';

const imports = new WeakMap<object, DesignImports>();

export function importsOf(ctx: Ctx): DesignImports {
  let s = imports.get(ctx.cfg);
  if (!s) {
    s = new DesignImports({
      design: designOf(ctx),
      office: () => ({
        dataDir: ctx.cfg.dataDir,
        projectsDir: ctx.building.projectsDir,
      }),
      audit: (e) => void audit.record(e),
      now: () => Date.now(),
    });
    imports.set(ctx.cfg, s);
  }
  return s;
}
