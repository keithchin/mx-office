// What an activity in a microflow or nanoflow shows: which action it is (that picks its icon), the
// caption Studio Pro would generate for it when the developer didn't write one, the variable it
// gives (drawn under the box: name in black, type in blue) and its commit/refresh markers.

import { doc, list, str, textOf, typeOf, type BsonDoc } from './bson.js';

export interface ActionInfo {
  action: string;
  category: string;
  caption: string;
  output?: { name: string; type?: string };
  commit?: boolean;
  refresh?: boolean;
}

/** "Module.Name" → "Name". */
export const short = (qn: string): string => qn.slice(qn.lastIndexOf('.') + 1);

/** A data type as Studio Pro writes it under a variable: an entity's name, "List of X", "Date and time". */
export function typeLabel(t: BsonDoc | undefined): string | undefined {
  if (!t) return undefined;
  const ty = str(t.$Type).replace(/^DataTypes\$/, '');
  switch (ty) {
    case 'ObjectType':
      return short(str(t.Entity)) || 'Object';
    case 'ListType':
      return `List of ${short(str(t.Entity))}`;
    case 'StringType':
      return 'String';
    case 'IntegerType':
      return 'Integer/Long';
    case 'DecimalType':
      return 'Decimal';
    case 'BooleanType':
      return 'Boolean';
    case 'DateTimeType':
      return 'Date and time';
    case 'EnumerationType':
      return short(str(t.Enumeration)) || 'Enumeration';
    case 'FloatType':
      return 'Decimal';
    case 'BinaryType':
      return 'Binary';
    case 'VoidType':
      return undefined;
    default:
      return ty.replace(/Type$/, '') || undefined;
  }
}

