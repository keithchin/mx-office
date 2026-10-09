// The Model tab's readers (server/model/): mxcli's project tree, a microflow from mxcli's elk+MDL and
// from its unit, a domain model from its unit and from mxcli, and what changed between two versions.
// Fixtures are JSON from the scratch test app's own HR module (no Mendix artwork).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseTree } from '../src/server/model/tree.js';
import { anchor, facing, marksAt, paramMarks, parseFlow, type ElkFlow } from '../src/server/model/flow.js';
import { actionInfo, caseLabel, typeLabel } from '../src/server/model/flow-actions.js';
import { attrType, domainFromElk, entityPositions, parseDomain } from '../src/server/model/domain.js';
import { changesFrom, diffUnits, treeDiff } from '../src/server/model/diff.js';
import type { BsonDoc } from '../src/server/model/bson.js';

const fx = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'model', f), 'utf8'));

test('the project tree keeps labels, types and qualified names, and drops empty child lists', () => {
  const nodes = parseTree(fx('tree.json'));
  assert.equal(nodes[0].type, 'systemoverview');
  const hr = nodes.find((n) => n.type === 'module' && n.label === 'HR');
  assert.ok(hr, 'HR module');
  const dm = hr.children?.find((c) => c.type === 'domainmodel');
  assert.equal(dm?.qn, 'HR');
  assert.ok(dm?.children?.some((c) => c.type === 'entity' && c.qn === 'HR.Employee'));
  const walk = (ns: typeof nodes): boolean => ns.every((n) => (n.children === undefined || n.children.length > 0) && walk(n.children ?? []));
  assert.ok(walk(nodes));
  assert.throws(() => parseTree({ not: 'a list' }));
  assert.deepEqual(parseTree([{ label: 'x' }, { label: 'ok', type: 'folder', children: [] }]), [{ label: 'ok', type: 'folder' }]);
});

test('a microflow from its unit: Studio Pro sizes and places, captions, outputs, outcomes and flows', () => {
  const elk = fx('hr-seed.elk.json') as ElkFlow;
  const unit = fx('hr-seed.unit.json') as BsonDoc;
  const doc = parseFlow('microflow', 'HR.ASu_SeedBaseline', elk, unit);
  assert.equal(doc.source, 'units');
  assert.equal(doc.returnType, 'Boolean');
  const start = doc.nodes.find((n) => n.kind === 'start')!;
  assert.deepEqual([start.w, start.h], [20, 20]);
  // RelativeMiddlePoint is the middle: the box's corner is half its size up and left of it.
  const retrieve = doc.nodes.find((n) => n.action === 'retrieve' && n.output?.name === 'Existing')!;
  assert.deepEqual([retrieve.x + retrieve.w / 2, retrieve.y + retrieve.h / 2], [360, 200]);
  assert.equal(retrieve.caption, 'Retrieve Employee');
  assert.deepEqual(retrieve.output, { name: 'Existing', type: 'Employee' });
  assert.equal(retrieve.category, 'object');
  const create = doc.nodes.find((n) => n.action === 'create' && n.output?.name === 'Maria')!;
  assert.equal(create.caption, 'Create Employee');
  assert.equal(create.commit, true);
  const log = doc.nodes.find((n) => n.action === 'log')!;
  assert.equal(log.category, 'log');
  const split = doc.nodes.find((n) => n.kind === 'split')!;
  assert.equal(split.expr, '$Existing != empty');
  // Every flow joins two nodes there are, on their sides, and the decision's outcomes are labelled.
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const e of doc.edges) assert.ok(ids.has(e.from) && ids.has(e.to), e.id);
  const outs = doc.edges.filter((e) => e.from === split.id).map((e) => e.label).sort();
  assert.deepEqual(outs, ['false', 'true']);
  // Node ids are the model's own, the same as mxcli's (without its "node-" prefix), so MDL lines line up.
  assert.ok(doc.nodes.some((n) => n.lines && n.lines[0] >= 0));
  assert.match(doc.mdl, /ASu_SeedBaseline/);
});

