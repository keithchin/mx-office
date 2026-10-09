// What the details beside a microflow or nanoflow say about each element, read from the flow's unit
// the way mxcli's `describe --format elk` words it (its "details" lines and node categories), so the
// diagram no longer waits on mxcli: "Variable: $Order", "Commit: Yes", "Name = $Input/Name",
// "Microflow: Sales.SUB_Check", "Result: $Ok", long values cut short with "...". tests/model-equiv.test.ts
// compares these with mxcli's own on the fixtures (all 1619 elements of the travel-approval app matched).

import { doc, list, str, textOf, typeOf, type BsonDoc } from './bson.js';
import { short } from './flow-actions.js';

/** `s` cut to `n` characters, its end as "..." (as mxcli does). */
export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

const v = (name: string) => '$' + name;
/** A message line, when there is a message. */
const message = (text: string) => (text.trim() ? [`Message: ${cut(text.trim(), 60)}`] : []);

/** "Name = value" lines of a change or create activity's member changes. */
function items(a: BsonDoc): string[] {
  return list(a.Items).map((i) => `${short(str(i.Attribute) || str(i.Association))} = ${cut(str(i.Value), 50)}`);
}

/** "Parameter = argument" lines of a call (parameters are Module.Flow.Name). */
function params(mappings: BsonDoc[]): string[] {
  return mappings.map((m) => `${short(str(m.Parameter))} = ${cut(str(m.Argument), 50)}`);
}

const result = (use: unknown, name: string) => (use !== false && name ? [`Result: ${v(name)}`] : []);

function retrieve(a: BsonDoc): string[] {
  const src = doc(a.RetrieveSource);
  const out = [`Output: ${v(str(a.ResultVariableName))}`];
  if (typeOf(src) === 'Microflows$AssociationRetrieveSource') return [...out, `From: ${v(str(src?.StartVariableName))}`, `Via: ${str(src?.AssociationId)}`];
  out.push(`From: ${str(src?.Entity)}`);
  const xpath = str(src?.XpathConstraint);
  if (xpath) out.push(`Where: ${cut(xpath, 60)}`);
  const range = doc(src?.Range);
  if (range?.SingleObject === true || typeOf(range).endsWith('FirstRange')) out.push('Range: First');
  else if (typeOf(range).endsWith('CustomRange')) out.push(`Range: Custom${str(range?.LimitExpression) ? ` limit=${str(range?.LimitExpression)}` : ''}${str(range?.OffsetExpression) ? ` offset=${str(range?.OffsetExpression)}` : ''}`);
  const sorts = list(doc(src?.NewSortings)?.Sortings).map((s) => `${str(s.AttributeRef ? doc(s.AttributeRef)?.Attribute : s.Attribute)} ${str(s.SortOrder)}`.trim());
  if (sorts.length) out.push(`Sort: ${sorts.join(', ')}`);
  return out;
}