const humanize = (t: string) =>
  t
    .replace(/^.*\$/, '')
    .replace(/Action$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

const out = (name: string, type?: string) => (name ? { name, type } : undefined);

/**
 * The action of an ActionActivity. `assocTarget` names the entity an association points to (for a
 * retrieve over an association, whose type the activity doesn't say).
 */
export function actionInfo(a: BsonDoc | undefined, assocTarget: (assoc: string) => string | undefined = () => undefined): ActionInfo {
  const t = str(a?.$Type).replace(/^Microflows\$/, '');
  if (!a) return { action: 'other', category: 'other', caption: 'Activity' };
  const commitOf = (v: unknown) => v === 'Yes' || v === 'YesWithoutEvents';
  switch (t) {
    case 'RetrieveAction': {
      const src = doc(a.RetrieveSource);
      const name = str(a.ResultVariableName) || str(a.OutputVariableName);
      if (typeOf(src) === 'Microflows$AssociationRetrieveSource') {
        const assoc = str(src?.AssociationId);
        const entity = assocTarget(assoc);
        return { action: 'retrieve', category: 'object', caption: `Retrieve ${entity ? short(entity) : name || short(assoc)}`, output: out(name, entity ? short(entity) : undefined) };
      }
      const entity = str(src?.Entity);
      const single = doc(src?.Range)?.SingleObject === true || str(doc(src?.Range)?.$Type).endsWith('FirstRange');
      return { action: 'retrieve', category: 'object', caption: `Retrieve ${short(entity) || name}`, output: out(name, single ? short(entity) : `List of ${short(entity)}`) };
    }
    case 'CreateChangeAction': {
      const entity = str(a.Entity);
      return { action: 'create', category: 'object', caption: `Create ${short(entity)}`, output: out(str(a.VariableName), short(entity)), commit: commitOf(a.Commit), refresh: a.RefreshInClient === true };
    }
    case 'ChangeAction':
      return { action: 'change', category: 'object', caption: `Change ${str(a.ChangeVariableName)}`, commit: commitOf(a.Commit), refresh: a.RefreshInClient === true };
    case 'CommitAction':
      return { action: 'commit', category: 'object', caption: `Commit ${str(a.CommitVariableName)}`, refresh: a.RefreshInClient === true };
    case 'DeleteAction':
      return { action: 'delete', category: 'object', caption: `Delete ${str(a.DeleteVariableName)}`, refresh: a.RefreshInClient === true };
    case 'RollbackAction':
      return { action: 'rollback', category: 'object', caption: `Rollback ${str(a.RollbackVariableName)}`, refresh: a.RefreshInClient === true };
    case 'CastAction':
      return { action: 'cast', category: 'object', caption: 'Cast object', output: out(str(a.VariableName)) };
    // Newer models call them AggregateAction and ListOperationsAction, with other field names.
    case 'AggregateListAction':
    case 'AggregateAction':
      return { action: 'aggregate', category: 'list', caption: `${humanize(str(a.AggregateFunction) || 'Aggregate')} of ${str(a.InputListVariableName) || str(a.AggregateVariableName)}`, output: out(str(a.OutputVariableName) || str(a.VariableName)) };
    case 'ListOperationAction':
    case 'ListOperationsAction':
      return { action: 'list-op', category: 'list', caption: `${humanize(typeOf(a.NewOperation) || typeOf(a.Operation) || 'List operation')}`, output: out(str(a.OutputVariableName) || str(a.ResultVariableName)) };
    case 'CreateListAction':
      return { action: 'create-list', category: 'list', caption: `Create list of ${short(str(a.Entity))}`, output: out(str(a.OutputVariableName), `List of ${short(str(a.Entity))}`) };
    case 'ChangeListAction':
      return { action: 'change-list', category: 'list', caption: `Change list ${str(a.ChangeVariableName)}` };
    case 'MicroflowCallAction': {
      const mf = str(doc(a.MicroflowCall)?.Microflow);
      return { action: 'call-microflow', category: 'call', caption: short(mf) || 'Call microflow', output: a.UseReturnVariable === false ? undefined : out(str(a.ResultVariableName)) };
    }
    case 'NanoflowCallAction': {
      const nf = str(doc(a.NanoflowCall)?.Nanoflow);
      return { action: 'call-nanoflow', category: 'call', caption: short(nf) || 'Call nanoflow', output: a.UseReturnVariable === false ? undefined : out(str(a.OutputVariableName)) };
    }
    case 'JavaActionCallAction':
      return { action: 'call-java', category: 'call', caption: short(str(a.JavaAction)) || 'Call Java action', output: a.UseReturnVariable === false ? undefined : out(str(a.ResultVariableName)) };
    case 'JavaScriptActionCallAction':
      return { action: 'call-js', category: 'call', caption: short(str(a.JavaScriptAction)) || 'Call JavaScript action', output: a.UseReturnVariable === false ? undefined : out(str(a.OutputVariableName)) };
    case 'RestCallAction':
    case 'RestOperationCallAction':
      return { action: 'call-rest', category: 'integration', caption: 'Call REST service', output: out(str(a.OutputVariableName) || str(doc(a.ResultHandling)?.ResultVariableName)) };
    case 'WebServiceCallAction':
      return { action: 'call-ws', category: 'integration', caption: 'Call web service', output: out(str(a.OutputVariableName)) };
    case 'ImportXmlAction':
      return { action: 'import', category: 'integration', caption: 'Import with mapping', output: out(str(doc(a.ResultHandling)?.ResultVariableName)) };
    case 'ExportXmlAction':
      return { action: 'export', category: 'integration', caption: 'Export with mapping', output: out(str(a.OutputVariableName)) };
    case 'ShowFormAction': {
      const page = str(doc(a.FormSettings)?.Form);
      return { action: 'show-page', category: 'client', caption: `Show ${short(page) || 'page'}` };
    }
    case 'CloseFormAction':
      return { action: 'close-page', category: 'client', caption: 'Close page' };
    case 'ShowHomePageAction':
      return { action: 'home', category: 'client', caption: 'Show home page' };
    case 'ShowMessageAction': {
      const text = textOf(doc(a.Template)?.Text);
      const kind = str(a.Type) || 'Information';
      return { action: `show-message-${kind.toLowerCase()}`, category: 'client', caption: text || 'Show message' };
    }
    case 'ValidationFeedbackAction': {
      const text = textOf(doc(a.FeedbackTemplate)?.Text);
      return { action: 'validation', category: 'client', caption: text || 'Validation feedback' };
    }
    case 'DownloadFileAction':
      return { action: 'download', category: 'client', caption: 'Download file' };
    case 'SynchronizeAction':
    case 'SyncAction':
      return { action: 'sync', category: 'client', caption: 'Synchronize' };
    case 'LogMessageAction':
      return { action: 'log', category: 'log', caption: `Log ${str(a.Level).toLowerCase() || 'message'}` };
    case 'CreateVariableAction':
      return { action: 'create-var', category: 'variable', caption: `Create ${str(a.VariableName)}`, output: out(str(a.VariableName), typeLabel(doc(a.VariableType))) };
    case 'ChangeVariableAction':
      return { action: 'change-var', category: 'variable', caption: `Change ${str(a.ChangeVariableName)}` };
    default:
      return { action: 'other', category: 'other', caption: humanize(t) || 'Activity' };
  }
}

/** A sequence flow's outcome label (true/false, an enumeration value, a specialization's name). */
export function caseLabel(flow: BsonDoc): string | undefined {
  const cases = list(flow.CaseValues);
  const c = cases.length ? cases[0] : doc(flow.CaseValue);
  if (!c) return undefined;
  const t = str(c.$Type);
  if (t.endsWith('EnumerationCase')) return str(c.Value) || undefined;
  if (t.endsWith('InheritanceCase')) return short(str(c.Value)) || '(empty)';
  return undefined;
}