test('a microflow from mxcli alone sits at the MDL\'s @position with default sizes', () => {
  const elk = fx('hr-seed.elk.json') as ElkFlow;
  const doc = parseFlow('microflow', 'HR.ASu_SeedBaseline', elk, null);
  assert.equal(doc.source, 'mdl');
  const start = doc.nodes.find((n) => n.kind === 'start')!;
  assert.ok(Number.isFinite(start.x));
  const acts = doc.nodes.filter((n) => n.kind === 'action');
  assert.ok(acts.length >= 10);
  for (const a of acts) assert.deepEqual([a.w, a.h], [120, 60]);
  assert.ok(doc.edges.length >= acts.length);
  const retrieve = acts.find((a) => /Retrieve HR.Employee|Retrieve/.test(a.caption))!;
  assert.equal(retrieve.x + 60, 360);
});

test('MDL marks: @position, @start, @caption and @anchor before a statement; parameters in the header', () => {
  const lines = ['create microflow M.F (', '  @position(-220, 75)', '  $Data: M.E', ')', 'begin', '  @start(-220, 200)', '  @position(230, 200)', "  @anchor(false: (from: top, to: bottom))", "  @caption 'It''s okay?'", '  if $x then'];
  const m = marksAt(lines, 6, 9);
  assert.deepEqual(m.pos, { x: 230, y: 200 });
  assert.equal(m.caption, "It's okay?");
  assert.deepEqual(m.anchors?.branch?.false, { from: 0, to: 2 });
  assert.deepEqual(marksAt(lines, 5, 5).start, { x: -220, y: 200 });
  assert.deepEqual(paramMarks(lines).get('Data'), { x: -220, y: 75 });
});

test('anchors and facing sides', () => {
  const b = { x: 0, y: 0, w: 120, h: 60 };
  assert.deepEqual(anchor(b, 0), { x: 60, y: 0 });
  assert.deepEqual(anchor(b, 1), { x: 120, y: 30 });
  assert.deepEqual(anchor(b, 2), { x: 60, y: 60 });
  assert.deepEqual(anchor(b, 3), { x: 0, y: 30 });
  assert.equal(facing(b, { x: 300, y: 0, w: 10, h: 10 }), 1);
  assert.equal(facing(b, { x: 0, y: -300, w: 10, h: 10 }), 0);
});

test('activities: captions Studio Pro would generate, variables and badges by action', () => {
  const at = (t: string, more: BsonDoc = {}) => actionInfo({ $Type: `Microflows$${t}`, ...more });
  assert.deepEqual(at('ChangeAction', { ChangeVariableName: 'Order', Commit: 'Yes', RefreshInClient: true }), { action: 'change', category: 'object', caption: 'Change Order', commit: true, refresh: true });
  assert.equal(at('CommitAction', { CommitVariableName: 'Order' }).caption, 'Commit Order');
  assert.equal(at('DeleteAction', { DeleteVariableName: 'Order' }).caption, 'Delete Order');
  const list = at('RetrieveAction', { ResultVariableName: 'Orders', RetrieveSource: { $Type: 'Microflows$DatabaseRetrieveSource', Entity: 'Shop.Order', Range: { $Type: 'Microflows$ConstantRange', SingleObject: false } } });
  assert.deepEqual(list.output, { name: 'Orders', type: 'List of Order' });
  const byAssoc = actionInfo({ $Type: 'Microflows$RetrieveAction', ResultVariableName: 'Account', RetrieveSource: { $Type: 'Microflows$AssociationRetrieveSource', AssociationId: 'Admin.Data_Account' } }, (a) => (a === 'Admin.Data_Account' ? 'Admin.Account' : undefined));
  assert.deepEqual([byAssoc.caption, byAssoc.output?.type], ['Retrieve Account', 'Account']);
  assert.equal(at('MicroflowCallAction', { MicroflowCall: { $Type: 'x', Microflow: 'Shop.SUB_Do' }, ResultVariableName: 'r', UseReturnVariable: true }).caption, 'SUB_Do');
  assert.equal(at('ShowMessageAction', { Type: 'Error', Template: { Text: { Items: [3, { LanguageCode: 'en_US', Text: 'Nope.' }] } } }).caption, 'Nope.');
  assert.equal(at('ShowMessageAction', { Type: 'Error' }).action, 'show-message-error');
  assert.equal(at('CloseFormAction').caption, 'Close page');
  assert.deepEqual(at('CreateVariableAction', { VariableName: 'n', VariableType: { $Type: 'DataTypes$IntegerType' } }).output, { name: 'n', type: 'Integer/Long' });
  assert.equal(at('SomethingNewAction').caption, 'Something new');
  assert.equal(typeLabel({ $Type: 'DataTypes$DateTimeType' }), 'Date and time');
  assert.equal(typeLabel({ $Type: 'DataTypes$VoidType' }), undefined);
  assert.equal(caseLabel({ CaseValues: [2, { $Type: 'Microflows$EnumerationCase', Value: 'true' }] }), 'true');
  assert.equal(caseLabel({ CaseValues: [2, { $Type: 'Microflows$InheritanceCase', Value: 'System.User' }] }), 'User');
  assert.equal(caseLabel({ CaseValues: [2, { $Type: 'Microflows$NoCase' }] }), undefined);
});

