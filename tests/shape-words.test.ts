// What a team shape leaves to the person (shared/roster/shape-words.ts): Solo's PM reviews every pull
// request (the Playbook's review rule), Startup has no Coordinator, and the models shown are the level's,
// never a fixed word in the shape's copy (Solo said Sonnet while Fast runs it on Opus).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_LEAVES_YOU, shapeModels } from '../src/shared/roster/shape-words.js';
import { SHAPES, TEAM_SHAPES } from '../src/shared/roster/coverage.js';
import { LEVEL_BY_ID } from '../src/shared/budget/levels.js';
import { reviewRule } from '../src/shared/review-gate.js';

const at = (l: 'lean' | 'balanced' | 'fast') => LEVEL_BY_ID.get(l)!.settings;

test('each shape says what it leaves to you; Solo: you review every pull request, as the Playbook rule says', () => {
  for (const s of TEAM_SHAPES) assert.ok(SHAPE_LEAVES_YOU[s].length > 40, s);
  assert.match(SHAPE_LEAVES_YOU.solo, /^You review every pull request/);
  assert.match(reviewRule('Sam', 'Solo Lead'), /On a team with no other Lead, the Project Manager reviews/, 'the rule the Solo copy cites');
  assert.match(SHAPE_LEAVES_YOU.startup, /review each other’s pull requests.*no Coordinator/);
  assert.match(SHAPE_LEAVES_YOU.enterprise, /Coordinator/);
});

test('the models are the level’s: Solo is Sonnet at Lean and Balanced, Opus at Fast; no model word in the shape copy', () => {
  for (const s of TEAM_SHAPES) assert.doesNotMatch(SHAPES[s].who, /Sonnet|Opus|Haiku/, s);
  assert.equal(shapeModels('solo', at('lean')), 'Solo Lead on Sonnet; subagents on Haiku where the role allows');
  assert.equal(shapeModels('solo', at('balanced')), 'Solo Lead on Sonnet (Discovery on Opus); subagents on Sonnet where the role allows');
  assert.equal(shapeModels('solo', at('fast')), 'Solo Lead on Opus; subagents on Sonnet where the role allows');
  assert.match(shapeModels('startup', at('fast')), /^Both Leads on Opus/);
  assert.match(shapeModels('enterprise', at('balanced')), /^Coordinator and Leads on Sonnet \(Discovery on Opus\)/);
  assert.match(shapeModels('solo', { ...at('balanced'), subagentModel: 'default' }), /subagents on their own models$/);
});