/** The details lines of an activity's action (undefined when mxcli gives none). */
export function actionDetails(a: BsonDoc | undefined): string[] | undefined {
  if (!a) return undefined;
  const t = str(a.$Type).replace(/^Microflows\$/, '');
  const commit = (c: unknown) => (c && c !== 'No' ? [`Commit: ${String(c)}`] : []);
  let out: string[] = [];
  switch (t) {
    case 'ChangeAction':
      out = [`Variable: ${v(str(a.ChangeVariableName))}`, ...commit(a.Commit), ...items(a)];
      break;
    case 'CreateChangeAction':
      out = [`Entity: ${str(a.Entity)}`, `Output: ${v(str(a.VariableName))}`, ...commit(a.Commit), ...items(a)];
      break;
    case 'CommitAction':
      out = [`Variable: ${v(str(a.CommitVariableName))}`, `With events: ${a.WithEvents !== false}`];
      break;
    case 'DeleteAction':
      out = [`Variable: ${v(str(a.DeleteVariableName))}`];
      break;
    case 'RollbackAction':
      out = [`Variable: ${v(str(a.RollbackVariableName))}`];
      break;
    case 'RetrieveAction':
      out = retrieve(a);
      break;
    case 'MicroflowCallAction': {
      const call = doc(a.MicroflowCall);
      out = [`Microflow: ${str(call?.Microflow)}`, ...params(list(call?.ParameterMappings)), ...result(a.UseReturnVariable, str(a.ResultVariableName))];
      break;
    }
    case 'NanoflowCallAction': {
      const call = doc(a.NanoflowCall);
      out = [`Nanoflow: ${str(call?.Nanoflow)}`, ...params(list(call?.ParameterMappings)), ...result(a.UseReturnVariable, str(a.OutputVariableName))];
      break;
    }
    case 'JavaActionCallAction':
      out = [`Java Action: ${str(a.JavaAction)}`, ...result(a.UseReturnVariable, str(a.ResultVariableName))];
      break;
    case 'ShowFormAction': {
      const fs = doc(a.FormSettings);
      out = [`Page: ${str(fs?.Form)}`, ...params(list(fs?.ParameterMappings))];
      break;
    }
    case 'CloseFormAction':
      // mxcli reads the number field only (newer models), not the older text one.
      out = typeof a.NumberOfPages === 'number' ? [`Pages: ${a.NumberOfPages}`] : [];
      break;
    case 'ShowMessageAction':
      out = [`Type: ${str(a.Type)}`, ...message(textOf(doc(a.Template)?.Text))];
      break;
    case 'ValidationFeedbackAction':
      out = [`Target: ${v(str(a.ValidationVariableName))}${str(a.Attribute) ? `.${short(str(a.Attribute))}` : ''}`, ...message(textOf(doc(a.FeedbackTemplate)?.Text))];
      break;
    case 'LogMessageAction':
      out = [`Level: ${str(a.Level)}`, `Node: ${str(a.Node)}`, ...message(str(doc(a.MessageTemplate)?.Text))];
      break;
    case 'CreateVariableAction':
      out = [`Variable: ${v(str(a.VariableName))}`, `Value: ${cut(str(a.InitialValue), 60)}`];
      break;
    case 'ChangeVariableAction':
      out = [`Variable: ${v(str(a.ChangeVariableName))}`, `Value: ${cut(str(a.Value), 60)}`];
      break;
    case 'AggregateAction':
    case 'AggregateListAction':
      out = [`List: ${v(str(a.AggregateVariableName) || str(a.InputListVariableName))}`, `Function: ${str(a.AggregateFunction)}`, `Output: ${v(str(a.VariableName) || str(a.OutputVariableName))}`];
      break;
    case 'ListOperationsAction':
    case 'ListOperationAction':
      out = [`Output: ${v(str(a.ResultVariableName) || str(a.OutputVariableName))}`];
      break;
    case 'RestCallAction': {
      const http = doc(a.HttpConfiguration);
      out = [`${str(http?.HttpMethod)} ${str(doc(http?.CustomLocationTemplate)?.Text)}`.trim()];
      break;
    }
    default:
      out = [];
  }
  return out.length ? out : undefined;
}

/** mxcli's category for an element that isn't an activity (an activity's comes from its action). */
export const NODE_CATEGORY: Record<string, string> = {
  start: 'event',
  end: 'event',
  error: 'event',
  break: 'event',
  continue: 'event',
  split: 'controlflow',
  inheritance: 'controlflow',
  merge: 'controlflow',
  loop: 'loop',
  annotation: 'variable',
};

/** The details lines of any element of a flow (an object of its ObjectCollection). */
export function objectDetails(o: BsonDoc): string[] | undefined {
  const t = str(o.$Type).replace(/^Microflows\$/, '');
  switch (t) {
    case 'ActionActivity':
      return actionDetails(doc(o.Action));
    case 'EndEvent':
      return str(o.ReturnValue) ? [`Return: ${str(o.ReturnValue)}`] : undefined;
    case 'ExclusiveSplit': {
      const cond = doc(o.SplitCondition);
      const expr = str(cond?.Expression);
      const out = [`Caption: ${str(o.Caption)}`];
      if (expr) out.push(`Condition: ${expr}`);
      else if (typeOf(cond).endsWith('RuleSplitCondition')) out.push(`Rule: ${str(doc(cond?.RuleCall)?.Rule)}`);
      return out;
    }
    case 'LoopedActivity': {
      const src = doc(o.LoopSource);
      if (typeOf(src).endsWith('WhileLoopCondition')) return [`While: ${str(src?.WhileExpression)}`];
      return [`List: ${v(str(src?.ListVariableName))}`, `Iterator: ${v(str(src?.VariableName))}`];
    }
    default:
      return undefined;
  }
}
