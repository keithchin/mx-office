// The diagram read straight from a flow's unit (no mxcli) against the one mxcli's elk description gave:
// every element and flow the same (ids, kinds, places, captions, labels, outcomes, error handlers), and
// the details and categories worded as mxcli words them. Fixtures: the scratch test app's HR module
// (hr-seed) and flows of the travel-approval app (ta/) chosen to cover loops, custom ranges and sorts,
// aggregates, list operations, validations over associations, close page and rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFlow, type ElkFlow } from '../src/server/model/flow.js';
import { actionDetails, cut, objectDetails } from '../src/server/model/flow-details.js';
import { mdlOf, withMdl } from '../src/server/model/read.js';
import type { BsonDoc } from '../src/server/model/bson.js';

const dir = path.join(import.meta.dirname, 'fixtures', 'model');
const fx = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));

const cases: { name: string; kind: 'microflow' | 'nanoflow'; elk: ElkFlow; unit: BsonDoc }[] = [
  { name: 'HR.ASu_SeedBaseline', kind: 'microflow', elk: fx('hr-seed.elk.json'), unit: fx('hr-seed.unit.json') },
  ...readdirSync(path.join(dir, 'ta'))
    .filter((f) => f.endsWith('.elk.json'))
    .map((f) => {
      const elk = fx(`ta/${f}`) as ElkFlow;
      return { name: `TravelApproval.${f.replace('.elk.json', '')}`, kind: (elk.type === 'nanoflow' ? 'nanoflow' : 'microflow') as 'microflow' | 'nanoflow', elk, unit: fx(`ta/${f.replace('.elk.json', '.unit.json')}`) as BsonDoc };
    }),
];

test('equivalence: every fixture flow drawn from its unit alone matches the one drawn with mxcli', () => {
  assert.ok(cases.length >= 9, `fixtures: ${cases.length}`);
  let elements = 0;
  for (const c of cases) {
    const withMx = parseFlow(c.kind, c.name, c.elk, c.unit);
    const direct = parseFlow(c.kind, c.name, null, c.unit);
    assert.equal(direct.source, 'units');
    assert.equal(direct.mdl, '', 'the MDL comes later, from mxcli');
    // Nodes: the same ones, at the same places, with the same captions, outputs, details and categories.
    const strip = (n: (typeof direct.nodes)[number]) => ({ ...n, lines: undefined });
    assert.deepEqual(direct.nodes.map(strip), withMx.nodes.map(strip), `${c.name}: nodes`);
    assert.deepEqual(direct.edges, withMx.edges, `${c.name}: edges and their labels`);
    elements += direct.nodes.length + direct.edges.length;
    // Every element mxcli describes is there.
    const ids = new Set(direct.nodes.map((n) => n.id));
    for (const n of c.elk.nodes ?? []) assert.ok(ids.has(n.id.replace(/^node-/, '')), `${c.name}: ${n.id}`);
    // The MDL, when it comes, puts back each element's lines as mxcli's view had them.
    const full = withMdl(direct, mdlOf(c.elk));
    assert.equal(full.mdl, withMx.mdl);
    assert.deepEqual(full.nodes.map((n) => n.lines), withMx.nodes.map((n) => n.lines), `${c.name}: MDL lines`);
  }
  assert.ok(elements > 300, `elements compared: ${elements}`);
});

test('details as mxcli words them: variables with $, values cut at its lengths, empty messages left out', () => {
  assert.equal(cut('abcdef', 5), 'ab...');
  assert.equal(cut('abc', 5), 'abc');
  assert.deepEqual(actionDetails({ $Type: 'Microflows$ChangeAction', ChangeVariableName: 'Order', Commit: 'Yes', Items: [2, { $Type: 'Microflows$ChangeActionItem', Attribute: 'Shop.Order.Status', Association: '', Value: `'${'x'.repeat(60)}'` }] }), ['Variable: $Order', 'Commit: Yes', `Status = '${'x'.repeat(46)}...`]);
  assert.deepEqual(actionDetails({ $Type: 'Microflows$ValidationFeedbackAction', ValidationVariableName: 'Order', Attribute: '', Association: 'Shop.Order_Customer', FeedbackTemplate: { Text: { Items: [3] } } }), ['Target: $Order']);
  assert.deepEqual(actionDetails({ $Type: 'Microflows$CloseFormAction', NumberOfPagesToClose: '1' }), undefined, 'mxcli reads only the number field');
  assert.deepEqual(actionDetails({ $Type: 'Microflows$CloseFormAction', NumberOfPages: 2 }), ['Pages: 2']);
  assert.deepEqual(objectDetails({ $Type: 'Microflows$EndEvent', ReturnValue: '' }), undefined);
  assert.deepEqual(objectDetails({ $Type: 'Microflows$LoopedActivity', LoopSource: { $Type: 'Microflows$IterableList', ListVariableName: 'Lines', VariableName: 'Line' } }), ['List: $Lines', 'Iterator: $Line']);
  assert.equal(actionDetails({ $Type: 'Microflows$SomethingNew' }), undefined);
});
