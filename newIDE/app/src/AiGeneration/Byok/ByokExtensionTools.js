// @flow
import {
  editorFunctions,
  editorFunctionsWithoutProject,
} from '../../EditorFunctions';
import {
  serializeToJSON,
  unserializeFromJSObject,
} from '../../Utils/Serializer';
import { parseByokEventScript } from './ByokEventScriptParser';
import type { ByokExtraTool, ByokExtraToolResult } from './ByokExtraTools';

/**
 * The events-based extension authoring tools of BYOK (Phase 8.4), ported
 * from the upstream v18 branch (commits c0bc40d06e, 3a2659eb86,
 * 8d514278ad — "Enable v18") that master does not have: the hosted agent
 * gains them server-side, BYOK ships them client-side FIRST by driving
 * libGD's EventsFunctionsExtension API directly, the same way the
 * extension editor does.
 *
 * Design rules carried over from the v18 lesson:
 * - regeneration (code generation for events functions) is triggered ONCE
 *   PER BATCH of changes, not per call (see the batch accumulator below);
 * - destructive changes (deletes) are guarded by a usage check;
 * - if master later gains REAL registry implementations of these tools,
 *   the interception must get out of the way (see
 *   isByokExtensionToolShadowedByRegistry).
 */

const gd: libGDevelop = global.gd;

// -----------------------------------------------------------------------
// The upstream-stub delegation guard
// -----------------------------------------------------------------------

/**
 * Whether a registry entry is a real implementation (not one of the
 * permanent "handled server-side" stubs). The stubs say so in their
 * failure message; a real launchFunction never does. Heuristic on
 * purpose: it only decides whether OUR interception stays active.
 */
const isRegistryImplementationReal = (editorFunction: any): boolean => {
  if (!editorFunction) return false;
  if (typeof editorFunction.launchFunction !== 'function') return false;
  return !String(editorFunction.launchFunction).includes('handled server-side');
};

/**
 * The names of the extension authoring tools — the ONLY tools the
 * delegation guard below ever applies to. The other interceptions
 * (add_scene_events, run_gameplay_test…) have real registry
 * implementations that we deliberately bypass (backend-bound, or shaped
 * differently); the guard must never affect them.
 */
const BYOK_EXTENSION_TOOL_NAMES: Set<string> = new Set([
  'create_extension',
  'change_extension_properties',
  'create_custom_object',
  'change_custom_object',
  'create_custom_behavior',
  'change_custom_behavior',
  'create_custom_function',
  'change_custom_function',
  'find_extension_usages',
]);

/**
 * True when the editor registry has a REAL implementation of one of the
 * extension authoring tools: our BYOK interception must then let the
 * registry version run (the upstream-tracking guard of Phase 8.4 — today
 * these names have no registry entry at all, so this stays false until
 * upstream ships the v18 tools).
 */
export const isByokExtensionToolShadowedByRegistry = (
  name: string
): boolean => {
  if (!BYOK_EXTENSION_TOOL_NAMES.has(name)) return false;
  const registryEntry =
    (editorFunctions: any)[name] || (editorFunctionsWithoutProject: any)[name];
  return isRegistryImplementationReal(registryEntry || null);
};

// -----------------------------------------------------------------------
// The regeneration batch accumulator (once per batch, not per call)
// -----------------------------------------------------------------------

type ByokExtensionBatchState = {|
  extensionNames: Set<string>,
  needsCodeGeneration: boolean,
|};

const batchState: ByokExtensionBatchState = {
  extensionNames: new Set(),
  needsCodeGeneration: false,
};

/** Reset the accumulator (called after a flush, and by the tests). */
export const resetByokExtensionBatchForTests = (): void => {
  batchState.extensionNames.clear();
  batchState.needsCodeGeneration = false;
};

const markExtensionModified = (
  extensionName: string,
  needsCodeGeneration: boolean
): void => {
  batchState.extensionNames.add(extensionName);
  batchState.needsCodeGeneration =
    batchState.needsCodeGeneration || needsCodeGeneration;
};

export type ByokExtensionRegenerationCollaborators = {|
  // Full regeneration (code generation of every events function) — the
  // expensive path, needed after any structural change.
  reloadEventsFunctionsExtensions?: (project: any) => Promise<void>,
  // Cheap metadata-only reload of one extension.
  reloadEventsFunctionsExtensionMetadata?: (
    project: any,
    extension: any
  ) => void,
|};

/**
 * Flush the batch: trigger the regeneration the editor needs to make the
 * changes usable (new functions callable in events, behaviors addable…),
 * ONCE for the whole batch of tool calls — the v18 lesson. Called by the
 * orchestrator after its intercepted-tools loop.
 */
export const flushByokExtensionRegeneration = async (
  project: any,
  collaborators: ByokExtensionRegenerationCollaborators
): Promise<void> => {
  const extensionNames = Array.from(batchState.extensionNames);
  const needsCodeGeneration = batchState.needsCodeGeneration;
  resetByokExtensionBatchForTests();
  if (!project || extensionNames.length === 0) return;

  if (needsCodeGeneration && collaborators.reloadEventsFunctionsExtensions) {
    await collaborators.reloadEventsFunctionsExtensions(project);
    return;
  }
  const reloadMetadata = collaborators.reloadEventsFunctionsExtensionMetadata;
  if (!reloadMetadata) return;
  for (const extensionName of extensionNames) {
    if (!project.hasEventsFunctionsExtensionNamed(extensionName)) continue;
    reloadMetadata(project, project.getEventsFunctionsExtension(extensionName));
  }
};

// -----------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------

const makeFailure = (message: string): ByokExtraToolResult => ({
  output: { success: false, message },
  didModifyProject: false,
});

