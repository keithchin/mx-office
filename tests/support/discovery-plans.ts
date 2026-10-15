// Plans for the Discovery brief's snapshots (tests/discovery-modes.test.ts): one per entry mode, with an
// approved project brief from the test planner and one attached document, so every part of the brief shows.
import { fakeBrief } from '../../src/server/wizard/planner/fake.js';
import type { ProjectPlan } from '../../src/shared/wizard.js';
import type { EntryMode } from '../../src/shared/wizard.js';

export const TOOLKIT = 'C:/tools/mendix-toolkit';
export const FLOOR = String.raw`C:\projects\Test-Org\pack-track`;
export const SHA = '7b4b4cf13b9f0000000000000000000000000000';

export function discoveryPlan(entry: EntryMode, over: Partial<ProjectPlan> = {}): ProjectPlan {
  const brief = fakeBrief([{ name: 'notes.md', path: 'x', text: 'notes' }]).brief;
  return {
    kind: entry === 'existing-app-change' || entry === 'assurance' ? 'change' : 'new',
    owner: 'Test-Org',
    name: 'pack-track',
    description: 'A demo',
    private: true,
    mendix: '11.12.4',
    entry,
    tier: 'standard',
    interview: 'steering',
    execApproval: 'auto',
    intake: [],
    clients: ['Acme'],
    operators: ['Probe'],
    roles: ['pm', 'lead-developer', 'chief-analyst'],
    discovery: { issue: true, queue: true, model: 'opus' },
    createdByHand: false,
    brief: { brief, approved: { by: 'Alex Lee', at: '2026-10-12T10:42:00.000Z', assumed: 2 }, attachments: [{ name: 'notes.md', size: 1200, read: 'text' }] },
    ...over,
  };
}
