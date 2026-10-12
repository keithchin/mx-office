// The Testing safety switches (release 39): two office-wide settings an admin turns on in ⚙️ Settings ›
// ✅ Verification, both off by default so an office that updates stays quiet on its existing projects.
//   * judge: Testing release 2's integrated-revision verification (judging merged tasks on their merge
//     commit, its Needs you items, the test-first prompt) and the default branch's checks fetch with gh.
//     Turned on, it judges only tasks whose PR merged after that moment (`judgeSince`).
//   * autoScore: Testing release 1b's automatic mxcli quality run for each new main commit, never while
//     the project's agents are working. An admin's "Score main now" works either way.
// Pure: the server keeps them (server/testing/switches.ts), the pages show them.

export interface TestingSwitches {
  judge: boolean;
  /** When judging was last turned on: only PRs merged from then on are judged. */
  judgeSince?: number;
  autoScore: boolean;
  /** Who changed each last, and when. */
  judgeBy?: string;
  judgeAt?: number;
  autoBy?: string;
  autoAt?: number;
}

export type TestingSwitchKey = 'judge' | 'autoScore';

export const SWITCH_LABEL: Record<TestingSwitchKey, string> = {
  judge: 'Judge merged tasks against checks',
  autoScore: 'Score main automatically with mxcli',
};

export const SWITCHES_OFF: TestingSwitches = { judge: false, autoScore: false };

/** GET /api/testing/switches. */
export interface SwitchesView {
  switches: TestingSwitches;
  /** Whoever's looking may change them (an admin). */
  admin: boolean;
}

/** The switches as saved, each only when well formed; anything else reads as off. */
export function cleanSwitches(raw: unknown): TestingSwitches {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TestingSwitches>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const str = (v: unknown): v is string => typeof v === 'string' && !!v;
  return {
    judge: r.judge === true,
    ...(r.judge === true && num(r.judgeSince) ? { judgeSince: r.judgeSince } : {}),
    autoScore: r.autoScore === true,
    ...(str(r.judgeBy) ? { judgeBy: r.judgeBy.slice(0, 80) } : {}),
    ...(num(r.judgeAt) ? { judgeAt: r.judgeAt } : {}),
    ...(str(r.autoBy) ? { autoBy: r.autoBy.slice(0, 80) } : {}),
    ...(num(r.autoAt) ? { autoAt: r.autoAt } : {}),
  };
}