test('loops, annotations, error handlers and annotation flows from a unit', () => {
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const unit: BsonDoc = {
    ObjectCollection: {
      Objects: [
        3,
        { $ID: id(1), $Type: 'Microflows$StartEvent', RelativeMiddlePoint: '0;100', Size: '20;20' },
        {
          $ID: id(2),
          $Type: 'Microflows$LoopedActivity',
          RelativeMiddlePoint: '300;100',
          Size: '300;160',
          LoopSource: { $Type: 'Microflows$IterableList', ListVariableName: 'Orders', VariableName: 'Order' },
          ObjectCollection: { Objects: [3, { $ID: id(3), $Type: 'Microflows$ActionActivity', RelativeMiddlePoint: '150;80', Size: '120;60', AutoGenerateCaption: true, Action: { $Type: 'Microflows$CommitAction', CommitVariableName: 'Order', ErrorHandlingType: 'CustomWithoutRollBack' } }] },
        },
        { $ID: id(4), $Type: 'Microflows$EndEvent', RelativeMiddlePoint: '600;100', Size: '20;20', ReturnValue: '' },
        { $ID: id(5), $Type: 'Microflows$Annotation', RelativeMiddlePoint: '300;-20', Size: '200;40', Caption: 'Commits\r\neach order' },
        { $ID: id(6), $Type: 'Microflows$ErrorEvent', RelativeMiddlePoint: '300;300', Size: '20;20' },
      ],
    },
    Flows: [
      3,
      { $ID: id(10), $Type: 'Microflows$SequenceFlow', OriginPointer: id(1), DestinationPointer: id(2), OriginConnectionIndex: 1, DestinationConnectionIndex: 3, Line: { OriginControlVector: '30;0', DestinationControlVector: '-30;0' } },
      { $ID: id(11), $Type: 'Microflows$SequenceFlow', OriginPointer: id(3), DestinationPointer: id(6), OriginConnectionIndex: 2, DestinationConnectionIndex: 0, IsErrorHandler: true },
      { $ID: id(12), $Type: 'Microflows$AnnotationFlow', OriginPointer: id(5), DestinationPointer: id(2) },
    ],
  };
  const doc = parseFlow('nanoflow', 'M.F', null, unit);
  const loop = doc.nodes.find((n) => n.kind === 'loop')!;
  assert.deepEqual(loop.output, { name: 'Order', type: 'in Orders' });
  const inner = doc.nodes.find((n) => n.parent === loop.id)!;
  // Inside a loop, places are from the loop's corner.
  assert.deepEqual([inner.x + inner.w / 2, inner.y + inner.h / 2], [loop.x + 150, loop.y + 80]);
  assert.equal(inner.caption, 'Commit Order');
  assert.equal(doc.nodes.find((n) => n.kind === 'annotation')!.caption, 'Commits\neach order');
  assert.ok(doc.nodes.some((n) => n.kind === 'error'));
  assert.equal(doc.edges.find((e) => e.id === id(11))!.error, true);
  assert.equal(doc.edges.find((e) => e.id === id(12))!.annotation, true);
  const first = doc.edges.find((e) => e.id === id(10))!;
  assert.deepEqual(first.path[0], { x: 10, y: 100 });
  assert.deepEqual(first.path[1], { x: 40, y: 100 });
  assert.equal(doc.kind, 'nanoflow');
});

