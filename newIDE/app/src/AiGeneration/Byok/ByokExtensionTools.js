// @flow
import {
  editorFunctions,
  editorFunctionsWithoutProject,
} from '../../EditorFunctions';
import { unserializeFromJSObject } from '../../Utils/Serializer';
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
    if (messages.length === 0) {
      return makeFailure(
        'Nothing to change: pass new_name, changed_properties or delete_this_extension.'
      );
    }
    return {
      output: {
        success: true,
        message: `Extension updated (${messages.join('; ')}).`,
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

    if (messages.length === 0 && !fullName && !description && !defaultName) {
      return makeFailure(
        'Nothing to change: pass new_name, full_name, description, default_name, changed_properties or delete_this_custom_object.'
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
        'Nothing to change: pass new_name, changed_settings, event_script or delete_this_function.'
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
