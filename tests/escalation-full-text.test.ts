// Long escalations read in full (release 81): a decision card was cut to its first paragraph (about 320
// characters) in Needs you, to its title in the answer's detail, and to one 400-character line in the team
// chatter, so the Project Manager couldn't read the whole of what they were deciding. The previews stay (the
// lists stay light); the whole text comes folded beside them, only when it says more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullBeyond, fullLabel } from '../src/shared/full-text.js';
import { escalationCandidates } from '../src/shared/decisions/candidates.js';
import { escalationModel, withFull } from '../src/client/ui/portal/needs-logic.js';
import { escalationDraft, answerDraft } from '../src/server/chatter/sources.js';
import { cleanLong } from '../src/server/chatter/index.js';
import { CHATTER_LONG_MAX } from '../src/shared/chatter.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';

const long = [
  'The order screen needs a decision on how returns are booked, and it blocks two stories.',
  `Option A keeps returns on the original order: ${'the refund is booked against the same lines, '.repeat(12)}which keeps reporting simple.`,
  'Option B makes a return order of its own: cleaner audit trail, but every report has to join both.',
  'Tried: asked the analyst; checked the brief (it says nothing about returns).',
].join('\n\n');

const esc = (details: string): Escalation =>
  ({ id: 'e1', at: 1, workerId: 'w1', by: 'Dylan', role: 'lead-developer', urgency: 'important', trigger: 'question', fyi: false, level: 2, title: 'How are returns booked?', details, options: ['A: on the original order', 'B: a return order'], status: 'open' }) as Escalation;
const roster = (es: Escalation[]): RosterView => ({ floor: 'shop', admin: true, escalations: es, approvals: [], members: [], settings: {} }) as unknown as RosterView;

test('fullBeyond: the whole text only when the preview is not all of it', () => {
  assert.equal(fullBeyond('Short and whole.', 'Short and whole.'), undefined);
  assert.equal(fullBeyond('Short and  whole.', 'Short\nand whole.'), undefined, 'the same words in other spacing are the same');
  assert.equal(fullBeyond('First.', 'First.\n\nSecond.'), 'First.\n\nSecond.');
  assert.equal(fullBeyond(undefined, ''), undefined);
  assert.equal(fullBeyond('A…', 'A\r\n\r\n\r\n\r\nB'), 'A\n\nB', 'line endings evened out, blank runs kept to one');
  assert.match(fullLabel('one two three'), /Read the whole message \(3 words\)/);
});

test('Needs you: the card keeps its short preview; the page folds the whole message under it from the escalation it already has', () => {
  const [c] = escalationCandidates(roster([esc(long)]));
  assert.ok(c.body.detail && c.body.detail.length <= 320, 'the preview stays short');
  // The shared Needs list (built on the server too, for Teams) carries no long text: no extra work or payload there.
  assert.equal((c.body as { full?: string }).full, undefined);
  const m = escalationModel(esc(long), { ago: () => '' });
  assert.equal(m.full, long, 'the whole message, every paragraph');
  assert.deepEqual(withFull(c.body.detail, long), { full: long });
  // A one-paragraph escalation has nothing more to show.
  assert.equal(escalationModel(esc('Just this.'), { ago: () => '' }).full, undefined);
  assert.deepEqual(withFull('Just this.', 'Just this.'), {});
});

test('chatter: an escalation and its answer are kept whole, with their lines', () => {
  const d = escalationDraft(esc(long));
  assert.equal(d.long, true);
  const kept = cleanLong(d.text);
  assert.ok(kept.includes('Option B makes a return order of its own'), 'the last paragraphs are there');
  assert.ok(kept.includes('\n\n'), 'its paragraphs kept');
  assert.ok(CHATTER_LONG_MAX >= 12_000, 'room for the details (6,000) and the +1s folded in (12,000)');
  const a = answerDraft({ ...esc(long), status: 'resolved', resolution: { verdict: 'reply', text: 'B. '.repeat(300), by: 'Keith', at: 2, delivered: true } } as Escalation);
  assert.equal(a?.long, true);
});