test('a domain model from its unit: entities, attributes, validation, associations and owners', () => {
  const doc = parseDomain('HR', fx('hr-domain.unit.json') as BsonDoc);
  assert.equal(doc.source, 'units');
  const emp = doc.entities.find((e) => e.name === 'Employee')!;
  assert.equal(emp.kind, 'persistent');
  assert.deepEqual([emp.x, emp.y], [100, 100]);
  assert.deepEqual(emp.attrs.map((a) => `${a.name}:${a.type}${a.validation ? '!' : ''}`), ['EmployeeNumber:String!', 'FullName:String!', 'Email:String']);
  const self = doc.associations.find((a) => a.name === 'Employee_Manager')!;
  assert.equal(self.parent, emp.id);
  assert.equal(self.child, emp.id);
  assert.deepEqual(self.parentConn, { x: 0, y: 50 });
  const cross = doc.associations.find((a) => a.name === 'Employee_User')!;
  assert.equal(cross.cross, true);
  assert.equal(cross.child, 'System.User');
});

test('entity types: non-persistable, specializations, view and external; calculated attributes and event handlers', () => {
  const ent = (name: string, more: BsonDoc): BsonDoc => ({ $ID: name, $Type: 'DomainModels$EntityImpl', Name: name, Location: '0;0', Attributes: [3], ValidationRules: [3], Events: [3], MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true }, ...more });
  const unit: BsonDoc = {
    Entities: [
      3,
      ent('Helper', { MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: false } }),
      ent('Person', { MaybeGeneralization: { $Type: 'DomainModels$Generalization', Generalization: 'System.User' }, Events: [3, { $Type: 'DomainModels$EventHandler' }], Image: 'Icons.Person' }),
      ent('Sub', { MaybeGeneralization: { $Type: 'DomainModels$Generalization', Generalization: 'M.Helper' } }),
      ent('Counts', { Source: { $Type: 'DomainModels$OqlViewEntitySource' } }),
      ent('Remote', { Source: { $Type: 'Rest$ODataRemoteEntitySource', SourceDocument: 'M.Shop_Service' } }),
      ent('Calc', { Attributes: [3, { $ID: 'a', Name: 'Total', NewType: { $Type: 'DomainModels$DecimalAttributeType' }, Value: { $Type: 'DomainModels$CalculatedValue' } }] }),
    ],
    Associations: [3, { $ID: 'as', Name: 'Sub_Helper', ParentPointer: 'Sub', ChildPointer: 'Helper', Type: 'ReferenceSet', Owner: 'Both' }],
    Annotations: [3, { $ID: 'n', Caption: 'Hello\r\nthere', Location: '5;6', Width: 300 }],
  };
  const doc = parseDomain('M', unit);
  const kind = (n: string) => doc.entities.find((e) => e.name === n)!;
  assert.equal(kind('Helper').kind, 'nonpersistent');
  assert.equal(kind('Person').kind, 'persistent');
  assert.equal(kind('Person').generalization, 'System.User');
  assert.equal(kind('Person').events, true);
  assert.equal(kind('Person').image, true);
  assert.equal(kind('Sub').kind, 'nonpersistent', 'a specialization of a non-persistable entity is non-persistable');
  assert.equal(kind('Counts').kind, 'view');
  assert.equal(kind('Remote').kind, 'external');
  assert.equal(kind('Remote').service, 'Shop_Service');
  assert.equal(kind('Calc').attrs[0].calculated, true);
  assert.equal(kind('Calc').attrs[0].type, 'Decimal');
  assert.deepEqual(doc.associations[0], { id: 'as', name: 'Sub_Helper', parent: 'Sub', child: 'Helper', type: 'ReferenceSet', owner: 'Both' });
  assert.deepEqual(doc.annotations[0], { id: 'n', text: 'Hello\nthere', x: 5, y: 6, w: 300 });
  assert.equal(attrType({ $Type: 'DomainModels$DateTimeAttributeType' }), 'Date and time');
  assert.equal(attrType({ $Type: 'DomainModels$AutoNumberAttributeType' }), 'AutoNumber');
});