const readRequiredString = (args: Object, name: string): string | null => {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const readOptionalString = (args: Object, name: string): ?string => {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getExtensionOrFailure = (
  project: any,
  extensionName: string
): {| extension: any | null, failure: ByokExtraToolResult | null |} => {
  if (!project.hasEventsFunctionsExtensionNamed(extensionName)) {
    return {
      extension: null,
      failure: makeFailure(
        `No extension named "${extensionName}" in the project — create it with create_extension first.`
      ),
    };
  }
  return {
    extension: project.getEventsFunctionsExtension(extensionName),
    failure: null,
  };
};

/**
 * The plain-text usage list of an extension: the other project extensions
 * depending on it, and the object types using its custom objects or
 * behaviors. Returned by find_extension_usages AND shown before refusing
 * an unsafe delete.
 */
export const findByokExtensionUsages = (
  project: any,
  extension: any
): Array<string> => {
  const usages: Array<string> = [];
  const extensionName = extension.getName();

  const dependents = gd.UsedExtensionsFinder.findExtensionsDependentOn(
    project,
    extension
  ).toJSArray();
  for (const dependent of dependents) {
    usages.push(`extension "${dependent}" depends on it`);
  }

  const eventsBasedObjects = extension.getEventsBasedObjects();
  for (let index = 0; index < eventsBasedObjects.getCount(); index++) {
    const eventsBasedObject = eventsBasedObjects.getAt(index);
    const objectType = `${extensionName}::${eventsBasedObject.getName()}`;
    if (gd.UsedObjectTypeFinder.scanProject(project, objectType)) {
      usages.push(`object type "${objectType}" is used in the project`);
    }
  }

  const eventsBasedBehaviors = extension.getEventsBasedBehaviors();
  for (let index = 0; index < eventsBasedBehaviors.getCount(); index++) {
    const eventsBasedBehavior = eventsBasedBehaviors.getAt(index);
    const usingObjectTypes = gd.WholeProjectRefactorer.getAllObjectTypesUsingEventsBasedBehavior(
      project,
      extension,
      eventsBasedBehavior
    )
      .toNewVectorString()
      .toJSArray();
    for (const usingObjectType of usingObjectTypes) {
      usages.push(
        `behavior "${extensionName}::${eventsBasedBehavior.getName()}" is used by objects of type "${usingObjectType}"`
      );
    }
  }
  return usages;
};

/** Apply [{property_name, new_value}] changes on a properties container. */
const applyPropertyChanges = (
  propertiesContainer: any,
  changedProperties: any
): Array<string> => {
  const applied: Array<string> = [];
  if (!Array.isArray(changedProperties)) return applied;
  for (const change of changedProperties) {
    if (!change || typeof change !== 'object') continue;
    const propertyName = change.property_name;
    const newValue = change.new_value;
    if (typeof propertyName !== 'string' || !propertyName.trim()) continue;
    if (typeof newValue !== 'string') continue;

    const property = propertiesContainer.has(propertyName)
      ? propertiesContainer.get(propertyName)
      : propertiesContainer.insertNew(
          propertyName,
          propertiesContainer.getCount()
        );
    property.setValue(newValue);
    applied.push(propertyName);
  }
  return applied;
};

/** The extension property setters the change tool understands. */
const applyExtensionPropertyChanges = (
  extension: any,
  changedProperties: any
): Array<string> => {
  const applied: Array<string> = [];
  if (!Array.isArray(changedProperties)) return applied;
  for (const change of changedProperties) {
    if (!change || typeof change !== 'object') continue;
    const propertyName = change.property_name;
    const newValue = change.new_value;
    if (typeof propertyName !== 'string' || typeof newValue !== 'string') {
      continue;
    }
    switch (propertyName) {
      case 'full_name':
        extension.setFullName(newValue);
        break;
      case 'short_description':
        extension.setShortDescription(newValue);
        break;
      case 'description':
        extension.setDescription(newValue);
        break;
      case 'version':
        extension.setVersion(newValue);
        break;
      case 'author':
        extension.setAuthor(newValue);
        break;
      case 'category':
        extension.setCategory(newValue);
        break;
      case 'icon_url':
        extension.setIconUrl(newValue);
        break;
      case 'preview_icon_url':
        extension.setPreviewIconUrl(newValue);
        break;
      case 'help_path':
        extension.setHelpPath(newValue);
        break;
      default:
        continue;
    }
    applied.push(propertyName);
  }
  return applied;
};

/**
 * Replace the whole events list of an events function with EventScript
 * source (the Phase 5 writer pipeline: parse → gd round-trip → replace).
 * Returns null on success, a failure result otherwise.
 */
const writeFunctionEventsFromScript = (
  project: any,
  eventsFunction: any,
  eventScript: string
): ByokExtraToolResult | null => {
  const parseResult = parseByokEventScript(eventScript);
  if (parseResult.error) {
    return makeFailure(
      `The EventScript of the function is not valid (line ${
        parseResult.error.lineNumber
      }, column ${parseResult.error.columnNumber}): ${
        parseResult.error.message
      }`
    );
  }
  const eventsList = new gd.EventsList();
  try {
    unserializeFromJSObject(
      eventsList,
      parseResult.events,
      'unserializeFrom',
      project
    );
    eventsFunction.getEvents().clear();
    eventsFunction.getEvents().insertEvents(eventsList, 0, true);
    return null;
  } catch (error) {
    return makeFailure(
      `The events of the function could not be applied: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    eventsList.delete();
  }
};

/**
 * Refactor the project after an existing parameter changed type — the same
 * hook the extension editor triggers on a type change
 * (onFunctionParameterTypeChanged → WholeProjectRefactorer.changeParameterType,
 * with the function's parameters exposed as the scope's objects container).
 * The parameter type must already be set when this runs (the editor sets it
 * before refactoring too).
 */
const refactorParameterTypeChange = (
  project: any,
  extension: any,
  args: Object,
  eventsFunction: any,
  parameterName: string
): void => {
  const customBehaviorName = readOptionalString(args, 'custom_behavior_name');
  const customObjectName = readOptionalString(args, 'custom_object_name');
  const eventsBasedBehavior = customBehaviorName
    ? extension.getEventsBasedBehaviors().get(customBehaviorName)
    : null;
  const eventsBasedObject = customObjectName
    ? extension.getEventsBasedObjects().get(customObjectName)
    : null;

  const parameterObjects = new gd.ObjectsContainer(
    gd.ObjectsContainer.Function
  );
  const parameterVariables = new gd.VariablesContainer(
    gd.VariablesContainer.Parameters
  );
  const parameterResources = new gd.ResourcesContainer(
    gd.ResourcesContainer.Parameters
  );
  const propertyVariables = new gd.VariablesContainer(
    gd.VariablesContainer.Properties
  );
  const propertyResources = new gd.ResourcesContainer(
    gd.ResourcesContainer.Properties
  );
  try {
    let projectScopedContainers;
    if (eventsBasedBehavior) {
      projectScopedContainers = gd.ProjectScopedContainers.makeNewProjectScopedContainersForBehaviorEventsFunction(
        project,
        extension,
        eventsBasedBehavior,
        eventsFunction,
        parameterObjects,
        parameterVariables,
        propertyVariables,
        parameterResources,
        propertyResources
      );
    } else if (eventsBasedObject) {
      projectScopedContainers = gd.ProjectScopedContainers.makeNewProjectScopedContainersForObjectEventsFunction(
        project,
        extension,
        eventsBasedObject,
        eventsFunction,
        parameterObjects,
        parameterVariables,
        propertyVariables,
        parameterResources,
        propertyResources
      );
    } else {
      projectScopedContainers = gd.ProjectScopedContainers.makeNewProjectScopedContainersForFreeEventsFunction(
        project,
        extension,
        eventsFunction,
        parameterObjects,
        parameterVariables,
        parameterResources
      );
    }
    gd.WholeProjectRefactorer.changeParameterType(
      project,
      projectScopedContainers,
      eventsFunction,
      parameterObjects,
      parameterName
    );
  } finally {
    parameterObjects.delete();
    parameterVariables.delete();
    parameterResources.delete();
    propertyVariables.delete();
    propertyResources.delete();
  }
};

/**
 * Apply the parameter operations of change_custom_function (Phase 11):
 * parameters_to_add / parameters_to_remove / parameters_to_move, executed
 * in that order. Returns one message per applied change; a wrong name or a
 * duplicate is skipped with the reason (the rest still applies).
 * Naming an existing parameter with a type changes that parameter's type
 * (with the project-wide usage refactor); without a type it stays a skip.
 */
export const applyFunctionParameterChanges = (
  project: any,
  extension: any,
  eventsFunction: any,
  args: Object
): Array<string> => {
  const parameters = eventsFunction.getParameters();
  const messages: Array<string> = [];

  if (Array.isArray(args.parameters_to_add)) {
    for (const parameter of args.parameters_to_add) {
      if (!parameter || typeof parameter !== 'object') continue;
      const name =
        typeof parameter.name === 'string' ? parameter.name.trim() : '';
      if (!name) {
        messages.push('skipped an unnamed parameter');
        continue;
      }
      if (parameters.hasParameterNamed(name)) {
        const metadata = parameters.getParameter(name);
        const newType =
          typeof parameter.type === 'string' ? parameter.type : '';
        if (!newType || newType === metadata.getType()) {
          messages.push(`"${name}" already exists (skipped)`);
          continue;
        }
        metadata.setType(newType);
        if (typeof parameter.description === 'string') {
          metadata.setDescription(parameter.description);
        }
        refactorParameterTypeChange(
          project,
          extension,
          args,
          eventsFunction,
          name
        );
        messages.push(`changed the type of "${name}" to ${newType}`);
        continue;
      }
      const metadata = parameters.insertNewParameter(
        name,
        parameters.getParametersCount()
      );
      metadata.setType(
        typeof parameter.type === 'string' ? parameter.type : 'expression'
      );
      if (typeof parameter.description === 'string') {
        metadata.setDescription(parameter.description);
      }
      messages.push(`added "${name}"`);
    }
  }

  if (Array.isArray(args.parameters_to_remove)) {
    for (const name of args.parameters_to_remove) {
      if (typeof name !== 'string') continue;
      if (!parameters.hasParameterNamed(name)) {
        messages.push(`"${name}" not found (skipped)`);
        continue;
      }
      parameters.removeParameter(name);
      messages.push(`removed "${name}"`);
    }
  }

  if (Array.isArray(args.parameters_to_move)) {
    for (const move of args.parameters_to_move) {
      if (!move || typeof move !== 'object') continue;
      const name = typeof move.name === 'string' ? move.name : '';
      const toIndex = move.to_index;
      if (!name || typeof toIndex !== 'number') {
        messages.push('skipped an invalid move');
        continue;
      }
      const boundedIndex = Math.max(
        0,
        Math.min(Math.round(toIndex), parameters.getParametersCount() - 1)
      );
      let fromIndex = -1;
      for (let index = 0; index < parameters.getParametersCount(); index++) {
        if (parameters.getParameterAt(index).getName() === name) {
          fromIndex = index;
          break;
        }
      }
      if (fromIndex === -1) {
        messages.push(`"${name}" not found (skipped)`);
        continue;
      }
      parameters.moveParameter(fromIndex, boundedIndex);
      messages.push(`moved "${name}" to ${boundedIndex}`);
    }
  }

  return messages;
};

/**
 * Whether a child object name appears in the events of any function of the
 * custom object (quoted, to limit false positives) — the usage guard of
 * children_to_remove. A custom object has no separate events sheet: its
 * logic IS its functions' events. Conservative: a false positive only
 * refuses and asks the model to read the events first.
 */
export const isChildObjectNameUsedInEvents = (
  eventsBasedObject: any,
  childObjectName: string
): boolean => {
  const functions = eventsBasedObject.getEventsFunctions();
  const quotedName = JSON.stringify(childObjectName);
  for (let index = 0; index < functions.getEventsFunctionsCount(); index++) {
    if (
      serializeToJSON(
        functions.getEventsFunctionAt(index).getEvents()
      ).includes(quotedName)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Apply the optional initial property values of a children_to_add entry to
 * the created child object (its configuration's properties — a custom
 * object type exposes its properties there, a plain Sprite has none).
 * Unknown property names are reported in the messages, not fatal: the
 * child is created either way.
 */
const applyChildInitialProperties = (
  createdObject: any,
  child: Object,
  childName: string,
  messages: Array<string>
): void => {
  if (!Array.isArray(child.initial_properties)) return;
  for (const property of child.initial_properties) {
    if (!property || typeof property !== 'object') continue;
    const propertyName =
      typeof property.name === 'string' ? property.name.trim() : '';
    if (!propertyName) continue;
    const applied = createdObject
      .getConfiguration()
      .updateProperty(propertyName, String(property.value));
    if (!applied) {
      messages.push(
        `property "${propertyName}" not applied to "${childName}" (its type has no such property)`
      );
    }
  }
};

/**
 * Apply the children operations of change_custom_object (Phase 11):
 * children_to_add (name + object type + optional initial property values)
 * and children_to_remove (guarded by the usage check). Returns the
 * messages; nothing is applied when the guard refuses (the failure is
 * returned instead).
 */
export const applyCustomObjectChildrenChanges = (
  project: any,
  eventsBasedObject: any,
  args: Object
): {| messages: Array<string>, failure: ByokExtraToolResult | null |} => {
  const messages: Array<string> = [];
  const childObjects = eventsBasedObject.getObjects();

  if (Array.isArray(args.children_to_add)) {
    for (const child of args.children_to_add) {
      if (!child || typeof child !== 'object') continue;
      const name = typeof child.name === 'string' ? child.name.trim() : '';
      const objectType =
        typeof child.object_type === 'string' ? child.object_type : '';
      if (!name || !objectType) {
        messages.push('skipped a child without name or object_type');
        continue;
      }
      if (childObjects.hasObjectNamed(name)) {
        messages.push(`"${name}" already exists (skipped)`);
        continue;
      }
      childObjects.insertNewObject(
        project,
        objectType,
        name,
        childObjects.getObjectsCount()
      );
      messages.push(`added child "${name}" (${objectType})`);
      applyChildInitialProperties(
        childObjects.getObject(name),
        child,
        name,
        messages
      );
    }
  }

  if (Array.isArray(args.children_to_remove)) {
    for (const name of args.children_to_remove) {
      if (typeof name !== 'string') continue;
      if (!childObjects.hasObjectNamed(name)) {
        messages.push(`"${name}" not found (skipped)`);
        continue;
      }
      if (isChildObjectNameUsedInEvents(eventsBasedObject, name)) {
        return {
          messages: [],
          failure: makeFailure(
            `Child "${name}" is used by the custom object's events — read them (they live in the object's functions), remove the usages, then remove the child.`
          ),
        };
      }
      childObjects.removeObject(name);
      messages.push(`removed child "${name}"`);
    }
  }

  return { messages, failure: null };
};

/** The current dependency list of an extension, as plain names. */
export const listByokExtensionDependencies = (
  extension: any
): Array<string> => {
  const dependencies = extension.getAllDependencies();
  const names: Array<string> = [];
  for (let index = 0; index < dependencies.size(); index++) {
    names.push(dependencies.at(index).getName());
  }
  return names;
};

/**
 * Apply the dependency operations of change_extension_properties
 * (Phase 11): dependencies_to_add / dependencies_to_remove.
 */
export const applyExtensionDependencyChanges = (
  extension: any,
  args: Object
): {| messages: Array<string>, failure: ByokExtraToolResult | null |} => {
  const messages: Array<string> = [];

  if (Array.isArray(args.dependencies_to_add)) {
    for (const dependency of args.dependencies_to_add) {
      if (!dependency || typeof dependency !== 'object') continue;
      const name =
        typeof dependency.name === 'string' ? dependency.name.trim() : '';
      if (!name) {
        messages.push('skipped an unnamed dependency');
        continue;
      }
      if (listByokExtensionDependencies(extension).includes(name)) {
        messages.push(`"${name}" already exists (skipped)`);
        continue;
      }
      const metadata = extension.addDependency();
      metadata.setName(name);
      metadata.setExportName(
        typeof dependency.export_name === 'string' && dependency.export_name
          ? dependency.export_name
          : name
      );
      metadata.setVersion(
        typeof dependency.version === 'string' && dependency.version
          ? dependency.version
          : '1.0.0'
      );
      metadata.setDependencyType(
        dependency.dependency_type === 'npm' ? 'npm' : 'cordova'
      );
      messages.push(`added dependency "${name}"`);
    }
  }

  if (Array.isArray(args.dependencies_to_remove)) {
    for (const name of args.dependencies_to_remove) {
      if (typeof name !== 'string') continue;
      const dependencies = extension.getAllDependencies();
      let index = -1;
      for (let position = 0; position < dependencies.size(); position++) {
        if (dependencies.at(position).getName() === name) {
          index = position;
          break;
        }
      }
      if (index === -1) {
        messages.push(`"${name}" not found (skipped)`);
        continue;
      }
      extension.removeDependencyAt(index);
      messages.push(`removed dependency "${name}"`);
    }
  }

  return { messages, failure: null };
};

/** Map a function_type string to the gd.EventsFunction enum value. */
const readFunctionType = (value: any): number | null => {
  switch (value) {
    case 'Action':
      return gd.EventsFunction.Action;
    case 'Condition':
      return gd.EventsFunction.Condition;
    case 'Expression':
      return gd.EventsFunction.Expression;
    case 'ExpressionAndCondition':
      return gd.EventsFunction.ExpressionAndCondition;
    case 'ActionWithOperator':
      return gd.EventsFunction.ActionWithOperator;
    default:
      return null;
  }
};

/**
 * Resolve the functions container addressed by a call: the extension
 * itself, or the behavior / custom object inside it.
 */
const getFunctionsContainerOrFailure = (
  extension: any,
  args: Object
): {|
  functionsContainer: any | null,
  failure: ByokExtraToolResult | null,
|} => {
  const customBehaviorName = readOptionalString(args, 'custom_behavior_name');
  if (customBehaviorName) {
    const behaviors = extension.getEventsBasedBehaviors();
    if (!behaviors.has(customBehaviorName)) {
      return {
        functionsContainer: null,
        failure: makeFailure(
          `No custom behavior named "${customBehaviorName}" in the extension.`
        ),
      };
    }
    return {
      functionsContainer: behaviors
        .get(customBehaviorName)
        .getEventsFunctions(),
      failure: null,
    };
  }
  const customObjectName = readOptionalString(args, 'custom_object_name');
  if (customObjectName) {
    const objects = extension.getEventsBasedObjects();
    if (!objects.has(customObjectName)) {
      return {
        functionsContainer: null,
        failure: makeFailure(
          `No custom object named "${customObjectName}" in the extension.`
        ),
      };
    }
    return {
      functionsContainer: objects.get(customObjectName).getEventsFunctions(),
      failure: null,
    };
  }
  return {
    functionsContainer: extension.getEventsFunctions(),
    failure: null,
  };
};

// -----------------------------------------------------------------------
// The tools
// -----------------------------------------------------------------------

const createExtensionTool: ByokExtraTool = {
  name: 'create_extension',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');

    if (project.hasEventsFunctionsExtensionNamed(extensionName)) {
      return makeFailure(
        `An extension named "${extensionName}" already exists — use change_extension_properties to modify it.`
      );
    }

    const extension = project.insertNewEventsFunctionsExtension(
      extensionName,
      project.getEventsFunctionsExtensionsCount()
    );
    extension.setName(extensionName);
    const fullName = readOptionalString(args, 'full_name');
    if (fullName) extension.setFullName(fullName);
    const shortDescription = readOptionalString(args, 'short_description');
    if (shortDescription) extension.setShortDescription(shortDescription);
    const description = readOptionalString(args, 'description');
    if (description) extension.setDescription(description);
    const version = readOptionalString(args, 'version');
    if (version) extension.setVersion(version);
    const author = readOptionalString(args, 'author');
    if (author) extension.setAuthor(author);
    const category = readOptionalString(args, 'category');
    if (category) extension.setCategory(category);
    // A project extension is authored here: no store origin.
    extension.setOrigin('', '');

    markExtensionModified(extensionName, false);
    return {
      output: {
        success: true,
        message: `Extension "${extensionName}" created (empty). Add functions with create_custom_function, custom objects or behaviors next.`,
        extension_name: extensionName,
      },
      didModifyProject: true,
    };
  },
};

const changeExtensionPropertiesTool: ByokExtraTool = {
  name: 'change_extension_properties',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');

    if (args.delete_this_extension === true) {
      const usages = findByokExtensionUsages(project, extension);
      if (usages.length > 0 && args.delete_even_if_used !== true) {
        return makeFailure(
          `The extension is still used: ${usages.join(
            '; '
          )}. Pass delete_even_if_used: true to delete anyway (the usages will break).`
        );
      }
      project.removeEventsFunctionsExtension(extensionName);
      markExtensionModified(extensionName, true);
      return {
        output: {
          success: true,
          message: `Extension "${extensionName}" deleted.`,
        },
        didModifyProject: true,
      };
    }

    const messages: Array<string> = [];
    const newName = readOptionalString(args, 'new_name');
    if (newName && newName !== extensionName) {
      const safeName = gd.Project.getSafeName(newName);
      if (project.hasEventsFunctionsExtensionNamed(safeName)) {
        return makeFailure(`An extension named "${safeName}" already exists.`);
      }
      gd.WholeProjectRefactorer.renameEventsFunctionsExtension(
        project,
        extension,
        extensionName,
        safeName
      );
      extension.setName(safeName);
      extension.setOrigin('', '');
      messages.push(`renamed to "${safeName}"`);
      markExtensionModified(safeName, true);
    } else {
      markExtensionModified(extensionName, false);
    }

    const appliedProperties = applyExtensionPropertyChanges(
      extension,
      args.changed_properties
    );
    if (appliedProperties.length > 0) {
      messages.push(`properties changed: ${appliedProperties.join(', ')}`);
    }

    const dependencies = applyExtensionDependencyChanges(extension, args);
    if (dependencies.failure) return dependencies.failure;
    if (dependencies.messages.length > 0) {
      messages.push(`dependencies: ${dependencies.messages.join(', ')}`);
    }

    if (messages.length === 0) {
      return makeFailure(
        'Nothing to change: pass new_name, changed_properties, dependencies_to_add/dependencies_to_remove or delete_this_extension.'
      );
    }
    return {
      output: {
        success: true,
        message: `Extension updated (${messages.join('; ')}).`,
        dependencies: listByokExtensionDependencies(extension),
      },
      didModifyProject: true,
    };
  },
};

const createCustomObjectTool: ByokExtraTool = {
  name: 'create_custom_object',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const customObjectName = readRequiredString(args, 'custom_object_name');
    if (!customObjectName) return makeFailure('Missing custom_object_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');

    const objects = extension.getEventsBasedObjects();
    if (objects.has(customObjectName)) {
      return makeFailure(
        `A custom object named "${customObjectName}" already exists in the extension.`
      );
    }
    const eventsBasedObject = objects.insertNew(
      customObjectName,
      objects.getCount()
    );
    eventsBasedObject.setName(customObjectName);
    const fullName = readOptionalString(args, 'full_name');
    if (fullName) eventsBasedObject.setFullName(fullName);
    const description = readOptionalString(args, 'description');
    if (description) eventsBasedObject.setDescription(description);
    const defaultName = readOptionalString(args, 'default_name');
    if (defaultName) eventsBasedObject.setDefaultName(defaultName);
    if (args.is_3d === true) eventsBasedObject.markAsRenderedIn3D(true);
    if (args.is_animatable === true) eventsBasedObject.markAsAnimatable(true);
    if (args.is_text_container === true) {
      eventsBasedObject.markAsTextContainer(true);
    }
    // A composed object needs at least one layer to hold its children.
    if (eventsBasedObject.getLayers().getLayersCount() === 0) {
      eventsBasedObject.getLayers().insertNewLayer('', 0);
    }
    gd.WholeProjectRefactorer.ensureObjectEventsFunctionsProperParameters(
      extension,
      eventsBasedObject
    );

    const objectType = `${extensionName}::${customObjectName}`;
    markExtensionModified(extensionName, true);
    return {
      output: {
        success: true,
        message: `Custom object created with type "${objectType}". Add child objects and its functions next (create_custom_function with custom_object_name).`,
        extension_name: extensionName,
        custom_object_name: customObjectName,
        object_type: objectType,
      },
      didModifyProject: true,
    };
  },
};

const changeCustomObjectTool: ByokExtraTool = {
  name: 'change_custom_object',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const customObjectName = readRequiredString(args, 'custom_object_name');
    if (!customObjectName) return makeFailure('Missing custom_object_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');

    const objects = extension.getEventsBasedObjects();
    if (!objects.has(customObjectName)) {
      return makeFailure(
        `No custom object named "${customObjectName}" in the extension.`
      );
    }
    const eventsBasedObject = objects.get(customObjectName);

    if (args.delete_this_custom_object === true) {
      const objectType = `${extensionName}::${customObjectName}`;
      if (
        gd.UsedObjectTypeFinder.scanProject(project, objectType) &&
        args.delete_even_if_used !== true
      ) {
        return makeFailure(
          `The object type "${objectType}" is used in the project. Pass delete_even_if_used: true to delete anyway (the usages will break).`
        );
      }
      objects.remove(customObjectName);
      markExtensionModified(extensionName, true);
      return {
        output: { success: true, message: 'Custom object deleted.' },
        didModifyProject: true,
      };
    }

    const messages: Array<string> = [];
    const newName = readOptionalString(args, 'new_name');
    if (newName && newName !== customObjectName) {
      const safeName = gd.Project.getSafeName(newName);
      if (objects.has(safeName)) {
        return makeFailure(
          `A custom object named "${safeName}" already exists in the extension.`
        );
      }
      gd.WholeProjectRefactorer.renameEventsBasedObject(
        project,
        extension,
        customObjectName,
        safeName
      );
      eventsBasedObject.setName(safeName);
      messages.push(`renamed to "${safeName}"`);
    }

    const fullName = readOptionalString(args, 'full_name');
    if (fullName) eventsBasedObject.setFullName(fullName);
    const description = readOptionalString(args, 'description');
    if (description) eventsBasedObject.setDescription(description);
    const defaultName = readOptionalString(args, 'default_name');
    if (defaultName) eventsBasedObject.setDefaultName(defaultName);

    const appliedProperties = applyPropertyChanges(
      eventsBasedObject.getPropertyDescriptors(),
      args.changed_properties
    );
    if (appliedProperties.length > 0) {
      messages.push(`properties: ${appliedProperties.join(', ')}`);
    }

    const children = applyCustomObjectChildrenChanges(
      project,
      eventsBasedObject,
      args
    );
    if (children.failure) return children.failure;
    if (children.messages.length > 0) {
      messages.push(`children: ${children.messages.join(', ')}`);
    }

    if (messages.length === 0 && !fullName && !description && !defaultName) {
      return makeFailure(
        'Nothing to change: pass new_name, full_name, description, default_name, changed_properties, children_to_add/children_to_remove or delete_this_custom_object.'
      );
    }
    gd.WholeProjectRefactorer.ensureObjectEventsFunctionsProperParameters(
      extension,
      eventsBasedObject
    );
    markExtensionModified(extensionName, true);
    return {
      output: {
        success: true,
        message: `Custom object updated (${messages.join('; ')}).`,
      },
      didModifyProject: true,
    };
  },
};

const createCustomBehaviorTool: ByokExtraTool = {
  name: 'create_custom_behavior',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const customBehaviorName = readRequiredString(args, 'custom_behavior_name');
    if (!customBehaviorName)
      return makeFailure('Missing custom_behavior_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');

    const behaviors = extension.getEventsBasedBehaviors();
    if (behaviors.has(customBehaviorName)) {
      return makeFailure(
        `A custom behavior named "${customBehaviorName}" already exists in the extension.`
      );
    }
    const eventsBasedBehavior = behaviors.insertNew(
      customBehaviorName,
      behaviors.getCount()
    );
    eventsBasedBehavior.setName(customBehaviorName);
    const fullName = readOptionalString(args, 'full_name');
    if (fullName) eventsBasedBehavior.setFullName(fullName);
    const description = readOptionalString(args, 'description');
    if (description) eventsBasedBehavior.setDescription(description);
    const objectType = readOptionalString(args, 'object_type');
    if (objectType) eventsBasedBehavior.setObjectType(objectType);
    gd.WholeProjectRefactorer.ensureBehaviorEventsFunctionsProperParameters(
      extension,
      eventsBasedBehavior
    );
    gd.WholeProjectRefactorer.updateBehaviorsSharedData(project);

    const behaviorType = `${extensionName}::${customBehaviorName}`;
    markExtensionModified(extensionName, true);
    return {
      output: {
        success: true,
        message: `Custom behavior created with type "${behaviorType}". Add its functions next (create_custom_function with custom_behavior_name).`,
        extension_name: extensionName,
        custom_behavior_name: customBehaviorName,
        behavior_type: behaviorType,
      },
      didModifyProject: true,
    };
  },
};

const changeCustomBehaviorTool: ByokExtraTool = {
  name: 'change_custom_behavior',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const customBehaviorName = readRequiredString(args, 'custom_behavior_name');
    if (!customBehaviorName)
      return makeFailure('Missing custom_behavior_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');

    const behaviors = extension.getEventsBasedBehaviors();
    if (!behaviors.has(customBehaviorName)) {
      return makeFailure(
        `No custom behavior named "${customBehaviorName}" in the extension.`
      );
    }
    const eventsBasedBehavior = behaviors.get(customBehaviorName);

    if (args.delete_this_custom_behavior === true) {
      const usingObjectTypes = gd.WholeProjectRefactorer.getAllObjectTypesUsingEventsBasedBehavior(
        project,
        extension,
        eventsBasedBehavior
      )
        .toNewVectorString()
        .toJSArray();
      if (usingObjectTypes.length > 0 && args.delete_even_if_used !== true) {
        return makeFailure(
          `The behavior is still used by objects of type: ${usingObjectTypes.join(
            ', '
          )}. Pass delete_even_if_used: true to delete anyway.`
        );
      }
      behaviors.remove(customBehaviorName);
      markExtensionModified(extensionName, true);
      return {
        output: { success: true, message: 'Custom behavior deleted.' },
        didModifyProject: true,
      };
    }

    const messages: Array<string> = [];
    const newName = readOptionalString(args, 'new_name');
    if (newName && newName !== customBehaviorName) {
      const safeName = gd.Project.getSafeName(newName);
      if (behaviors.has(safeName)) {
        return makeFailure(
          `A custom behavior named "${safeName}" already exists in the extension.`
        );
      }
      gd.WholeProjectRefactorer.renameEventsBasedBehavior(
        project,
        extension,
        customBehaviorName,
        safeName
      );
      eventsBasedBehavior.setName(safeName);
      messages.push(`renamed to "${safeName}"`);
    }

    const fullName = readOptionalString(args, 'full_name');
    if (fullName) eventsBasedBehavior.setFullName(fullName);
    const description = readOptionalString(args, 'description');
    if (description) eventsBasedBehavior.setDescription(description);
    const objectType = readOptionalString(args, 'object_type');
    if (objectType) eventsBasedBehavior.setObjectType(objectType);

    const appliedProperties = applyPropertyChanges(
      eventsBasedBehavior.getPropertyDescriptors(),
      args.changed_properties
    );
    if (appliedProperties.length > 0) {
      messages.push(`properties: ${appliedProperties.join(', ')}`);
    }

    if (messages.length === 0 && !fullName && !description && !objectType) {
      return makeFailure(
        'Nothing to change: pass new_name, full_name, description, object_type, changed_properties or delete_this_custom_behavior.'
      );
    }
    gd.WholeProjectRefactorer.ensureBehaviorEventsFunctionsProperParameters(
      extension,
      eventsBasedBehavior
    );
    markExtensionModified(extensionName, true);
    return {
      output: {
        success: true,
        message: `Custom behavior updated (${messages.join('; ')}).`,
      },
      didModifyProject: true,
    };
  },
};

const createCustomFunctionTool: ByokExtraTool = {
  name: 'create_custom_function',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const functionName = readRequiredString(args, 'function_name');
    if (!functionName) return makeFailure('Missing function_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');
    const container = getFunctionsContainerOrFailure(extension, args);
    // A local binding: Flow refines it (the property itself stays any | null).
    const functionsContainer = container.functionsContainer;
    if (!functionsContainer) {
      return container.failure || makeFailure('Unknown error.');
    }

    if (functionsContainer.hasEventsFunctionNamed(functionName)) {
      return makeFailure(
        `A function named "${functionName}" already exists in this scope — use change_custom_function to modify it.`
      );
    }

    const functionType = readFunctionType(args.function_type);
    if (functionType === null) {
      return makeFailure(
        'Missing or invalid function_type: Action, Condition, Expression, ExpressionAndCondition or ActionWithOperator.'
      );
    }

    const eventsFunction = functionsContainer.insertNewEventsFunction(
      functionName,
      functionsContainer.getEventsFunctionsCount()
    );
    eventsFunction.setName(functionName);
    eventsFunction.setFunctionType(functionType);
    const fullName = readOptionalString(args, 'full_name');
    if (fullName) eventsFunction.setFullName(fullName);
    const description = readOptionalString(args, 'description');
    if (description) eventsFunction.setDescription(description);
    const sentence = readOptionalString(args, 'sentence');
    if (sentence) eventsFunction.setSentence(sentence);
    const group = readOptionalString(args, 'group');
    if (group) eventsFunction.setGroup(group);
    if (args.is_private === true) eventsFunction.setPrivate(true);
    if (args.is_async === true) eventsFunction.setAsync(true);

    // The typed parameters, in order.
    if (Array.isArray(args.parameters)) {
      for (const parameter of args.parameters) {
        if (!parameter || typeof parameter !== 'object') continue;
        const name =
          typeof parameter.name === 'string' ? parameter.name.trim() : '';
        if (!name) continue;
        const parameterMetadata = eventsFunction
          .getParameters()
          .insertNewParameter(
            name,
            eventsFunction.getParameters().getParametersCount()
          );
        parameterMetadata.setName(name);
        parameterMetadata.setType(
          typeof parameter.type === 'string' ? parameter.type : 'expression'
        );
        if (typeof parameter.description === 'string') {
          parameterMetadata.setDescription(parameter.description);
        }
      }
    }

    const eventScript = readOptionalString(args, 'event_script');
    if (eventScript) {
      const writeFailure = writeFunctionEventsFromScript(
        project,
        eventsFunction,
        eventScript
      );
      if (writeFailure) return writeFailure;
    }

    markExtensionModified(extensionName, true);
    return {
      output: {
        success: true,
        message: `Function "${functionName}" created (${String(
          args.function_type
        )}).`,
        extension_name: extensionName,
        function_name: functionName,
      },
      didModifyProject: true,
    };
  },
};

const changeCustomFunctionTool: ByokExtraTool = {
  name: 'change_custom_function',
  modifiesProject: true,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const functionName = readRequiredString(args, 'function_name');
    if (!functionName) return makeFailure('Missing function_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');
    const container = getFunctionsContainerOrFailure(extension, args);
    // A local binding: Flow refines it (the property itself stays any | null).
    const functionsContainer = container.functionsContainer;
    if (!functionsContainer) {
      return container.failure || makeFailure('Unknown error.');
    }

    if (!functionsContainer.hasEventsFunctionNamed(functionName)) {
      return makeFailure(`No function named "${functionName}" in this scope.`);
    }
    const eventsFunction = functionsContainer.getEventsFunction(functionName);

    if (args.delete_this_function === true) {
      functionsContainer.removeEventsFunction(functionName);
      markExtensionModified(extensionName, true);
      return {
        output: {
          success: true,
          message: `Function "${functionName}" deleted.`,
        },
        didModifyProject: true,
      };
    }

    const messages: Array<string> = [];
    const newName = readOptionalString(args, 'new_name');
    if (newName && newName !== functionName) {
      const safeName = gd.Project.getSafeName(newName);
      if (functionsContainer.hasEventsFunctionNamed(safeName)) {
        return makeFailure(
          `A function named "${safeName}" already exists in this scope.`
        );
      }
      // Keep the project-wide references (events calling the function)
      // pointing at the renamed function.
      const customBehaviorName = readOptionalString(
        args,
        'custom_behavior_name'
      );
      const customObjectName = readOptionalString(args, 'custom_object_name');
      if (customBehaviorName) {
        gd.WholeProjectRefactorer.renameBehaviorEventsFunction(
          project,
          extension,
          extension.getEventsBasedBehaviors().get(customBehaviorName),
          functionName,
          safeName
        );
      } else if (customObjectName) {
        gd.WholeProjectRefactorer.renameObjectEventsFunction(
          project,
          extension,
          extension.getEventsBasedObjects().get(customObjectName),
          functionName,
          safeName
        );
      } else {
        gd.WholeProjectRefactorer.renameEventsFunction(
          project,
          extension,
          functionName,
          safeName
        );
      }
      eventsFunction.setName(safeName);
      messages.push(`renamed to "${safeName}"`);
    }

    if (Array.isArray(args.changed_settings)) {
      for (const change of args.changed_settings) {
        if (!change || typeof change !== 'object') continue;
        const propertyName = change.property_name;
        const newValue = change.new_value;
        if (typeof propertyName !== 'string' || typeof newValue !== 'string') {
          continue;
        }
        if (propertyName === 'full_name') eventsFunction.setFullName(newValue);
        else if (propertyName === 'description') {
          eventsFunction.setDescription(newValue);
        } else if (propertyName === 'sentence') {
          eventsFunction.setSentence(newValue);
        } else if (propertyName === 'group') {
          eventsFunction.setGroup(newValue);
        } else if (propertyName === 'is_private') {
          eventsFunction.setPrivate(newValue === 'true');
        } else if (propertyName === 'is_async') {
          eventsFunction.setAsync(newValue === 'true');
        } else continue;
        messages.push(propertyName);
      }
    }

    const parameterMessages = applyFunctionParameterChanges(
      project,
      extension,
      eventsFunction,
      args
    );
    if (parameterMessages.length > 0) {
      messages.push(`parameters: ${parameterMessages.join(', ')}`);
    }

    const eventScript = readOptionalString(args, 'event_script');
    if (eventScript) {
      const writeFailure = writeFunctionEventsFromScript(
        project,
        eventsFunction,
        eventScript
      );
      if (writeFailure) return writeFailure;
      messages.push('events replaced');
    }

    if (messages.length === 0) {
      return makeFailure(
        'Nothing to change: pass new_name, changed_settings, parameters_to_add, parameters_to_remove, parameters_to_move, event_script or delete_this_function.'
      );
    }
    markExtensionModified(extensionName, true);
    return {
      output: {
        success: true,
        message: `Function updated (${messages.join('; ')}).`,
      },
      didModifyProject: true,
    };
  },
};

const findExtensionUsagesTool: ByokExtraTool = {
  name: 'find_extension_usages',
  modifiesProject: false,
  run: async (args, collaborators) => {
    const project = collaborators.getProject();
    const extensionName = readRequiredString(args, 'extension_name');
    if (!extensionName) return makeFailure('Missing extension_name.');
    const { extension, failure } = getExtensionOrFailure(
      project,
      extensionName
    );
    if (failure || !extension) return failure || makeFailure('Unknown error.');

    const usages = findByokExtensionUsages(project, extension);
    return {
      output: {
        success: true,
        message:
          usages.length === 0
            ? `The extension "${extensionName}" is not used anywhere else in the project.`
            : `${usages.length} usage(s) found.`,
        usages,
      },
      didModifyProject: false,
    };
  },
};

/** The extension authoring tools (registered in ByokExtraTools). */
export const getByokExtensionTools = (): Array<ByokExtraTool> => [
  createExtensionTool,
  changeExtensionPropertiesTool,
  createCustomObjectTool,
  changeCustomObjectTool,
  createCustomBehaviorTool,
  changeCustomBehaviorTool,
  createCustomFunctionTool,
  changeCustomFunctionTool,
  findExtensionUsagesTool,
];