test('a domain model from mxcli alone: elk entities at their MDL positions, owners from the list', () => {
  const elk = {
    moduleName: 'Administration',
    entities: [
      { id: 'e1', name: 'AccountPasswordData', category: 'nonpersistent', attributes: [{ name: 'OldPassword', type: 'String' }] },
      { id: 'e2', name: 'Account', category: 'persistent', attributes: [{ name: 'Since', type: 'DateTime' }] },
      { id: 'g', name: 'System.User', category: 'external', attributes: null },
    ],
    associations: [{ id: 'a0', sourceId: 'e2', targetId: 'e1', name: 'AccountPasswordData_Account', type: 'reference' }],
    generalizations: [{ childId: 'e2', parentId: 'g', parentName: 'System.User' }],
  };
  const mdl = '@Position(220, 140)\ncreate or modify persistent entity Administration.Account extends System.User (\n);\n@Position(600, 140)\ncreate or modify non-persistent entity Administration.AccountPasswordData (\n);';
  const pos = entityPositions(mdl);
  assert.deepEqual(pos.get('Account'), { x: 220, y: 140 });
  assert.deepEqual(pos.get('AccountPasswordData'), { x: 600, y: 140 });
  const doc = domainFromElk(elk, pos, new Map([['AccountPasswordData_Account', 'Both']]));
  assert.equal(doc.entities.length, 2, 'other modules\' entities are not drawn as boxes');
  assert.equal(doc.entities.find((e) => e.name === 'Account')!.generalization, 'System.User');
  assert.equal(doc.entities.find((e) => e.name === 'Account')!.attrs[0].type, 'Date and time');
  assert.deepEqual(doc.associations[0], { id: 'a0', name: 'AccountPasswordData_Account', parent: 'e1', child: 'e2', type: 'Reference', owner: 'Both' });
});

test('what changed: documents by content hash, elements by id', () => {
  const base: BsonDoc = { ObjectCollection: { Objects: [3, { $ID: 'a', $Type: 'Microflows$ActionActivity', Caption: 'Old' }, { $ID: 'b', $Type: 'Microflows$EndEvent' }, { $ID: 'gone', $Type: 'Microflows$ActionActivity', Caption: 'Bye' }] }, Flows: [3] };
  const head: BsonDoc = { ObjectCollection: { Objects: [3, { $ID: 'a', $Type: 'Microflows$ActionActivity', Caption: 'New' }, { $ID: 'b', $Type: 'Microflows$EndEvent' }, { $ID: 'c', $Type: 'Microflows$StartEvent' }] }, Flows: [3, { $ID: 'f', $Type: 'Microflows$SequenceFlow' }] };
  assert.deepEqual(diffUnits('microflow', base, head), { added: ['c', 'f'], changed: ['a'], removed: ['Bye'] });
  assert.deepEqual(diffUnits('microflow', null, head).added.length, 4);
  const dmBase: BsonDoc = { Entities: [3, { $ID: 'e', Name: 'Order', Attributes: [3] }] };
  const dmHead: BsonDoc = { Entities: [3, { $ID: 'e', Name: 'Order', Attributes: [3, { $ID: 'x', Name: 'Total' }] }] };
  assert.deepEqual(diffUnits('domainmodel', dmBase, dmHead), { added: [], changed: ['e'], removed: [] });
  // Access rules alone don't make an entity "changed" in the diagram.
  assert.deepEqual(diffUnits('domainmodel', dmBase, { Entities: [3, { $ID: 'e', Name: 'Order', Attributes: [3], AccessRules: [3, { x: 1 }] }] }).changed, []);
  assert.deepEqual(changesFrom({ added: ['microflow:M.A'], changed: ['domainmodel:M'], removed: ['page:M.P'] }), [
    { type: 'microflow', qn: 'M.A', status: 'added' },
    { type: 'domainmodel', qn: 'M', status: 'changed' },
    { type: 'page', qn: 'M.P', status: 'removed' },
  ]);
  const t = (qns: string[]) => [{ label: 'M', type: 'module', qn: 'M', children: qns.map((q) => ({ label: q, type: 'microflow', qn: q })) }];
  assert.deepEqual(treeDiff(t(['M.A', 'M.B']), t(['M.B', 'M.C'])), [
    { type: 'microflow', qn: 'M.C', status: 'added' },
    { type: 'microflow', qn: 'M.A', status: 'removed' },
  ]);
});
